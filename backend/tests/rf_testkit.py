"""Shared helpers for the RideForge API integration tests (standard library only).

The tests talk to a running API over HTTP and use ``psql`` for fixtures and for
asserting on database state. They read the same PG* / RIDEFORGE_* environment
variables as the CI workflow and ``http_smoke.sh``.
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import namedtuple

BASE_URL = os.environ.get("RIDEFORGE_TEST_BASE_URL", "http://127.0.0.1:8080")
SECRET = os.environ.get(
    "RIDEFORGE_JWT_SECRET", "not-a-production-secret-please-override-32chars")
PASSWORD = "a-long-ci-password-123"

Response = namedtuple("Response", "status json text headers seconds")


class TestFailure(AssertionError):
    pass


def check(condition, message):
    """Assertion that survives ``python -O`` and names what failed."""
    if not condition:
        raise TestFailure(message)


def request(method, path, body=None, token=None, headers=None, base=None, timeout=20):
    url = (base or BASE_URL) + path
    data = None
    final_headers = {"Accept": "application/json"}
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        final_headers["Content-Type"] = "application/json"
    if token is not None:
        final_headers["Authorization"] = "Bearer " + token
    final_headers.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=final_headers)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            status, response_headers = resp.status, resp.headers
    except urllib.error.HTTPError as error:
        raw = error.read()
        status, response_headers = error.code, error.headers
    elapsed = time.monotonic() - started
    text = raw.decode("utf-8", "replace")
    try:
        parsed = json.loads(text) if text else None
    except ValueError:
        parsed = None
    return Response(status, parsed, text, response_headers, elapsed)


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def forge_token(subject, role, secret=SECRET, issued_offset=0, lifetime=900,
                issuer="rideforge-api", audience="rideforge-web", alg="HS256",
                sign=True):
    """Build an access token the way the API does, with knobs to break it."""
    now = int(time.time()) + issued_offset
    header = b64url(json.dumps({"alg": alg, "typ": "JWT"}, separators=(",", ":")).encode())
    claims = {"iss": issuer, "aud": audience, "sub": subject, "role": role,
              "iat": now, "exp": now + lifetime}
    payload = b64url(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = header + "." + payload
    if not sign:
        return signing_input + "."
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + b64url(signature)


def psql(sql, check_rc=True):
    """Run SQL through psql and return stdout. Uses the PG* environment."""
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
        capture_output=True, text=True)
    if check_rc and proc.returncode != 0:
        raise TestFailure("psql failed: " + proc.stderr.strip() + " :: " + sql)
    return proc.stdout.strip()


def unique(prefix):
    return "%s-%s" % (prefix, uuid.uuid4().hex[:10])


def register(email=None, name="Test User", base=None):
    email = email or unique("t") + "@example.test"
    resp = request("POST", "/api/v1/auth/register", base=base,
                   body={"email": email, "displayName": name, "password": PASSWORD})
    check(resp.status == 201, "register failed: %s %s" % (resp.status, resp.text))
    return email, resp.json["account"]["id"], resp.json["accessToken"]


def login(email, password=PASSWORD, base=None, headers=None):
    return request("POST", "/api/v1/auth/login", base=base, headers=headers,
                   body={"email": email, "password": password})


_hash_cache = {}


def known_password_hash():
    """A real hash of PASSWORD, borrowed from one registered account.

    Registration is rate limited and costs a PBKDF2 run, so fixtures for the other
    accounts are inserted directly with this hash instead of via the API."""
    if "hash" not in _hash_cache:
        # Reuse a hash left by an earlier test file. Registration is limited to 10 per
        # minute per address, so every file registering its own account would trip it
        # when several run back to back. Only accounts made by this kit are matched,
        # because only those are known to use PASSWORD.
        existing = psql(
            "SELECT password_hash FROM accounts WHERE email LIKE '%@example.test' "
            "AND (display_name = 'Test User' OR display_name LIKE 'Fixture %') LIMIT 1")
        if existing:
            _hash_cache["hash"] = existing
        else:
            email, _, _ = register()
            _hash_cache["hash"] = psql(
                "SELECT password_hash FROM accounts WHERE email='%s'" % email)
    return _hash_cache["hash"]


def create_account(role, email=None, active=True):
    email = email or unique(role) + "@example.test"
    account_id = psql(
        "INSERT INTO accounts (email,display_name,role,password_hash,is_active) "
        "VALUES ('%s','Fixture %s','%s','%s',%s) RETURNING id"
        % (email, role, role, known_password_hash(), "true" if active else "false"))
    return email, account_id.splitlines()[0]


def create_driver(approved=True, online=False):
    email, account_id = create_account("driver")
    psql("INSERT INTO driver_profiles (account_id,vehicle_registration,is_online,is_approved) "
         "VALUES ('%s','%s',%s,%s)" % (account_id, unique("RF").upper()[:20],
                                        "true" if online else "false",
                                        "true" if approved else "false"))
    return email, account_id


def token_for(account_id, role):
    return forge_token(account_id, role)


def new_quote(minutes=5, label=None):
    label = label or unique("Quote")
    return psql(
        "INSERT INTO route_quotes (pickup_label,pickup_latitude,pickup_longitude,"
        "destination_label,destination_latitude,destination_longitude,route_distance_m,"
        "route_duration_seconds,fare_paise,currency,expires_at) VALUES "
        "('%s A',28.5300,77.3500,'%s B',28.5400,77.3600,2500,600,4750,'INR',"
        "now() + interval '%d seconds') RETURNING id" % (label, label, int(minutes * 60))
    ).splitlines()[0]


def book(token, quote_id=None, key=None):
    quote_id = quote_id or new_quote()
    return request("POST", "/api/v1/rides", token=token,
                   headers={"Idempotency-Key": key or unique("idem-key")},
                   body={"quoteId": quote_id})


def go_online(driver_token, latitude=28.53, longitude=77.35):
    return request("PUT", "/api/v1/driver/availability", token=driver_token,
                   body={"online": True, "latitude": latitude, "longitude": longitude})


def wait_for(predicate, timeout=15.0, interval=0.2, message="condition"):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(interval)
    raise TestFailure("timed out waiting for " + message)


class Runner:
    """Tiny test runner: runs every ``test_*`` function, reports all failures."""

    def __init__(self, name):
        self.name = name
        self.failures = []
        self.passed = 0

    def run(self, functions):
        for fn in functions:
            label = fn.__name__
            started = time.monotonic()
            try:
                fn()
            except Exception as error:  # noqa: BLE001 - report every kind of failure
                self.failures.append((label, error))
                print("FAIL  %s: %s" % (label, error), file=sys.stderr)
            else:
                self.passed += 1
                print("ok    %s (%.1fs)" % (label, time.monotonic() - started))
        print("%s: %d passed, %d failed" % (self.name, self.passed, len(self.failures)))
        return 1 if self.failures else 0
