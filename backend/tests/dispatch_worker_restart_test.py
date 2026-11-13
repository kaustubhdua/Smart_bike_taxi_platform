#!/usr/bin/env python3
"""Verify a fresh dispatch-worker process recovers rides created while it was down.

The backend workflow stops the original worker, prepares a persisted ride with
an eligible driver while no dispatcher is running, starts a new worker process,
and asks this script to verify that the new process creates the durable offer.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rf_testkit import (
    book, check, create_account, create_driver, forge_token, go_online, psql,
    wait_for,
)


def prepare():
    _, driver_id = create_driver(approved=True)
    driver_token = forge_token(driver_id, "driver")
    online = go_online(driver_token)
    check(online.status == 200, "driver could not go online: %s %s" % (online.status, online.text))

    _, passenger_id = create_account("passenger")
    passenger_token = forge_token(passenger_id, "passenger")
    ride = book(passenger_token)
    check(ride.status == 201, "booking failed while dispatch worker was stopped: %s %s" %
          (ride.status, ride.text))
    ride_id = ride.json["rideId"]
    # Make this fixture the oldest pending request so unrelated leftovers from
    # earlier suites cannot delay the restart assertion.
    psql("UPDATE rides SET created_at=now()-interval '1 day' WHERE id='%s'" % ride_id)
    offers = psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s'" % ride_id)
    check(offers == "0", "an offer appeared while the dispatch worker was stopped")
    print(ride_id)


def verify(ride_id):
    wait_for(
        lambda: psql("SELECT count(*) FROM ride_offers WHERE ride_id='%s' "
                     "AND status='offered' AND expires_at > now()" % ride_id) == "1",
        timeout=30,
        message="the restarted dispatch worker to create a durable offer",
    )
    status = psql("SELECT status FROM rides WHERE id='%s'" % ride_id)
    check(status == "matching", "restarted worker did not advance ride to matching: %s" % status)
    print("dispatch worker restart recovered pending ride %s" % ride_id)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "prepare":
        prepare()
    elif len(sys.argv) == 3 and sys.argv[1] == "verify":
        verify(sys.argv[2])
    else:
        raise SystemExit("usage: dispatch_worker_restart_test.py prepare | verify RIDE_ID")
