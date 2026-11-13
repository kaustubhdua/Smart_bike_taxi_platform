#!/usr/bin/env python3
"""Concurrency tests for booking, dispatch acceptance, cancellation and status changes.

Each race fires its requests from separate threads released by a barrier, then checks
the outcome through the API responses and, more importantly, the database
invariants that must hold whatever the interleaving:

  * a ride is assigned at most once and a driver holds at most one active ride;
  * an idempotency key or a quote produces at most one ride;
  * a ride's event log is a valid chain that ends in the ride's current status;
  * every event has exactly one outbox row;
  * no request is answered with a 5xx.

Rides and offers are planted in one statement, so the running dispatch worker never
sees a ride without its offer. Run:  python3 backend/tests/concurrency_test.py
"""
import os
import subprocess
import sys
import threading
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rf_testkit import (  # noqa: E402
    Runner, book, check, create_account, create_driver, forge_token, go_online,
    new_quote, psql, request, unique, wait_for,
)

ACTIVE = "('assigned','driver_arriving','in_progress')"
ROUNDS = 6


def race(calls):
    """Run callables simultaneously; return their results in the order given."""
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)
    errors = []

    def runner(index, fn):
        try:
            barrier.wait(timeout=10)
            results[index] = fn()
        except Exception as exc:  # noqa: BLE001 - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=runner, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    check(not errors, "a racing request raised: %r" % (errors,))
    return results


def no_server_errors(responses):
    bad = [r.status for r in responses if r.status >= 500]
    check(not bad, "server errors under concurrency: %s" % bad)


def passenger():
    _, account_id = create_account("passenger")
    return account_id, forge_token(account_id, "passenger")


def online_driver():
    _, driver_id = create_driver(approved=True)
    token = forge_token(driver_id, "driver")
    resp = go_online(token)
    check(resp.status == 200, "driver could not go online: %s %s" % (resp.status, resp.text))
    return driver_id, token


def plant_ride_with_offer(passenger_id, driver_id):
    """Create a matching ride and a live offer to ``driver_id`` in one statement."""
    ride_id = str(uuid.uuid4())
    sql = """
WITH r AS (
  INSERT INTO rides (id, passenger_id, status, pickup_label, pickup_latitude, pickup_longitude,
                     destination_label, destination_latitude, destination_longitude,
                     route_distance_m, quoted_fare_paise, idempotency_key)
  VALUES ('{ride}', '{passenger}', 'matching', 'Planted pickup', 28.53, 77.35,
          'Planted destination', 28.54, 77.36, 2500, 4750, '{key}')
  RETURNING id),
e AS (
  INSERT INTO ride_events (ride_id, previous_status, new_status, details)
  SELECT id, NULL, 'matching', '{{"source":"concurrency_test"}}'::jsonb FROM r)
INSERT INTO ride_offers (ride_id, driver_id) SELECT id, '{driver}' FROM r
""".format(ride=ride_id, passenger=passenger_id, driver=driver_id, key=unique("planted-key"))
    proc = subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                          capture_output=True, text=True)
    check(proc.returncode == 0, "could not plant a ride: " + proc.stderr)
    return ride_id




def plant_ride_without_offer(passenger_id):
    """Create a matching ride with its initial event but no driver offer."""
    ride_id = str(uuid.uuid4())
    sql = """
WITH r AS (
  INSERT INTO rides (id, passenger_id, status, pickup_label, pickup_latitude, pickup_longitude,
                     destination_label, destination_latitude, destination_longitude,
                     route_distance_m, quoted_fare_paise, idempotency_key)
  VALUES ('{ride}', '{passenger}', 'matching', 'Parallel pickup', 28.53, 77.35,
          'Parallel destination', 28.54, 77.36, 2500, 4750, '{key}')
  RETURNING id)
INSERT INTO ride_events (ride_id, previous_status, new_status, details)
SELECT id, NULL, 'matching', '{{"source":"parallel_dispatch_test"}}'::jsonb FROM r
""".format(ride=ride_id, passenger=passenger_id, key=unique("parallel-dispatch"))
    proc = subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                          capture_output=True, text=True)
    check(proc.returncode == 0, "could not plant a matching ride: " + proc.stderr)
    return ride_id

def plant_assigned_ride(passenger_id, driver_id):
    ride_id = plant_ride_with_offer(passenger_id, driver_id)
    psql("UPDATE ride_offers SET status='accepted', responded_at=now() WHERE ride_id='%s'" % ride_id)
    psql("INSERT INTO ride_events (ride_id, previous_status, new_status, details) "
         "VALUES ('%s','matching','assigned','{}'::jsonb)" % ride_id)
    psql("UPDATE rides SET status='assigned', driver_id='%s', assigned_at=now() WHERE id='%s'"
         % (driver_id, ride_id))
    return ride_id


def ride_state(ride_id):
    status, driver = psql("SELECT status, coalesce(driver_id::text,'') FROM rides "
                          "WHERE id='%s'" % ride_id).split("|")
    return status, driver


def event_statuses(ride_id):
    rows = psql("SELECT coalesce(previous_status::text,'-')||'>'||new_status FROM ride_events "
                "WHERE ride_id='%s' ORDER BY id" % ride_id)
    return rows.splitlines()


def assert_ride_consistent(ride_id):
    """Event log is a valid chain ending at the ride's status; outbox mirrors events."""
    rows = psql("SELECT coalesce(previous_status::text,''), new_status::text FROM ride_events "
                "WHERE ride_id='%s' ORDER BY id" % ride_id).splitlines()
    chain = [tuple(row.split("|")) for row in rows]
    for index in range(1, len(chain)):
        check(chain[index][0] == chain[index - 1][1],
              "broken event chain for %s: %s" % (ride_id, event_statuses(ride_id)))
    status, _ = ride_state(ride_id)
    check(chain[-1][1] == status,
          "ride is %s but its last event says %s (%s)" % (status, chain[-1][1], event_statuses(ride_id)))
    events = psql("SELECT count(*) FROM ride_events WHERE ride_id='%s'" % ride_id)
    outbox = psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s'" % ride_id)
    check(events == outbox, "%s events but %s outbox rows" % (events, outbox))


def active_rides_of(driver_id):
    return int(psql("SELECT count(*) FROM rides WHERE driver_id='%s' AND status IN %s"
                    % (driver_id, ACTIVE)))


def accept(ride_id, token):
    return lambda: request("POST", "/api/v1/driver/rides/%s/accept" % ride_id, token=token)


# ---------------------------------------------------------------- assignment

def test_double_submitted_accept_assigns_the_ride_once():
    passenger_id, _ = passenger()
    for _ in range(ROUNDS):
        driver_id, token = online_driver()
        ride_id = plant_ride_with_offer(passenger_id, driver_id)
        responses = race([accept(ride_id, token)] * 8)
        no_server_errors(responses)
        statuses = sorted(r.status for r in responses)
        check(statuses.count(200) == 1, "accept succeeded %d times: %s" % (statuses.count(200), statuses))
        check(all(s in (200, 404, 409) for s in statuses), "unexpected statuses %s" % statuses)
        check(ride_state(ride_id) == ("assigned", driver_id), "ride state %s" % (ride_state(ride_id),))
        check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' AND status='accepted'" % ride_id) == "1",
              "the offer was not accepted exactly once")
        check(event_statuses(ride_id).count("matching>assigned") == 1,
              "assignment was recorded more than once: %s" % event_statuses(ride_id))
        assert_ride_consistent(ride_id)


def test_only_the_offered_driver_wins_when_another_driver_races_them():
    passenger_id, _ = passenger()
    for _ in range(ROUNDS):
        winner_id, winner = online_driver()
        rival_id, rival = online_driver()
        ride_id = plant_ride_with_offer(passenger_id, winner_id)
        responses = race([accept(ride_id, winner), accept(ride_id, rival)])
        no_server_errors(responses)
        check(responses[0].status == 200, "the offered driver lost: %s" % responses[0].status)
        check(responses[1].status in (404, 409), "the rival was answered %s" % responses[1].status)
        check(ride_state(ride_id) == ("assigned", winner_id), "wrong assignee: %s" % (ride_state(ride_id),))
        check(active_rides_of(rival_id) == 0, "the rival was left holding a ride")
        assert_ride_consistent(ride_id)


def test_a_driver_cannot_be_assigned_two_rides_at_once():
    passenger_id, passenger_token = passenger()
    for _ in range(ROUNDS):
        driver_id, token = online_driver()
        first = plant_ride_with_offer(passenger_id, driver_id)
        response = request("POST", "/api/v1/driver/rides/%s/accept" % first, token=token)
        check(response.status == 200, "first ride could not be accepted: %s" % response.status)
        check(ride_state(first) == ("assigned", driver_id), "first ride was not assigned")

        # Once the driver is busy, a second live offer should never be produced
        # by dispatch. Plant one deliberately to exercise the API's final
        # busy-driver guard even if a stale/duplicate offer exists.
        psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
             "current_longitude=NULL,last_location_at=NULL WHERE account_id <> '%s'" % driver_id)
        second = plant_ride_without_offer(passenger_id)
        psql("INSERT INTO ride_offers (ride_id,driver_id) VALUES ('%s','%s')" % (second, driver_id))
        response = request("POST", "/api/v1/driver/rides/%s/accept" % second, token=token)
        check(response.status == 409,
              "busy driver accepted a second ride: %s %s" % (response.status, response.text))
        check(ride_state(first) == ("assigned", driver_id), "first assignment changed")
        check(ride_state(second) == ("matching", ""), "second ride was assigned: %s" % (ride_state(second),))
        check(active_rides_of(driver_id) == 1, "driver holds %d active rides" % active_rides_of(driver_id))
        check(psql("SELECT status FROM ride_offers WHERE ride_id='%s' AND driver_id='%s'"
                   % (second, driver_id)) == "offered",
              "rejected busy-driver acceptance mutated the offer")
        check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' AND status='accepted'"
                   % second) == "0", "busy driver offer was accepted")
        assert_ride_consistent(first)
        assert_ride_consistent(second)

        for ride_id in (first, second):
            cancelled = request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=passenger_token)
            check(cancelled.status == 200, "cleanup cancellation failed: %s" % cancelled.status)
            assert_ride_consistent(ride_id)
        psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
             "current_longitude=NULL,last_location_at=NULL WHERE account_id='%s'" % driver_id)


def test_accept_racing_cancel_never_leaves_a_half_state():
    passenger_id, passenger_token = passenger()
    outcomes = set()
    for _ in range(ROUNDS * 2):
        driver_id, driver_token = online_driver()
        ride_id = plant_ride_with_offer(passenger_id, driver_id)
        responses = race([
            accept(ride_id, driver_token),
            lambda rid=ride_id: request("POST", "/api/v1/rides/%s/cancel" % rid, token=passenger_token),
        ])
        no_server_errors(responses)
        status, _ = ride_state(ride_id)
        outcomes.add(status)
        check(status in ("assigned", "cancelled"), "ride ended as %s" % status)
        if status == "cancelled":
            check(active_rides_of(driver_id) == 0, "driver still holds a cancelled ride")
            check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' AND status='offered'" % ride_id) == "0",
                  "a live offer remained on a cancelled ride")
        else:
            check(responses[1].status in (404, 409), "cancel reported %s but the ride is assigned"
                  % responses[1].status)
        assert_ride_consistent(ride_id)
    print("      accept-vs-cancel outcomes seen: %s" % sorted(outcomes))


def test_expired_driver_offer_cannot_be_accepted():
    passenger_id, _ = passenger()
    driver_id, token = online_driver()
    ride_id = plant_ride_with_offer(passenger_id, driver_id)

    # Remove the driver from eligibility before expiring the offer so the live
    # dispatch worker cannot immediately create a replacement while this test
    # checks that an expired offer itself is never accepted.
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL WHERE account_id='%s'" % driver_id)
    psql("UPDATE ride_offers SET offered_at=now()-interval '2 minutes',"
         "expires_at=now()-interval '1 minute' "
         "WHERE ride_id='%s' AND driver_id='%s' AND status='offered'" % (ride_id, driver_id))

    response = request("POST", "/api/v1/driver/rides/%s/accept" % ride_id, token=token)
    check(response.status in (404, 409),
          "an expired offer was accepted or returned an unexpected status: %s %s"
          % (response.status, response.text))
    check(ride_state(ride_id) == ("matching", ""),
          "an expired offer changed ride assignment: %s" % (ride_state(ride_id),))
    check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' "
               "AND status='accepted'" % ride_id) == "0",
          "an expired offer was persisted as accepted")
    assert_ride_consistent(ride_id)


def test_accept_racing_offer_expiry_never_leaves_a_partial_assignment():
    # Keep this race isolated: the dispatch worker must not immediately offer
    # the same ride to an unrelated driver after the first offer expires.
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL")
    passenger_id, _ = passenger()
    outcomes = set()
    for _ in range(ROUNDS):
        # Plant the explicit offer while the driver is offline, then make the
        # driver eligible. This avoids the dispatcher claiming it for an unrelated
        # pending ride between go_online() and the fixture insert.
        _, driver_id = create_driver(approved=True)
        token = forge_token(driver_id, "driver")
        ride_id = plant_ride_with_offer(passenger_id, driver_id)
        psql("UPDATE driver_profiles SET is_online=true,current_latitude=28.53,"
             "current_longitude=77.35,last_location_at=now() WHERE account_id='%s'" % driver_id)

        def expire_offer():
            # The expiry worker locks and commits the offer row separately; API
            # acceptance holds the ride row and then updates that offer. Whichever
            # wins must commit a complete, internally consistent state.
            return psql(
                "BEGIN; "
                "SELECT id FROM ride_offers WHERE ride_id='%s' AND driver_id='%s' "
                "AND status='offered' FOR UPDATE; "
                "SELECT pg_sleep(0.05); "
                "UPDATE ride_offers SET status='expired',"
                "offered_at=now()-interval '2 minutes',"
                "expires_at=now()-interval '1 minute',responded_at=now() "
                "WHERE ride_id='%s' AND driver_id='%s' AND status='offered'; "
                "COMMIT;"
                % (ride_id, driver_id, ride_id, driver_id)
            )

        response, _ = race([accept(ride_id, token), expire_offer])
        check(response.status in (200, 404, 409),
              "accept-vs-expiry returned unexpected status %s: %s"
              % (response.status, response.text))
        status, assigned_driver = ride_state(ride_id)
        offer_status = psql("SELECT status FROM ride_offers "
                            "WHERE ride_id='%s' AND driver_id='%s'" % (ride_id, driver_id))

        if status == "assigned":
            check(response.status == 200, "ride assigned although accept did not succeed")
            check(assigned_driver == driver_id, "wrong driver won accept-vs-expiry")
            check(offer_status == "accepted", "assigned ride has offer state %s" % offer_status)
            outcomes.add("assigned")
        else:
            check(status == "matching" and assigned_driver == "",
                  "expiry race left unexpected ride state %s/%s" % (status, assigned_driver))
            check(offer_status == "expired", "unassigned ride has offer state %s" % offer_status)
            outcomes.add("expired")

        check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' AND status='offered'"
                   % ride_id) == "0", "accept-vs-expiry left a live offer behind")
        check(event_statuses(ride_id).count("matching>assigned") ==
              (1 if status == "assigned" else 0),
              "assignment event does not match the winning transaction")
        assert_ride_consistent(ride_id)
        psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
             "current_longitude=NULL,last_location_at=NULL WHERE account_id='%s'" % driver_id)

    print("      accept-vs-expiry outcomes seen: %s" % sorted(outcomes))


def test_expired_offer_is_redispatched_to_next_eligible_driver():
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL")
    passenger_id, _ = passenger()
    expired_driver, _ = online_driver()
    next_driver, next_token = online_driver()
    ride_id = plant_ride_with_offer(passenger_id, expired_driver)

    # Leave only the next driver eligible. The worker must consume the expired
    # durable offer and create a new offer instead of losing the matching ride.
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL WHERE account_id='%s'" % expired_driver)
    psql("UPDATE ride_offers SET offered_at=now()-interval '2 minutes',"
         "expires_at=now()-interval '1 minute' "
         "WHERE ride_id='%s' AND driver_id='%s' AND status='offered'"
         % (ride_id, expired_driver))

    deadline = time.monotonic() + 30
    next_offer_count = "0"
    expired_status = "offered"
    while time.monotonic() < deadline:
        expired_status = psql("SELECT status FROM ride_offers WHERE ride_id='%s' "
                              "AND driver_id='%s'" % (ride_id, expired_driver))
        next_offer_count = psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' "
                                "AND driver_id='%s' AND status='offered' AND expires_at>now()"
                                % (ride_id, next_driver))
        if expired_status == "expired" and next_offer_count == "1":
            break
        time.sleep(0.25)

    check(expired_status == "expired", "dispatch worker did not expire the stale offer")
    check(next_offer_count == "1", "dispatch worker did not redispatch to the next eligible driver")
    check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s'" % ride_id) == "2",
          "redispatch did not preserve exactly two offer attempts")

    response = request("POST", "/api/v1/driver/rides/%s/accept" % ride_id, token=next_token)
    check(response.status == 200,
          "redispatched offer could not be accepted: %s %s" % (response.status, response.text))
    check(ride_state(ride_id) == ("assigned", next_driver),
          "redispatched ride was not assigned to the next driver")
    check(psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' AND status='accepted'"
               % ride_id) == "1", "redispatch did not produce exactly one accepted offer")
    assert_ride_consistent(ride_id)
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL WHERE account_id='%s'" % next_driver)





def test_parallel_dispatch_workers_never_offer_one_driver_twice():
    # Run two real worker processes against the same PostgreSQL database. The
    # unique partial index is the final guard; worker-side filtering lets the
    # remaining rides progress to other free drivers after an offer is created.
    worker_bin = os.environ.get("RIDEFORGE_DISPATCH_BIN", "")
    check(worker_bin and os.path.isfile(worker_bin),
          "RIDEFORGE_DISPATCH_BIN must point to the built dispatch worker")
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL")
    passenger_id, _ = passenger()
    drivers = [online_driver()[0] for _ in range(4)]
    rides = [plant_ride_without_offer(passenger_id) for _ in range(12)]

    env = os.environ.copy()
    env["RIDEFORGE_DISPATCH_POLL_MS"] = "100"
    second_worker = subprocess.Popen([worker_bin], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    driver_filter = ",".join("'%s'" % driver_id for driver_id in drivers)
    try:
        def all_drivers_have_one_offer():
            if second_worker.poll() is not None:
                return False
            return int(psql("SELECT count(*) FROM ride_offers WHERE status='offered' "
                            "AND driver_id IN (%s)" % driver_filter)) >= len(drivers)

        wait_for(all_drivers_have_one_offer, timeout=30,
                 message="both dispatch workers to offer one ride to each free driver")
        active = psql("SELECT count(*) FROM ride_offers WHERE status='offered' "
                      "AND driver_id IN (%s)" % driver_filter)
        distinct = psql("SELECT count(DISTINCT driver_id) FROM ride_offers "
                        "WHERE status='offered' AND driver_id IN (%s)" % driver_filter)
        duplicates = psql("SELECT count(*) FROM (SELECT driver_id FROM ride_offers "
                          "WHERE status='offered' AND driver_id IN (%s) "
                          "GROUP BY driver_id HAVING count(*)>1) busy" % driver_filter)
        check(active == str(len(drivers)) and distinct == str(len(drivers)) and duplicates == "0",
              "parallel workers created duplicate active driver offers: active=%s distinct=%s duplicates=%s"
              % (active, distinct, duplicates))
        for ride_id in rides:
            assert_ride_consistent(ride_id)
    finally:
        second_worker.terminate()
        try:
            second_worker.wait(timeout=5)
        except subprocess.TimeoutExpired:
            second_worker.kill()
            second_worker.wait(timeout=5)
        psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
             "current_longitude=NULL,last_location_at=NULL WHERE account_id IN (%s)" % driver_filter)


# ---------------------------------------------------------------- state changes

def test_concurrent_status_updates_apply_exactly_once():
    passenger_id, _ = passenger()
    driver_id, token = online_driver()
    ride_id = plant_assigned_ride(passenger_id, driver_id)

    def update(status):
        return lambda: request("PUT", "/api/v1/driver/rides/%s/status" % ride_id, token=token,
                               body={"status": status})

    for step, expected_event in (("driver_arriving", "assigned>driver_arriving"),
                                 ("in_progress", "driver_arriving>in_progress")):
        responses = race([update(step)] * 6)
        no_server_errors(responses)
        statuses = sorted(r.status for r in responses)
        check(statuses.count(200) == 1, "%s applied %d times: %s" % (step, statuses.count(200), statuses))
        check(all(s in (200, 409) for s in statuses), "unexpected statuses %s" % statuses)
        check(event_statuses(ride_id).count(expected_event) == 1,
              "%s was recorded more than once: %s" % (step, event_statuses(ride_id)))
        assert_ride_consistent(ride_id)


def test_illegal_status_jumps_are_refused_and_leave_no_trace():
    passenger_id, _ = passenger()
    driver_id, token = online_driver()
    ride_id = plant_assigned_ride(passenger_id, driver_id)
    before = event_statuses(ride_id)
    for bad in ("completed", "in_progress", "assigned", "matching", "requested", "cancelled", "bogus"):
        resp = request("PUT", "/api/v1/driver/rides/%s/status" % ride_id, token=token,
                       body={"status": bad})
        check(resp.status in (409, 422), "assigned -> %s returned %s" % (bad, resp.status))
    check(event_statuses(ride_id) == before, "an illegal transition wrote events")
    check(ride_state(ride_id) == ("assigned", driver_id), "an illegal transition changed the ride")

    for step in ("driver_arriving", "in_progress", "completed"):
        resp = request("PUT", "/api/v1/driver/rides/%s/status" % ride_id, token=token,
                       body={"status": step})
        check(resp.status == 200, "%s was refused: %s %s" % (step, resp.status, resp.text))
    for step in ("driver_arriving", "in_progress", "completed"):
        resp = request("PUT", "/api/v1/driver/rides/%s/status" % ride_id, token=token,
                       body={"status": step})
        check(resp.status == 409, "a completed ride accepted %s: %s" % (step, resp.status))
    check(active_rides_of(driver_id) == 0, "the driver is still busy after completing")
    assert_ride_consistent(ride_id)


def test_concurrent_cancellation_is_applied_once():
    _, token = passenger()
    ride_id = book(token).json["rideId"]
    responses = race([lambda: request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token)] * 6)
    no_server_errors(responses)
    statuses = sorted(r.status for r in responses)
    check(statuses.count(200) == 1, "cancel succeeded %d times: %s" % (statuses.count(200), statuses))
    check(all(s in (200, 409) for s in statuses), "unexpected statuses %s" % statuses)
    check(event_statuses(ride_id).count("requested>cancelled") +
          sum(1 for e in event_statuses(ride_id) if e.endswith(">cancelled")) >= 1,
          "no cancellation event: %s" % event_statuses(ride_id))
    check(sum(1 for e in event_statuses(ride_id) if e.endswith(">cancelled")) == 1,
          "cancellation was recorded more than once: %s" % event_statuses(ride_id))
    assert_ride_consistent(ride_id)


# ---------------------------------------------------------------- idempotency

def test_one_idempotency_key_creates_one_ride_under_concurrency():
    passenger_id, token = passenger()
    quote = new_quote()
    key = unique("idem-race")
    responses = race([lambda: book(token, quote_id=quote, key=key)] * 10)
    no_server_errors(responses)
    statuses = sorted(r.status for r in responses)
    check(statuses.count(201) == 1 and statuses.count(200) == 9,
          "want one 201 and nine replays, got %s" % statuses)
    ride_ids = {r.json["rideId"] for r in responses}
    check(len(ride_ids) == 1, "replays returned different rides: %s" % ride_ids)
    check(psql("SELECT count(*) FROM rides WHERE passenger_id='%s' AND idempotency_key='%s'"
               % (passenger_id, key)) == "1", "more than one ride row for the key")

    other_quote = new_quote()
    clash = book(token, quote_id=other_quote, key=key)
    check(clash.status == 409, "same key with another quote returned %s, want 409" % clash.status)
    check(psql("SELECT count(*) FROM rides WHERE passenger_id='%s'" % passenger_id) == "1",
          "a conflicting replay created a ride")


def test_a_quote_cannot_fund_two_rides():
    passenger_id, token = passenger()
    quote = new_quote()
    responses = race([lambda: book(token, quote_id=quote, key=unique("quote-race")) for _ in range(8)])
    no_server_errors(responses)
    statuses = sorted(r.status for r in responses)
    check(statuses.count(201) == 1, "one quote produced %d rides: %s" % (statuses.count(201), statuses))
    check(all(400 <= s < 500 for s in statuses if s != 201), "unexpected statuses %s" % statuses)
    check(psql("SELECT count(*) FROM rides WHERE passenger_id='%s'" % passenger_id) == "1",
          "more than one ride exists for one quote")



def test_an_expired_quote_cannot_be_booked():
    passenger_id, token = passenger()
    quote = new_quote(minutes=1.0 / 60)  # expires one second from now
    time.sleep(2.0)
    resp = book(token, quote_id=quote)
    check(400 <= resp.status < 500, "expired quote returned %s, want a 4xx" % resp.status)
    check(resp.status != 201, "an expired quote produced a ride")
    check(psql("SELECT count(*) FROM rides WHERE passenger_id='%s'" % passenger_id) == "0",
          "an expired quote left a ride behind")


def reset_dispatch_fixtures():
    """Keep the live dispatch worker from carrying offers between tests."""
    psql("UPDATE driver_profiles SET is_online=false,current_latitude=NULL,"
         "current_longitude=NULL,last_location_at=NULL")
    pending = psql(
        "SELECT id::text || '|' || passenger_id::text FROM rides "
        "WHERE status IN ('requested','matching') ORDER BY created_at"
    )
    for row in pending.splitlines():
        ride_id, passenger_id = row.split("|", 1)
        response = request(
            "POST", "/api/v1/rides/%s/cancel" % ride_id,
            token=forge_token(passenger_id, "passenger"))
        check(response.status in (200, 409),
              "could not isolate pending ride %s before concurrency test: %s %s"
              % (ride_id, response.status, response.text))


def isolated(test):
    def run():
        reset_dispatch_fixtures()
        test()
    run.__name__ = test.__name__
    return run


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    tests = [isolated(test) for test in tests]
    runner = Runner("concurrency")
    code = runner.run(tests)
    if code == 0:
        print("PASS: assignment, cancellation, status and idempotency races hold their invariants")
    return code


if __name__ == "__main__":
    sys.exit(main())
