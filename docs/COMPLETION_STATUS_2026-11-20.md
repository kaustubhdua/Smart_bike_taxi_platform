# RideForge completion status — 20 November 2026

**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Supabase project:** `ghcufcegfvvjhsnqnrzr` (Mumbai, PostgreSQL 17)  
**Decision:** **Deployed academic/portfolio MVP; not complete for real passenger transport or commercial operation.**

This is an evidence-based status snapshot. A green build, a route quote, or a healthy database does not prove signup, dispatch, payment, safety response, backup recovery, or legal permission.

## 1. Verified live state

| Area | Evidence observed | Status |
|---|---|---|
| GitHub main | Latest source/documentation changes committed to `main` | Verified |
| Vercel | Production deployment READY at main SHA `c08e8373e875f98e7387ba32c1378603811ee8ec` (deployment `dpl_43oJS3ojZXG7EJDoaN4LxuyoNP7U`); alias `https://smart-bike-taxi-platform.vercel.app` | Verified |
| Public access | Production SSO protection changed to preview-only; production homepage, current JS and CSS assets return HTTP 200; preview deployments remain SSO-protected | Verified |
| Frontend design | Nirdhoom-inspired cream/forest-green/saffron/navy visual system; new forest-gradient hero, refined booking card, responsive polish, reduced-motion-aware motion and one-tap real route presets are deployed | Implemented; manual visual/device QA still needed |
| Frontend API config | Vercel production `VITE_API_BASE_URL` points to the Supabase `rideforge-api` Edge Function | Verified |
| Supabase project | `ACTIVE_HEALTHY` | Verified |
| Edge Function | `rideforge-api` ACTIVE, version 15 | Verified |
| Function source | Deployed `index.ts` exactly matches repository source at inspection | Verified |
| Database RLS | All 14 public application tables have RLS enabled | Verified |
| Security Advisor | Zero findings at latest inspection | Verified |
| Health Advisor | Zero findings at latest inspection | Verified |
| Performance Advisor | 15 informational unused-index findings | Informational; do not remove indexes on an empty workload |
| Route quotes | 7 persisted quote rows | Verified |
| Auth users / accounts / rides | 0 / 0 / 0 | No hosted account or ride lifecycle evidence |


### Latest 20 November UI release verification

- Main HEAD: `c08e8373e875f98e7387ba32c1378603811ee8ec`; Vercel production deployment `dpl_43oJS3ojZXG7EJDoaN4LxuyoNP7U` is READY and the Vercel commit status is SUCCESS.
- Public production homepage returned HTTP 200. The deployed JavaScript bundle returned HTTP 200 (430,482 bytes) and contains the Noida route presets and configured Supabase API base URL. The deployed stylesheet returned HTTP 200 (87,484 bytes) and contains the new hero and route-preset styles.
- Vercel runtime error query returned no errors in the selected time range. This is not a substitute for interactive browser acceptance.
- The latest 15/15 full release-readiness workflow remains historical; no new GitHub Actions workflow run was returned for this documentation-only release commit. Manual visual/device and full passenger/driver/admin acceptance remain outstanding.
- The route preset buttons only fill pickup/drop-off inputs; the user must request a fresh server quote. They do not insert mock coordinates, fake fares, drivers, or rides.

## 2. Blocking production acceptance

### Auth and identity
- The Supabase Auth URL allowlist could not be read or changed using the connected project actions.
- Owner must set Site URL to `https://smart-bike-taxi-platform.vercel.app`.
- Add `https://smart-bike-taxi-platform.vercel.app/**`, fallback `https://rideforge-web.onrender.com/**`, and local `http://localhost:5173/**` as allowed redirects.
- Verify email confirmation, recovery, SMTP delivery and rate limits.
- Create a real verified passenger account, a separately provisioned driver account, and a verified owner/admin account. No synthetic production identities.
- Admin promotion is an owner-only SQL action documented in `docs/SUPABASE_BACKEND.md`; never expose an admin-promotion endpoint or browser service-role key.

### End-to-end ride
Use separate browser sessions and prove: passenger quote → booking → dispatch offer → driver accept/decline/expiry → arrival → start → completion/cancellation → history/receipt. Test cross-account authorization, idempotent retries, stale location, SSE reconnect/REST recovery, and admin 403 boundaries. No real journey is currently evidenced.

### Backup and recovery
- `rideforge_backup` remains intentionally NOLOGIN until the owner provisions it securely.
- GitHub Actions secrets `RIDEFORGE_BACKUP_DATABASE_URL` and `RIDEFORGE_BACKUP_PASSPHRASE` are outstanding.
- Run the encrypted backup, verify checksum/decryption, and complete an isolated PostgreSQL 17 restore.
- Current repository workflow covers the public schema only, not managed Auth, Storage objects, Edge Function bundles, Auth settings, or platform secrets. A schema restore is not full-project disaster recovery.

### Governance and security operations
- GitHub issue #17 records that main branch protection/ruleset is not configured. The available GitHub connector cannot create a ruleset; repository owner must require PRs and status checks, block force pushes and deletion, and verify with a test PR.
- Enable GitHub, Supabase and Vercel account MFA/2FA. The Vercel account previously displayed an MFA prompt.
- Confirm SSL enforcement, database network restrictions, auth confirmation/recovery, custom SMTP, CAPTCHA/rate limits, monitoring, alerting and incident response with the owner.
- Run manual Android Chrome and iOS Safari QA, keyboard/focus/screen-reader/zoom/reduced-motion checks, and realistic load tests on staging.

## 3. Legal and operating boundary — Noida/NCR

RideForge is a software MVP, not a licensed transport operator. Do not accept passengers or money.

- CAQM Direction No. 94 dated 3 June 2025 says conventional petrol/diesel ICE two-wheelers shall not be further inducted into aggregator/DSP fleets in NCR from 1 January 2026. Noida is in NCR. Obtain written confirmation of the exact vehicle-class/fleet implications before any onboarding.
- Uttar Pradesh's 2026 aggregator framework requires formal review of the final Gazette notification, STA licensing, driver/vehicle requirements, insurance, training, grievance handling, security certification, data retention, fare rules and control-room obligations. The official UP document located during this audit is a draft notification dated 13 March 2026; do not treat it as the final instrument.
- Commercial release requires legal counsel / Transport Department confirmation, applicable licence, eligible vehicle classes, driver and vehicle verification, insurance, statutory safety controls, grievance and control-room staffing, privacy/data-retention compliance, and app security certification.

Official references:
- CAQM Direction No. 94: https://caqm.nic.in/WriteReadData/LINKS/Direction%20No-94cd874424-d234-41f3-872a-e51267b5447e.pdf
- UP 2026 draft aggregator framework (13 March 2026): https://upidadv.up.gov.in/upload/PublicationRequest/183241/SachivalyaLKO130326Notification639090236220551079.pdf
- Supabase Production Checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Supabase Production Security Checklist: https://supabase.com/docs/guides/security/production-checklist

## 4. Next execution order

1. Owner verifies Vercel production domain in Supabase Auth allowlist and completes real email verification.
2. Create separate real test identities; owner performs the one-time admin bootstrap.
3. Complete passenger, driver and admin browser journeys on the deployed app; fix every failure and rerun exact-head CI.
4. Provision backup login and GitHub secrets in a private terminal/settings UI; run encrypted backup and isolated restore.
5. Configure branch protection, MFA, SMTP, abuse controls, monitoring and manual accessibility/mobile QA.
6. Resolve the Noida/NCR vehicle and aggregator licensing position before any public ride or payment.
7. Only after acceptance, retire legacy Render API services; keep the Render static site as a rollback target until Vercel is stable.

## 5. Claims we can safely make today

- RideForge has a deployed React/Vite passenger interface using a Nirdhoom-inspired visual system.
- The deployed frontend is configured to call the Supabase Edge API.
- The Edge API and database are active; route quoting is server-authoritative and route quotes persist.
- Public application tables have RLS enabled, with no current Security or Health Advisor findings.

Do not claim that real passenger signup, driver onboarding, full ride completion, payments, emergency response, backup recovery, legal licensing, or commercial readiness are complete.


## 6. Release verification addendum — 20 November 2026, 07:15 IST

This addendum supersedes earlier deployment/CI statements above where they conflict.

- **Current GitHub main HEAD:** `440afb157c7981368252eed55745024e8255165c` (`test(e2e): target current Vercel production for live quote acceptance`).
- **Latest observed READY Vercel production deployment:** `dpl_8mZasVUEQ2AGMtKyX8ZUYrj6j2Lc`, built from `8ecfe94a5a249b3d808377778982b48f3e9d2859`. The later main HEAD is therefore **not yet proven deployed**.
- **Vercel status for current main HEAD:** failure with Vercel's `build-rate-limit` response. This is a deployment quota/account limit, not a confirmed application build failure. Do not claim the latest driver/admin workspace styling is live until a deployment built from the current HEAD is READY.
- **GitHub Actions run:** [run 44647862357](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/44647862357). All 15 returned jobs completed successfully, including both CodeQL analyses, dependency audit, API smoke at 5 km and 20 km, Supabase schema/RLS and Edge API tests, PostgreSQL backup/restore test, container scans, and web build/typecheck/browser suite.
- **Web acceptance:** 56 Playwright tests; 53 passed and 3 skipped. The route-preset regression test passed. The one-time live production passenger quote acceptance step was skipped. The live route quote remains demonstrated in the prior deployed build/runbook, but this workflow does not establish a fresh live quote on the latest source commit.
- **Latest hosted DB counts rechecked:** 0 Auth users, 0 application accounts, 0 rides, 7 route quotes. Security Advisor and Health Advisor both returned zero findings.
- **Release decision remains:** deployed academic/portfolio MVP only; not a completed commercial ride-hailing operation. The owner must still provision real passenger/driver/admin identities, configure Auth redirects and email delivery, complete real multi-account ride lifecycle acceptance, provision backup credentials/secrets and run hosted recovery, configure repository rules/MFA/monitoring, and obtain written transport/legal clearance before any real passenger service.
