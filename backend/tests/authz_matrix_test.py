#!/usr/bin/env python3
"""Authorization matrix for the RideForge API.

Covers three layers, each against a running API and PostgreSQL:

  1. Token validation: forged, tampered, expired or mis-scoped bearer tokens are
     rejected with 401 on every protected endpoint.
  2. Role (function-level) authorization: each endpoint accepts only its roles.
  3. Object-level authorization: one account cannot read or change another
     account's ride, and a denied request leaves the database untouched.

Also checks that deactivating an account or changing its role takes effect on
tokens that are still cryptographically valid, and that malformed object IDs are a
client error rather than a server error.

Run:  python3 backend/tests/authz_matrix_test.py   (same environment as http_smoke.sh)
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rf_testkit import (  # noqa: E402
    Runner, b64url, book, check, create_account, create_driver, forge_token,
    new_quote, psql, register, request, unique,
)

ZERO_UUID = "00000000-0000-4000-8000-000000000000"
ROLES = ("passenger", "driver", "admin")

# (method, path template, roles allowed past the role check, JSON body or None)
# {ride} and {driver} are replaced with real identifiers. Bodies are well formed so
# a 403 can only come from the role check, never from body validation.
ENDPOINTS = [
    ("GET", "/api/v1/me", set(ROLES), None),
    ("PATCH", "/api/v1/me", set(ROLES), {"displayName": "Updated Profile"}),
    ("GET", "/api/v1/rides", {"passenger"}, None),
    ("POST", "/api/v1/rides", {"passenger"}, {"quoteId": ZERO_UUID}),
    ("POST", "/api/v1/rides/{ride}/cancel", {"passenger"}, None),
    ("PUT", "/api/v1/driver/availability", {"driver"},
     {"online": False}),
    ("GET", "/api/v1/driver/rides", {"driver"}, None),
    ("GET", "/api/v1/driver/rides/history", {"driver"}, None),
    ("POST", "/api/v1/driver/rides/{ride}/accept", {"driver"}, None),
    ("POST", "/api/v1/driver/rides/{ride}/decline", {"driver"}, None),
    ("PUT", "/api/v1/driver/rides/{ride}/status", {"driver"},
     {"status": "driver_arriving"}),
    ("GET", "/api/v1/admin/drivers", {"admin"}, None),
    ("POST", "/api/v1/admin/drivers", {"admin"},
     {"email": "x@example.test", "displayName": "X", "password": "a-long-ci-password-123",
      "vehicleRegistration": "ZZ00ZZ0000"}),
    ("PUT", "/api/v1/admin/drivers/{driver}/approval", {"admin"}, {"approved": True}),
    ("GET", "/api/v1/admin/audit", {"admin"}, None),
    ("GET", "/api/v1/admin/rides", {"admin"}, None),
    ("GET", "/api/v1/admin/metrics", {"admin"}, None),
    ("GET", "/api/v1/admin/support-reports", {"admin"}, None),
    ("PUT", "/api/v1/admin/support-reports/{report}", {"admin"}, {"status": "in_review"}),
    ("GET", "/api/v1/support/reports", {"passenger", "driver"}, None),
    ("POST", "/api/v1/support/reports", {"passenger", "driver"},
     {"category": "other", "description": "authorization matrix probe"}),
]
# Readable by any authenticated role; the answer is then scoped to the caller.
ANY_ROLE_ENDPOINTS = [("GET", "/api/v1/rides/{ride}")]


def fill(template, ride, driver):
    return (template.replace("{ride}", ride).replace("{driver}", driver)
            .replace("{report}", "1"))


def call(method, template, body, token, ride=ZERO_UUID, driver=ZERO_UUID, headers=None):
    path = fill(template, ride, driver)
    extra = dict(headers or {})
    if method == "POST" and path == "/api/v1/rides":
        extra.setdefault("Idempotency-Key", unique("authz-key"))
    return request(method, path, body=body, token=token, headers=extra)


def fixtures():
    """One account per role plus a second passenger and driver for cross-account checks."""
    out = {}
    _, out["passenger"] = create_account("passenger")
    _, out["passenger_b"] = create_account("passenger")
    _, out["admin"] = create_account("admin")
    _, out["driver"] = create_driver(approved=True)
    _, out["driver_b"] = create_driver(approved=True)
    return out


def role_of(name):
    return "passenger" if name.startswith("passenger") else name.split("_")[0]


def token(accounts, name):
    return forge_token(accounts[name], role_of(name))


# ---------------------------------------------------------------- token validation

def test_every_protected_endpoint_requires_authentication():
    for method, template, _, body in ENDPOINTS + [(m, p, None, None) for m, p in ANY_ROLE_ENDPOINTS]:
        resp = call(method, template, body, token=None)
        check(resp.status == 401,
              "%s %s without a token returned %s, want 401" % (method, template, resp.status))
        for bad in ("garbage", "a.b.c", "x" * 5000):
            resp = call(method, template, body, token=bad)
            check(resp.status == 401,
                  "%s %s with bad token %r returned %s" % (method, template, bad[:12], resp.status))


def test_authorization_header_forms_are_strict():
    accounts = fixtures()
    good = token(accounts, "passenger")
    for header in ("bearer " + good, "Basic " + good, "Bearer", "Bearer ", good,
                   "Bearer  " + good, "Token " + good):
        resp = request("GET", "/api/v1/rides", headers={"Authorization": header})
        check(resp.status == 401, "header %r returned %s, want 401" % (header[:16], resp.status))
    check(request("GET", "/api/v1/rides", token=good).status == 200,
          "well-formed token for an active passenger must be accepted")


def test_forged_and_tampered_tokens_are_rejected():
    accounts = fixtures()
    sub = accounts["passenger"]
    good = forge_token(sub, "passenger")
    check(request("GET", "/api/v1/rides", token=good).status == 200, "control token rejected")

    header, payload, signature = good.split(".")
    claims = json.loads(__import__("base64").urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    escalated = dict(claims, role="admin")
    swapped = b64url(json.dumps(escalated, separators=(",", ":")).encode())
    variants = {
        "unsigned (alg=none)": forge_token(sub, "passenger", alg="none", sign=False),
        "unsigned HS256 header": forge_token(sub, "passenger", sign=False),
        "wrong secret": forge_token(sub, "passenger", secret="x" * 40),
        "wrong alg label": forge_token(sub, "passenger", alg="HS512"),
        "wrong issuer": forge_token(sub, "passenger", issuer="someone-else"),
        "wrong audience": forge_token(sub, "passenger", audience="other-app"),
        "expired": forge_token(sub, "passenger", issued_offset=-3600),
        "issued in the future": forge_token(sub, "passenger", issued_offset=3600),
        "lifetime over 15 minutes": forge_token(sub, "passenger", lifetime=901),
        "zero lifetime": forge_token(sub, "passenger", lifetime=0),
        "negative lifetime": forge_token(sub, "passenger", lifetime=-10),
        "unknown role": forge_token(sub, "superuser"),
        "payload swapped, signature kept": ".".join((header, swapped, signature)),
        "signature stripped": ".".join((header, payload, "")),
        "extra segment": good + ".extra",
        "truncated": good[:-4],
    }
    for label, bad in variants.items():
        status = request("GET", "/api/v1/rides", token=bad).status
        check(status == 401, "%s returned %s, want 401" % (label, status))


def test_token_for_unknown_or_malformed_subject_is_rejected():
    for sub in (ZERO_UUID, "not-a-uuid", "1; DROP TABLE accounts", "' OR '1'='1", ""):
        status = request("GET", "/api/v1/rides", token=forge_token(sub, "passenger")).status
        check(status == 401, "subject %r returned %s, want 401" % (sub, status))


# ---------------------------------------------------------------- self-service profile

def test_profile_read_and_update_are_scoped_to_authenticated_subject():
    accounts = fixtures()
    for who in ("passenger", "passenger_b", "driver", "driver_b", "admin"):
        auth = token(accounts, who)
        initial = request("GET", "/api/v1/me", token=auth)
        check(initial.status == 200, "%s could not read own profile: %s" % (who, initial.status))
        check(initial.json["id"] == accounts[who], "%s received another account's profile" % who)
        check(initial.json["role"] == role_of(who), "%s profile has the wrong role" % who)
        check(initial.json["email"].endswith("@example.test"), "%s profile omitted its email" % who)

        display_name = "Updated " + who
        updated = request("PATCH", "/api/v1/me", token=auth, body={"displayName": display_name})
        check(updated.status == 200, "%s could not update own display name: %s %s"
              % (who, updated.status, updated.text))
        check(updated.json["id"] == accounts[who] and updated.json["displayName"] == display_name,
              "%s update returned another profile or stale name" % who)
        check(psql("SELECT display_name FROM accounts WHERE id='%s'" % accounts[who]) == display_name,
              "%s display name was not persisted" % who)

    passenger_name = psql("SELECT display_name FROM accounts WHERE id='%s'" % accounts["passenger"])
    other_name = psql("SELECT display_name FROM accounts WHERE id='%s'" % accounts["passenger_b"])
    check(passenger_name == "Updated passenger" and other_name == "Updated passenger_b",
          "updating one profile changed another account")

    before = psql("SELECT display_name FROM accounts WHERE id='%s'" % accounts["passenger"])
    for body in ({"displayName": ""}, {"displayName": "x" * 121},
                 {"displayName": "Valid Name", "phone": "+911234567890"}):
        rejected = request("PATCH", "/api/v1/me", token=token(accounts, "passenger"), body=body)
        check(rejected.status == 422, "invalid profile body %s returned %s" % (body, rejected.status))
    check(psql("SELECT display_name FROM accounts WHERE id='%s'" % accounts["passenger"]) == before,
          "invalid profile update changed persisted data")


# ---------------------------------------------------------------- role matrix

def test_role_matrix():
    accounts = fixtures()
    ride_id = book(token(accounts, "passenger")).json["rideId"]
    for method, template, allowed, body in ENDPOINTS:
        for role in ROLES:
            name = role
            resp = call(method, template, body, token(accounts, name),
                        ride=ride_id, driver=accounts["driver"])
            if role in allowed:
                check(resp.status not in (401, 403),
                      "%s %s as %s was refused (%s %s)" % (method, template, role,
                                                            resp.status, resp.text[:100]))
            else:
                check(resp.status == 403,
                      "%s %s as %s returned %s, want 403" % (method, template, role,
                                                              resp.status))
                check("error" in (resp.json or {}), "403 body is not an error object")


def test_role_denial_does_not_mutate_state():
    accounts = fixtures()
    before = psql("SELECT count(*) FROM accounts")
    audit_before = psql("SELECT count(*) FROM admin_audit_events")
    for role in ("passenger", "driver"):
        call("POST", "/api/v1/admin/drivers", ENDPOINTS[10][3], token(accounts, role))
        call("PUT", "/api/v1/admin/drivers/{driver}/approval", {"approved": False},
             token(accounts, role), driver=accounts["driver"])
    check(psql("SELECT count(*) FROM accounts") == before, "denied admin call created an account")
    check(psql("SELECT count(*) FROM admin_audit_events") == audit_before,
          "denied admin call wrote an audit event")
    check(psql("SELECT is_approved FROM driver_profiles WHERE account_id='%s'"
               % accounts["driver"]) == "t", "denied call changed driver approval")


def test_registration_cannot_choose_a_role():
    email, _, _ = register()
    for extra in ({"role": "admin"}, {"role": "driver"}, {"isActive": False}):
        email = unique("t") + "@example.test"
        body = {"email": email, "displayName": "Role Probe", "password": "a-long-ci-password-123"}
        body.update(extra)
        resp = request("POST", "/api/v1/auth/register", body=body)
        if resp.status == 429:  # per-address limit; the point is made by the other cases
            continue
        check(resp.status in (201, 422), "register with %s returned %s" % (extra, resp.status))
        if resp.status == 201:
            check(resp.json["account"]["role"] == "passenger", "registration honoured a role field")
            check(psql("SELECT role FROM accounts WHERE email='%s'" % email) == "passenger",
                  "stored role is not passenger")


# ---------------------------------------------------------------- object level

def test_other_passenger_cannot_read_or_cancel_a_ride():
    accounts = fixtures()
    owner, intruder = token(accounts, "passenger"), token(accounts, "passenger_b")
    ride = book(owner)
    check(ride.status == 201, "booking failed: %s" % ride.text)
    ride_id = ride.json["rideId"]

    seen = request("GET", "/api/v1/rides/" + ride_id, token=intruder)
    check(seen.status == 404, "other passenger read the ride: %s" % seen.status)
    check(ride_id not in seen.text and accounts["passenger"] not in seen.text,
          "404 body leaks ride or owner identifiers")

    cancelled = request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=intruder)
    check(cancelled.status == 404, "other passenger cancelled the ride: %s" % cancelled.status)
    check(psql("SELECT status FROM rides WHERE id='%s'" % ride_id) != "cancelled",
          "ride was cancelled by a non-owner")

    listing = request("GET", "/api/v1/rides", token=intruder)
    check(listing.status == 200 and ride_id not in listing.text,
          "ride listing leaked another passenger's ride")
    check(request("GET", "/api/v1/rides/" + ride_id, token=owner).status == 200,
          "owner lost access to their own ride")


def test_unassigned_and_other_drivers_have_no_access_to_a_ride():
    accounts = fixtures()
    owner = token(accounts, "passenger")
    ride_id = book(owner).json["rideId"]
    for who in ("driver", "driver_b"):
        resp = request("GET", "/api/v1/rides/" + ride_id, token=token(accounts, who))
        check(resp.status == 404, "%s read an unassigned ride: %s" % (who, resp.status))

    # Without a live offer a driver must not be able to take the ride.
    resp = request("POST", "/api/v1/driver/rides/%s/accept" % ride_id,
                   token=token(accounts, "driver"))
    check(resp.status in (404, 409), "accept without an offer returned %s" % resp.status)
    check(psql("SELECT coalesce(driver_id::text,'') FROM rides WHERE id='%s'" % ride_id) == "",
          "ride was assigned without an offer")


def test_driver_cannot_change_a_ride_assigned_to_another_driver():
    accounts = fixtures()
    ride_id = book(token(accounts, "passenger")).json["rideId"]
    psql("UPDATE rides SET status='assigned', driver_id='%s', assigned_at=now() WHERE id='%s'"
         % (accounts["driver"], ride_id))
    intruder = token(accounts, "driver_b")

    for method, path, body in (
        ("PUT", "/api/v1/driver/rides/%s/status" % ride_id, {"status": "driver_arriving"}),
        ("POST", "/api/v1/driver/rides/%s/accept" % ride_id, None),
        ("POST", "/api/v1/driver/rides/%s/decline" % ride_id, None),
    ):
        resp = request(method, path, body=body, token=intruder)
        check(resp.status in (404, 409), "%s %s by another driver returned %s"
              % (method, path, resp.status))
    row = psql("SELECT status||'|'||driver_id FROM rides WHERE id='%s'" % ride_id)
    check(row == "assigned|" + accounts["driver"], "foreign driver altered the ride: " + row)

    check(request("GET", "/api/v1/rides/" + ride_id, token=intruder).status == 404,
          "foreign driver can read the ride")
    assigned = request("GET", "/api/v1/rides/" + ride_id, token=token(accounts, "driver"))
    check(assigned.status == 200, "assigned driver cannot read their ride")


def test_admin_can_read_any_ride_but_cannot_act_as_the_passenger():
    accounts = fixtures()
    ride_id = book(token(accounts, "passenger")).json["rideId"]
    admin = token(accounts, "admin")
    seen = request("GET", "/api/v1/rides/" + ride_id, token=admin)
    check(seen.status == 200 and seen.json.get("passengerId") == accounts["passenger"],
          "admin cannot read a ride: %s" % seen.status)
    cancelled = request("POST", "/api/v1/rides/%s/cancel" % ride_id, token=admin)
    check(cancelled.status == 403, "admin cancelled a passenger's ride: %s" % cancelled.status)


def test_event_stream_is_scoped_to_ride_participants():
    accounts = fixtures()
    ride_id = book(token(accounts, "passenger")).json["rideId"]
    for who in ("passenger_b", "driver_b"):
        resp = request("GET", "/api/v1/rides/%s/events" % ride_id, token=token(accounts, who),
                       headers={"Accept": "text/event-stream"}, timeout=5)
        check(resp.status == 404, "%s opened another account's event stream: %s"
              % (who, resp.status))
    resp = request("GET", "/api/v1/rides/%s/events" % ride_id, headers={"Accept": "text/event-stream"},
                   timeout=5)
    check(resp.status == 401, "unauthenticated event stream returned %s" % resp.status)


def test_support_reports_are_scoped_to_their_owner():
    accounts = fixtures()
    owner, other = token(accounts, "passenger"), token(accounts, "passenger_b")
    ride_id = book(owner).json["rideId"]
    marker = unique("scope-marker")
    created = request("POST", "/api/v1/support/reports", token=owner, body={
        "category": "booking", "description": "private description " + marker, "rideId": ride_id})
    check(created.status == 201, "owner could not file a report: %s %s" % (created.status, created.text))

    listing = request("GET", "/api/v1/support/reports", token=other)
    check(listing.status == 200 and marker not in listing.text,
          "another account saw a support report it does not own")
    forged = request("POST", "/api/v1/support/reports", token=other, body={
        "category": "booking", "description": "attaching to a ride I do not own",
        "rideId": ride_id})
    check(forged.status == 404, "report attached to someone else's ride: %s" % forged.status)
    check(marker in request("GET", "/api/v1/support/reports", token=owner).text,
          "owner cannot list their own report")


# ---------------------------------------------------------------- revocation

def test_deactivated_account_loses_access_with_a_still_valid_token():
    accounts = fixtures()
    tok = token(accounts, "passenger")
    check(request("GET", "/api/v1/rides", token=tok).status == 200, "control request failed")
    psql("UPDATE accounts SET is_active=false WHERE id='%s'" % accounts["passenger"])
    # The account state is cached for a few seconds, so allow that window but no more.
    deadline = time.monotonic() + 8
    status = 200
    while time.monotonic() < deadline and status != 401:
        status = request("GET", "/api/v1/rides", token=tok).status
        time.sleep(0.5)
    check(status == 401, "deactivated account still accepted after 8s (last status %s)" % status)
    for method, template, _, body in ENDPOINTS[:3]:
        resp = call(method, template, body, tok)
        check(resp.status == 401, "%s %s allowed a deactivated account: %s"
              % (method, template, resp.status))


def test_role_change_invalidates_existing_tokens():
    accounts = fixtures()
    tok = token(accounts, "passenger")
    check(request("GET", "/api/v1/rides", token=tok).status == 200, "control request failed")
    psql("UPDATE accounts SET role='admin' WHERE id='%s'" % accounts["passenger"])
    deadline = time.monotonic() + 8
    status = 200
    while time.monotonic() < deadline and status != 401:
        status = request("GET", "/api/v1/rides", token=tok).status
        time.sleep(0.5)
    check(status == 401, "token for the old role still accepted (last status %s)" % status)


def test_reactivated_account_regains_access():
    accounts = fixtures()
    tok = token(accounts, "passenger")
    psql("UPDATE accounts SET is_active=false WHERE id='%s'" % accounts["passenger"])
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and request("GET", "/api/v1/rides", token=tok).status != 401:
        time.sleep(0.5)
    psql("UPDATE accounts SET is_active=true WHERE id='%s'" % accounts["passenger"])
    deadline = time.monotonic() + 8
    status = 401
    while time.monotonic() < deadline and status != 200:
        status = request("GET", "/api/v1/rides", token=tok).status
        time.sleep(0.5)
    check(status == 200, "reactivated account never recovered (last status %s)" % status)


def test_unapproved_and_suspended_drivers_cannot_go_online():
    _, unapproved = create_driver(approved=False)
    resp = request("PUT", "/api/v1/driver/availability", token=forge_token(unapproved, "driver"),
                   body={"online": True, "latitude": 28.53, "longitude": 77.35})
    check(resp.status in (403, 409), "unapproved driver went online: %s" % resp.status)
    check(psql("SELECT is_online FROM driver_profiles WHERE account_id='%s'" % unapproved) == "f",
          "unapproved driver is marked online")

    _, suspended = create_driver(approved=True)
    psql("UPDATE driver_profiles SET is_approved=false WHERE account_id='%s'" % suspended)
    resp = request("PUT", "/api/v1/driver/availability", token=forge_token(suspended, "driver"),
                   body={"online": True, "latitude": 28.53, "longitude": 77.35})
    check(resp.status in (403, 409), "suspended driver went online: %s" % resp.status)


# ---------------------------------------------------------------- malformed ids

def test_malformed_object_ids_are_client_errors():
    accounts = fixtures()
    bad_ids = ("not-a-uuid", "1", "00000000-0000-0000-0000-00000000000g", "%27%20OR%201=1",
               "..%2f..%2fadmin", "a" * 200)
    for bad in bad_ids:
        for who, method, path in (
            ("passenger", "GET", "/api/v1/rides/%s"),
            ("passenger", "POST", "/api/v1/rides/%s/cancel"),
            ("passenger", "GET", "/api/v1/rides/%s/events"),
            ("driver", "POST", "/api/v1/driver/rides/%s/accept"),
            ("driver", "POST", "/api/v1/driver/rides/%s/decline"),
            ("driver", "PUT", "/api/v1/driver/rides/%s/status"),
            ("admin", "PUT", "/api/v1/admin/drivers/%s/approval"),
        ):
            body = {"status": "driver_arriving"} if path.endswith("status") else (
                {"approved": True} if path.endswith("approval") else None)
            resp = request(method, path % bad, body=body, token=token(accounts, who), timeout=5)
            check(resp.status == 404, "%s %s returned %s, want 404 (not 5xx)"
                  % (method, path % bad[:20], resp.status))
    # A well-formed but unknown ID is also a plain 404 for the owner role.
    check(request("GET", "/api/v1/rides/" + ZERO_UUID, token=token(accounts, "passenger")).status == 404,
          "unknown ride id was not 404")


def test_client_errors_are_not_reported_as_server_errors():
    accounts = fixtures()
    tok = token(accounts, "passenger")
    cases = (
        ("POST", "/api/v1/rides", b"{not json", {"Idempotency-Key": "abcdefgh12"}),
        ("POST", "/api/v1/rides", b"[]", {"Idempotency-Key": "abcdefgh12"}),
        ("POST", "/api/v1/rides", {"quoteId": 5}, {"Idempotency-Key": "abcdefgh12"}),
        ("POST", "/api/v1/rides", {"quoteId": ZERO_UUID}, {}),
        ("POST", "/api/v1/rides", {"quoteId": ZERO_UUID}, {"Idempotency-Key": "short"}),
        ("POST", "/api/v1/rides", {"quoteId": "not-a-uuid"}, {"Idempotency-Key": "abcdefgh12"}),
    )
    for method, path, body, headers in cases:
        resp = request(method, path, body=body, token=tok, headers=headers)
        check(400 <= resp.status < 500, "%s %r returned %s, want a 4xx"
              % (method, body if isinstance(body, dict) else body[:12], resp.status))



# ---------------------------------------------------------------- coverage guard

def openapi_protected_operations():
    """(METHOD, path) pairs the OpenAPI contract protects with the global bearer scheme.

    The contract declares ``security: bearerAuth`` globally and public operations opt
    out with ``security: []``, so anything without that override is protected."""
    spec = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "openapi.yaml")
    protected, in_paths, path, method, public = {}, False, None, None, False
    for line in open(spec, encoding="utf-8").read().splitlines():
        if line.startswith("paths:"):
            in_paths = True
            continue
        if in_paths and re.match(r"^\S", line):
            in_paths = False
        if not in_paths:
            continue
        found_path = re.match(r"^  (/\S+):\s*$", line)
        if found_path:
            path, method = found_path.group(1), None
            continue
        found_method = re.match(r"^    (get|post|put|patch|delete):\s*$", line)
        if found_method:
            method, public = found_method.group(1).upper(), False
            protected[(method, path)] = True
            continue
        if method and re.match(r"^      security:\s*\[\s*\]\s*$", line):
            protected[(method, path)] = False
    return {key for key, is_protected in protected.items() if is_protected}


def normalised(path):
    path = re.sub(r"^/api/v1", "", path)
    return re.sub(r"\{[^}]*\}", "{}", path)


def test_matrix_covers_every_protected_operation_in_the_openapi_contract():
    covered = {(m, normalised(p)) for m, p, _, _ in ENDPOINTS}
    covered |= {(m, normalised(p)) for m, p in ANY_ROLE_ENDPOINTS}
    covered.add(("GET", "/rides/{}/events"))  # exercised by the event-stream test
    declared = {(m, normalised(p)) for m, p in openapi_protected_operations()}
    check(len(declared) >= 20, "OpenAPI parsing found only %d protected operations" % len(declared))
    missing = sorted(declared - covered)
    check(not missing, "protected operations with no authorization test: %s" % missing)
    stale = sorted(covered - declared)
    check(not stale, "matrix entries that are not in the OpenAPI contract: %s" % stale)


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    runner = Runner("authz_matrix")
    code = runner.run(tests)
    if code == 0:
        print("PASS: authorization matrix (token, role, object-level, revocation)")
    return code


if __name__ == "__main__":
    sys.exit(main())
