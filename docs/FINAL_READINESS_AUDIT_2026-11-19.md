# RideForge final-readiness audit

**Assessment date:** 2026-11-19  
**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Audited main SHA:** `7bad02b20aded723aaab1fcd3882da4ca3f7dc4f`  
**Supabase project:** `rideforge-production` (`ghcufcegfvvjhsnqnrzr`, ap-south-1)  
**Decision:** **Not complete / not approved for public or commercial rides.** The repository has a strong, CI-verified academic MVP foundation. Several operator-controlled and real-environment acceptance gates remain open.

This report supersedes the dated status summaries in the README, `docs/COMPLETION_MATRIX.md`, and earlier release evidence. It deliberately separates source-code tests, live infrastructure observations, operator actions, and legal/commercial approval.

## 1. Exact evidence observed

### GitHub

- `main` resolves to `7bad02b20aded723aaab1fcd3882da4ca3f7dc4f` after PR #87 merged.
- PR [#87](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/87) updated the web runtime to `nginx:1.30.7-alpine3.24`. Exact-head Full release readiness run [#707](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/44500919071) passed all 15 jobs, including both API smoke radii, PostgreSQL migration/recovery, web/Playwright, Supabase migration/security checks, GCC/Clang/sanitizers, both CodeQL analyses, dependency audit, container validation and Trivy scan.
- PR [#88](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/88) contains atomic Supabase accept/decline RPCs and rollback-only SQL integration tests. Its earlier run #712 was on the previous main base; it must be revalidated against the new mainline before merge.
- PR [#89](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/89) adds trusted hosted client-IP extraction, 8-second geocoding/routing timeouts, coordinate validation and Deno unit tests. Its exact-head run #713 is in progress.

- GitHub issue [#17 — protect main](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/17) remains open. Main must be protected with required checks, PR-only changes, force-push protection, and deletion protection.
- GitHub issue [#3 — deployed E2E, accessibility and deployment verification](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/3) remains open.
- GitHub issue [#10 — dispatch races and recovery](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/10) remains open for additional stress and deployed-journey evidence.

A passing CI run proves the tested commit and test environment. It does not prove that a real user can sign up, that a real passenger and driver can complete a ride on the deployed site, or that a backup can be restored into an isolated hosted project.

### Supabase — read-only live inspection

- Project status: `ACTIVE_HEALTHY`; PostgreSQL 17.11; region `ap-south-1`.
- Edge Function `rideforge-api`: `ACTIVE`, version 10, deployed during this work from the exact `main` source. The deployed bundle now imports `npm:@supabase/supabase-js@2.119.0`, matching the repository (version 9 was still using 2.49.1). Platform JWT verification remains disabled because the handler performs application-level authentication itself. The hosted `/api/v1/ready` endpoint returned `{\"status\":\"ready\",\"backend\":\"supabase\"}` in the GitHub Edge API smoke job after deployment.
- The live public schema contains 14 tables; all 14 report RLS enabled.
- The live application migration ledger contains 24 entries (001–024).
- Security Advisor: zero findings. Health Advisor: zero findings.
- Performance Advisor: 16 informational unused-index findings. The database is effectively empty, so these are not grounds for dropping indexes; reassess after representative traffic.
- Live counts at audit time: 0 Auth users, 0 application accounts, 0 rides.

The empty production identity and ride tables mean no real signup/login or passenger-driver-admin ride lifecycle has yet been evidenced against this hosted project.

### Render — read-only live inspection

- `rideforge-web` is live at https://rideforge-web.onrender.com.
- The static site is live on commit `66a37b91512ed5a03e5341a358eb20a36edb7994`. GitHub `main` has advanced to `7bad02b20aded723aaab1fcd3882da4ca3f7dc4f`; the static frontend has not yet deployed the merged security fix or the PR #86 driver-dispatch disclosure correction.
- Three historical API service objects remain: `rideforge-api-final`, `rideforge-api-v2`, and `rideforge-api`. The inspected `rideforge-api-final` deployments failed on 13 November. They are not the intended active backend in the Supabase-native architecture.
- Do not delete these legacy services until the external browser acceptance suite passes. After that, remove them deliberately and verify the Render inventory again.

## 2. Critical backup gate

The scheduled workflow `.github/workflows/supabase-backup.yml` failed on 18 November. The failure is explicit: the repository secrets `RIDEFORGE_BACKUP_DATABASE_URL` and `RIDEFORGE_BACKUP_PASSPHRASE` are empty/missing. See [failed run #5](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/44285760798).

The database migration intentionally creates `rideforge_backup` as `NOLOGIN BYPASSRLS` with a null password. This is a safe disabled-by-default backup identity, but it cannot authenticate until an authorized project owner deliberately provisions it. Adding GitHub secrets alone is insufficient.

### Safe operator provisioning

1. Open the Supabase Dashboard for `rideforge-production` and copy the **Session pooler** connection details from the Connect panel. Do not construct the pooler hostname from the region.
2. As the project owner, use a secure `psql` session as the database administrator to enable the dedicated backup identity and set its password interactively:
   ```sql
   ALTER ROLE rideforge_backup LOGIN BYPASSRLS;
   ```
   Then use the `psql` meta-command `\password rideforge_backup` to set a randomly generated password without putting the plaintext password in SQL history or logs. Do not paste the password into chat, source control, a workflow file, or a shell command line.
3. In GitHub repository Settings → Secrets and variables → Actions, create:
   - `RIDEFORGE_BACKUP_DATABASE_URL`: the copied Session pooler URI, with username `rideforge_backup.ghcufcegfvvjhsnqnrzr`, port `5432`, `sslmode=require`, and the newly provisioned password URI-encoded.
   - `RIDEFORGE_BACKUP_PASSPHRASE`: a separate high-entropy encryption passphrase. Store it independently from the database password.
4. Run the workflow manually. Verify that the job completes, that the encrypted artifact and checksum exist, and that the plaintext dump is not uploaded.
5. Perform an isolated restore drill into a disposable database/project, verify expected schema and data, and record the restore result and elapsed time. Do not restore over production.
6. Rotate both credentials if they are exposed. The restore script re-applies the role-hardening migration, which returns `rideforge_backup` to `NOLOGIN` with no password; re-provision it before the next scheduled backup.

The current workflow verifies decryption and archive listing, and CI restores a logical dump into a local disposable PostgreSQL database. Neither is yet proof of a hosted off-site restore drill. GitHub Actions artifacts currently have 30-day retention; decide whether a second independent object-storage destination and longer retention are required for the intended recovery objectives.

**Scope limitation:** the workflow runs raw `pg_dump --schema=public`, so it backs up only the RideForge application schema. It does not include Supabase-managed `auth` or `storage` schemas, Storage object bytes, Edge Function source/configuration, Auth provider settings, project secrets, or other project-level settings. Supabase's CLI `db dump` also intentionally excludes managed schemas such as `auth` and `storage`; see the [CLI dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump) and [restore-to-new-project guide](https://supabase.com/docs/guides/platform/clone-project). Supabase's managed database backups are available on paid plans; the Free-plan recommendation is to export data regularly, but a `public`-only dump is not a full-project disaster-recovery plan. Before any real users or uploaded documents are introduced, either adopt managed backups/PITR on an appropriate plan or define and test separate recovery procedures for Auth identities, Storage objects, Edge Function code, Auth configuration, and secrets.

Supabase recommends regular logical exports for Free-plan projects and explains its managed backup/PITR plan limits in its [backup documentation](https://supabase.com/docs/guides/platform/backups). Its [GitHub Actions backup guide](https://supabase.com/docs/guides/deployment/ci/backups) also warns against committing plaintext database dumps to a repository.

## 3. Mapping and routing provider constraints

The current Edge Function defaults to public Nominatim and OSRM endpoints. These are acceptable only for constrained evaluation/demo use with correct attribution and provider throttling.

- The [Nominatim public-service policy](https://operations.osmfoundation.org/policies/nominatim/) limits usage to at most one request per second, requires an identifying User-Agent/Referer and attribution, and prohibits client-side autocomplete.
- The app's database-backed provider throttle and sequential geocoding calls are aligned with a conservative evaluation posture, but public Nominatim is not a production geocoding dependency for a commercial ride service.
- Select a contracted geocoding/routing provider or operate adequately provisioned services before real riders. Keep provider URLs/configuration server-side; do not expose private provider credentials in the browser.
- Use the provider's current terms, quotas, data retention, attribution and SLA as explicit release evidence.

## 4. Open completion gates

| Gate | Current state | Required evidence before marking complete |
|---|---|---|
| Current frontend deployment | Behind main | Successful deployment on the exact approved main SHA; verify deployed asset/build identity |
| Backup credentials | Missing | Dedicated login enabled, two GitHub secrets provisioned, scheduled run succeeds |
| Backup restore | Partial | Isolated hosted restore drill, schema/data checks, documented RPO/RTO |
| Auth bootstrap | Not proven | Real verified passenger, driver and admin accounts; admin promotion controlled and audited |
| Full ride lifecycle | Not proven in hosted environment | Separate browser sessions: quote → book → offer → accept/decline/expiry → arrival → start → complete/cancel → history/receipt |
| Authorization | CI evidence exists; live journeys absent | Negative tests for cross-account access and every admin/driver route against deployed function |
| Dispatch reliability | Core tests pass; more evidence open | Deterministic accept/expiry/cancel/duplicate-worker tests plus representative load and restart recovery |
| Branch governance | Open issue #17 | Enforced ruleset/branch protection and test PR proving required checks block merge |
| Mobile/accessibility | Automated checks exist | Manual Android Chrome and iOS Safari, keyboard/focus/screen-reader/zoom/reduced-motion review |
| Monitoring/operations | Partial | Error/latency/traffic/saturation signals, alerts, incident runbook, retention/deletion and support process |
| Routing provider | Demo default | Production-grade provider contract or self-hosted service with measured capacity |
| Commercial/legal | Not authorized | Applicable UP aggregator licence, vehicle/driver/insurance/safety compliance, DPDP/privacy review and legal sign-off |

## 5. Research-backed engineering principles

- Follow Supabase's current [production security checklist](https://supabase.com/docs/guides/security/production-checklist): RLS on exposed tables, least-privilege database roles, secret isolation, Auth controls and advisor review.
- For Edge Functions, preserve the distinction between a user JWT and a project secret/API key. Keep user-scoped operations under the caller's RLS context; use privileged service-role access only with explicit server-side ownership checks. See [Supabase Edge Function security](https://supabase.com/docs/guides/functions/auth) and [authorization headers](https://supabase.com/docs/guides/functions/auth-headers).
- Use PostgreSQL transactions, constraints and row locks as the source of truth for one-time ride assignment. Client-side state and realtime delivery must never be the authority for accepting a driver offer.
- Treat persisted ride events and idempotent REST recovery as the correctness path; live event streams are a latency optimization and must tolerate reconnects, duplicate delivery and replay.
- Do not remove indexes merely because an empty database reports them unused. Revisit query plans and index utility after representative workload data exists.


### Open-source architecture research

The review used open-source ride-hailing implementations as architecture references, not as code to copy blindly:

- [OpenRide](https://github.com/adam-nelson/openride) documents a modular rider/driver/operator workflow, dispatch, routing, payments, compliance and incident handling. Its repository declares Apache-2.0; review the exact upstream license and attribution before reusing any implementation.
- [Autofleet Locomotion](https://github.com/Autofleet/locomotion) is an MIT-licensed rider app, but its README describes a dependency on the Autofleet backend ride engine. It is useful as a client/workflow reference, not a drop-in self-hosted backend.
- [WNCC UberClone](https://github.com/wncc/Hello-FOSS-26_UberClone) describes India-focused route/matching workflows and an end-to-end rider/driver test harness. Treat it as a design reference only unless its license is independently verified.

The strongest transferable patterns for RideForge are: explicit rider/driver state machines, a single transactional winner for competing offers, server-side fare snapshots, restart-safe dispatch, real end-to-end tests across two identities, and a hard separation between a demo fare and real payment/settlement. RideForge already implements parts of these patterns; its missing evidence is called out in the release gates above.

## 6. Follow-up remediation — 19 November 2026

### Container security

PR [#87](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/87) updates the web runtime from `nginx:1.30.6-alpine3.24` to `nginx:1.30.7-alpine3.24` after run #704 found 3 CRITICAL and 3 HIGH fixed NGINX vulnerabilities. The replacement was verified on the exact candidate: run [#707](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/44500919071) passed all 15 jobs, including the container vulnerability scan. PR #87 was merged as `7bad02b20aded723aaab1fcd3882da4ca3f7dc4f`.

### Supabase offer state transitions

Source review found the driver decline handler performed two separate database requests (offer status update, then decline-exclusion upsert), allowing partial state if the second request failed. The accept path also locked offer before ride while dispatch/cancellation lock the ride first.

PR #88 implements a service-role-only transactional decline RPC, atomic offer/exclusion writes, immediate redispatch, a ride-first lock order for acceptance, and rollback-only SQL integration tests. Its run #712 passed the local Supabase migration/security invariant job, including applying the new migration; the remaining jobs were still running when this snapshot was taken. The PR's base became stale after PR #87 merged, so the same changes are being carried on a new mainline branch/PR #90 for fresh exact-head verification.

### Hosted quote endpoint

PR #89 hardens public quote rate limiting by trusting only Supabase's Cloudflare-overwritten `CF-Connecting-IP` on hosted ingress and refusing caller-supplied forwarding headers; local gateway fallbacks are restricted to local Supabase URLs. It also adds 8-second upstream timeouts and coordinate validation, with Deno tests in CI. Exact-head run #713 is in progress. No production Edge Function redeploy has been made for these pending PRs.

### Live data and deployment

The live Supabase project remains ACTIVE_HEALTHY with 14 public tables, all 14 RLS-enabled, zero Security Advisor findings, zero Health Advisor findings, and 16 informational unused-index findings. The application ledger has 24 entries. It still has zero Auth users, zero application accounts and zero rides. The Render static frontend remains live on the older commit `66a37b91512ed5a03e5341a358eb20a36edb7994`; do not claim the hosted app is aligned to current main until a new live deployment is observed.

## 7. Final release decision

**Current classification: CI-verified academic/portfolio MVP; not yet end-to-end verified in the hosted environment.**

The following must all be true before the next audit can issue a positive *MVP completion* verdict:

1. The latest approved commit is deployed and its SHA is recorded.
2. Backup workflow succeeds with dedicated least-privilege credentials and a separate restore drill succeeds.
3. Passenger, driver and admin accounts complete the real hosted journeys in separate browser sessions.
4. Security/authorization negative tests, dispatch concurrency/recovery tests, mobile/accessibility checks and operational smoke tests pass.
5. Main branch protection is enabled and required checks are enforced.
6. The completion matrix and README reflect the exact tested SHA and evidence links.

Commercial passenger operations remain a separate L5 authorization gate and must not be inferred from an MVP completion verdict.


## 8. Live deployment and remediation update — 19 November 2026 (16:xx IST)

### Verified repository and Vercel state

- Current main at the start of this release pass: `1a52e982123e0ec334f7fe5e91d55c3cde499337`.
- PR [#91](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/91) is merged. It adds trusted Cloudflare client-IP extraction for hosted quote rate limiting, rejects caller-controlled forwarding headers, and bounds upstream provider calls.
- PR [#90](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/90) is merged. Its exact-head Full release readiness run [#732](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/44516667633) passed all 15 jobs, including the dispatch accept/decline race test, Supabase schema rebuild/security invariants, both API smoke radii, browser tests, CodeQL and Trivy.
- Vercel Production deployment `dpl_DZEjKWKVvnH59QysSv2wtQn3aKVS` is READY on main SHA `1a52e982123e0ec334f7fe5e91d55c3cde499337`. The production bundle embeds `https://ghcufcegfvvjhsnqnrzr.supabase.co/functions/v1/rideforge-api` through `VITE_API_BASE_URL`.
- The integrated release PR [#97](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/97) consolidates Vercel SPA rewrites, exact-origin CORS, Vercel Auth redirect defaults, and encrypted public-schema backup/restore. Its exact-head Full release readiness and backup-workflow actionlint checks must pass before merge.
- The Vercel preview for PR #97 returned HTTP 200 and the Vite entry point for `/`, `/driver`, and `/admin`. Production deep links remain pending until PR #97 is merged and Vercel deploys the resulting main SHA.

### Verified Supabase production state

- Project `ghcufcegfvvjhsnqnrzr` is ACTIVE_HEALTHY, PostgreSQL 17.11, Mumbai region, Free plan.
- 14 public tables are present and all 14 have RLS enabled. Security Advisor and Health Advisor returned zero lints; Performance Advisor reports informational unused indexes on the empty database.
- The project has zero Auth users, zero application accounts, zero rides, and no development/staging branches. No dummy passenger, driver or administrator identities were created in production.
- Migration `025_atomic_driver_offer_transitions` was applied on 19 November 2026 and recorded in both migration histories. The `rideforge_accept_offer` and `rideforge_decline_offer` SECURITY DEFINER RPCs exist; `service_role` can execute both, while `anon` and `authenticated` cannot.
- After the migration, the live `/api/v1/health` and `/api/v1/ready` endpoints returned HTTP 200 with `status: ok` and `status: ready`.
- The live Edge Function is still version 10. It has not yet been redeployed with the PR #97 CORS helper and the atomic decline RPC caller. Do not claim the new decline path or Vercel CORS is live until the reviewed source is deployed and rechecked.

### Backup and account controls

- The dedicated `rideforge_backup` role remains `NOLOGIN` and passwordless. It must stay disabled until the owner securely sets a password and provisions GitHub Actions secrets `RIDEFORGE_BACKUP_DATABASE_URL` and `RIDEFORGE_BACKUP_PASSPHRASE`.
- PR #97 adds a GPG-encrypted `pg_dump --schema=public` workflow and a disposable PostgreSQL 17 restore drill. This is a schema-only backup, not a full Supabase Auth/Storage/Functions/secrets/platform backup. No successful backup artifact or restore drill is yet evidenced.
- Supabase Auth Site URL and redirect allowlist need an owner-side update to `https://smart-bike-taxi-platform.vercel.app` and `https://smart-bike-taxi-platform.vercel.app/**`. The production Auth redirect configuration could not be read or changed through the connected Supabase tools; do not claim this setting is complete.
- No staging project/branch exists. Supabase branching can incur hourly compute charges and requires explicit cost approval; do not create one or place test identities in production without authorization.
- The GitHub repository has no repository rulesets configured, and the earlier branch-protection audit reported `main` unprotected. The available GitHub connector has no ruleset/branch-protection mutation action. An owner must enable a required-check ruleset and verify it with a test PR.
- The Vercel account UI displayed an Enable 2FA prompt. Enable account MFA/2FA before relying on this account for production administration.

### Commercial and jurisdictional release boundary

RideForge remains an academic/portfolio MVP, not an authorized transport operator. A secondary legal analysis reports that the Uttar Pradesh Motor Vehicle (Thirty-third Amendment) (Aggregator and Delivery Services Provider) Rules, 2026 were notified on 22 May 2026 and require a State Transport Authority licence before new aggregator operations, along with extensive driver, vehicle, insurance, training, app-security, control-room, grievance and fare obligations. Obtain the final Gazette and written legal/STA confirmation before any real ride: [Argus legal analysis](https://www.argus-p.com/updates/updates/overview-of-the-uttar-pradesh-motor-vehicle-thirty-third-amendment-aggregator-and-delivery-services-provider-rules-2026/). The official [CAQM Direction 94 amendment dated 23 December 2025](https://caqm.nic.in/FileUploadDomain/WebsiteDocument/Home/News/Direction%20and%20Amendmente738921f-1bba-445c-b837-6e794e066be4.pdf) restricts induction of conventional petrol/diesel two-wheelers from 1 January 2026 while allowing BS-VI two-wheelers in existing fleets through 31 December 2026. Do not onboard vehicles or accept fares until these rules are validated against the intended operating model.

### Current verdict

**CI-verified academic/portfolio MVP with a live Vercel frontend and live Supabase backend; not yet hosted-journey verified and not commercially launch-ready.** The remaining gates are: merge PR #97 after all exact-head checks pass; deploy and verify the matching Edge Function; complete Supabase Auth URL configuration and first-admin bootstrap; provision the backup credentials and complete a real backup/restore drill; create a separately approved staging environment and test passenger/driver/admin journeys; enable GitHub branch protection and account MFA; and complete the legal, vehicle, safety, privacy, accessibility, device and load reviews.
