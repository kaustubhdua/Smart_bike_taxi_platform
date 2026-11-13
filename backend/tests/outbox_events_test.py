#!/usr/bin/env python3
"""Transactional outbox and server-sent-event delivery tests.

Needs the API, the outbox worker and PostgreSQL running (same setup as
http_smoke.sh). Rows are planted in specific outbox states inside a single
transaction, so the live worker never sees a half-built row.

Covers: events and outbox rows commit or roll back together; crash recovery through
lease expiry; retry back-off; dead-lettered rows; and SSE delivery that stays
ordered and gap-free when events are published late, out of order or twice.

Run:  python3 backend/tests/outbox_events_test.py
"""
import http.client
import json
import os
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rf_testkit import (  # noqa: E402
    BASE_URL, Runner, book, check, create_account, forge_token, psql, request,
    unique, wait_for,
)


def passenger_with_ride():
    _, passenger_id = create_account("passenger")
    token = forge_token(passenger_id, "passenger")
    ride = book(token)
    check(ride.status == 201, "booking failed: %s %s" % (ride.status, ride.text))
    return passenger_id, token, ride.json["rideId"]


def plant_event(ride_id, new_status, outbox_set):
    """Insert a ride event and adjust its outbox row in the same transaction.

    Returns the event id. ``outbox_set`` is the SET clause applied to the row the
    trigger created, e.g. ``available_at = now() + interval '5 seconds'``."""
    sql = """
DO $$
DECLARE new_id bigint;
BEGIN
  INSERT INTO ride_events (ride_id, previous_status, new_status, details)
  VALUES ('%s', 'requested', '%s', '{"source":"outbox_events_test"}'::jsonb)
  RETURNING id INTO new_id;
  UPDATE ride_event_outbox SET %s WHERE ride_event_id = new_id;
  RAISE NOTICE 'event_id=%%', new_id;
END $$;
""" % (ride_id, new_status, outbox_set)
    proc = subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                          capture_output=True, text=True)
    check(proc.returncode == 0, "plant_event failed: " + proc.stderr)
    for line in proc.stderr.splitlines():
        if "event_id=" in line:
            return int(line.split("event_id=")[1])
    raise AssertionError("event id not reported: " + proc.stderr)


def outbox_row(event_id):
    row = psql("SELECT coalesce(published_at::text,''),attempts,coalesce(last_error,''),"
               "coalesce(dead_lettered_at::text,'') FROM ride_event_outbox "
               "WHERE ride_event_id=%d" % event_id)
    published, attempts, error, dead = row.split("|")
    return {"published": published, "attempts": int(attempts), "error": error, "dead": dead}


# ---------------------------------------------------------------- atomicity

def test_every_event_has_exactly_one_outbox_row():
    _, token, ride_id = passenger_with_ride()
    request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token)
    events = int(psql("SELECT count(*) FROM ride_events WHERE ride_id='%s'" % ride_id))
    check(events >= 2, "expected a requested and a cancelled event, got %d" % events)
    check(int(psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s'" % ride_id)) == events,
          "outbox row count differs from event count")
    orphans = psql("SELECT count(*) FROM ride_events e WHERE NOT EXISTS "
                   "(SELECT 1 FROM ride_event_outbox o WHERE o.ride_event_id=e.id)")
    check(orphans == "0", "%s events have no outbox row anywhere in the database" % orphans)


def test_outbox_row_cannot_be_duplicated_for_one_event():
    _, _, ride_id = passenger_with_ride()
    event_id = psql("SELECT id FROM ride_events WHERE ride_id='%s' LIMIT 1" % ride_id)
    proc = subprocess.run(
        ["psql", "-tAq", "-c",
         "INSERT INTO ride_event_outbox (ride_event_id, ride_id) VALUES (%s,'%s')" % (event_id, ride_id)],
        capture_output=True, text=True)
    check(proc.returncode != 0 and "duplicate key" in proc.stderr,
          "a second outbox row for one event was accepted")


def test_event_and_outbox_row_roll_back_together():
    _, _, ride_id = passenger_with_ride()
    marker = unique("rollback")
    sql = """
DO $$
DECLARE new_id bigint; seen int;
BEGIN
  INSERT INTO ride_events (ride_id, previous_status, new_status, details)
  VALUES ('%s','requested','matching', '{"marker":"%s"}'::jsonb) RETURNING id INTO new_id;
  SELECT count(*) INTO seen FROM ride_event_outbox WHERE ride_event_id = new_id;
  RAISE EXCEPTION 'rolled_back id=%% outbox_rows_inside=%%', new_id, seen;
END $$;
""" % (ride_id, marker)
    proc = subprocess.run(["psql", "-tAq", "-c", sql], capture_output=True, text=True)
    check("outbox_rows_inside=1" in proc.stderr,
          "the outbox row was not created inside the transaction: " + proc.stderr)
    check(psql("SELECT count(*) FROM ride_events WHERE details->>'marker'='%s'" % marker) == "0",
          "rolled-back event is visible")
    event_id = int(proc.stderr.split("id=")[1].split()[0])
    check(psql("SELECT count(*) FROM ride_event_outbox WHERE ride_event_id=%d" % event_id) == "0",
          "outbox row survived the rollback")


def test_rejected_transitions_leave_no_events_or_outbox_rows():
    _, token, ride_id = passenger_with_ride()
    check(request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token).status == 200,
          "first cancel failed")
    before = psql("SELECT count(*) FROM ride_events WHERE ride_id='%s'" % ride_id)
    outbox_before = psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s'" % ride_id)
    again = request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token)
    check(again.status in (404, 409), "second cancel returned %s" % again.status)
    check(psql("SELECT count(*) FROM ride_events WHERE ride_id='%s'" % ride_id) == before,
          "a rejected cancel wrote an event")
    check(psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s'" % ride_id) == outbox_before,
          "a rejected cancel wrote an outbox row")


# ---------------------------------------------------------------- publication

def test_pending_outbox_rows_are_published():
    _, token, ride_id = passenger_with_ride()
    request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token)
    wait_for(lambda: psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s' "
                          "AND published_at IS NULL" % ride_id) == "0",
             timeout=15, message="the worker to publish every outbox row")


def test_row_leased_by_a_crashed_worker_is_retried_after_the_lease_expires():
    _, _, ride_id = passenger_with_ride()
    event_id = plant_event(ride_id, "matching",
                           "claimed_until = now() + interval '6 seconds', attempts = 1")
    time.sleep(3)
    row = outbox_row(event_id)
    check(row["published"] == "" and row["attempts"] == 1,
          "a leased row was published while its lease was valid: %s" % row)
    wait_for(lambda: outbox_row(event_id)["published"] != "", timeout=15,
             message="the lease to expire and the row to be published")
    check(outbox_row(event_id)["attempts"] >= 2, "recovery did not count as another attempt")


def test_backed_off_row_is_not_published_before_it_is_due():
    _, _, ride_id = passenger_with_ride()
    event_id = plant_event(ride_id, "matching",
                           "available_at = now() + interval '5 seconds', attempts = 2, "
                           "last_error = 'publish_failed'")
    time.sleep(2.5)
    check(outbox_row(event_id)["published"] == "", "row was published before available_at")
    wait_for(lambda: outbox_row(event_id)["published"] != "", timeout=15,
             message="the backed-off row to be published once due")
    check(outbox_row(event_id)["error"] == "", "last_error was not cleared after success")


def test_dead_lettered_rows_are_never_republished_and_are_counted():
    _, passenger_id = create_account("passenger")
    ride_id = book(forge_token(passenger_id, "passenger")).json["rideId"]
    event_id = plant_event(ride_id, "matching",
                           "dead_lettered_at = now(), attempts = 10, last_error = 'publish_failed'")
    time.sleep(2)
    row = outbox_row(event_id)
    check(row["published"] == "" and row["dead"] != "", "dead-lettered row was published: %s" % row)
    _, admin_id = create_account("admin")
    metrics = request("GET", "/api/v1/admin/metrics", token=forge_token(admin_id, "admin"))
    check(metrics.status == 200 and metrics.json["deadLetteredOutboxEvents"] >= 1,
          "dead letters are not visible in metrics: %s" % metrics.text)


# ---------------------------------------------------------------- SSE delivery

class Stream:
    """Minimal SSE client over a raw socket that records every frame it receives.

    A raw socket is used on purpose: http.client's buffered reader refuses all reads
    after the first timeout, which would hide frames that arrive later."""

    def __init__(self, ride_id, token, last_event_id=None):
        parsed = urlparse(BASE_URL)
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=5)
        lines = ["GET /api/v1/rides/%s/events HTTP/1.1" % ride_id,
                 "Host: %s:%s" % (parsed.hostname, parsed.port),
                 "Authorization: Bearer " + token,
                 "Accept: text/event-stream"]
        if last_event_id is not None:
            lines.append("Last-Event-ID: %s" % last_event_id)
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        self.ids = []
        self.statuses = []
        self._buffer = b""
        head = self._read_until(b"\r\n\r\n", 5)
        check(head is not None, "no response headers from the event stream")
        self.status = int(head.split(b" ", 2)[1])

    def _read_until(self, marker, seconds):
        deadline = time.monotonic() + seconds
        while marker not in self._buffer and time.monotonic() < deadline:
            self.sock.settimeout(max(0.05, min(0.5, deadline - time.monotonic())))
            try:
                chunk = self.sock.recv(4096)
            except (socket.timeout, TimeoutError):
                continue
            except OSError:
                return None
            if not chunk:
                return None
            self._buffer += chunk
        if marker not in self._buffer:
            return None
        head, self._buffer = self._buffer.split(marker, 1)
        return head

    def pump(self, seconds):
        """Read for ``seconds`` and collect any complete frames."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.sock.settimeout(max(0.05, min(0.5, deadline - time.monotonic())))
            try:
                chunk = self.sock.recv(4096)
            except (socket.timeout, TimeoutError):
                continue
            except OSError:
                break
            if not chunk:
                break
            self._buffer += chunk
            while b"\n\n" in self._buffer:
                frame, self._buffer = self._buffer.split(b"\n\n", 1)
                self._parse(frame.decode("utf-8", "replace"))
        return self

    def _parse(self, frame):
        event_id, data = None, None
        for line in frame.splitlines():
            if line.startswith("id: "):
                event_id = int(line[4:])
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if event_id is not None:
            self.ids.append(event_id)
            self.statuses.append(data["status"] if data else None)

    def close(self):
        self.sock.close()


def event_ids(ride_id):
    rows = psql("SELECT id FROM ride_events WHERE ride_id='%s' ORDER BY id" % ride_id)
    return [int(x) for x in rows.splitlines()]


def test_stream_replays_persisted_events_in_order_without_duplicates():
    _, token, ride_id = passenger_with_ride()
    request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token)
    stream = Stream(ride_id, token)
    try:
        check(stream.status == 200, "stream returned %s" % stream.status)
        stream.pump(2.5)
    finally:
        stream.close()
    check(stream.ids == event_ids(ride_id), "replay %s != persisted %s" % (stream.ids, event_ids(ride_id)))


def test_last_event_id_resumes_exactly_after_the_cursor():
    _, token, ride_id = passenger_with_ride()
    request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=token)
    ids = event_ids(ride_id)
    check(len(ids) >= 2, "need two events")
    stream = Stream(ride_id, token, last_event_id=ids[0])
    try:
        stream.pump(2.0)
    finally:
        stream.close()
    check(stream.ids == ids[1:], "resume %s != expected %s" % (stream.ids, ids[1:]))

    stream = Stream(ride_id, token, last_event_id=ids[-1])
    try:
        stream.pump(1.5)
    finally:
        stream.close()
    check(stream.ids == [], "events were replayed past the cursor: %s" % stream.ids)


def test_malformed_last_event_id_is_rejected():
    _, token, ride_id = passenger_with_ride()
    # Leading and trailing spaces are not tested: HTTP strips them from header values
    # before the application sees them.
    for bad in ("-1", "+5", "abc", "1e3", "0x10", "5;6", "5,6", "9" * 40):
        parsed = urlparse(BASE_URL)
        conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=3)
        conn.request("GET", "/api/v1/rides/%s/events" % ride_id,
                     headers={"Authorization": "Bearer " + token, "Last-Event-ID": bad})
        status = conn.getresponse().status
        conn.close()
        check(status == 400, "Last-Event-ID %r returned %s, want 400" % (bad, status))


def test_late_older_event_is_not_lost_when_a_newer_one_is_published_first():
    """Publication can be out of order (retry back-off, several workers). The stream
    must still deliver every persisted event, in id order, exactly once."""
    _, token, ride_id = passenger_with_ride()
    wait_for(lambda: psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s' "
                          "AND published_at IS NULL" % ride_id) == "0", timeout=10,
             message="the booking event to be published")
    stream = Stream(ride_id, token)
    try:
        stream.pump(1.0)
        baseline = list(stream.ids)
        older = plant_event(ride_id, "matching", "available_at = now() + interval '4 seconds'")
        newer = plant_event(ride_id, "assigned", "attempts = 0")
        check(older < newer, "fixture ids are not ordered")
        stream.pump(7.0)
    finally:
        stream.close()
    fresh = [i for i in stream.ids if i not in baseline]
    check(fresh == [older, newer],
          "delivered %s, want %s in order (the older event was lost or reordered)" % (fresh, [older, newer]))
    check(len(set(stream.ids)) == len(stream.ids), "duplicate frames: %s" % stream.ids)


def test_republished_event_is_not_delivered_twice():
    _, token, ride_id = passenger_with_ride()
    wait_for(lambda: psql("SELECT count(*) FROM ride_event_outbox WHERE ride_id='%s' "
                          "AND published_at IS NULL" % ride_id) == "0", timeout=10,
             message="the booking event to be published")
    stream = Stream(ride_id, token)
    try:
        stream.pump(1.0)
        event_id = plant_event(ride_id, "matching", "attempts = 0")
        stream.pump(2.5)
        check(stream.ids.count(event_id) == 1, "event not delivered exactly once: %s" % stream.ids)
        psql("UPDATE ride_event_outbox SET published_at=NULL, available_at=now() "
             "WHERE ride_event_id=%d" % event_id)
        stream.pump(3.0)
    finally:
        stream.close()
    check(stream.ids.count(event_id) == 1, "duplicate notification produced a duplicate frame: %s" % stream.ids)
    check(stream.ids == sorted(stream.ids), "frames arrived out of order: %s" % stream.ids)


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    runner = Runner("outbox_events")
    code = runner.run(tests)
    if code == 0:
        print("PASS: outbox atomicity, crash recovery, back-off, dead letters and ordered SSE delivery")
    return code


if __name__ == "__main__":
    sys.exit(main())
