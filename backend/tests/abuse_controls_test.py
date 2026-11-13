#!/usr/bin/env python3
"""Abuse-control tests: rate limits, login throttling and provider protection.

Unlike the other integration tests this one starts its own API processes, because
the behaviour under test depends on process start-up configuration
(RIDEFORGE_TRUSTED_PROXIES, provider URLs) and on fresh limiter / circuit-breaker
state. It needs the API binary:

    RIDEFORGE_API_BIN=./build-backend/rideforge_api python3 backend/tests/abuse_controls_test.py

plus the usual PG* / DATABASE_URL / RIDEFORGE_JWT_SECRET environment.
"""
import contextlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rf_testkit import (  # noqa: E402
    PASSWORD, Runner, check, create_account, psql, request, unique,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API_BIN = os.environ.get("RIDEFORGE_API_BIN") or os.path.join(REPO_ROOT, "build-backend", "rideforge_api")
FAKE_PROVIDER_PORT = 8095


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def api(**extra_env):
    """Run a private API instance and yield (base_url, read_log)."""
    check(os.path.exists(API_BIN), "API binary not found at %s (set RIDEFORGE_API_BIN)" % API_BIN)
    port = free_port()
    env = dict(os.environ, PORT=str(port), **extra_env)
    log = tempfile.TemporaryFile(mode="w+")
    proc = subprocess.Popen([API_BIN], env=env, stdout=subprocess.DEVNULL, stderr=log)
    base = "http://127.0.0.1:%d" % port
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            check(proc.poll() is None, "API exited during start-up")
            try:
                if request("GET", "/api/v1/health", base=base, timeout=2).status == 200:
                    break
            except OSError:
                pass
            time.sleep(0.2)
        else:
            raise AssertionError("API did not become healthy")

        def read_log():
            log.flush()
            log.seek(0)
            return log.read()
        yield base, read_log
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()


def login_status(base, email, password, forwarded=None):
    headers = {"X-Forwarded-For": forwarded} if forwarded else None
    return request("POST", "/api/v1/auth/login", base=base, headers=headers,
                   body={"email": email, "password": password})


def ip_probe(base, forwarded=None):
    """One failed login for a never-seen email, so only the per-address limit applies."""
    return login_status(base, unique("ghost") + "@example.test", "wrong-password-123",
                        forwarded=forwarded).status


# ------------------------------------------------------------ configuration

def test_invalid_trusted_proxy_list_stops_startup():
    for bad in ("not-an-ip", "10.0.0.0/33", "10.0.0.0/", "::ffff:10.0.0.0/104"):
        proc = subprocess.run([API_BIN], env=dict(os.environ, PORT=str(free_port()),
                                                  RIDEFORGE_TRUSTED_PROXIES=bad),
                              capture_output=True, text=True, timeout=20)
        check(proc.returncode == 2, "%r: exit code %s, want 2" % (bad, proc.returncode))
        check("invalid_trusted_proxies_configuration" in proc.stderr,
              "%r: no configuration error was logged" % bad)


def test_invalid_pacing_interval_stops_startup():
    for bad in ("fast", "-1", "1.5", "60001", "1e3", " 5"):
        proc = subprocess.run([API_BIN], env=dict(os.environ, PORT=str(free_port()),
                                                  RIDEFORGE_GEOCODING_MIN_INTERVAL_MS=bad),
                              capture_output=True, text=True, timeout=20)
        check(proc.returncode == 2, "%r: exit code %s, want 2" % (bad, proc.returncode))
        check("invalid_provider_pacing_configuration" in proc.stderr,
              "%r: no configuration error was logged" % bad)


# ------------------------------------------------------------ per-address limits

def test_forwarded_header_is_ignored_without_a_trusted_proxy():
    with api() as (base, _):
        statuses = [ip_probe(base, "198.51.100.%d" % n) for n in range(12)]
    check(statuses[:10] == [401] * 10, "first ten attempts: %s" % statuses[:10])
    check(statuses[10] == 429, "spoofed X-Forwarded-For evaded the limit: %s" % statuses)


def test_trusted_proxy_keys_limits_on_the_forwarded_client():
    with api(RIDEFORGE_TRUSTED_PROXIES="127.0.0.1") as (base, _):
        first = [ip_probe(base, "203.0.113.7") for _ in range(11)]
        check(first[:10] == [401] * 10 and first[10] == 429, "client A: %s" % first)
        check(ip_probe(base, "203.0.113.8") == 401, "a different client shared the first client's limit")


def test_prepended_forwarded_entries_cannot_pick_the_rate_limit_key():
    # The proxy appends the real client on the right; anything an attacker puts on
    # the left is untrusted and must not change which bucket is charged.
    with api(RIDEFORGE_TRUSTED_PROXIES="127.0.0.1") as (base, _):
        statuses = [ip_probe(base, "192.0.2.%d, 203.0.113.50" % n) for n in range(11)]
    check(statuses[:10] == [401] * 10 and statuses[10] == 429,
          "left-hand spoofing avoided the limit: %s" % statuses)


def test_ipv6_clients_share_one_limit_per_64():
    with api(RIDEFORGE_TRUSTED_PROXIES="127.0.0.1") as (base, _):
        statuses = [ip_probe(base, "2001:db8:1:2::%x" % (n + 1)) for n in range(11)]
        check(statuses[:10] == [401] * 10 and statuses[10] == 429,
              "rotating inside a /64 evaded the limit: %s" % statuses)
        check(ip_probe(base, "2001:db8:1:3::1") == 401, "a different /64 was throttled")


def test_quote_endpoint_is_rate_limited_per_address():
    with api() as (base, _):
        statuses = [request("POST", "/api/v1/routes/quote", base=base,
                            body={"pickup": {"label": "x"}, "destination": {"label": "y"}}).status
                    for _ in range(32)]
    check(statuses[:30] == [422] * 30, "first thirty: %s" % sorted(set(statuses[:30])))
    check(429 in statuses[30:], "the 31st quote request was not limited: %s" % statuses[30:])


# ------------------------------------------------------------ account throttling

def test_failed_logins_lock_the_account_across_many_addresses():
    email, _ = create_account("passenger")
    _, bystander = create_account("passenger")
    with api(RIDEFORGE_TRUSTED_PROXIES="127.0.0.1") as (base, _):
        for n in range(8):
            resp = login_status(base, email, "wrong-password-%d" % n, forwarded="198.51.100.%d" % n)
            check(resp.status == 401, "failure %d returned %s" % (n, resp.status))
        locked = login_status(base, email, PASSWORD, forwarded="198.51.100.200")
        check(locked.status == 429, "correct password accepted after 8 failures: %s" % locked.status)
        other_email = psql("SELECT email FROM accounts WHERE id='%s'" % bystander)
        ok = login_status(base, other_email, PASSWORD, forwarded="198.51.100.201")
        check(ok.status == 200, "another account was affected by the lock: %s" % ok.status)


def test_successful_login_clears_the_failure_count():
    email, _ = create_account("passenger")
    with api(RIDEFORGE_TRUSTED_PROXIES="127.0.0.1") as (base, _):
        n = 0

        def attempt(password):
            nonlocal n
            n += 1
            return login_status(base, email, password, forwarded="192.0.2.%d" % n).status

        for _ in range(5):
            check(attempt("wrong-password") == 401, "expected a failed login")
        check(attempt(PASSWORD) == 200, "a valid login was refused before the limit")
        for _ in range(5):
            check(attempt("wrong-password") == 401, "failure count was not reset by success")
        check(attempt(PASSWORD) == 200, "account locked although failures were not consecutive")


def test_login_does_not_reveal_whether_an_account_exists():
    known, _ = create_account("passenger")
    inactive, _ = create_account("passenger", active=False)
    with api(RIDEFORGE_TRUSTED_PROXIES="127.0.0.1") as (base, _):
        n = 0

        def timed(email, password):
            nonlocal n
            n += 1
            resp = login_status(base, email, password, forwarded="192.0.2.%d" % n)
            return resp

        unknown = [timed(unique("ghost") + "@example.test", PASSWORD) for _ in range(5)]
        wrong = [timed(known, "definitely-wrong-password") for _ in range(5)]
        disabled = [timed(inactive, PASSWORD) for _ in range(5)]

    bodies = {json.dumps(r.json, sort_keys=True) for r in unknown + wrong + disabled}
    statuses = {r.status for r in unknown + wrong + disabled}
    check(statuses == {401}, "statuses differ by account state: %s" % statuses)
    check(len(bodies) == 1, "response bodies differ by account state: %s" % bodies)

    def median(rs):
        return sorted(r.seconds for r in rs)[len(rs) // 2]
    # Without the dummy verification an unknown email returns in milliseconds while a
    # real one takes a full PBKDF2 run, which is an account-enumeration oracle.
    check(median(unknown) > 0.5 * median(wrong),
          "unknown-email logins are much faster (%.3fs vs %.3fs)" % (median(unknown), median(wrong)))
    check(median(disabled) > 0.5 * median(wrong),
          "inactive-account logins are much faster (%.3fs vs %.3fs)" % (median(disabled), median(wrong)))


# ------------------------------------------------------------ provider protection

class FakeProvider:
    """Controllable Nominatim/OSRM stand-in running inside this process."""

    def __init__(self, port):
        self.mode = "ok"
        self.hits = {"search": 0, "route": 0}
        self.search_times = []
        self.in_flight = 0
        self.max_in_flight = 0
        self.lock = threading.Lock()
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                return

            def _send(self, status, payload, content_type="application/json", raw=None):
                data = raw if raw is not None else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try:
                    self.wfile.write(data)
                except OSError:
                    pass

            def do_GET(self):
                kind = "search" if self.path.startswith("/search") else "route"
                with provider.lock:
                    provider.hits[kind] += 1
                    if kind == "search":
                        provider.search_times.append(time.monotonic())
                    provider.in_flight += 1
                    provider.max_in_flight = max(provider.max_in_flight, provider.in_flight)
                    mode = provider.mode
                try:
                    if mode == "slow":
                        time.sleep(1.5)
                    if mode == "http500" or (mode == "route500" and kind == "route"):
                        return self._send(500, {"error": "down"})
                    if mode == "html200":
                        return self._send(200, None, "text/html", b"<html>captive portal</html>")
                    if mode == "huge":
                        return self._send(200, None, raw=b'["' + b"x" * (2 * 1024 * 1024) + b'"]')
                    if kind == "search":
                        label = "Evil\x00Label\x07 " + "é" * 200 if mode == "evil" else "Place"
                        far = "dest" in self.path.lower()
                        return self._send(200, [{"lat": "28.54" if far else "28.53",
                                                 "lon": "77.36" if far else "77.35",
                                                 "display_name": label}])
                    distance = 9.0e8 if mode == "far" else 2500.2
                    return self._send(200, {"code": "Ok",
                                            "routes": [{"distance": distance, "duration": 600.1}]})
                finally:
                    with provider.lock:
                        provider.in_flight -= 1

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@contextlib.contextmanager
def provider_stack(**extra_env):
    provider = FakeProvider(FAKE_PROVIDER_PORT)
    try:
        with api(RIDEFORGE_GEOCODING_URL="http://127.0.0.1:%d/search" % FAKE_PROVIDER_PORT,
                 RIDEFORGE_ROUTING_URL="http://127.0.0.1:%d/route/v1/driving" % FAKE_PROVIDER_PORT,
                 RIDEFORGE_TRUSTED_PROXIES="127.0.0.1", **extra_env) as (base, read_log):
            yield provider, base, read_log
    finally:
        provider.stop()


_quote_counter = [0]


def quote(base, pickup="Pickup Place", destination="Destination Place"):
    # Vary the client address so the per-address quote limiter is not what we measure.
    _quote_counter[0] += 1
    return request("POST", "/api/v1/routes/quote", base=base,
                   headers={"X-Forwarded-For": "192.0.2.%d" % (_quote_counter[0] % 250 + 1)},
                   body={"pickup": {"label": pickup}, "destination": {"label": destination}})


def test_provider_returning_html_is_an_outage_not_data():
    with provider_stack() as (provider, base, _):
        check(quote(base).status == 200, "control quote failed")
        provider.mode = "html200"
        resp = quote(base)
        check(resp.status == 503, "HTML 200 from the provider returned %s" % resp.status)
        check(resp.json == {"error": "quote_service_unavailable"}, "unexpected body %s" % resp.text)


def test_oversized_provider_response_is_rejected():
    with provider_stack() as (provider, base, _):
        provider.mode = "huge"
        resp = quote(base)
        check(resp.status == 503, "2 MiB provider body returned %s" % resp.status)
        check(request("GET", "/api/v1/health", base=base).status == 200, "API unhealthy afterwards")


def test_absurd_route_distance_is_not_quoted():
    with provider_stack() as (provider, base, _):
        provider.mode = "far"
        before = psql("SELECT count(*) FROM route_quotes")
        resp = quote(base)
        check(resp.status == 422, "900,000 km route returned %s" % resp.status)
        check(psql("SELECT count(*) FROM route_quotes") == before, "an absurd quote was persisted")


def test_provider_labels_are_sanitised_before_storage():
    with provider_stack() as (provider, base, _):
        provider.mode = "evil"
        resp = quote(base)
        check(resp.status == 200, "quote with an odd label failed: %s %s" % (resp.status, resp.text))
        label = psql("SELECT pickup_label FROM route_quotes WHERE id='%s'" % resp.json["quoteId"])
        check(all(ord(c) >= 0x20 and ord(c) != 0x7F for c in label),
              "control characters were stored: %r" % label)
        check(len(label.encode("utf-8")) <= 240, "label exceeds 240 bytes")
        check(label.startswith("Evil"), "label content was lost: %r" % label[:20])


def test_circuit_breaker_stops_calling_a_failing_provider_and_recovers():
    with provider_stack() as (provider, base, read_log):
        check(quote(base).status == 200, "control quote failed")
        provider.mode = "http500"
        for n in range(5):
            check(quote(base).status == 503, "failure %d was not a 503" % n)
        opened_at = time.monotonic()
        hits_when_open = provider.hits["search"]

        fast = []
        for _ in range(4):
            resp = quote(base)
            fast.append(resp.seconds)
            check(resp.status == 503, "open breaker returned %s" % resp.status)
        check(provider.hits["search"] == hits_when_open,
              "an open breaker still called the provider (%d -> %d)"
              % (hits_when_open, provider.hits["search"]))
        check(max(fast) < 1.0, "rejections were not immediate: %s" % fast)
        check("circuit_open" in read_log(), "no circuit_open event was logged")

        # Recovery: the provider heals, but the breaker stays open for its full interval.
        provider.mode = "ok"
        check(quote(base).status == 503, "breaker closed before its open interval ended")
        time.sleep(max(0.0, 15.5 - (time.monotonic() - opened_at)))
        probe = quote(base)
        check(probe.status == 200, "breaker did not let a probe through: %s" % probe.status)
        check(quote(base).status == 200, "breaker stayed degraded after a successful probe")


def test_breakers_are_independent_per_upstream():
    with provider_stack() as (provider, base, _):
        provider.mode = "route500"
        for _ in range(5):
            check(quote(base).status == 503, "routing failure was not a 503")
        route_hits, search_hits = provider.hits["route"], provider.hits["search"]
        for _ in range(3):
            check(quote(base).status == 503, "quote succeeded while routing is open")
        check(provider.hits["route"] == route_hits, "routing was called while its breaker is open")
        check(provider.hits["search"] > search_hits,
              "the routing outage also blocked geocoding")


def test_provider_concurrency_is_bounded_and_does_not_trip_the_breaker():
    with provider_stack() as (provider, base, _):
        provider.mode = "slow"
        results = []

        def worker():
            results.append(quote(base).status)

        threads = [threading.Thread(target=worker) for _ in range(24)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        check(provider.max_in_flight <= 8,
              "more than 8 simultaneous provider calls: %d" % provider.max_in_flight)
        check(200 in results and 503 in results,
              "expected some quotes served and some shed, got %s" % sorted(set(results)))
        provider.mode = "ok"
        check(quote(base).status == 200,
              "shedding load must not open the breaker or leak permits")


def test_geocoding_is_paced_across_all_clients_and_excess_is_shed():
    """The public Nominatim policy is one request per second for the whole application.
    Fire many quotes at once from distinct client addresses and check that the provider
    still sees evenly spaced requests, with the surplus refused rather than queued."""
    interval = 0.4
    with provider_stack(RIDEFORGE_GEOCODING_MIN_INTERVAL_MS="400") as (provider, base, read_log):
        results = []

        def worker():
            results.append(quote(base).status)

        threads = [threading.Thread(target=worker) for _ in range(14)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        times = sorted(provider.search_times)
        gaps = [b - a for a, b in zip(times, times[1:])]
        check(len(times) >= 4, "too few geocoding calls reached the provider: %d" % len(times))
        check(min(gaps) >= interval * 0.85,
              "provider saw requests %.0f ms apart, below the %.0f ms interval"
              % (min(gaps) * 1000, interval * 1000))
        check(200 in results, "no quote succeeded under pacing: %s" % sorted(set(results)))
        check(503 in results, "excess load was not shed: %s" % sorted(set(results)))
        check(all(s in (200, 503) for s in results), "unexpected statuses %s" % sorted(set(results)))
        check('"reason":"paced"' in read_log(), "shed calls were not logged as paced")
        # Pacing is back-pressure, not a fault: it must not trip the circuit breaker.
        time.sleep(3.5)
        check(quote(base).status == 200, "the provider did not recover after the burst")


def test_pacing_can_be_switched_off_for_a_provider_with_its_own_budget():
    with provider_stack(RIDEFORGE_GEOCODING_MIN_INTERVAL_MS="0") as (provider, base, _):
        started = time.monotonic()
        check(quote(base).status == 200, "quote failed")
        check(time.monotonic() - started < 0.5, "an unpaced quote was slow")


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    runner = Runner("abuse_controls")
    code = runner.run(tests)
    if code == 0:
        print("PASS: rate limits, trusted proxies, login throttling and provider protection")
    return code


if __name__ == "__main__":
    sys.exit(main())
