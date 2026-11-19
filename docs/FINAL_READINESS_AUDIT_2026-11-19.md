# RideForge final-readiness audit

**Assessment date:** 2026-11-19  
**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Audited main SHA:** `66a37b91512ed5a03e5341a358eb20a36edb7994`  
**Supabase project:** `rideforge-production` (`ghcufcegfvvjhsnqnrzr`, ap-south-1)  
**Decision:** **Not complete / not approved for public or commercial rides.** The repository has a strong, CI-verified academic MVP foundation. Several operator-controlled and real-environment acceptance gates remain open.

This report supersedes the dated status summaries in the README, `docs/COMPLETION_MATRIX.md`, and earlier release evidence. It deliberately separates source-code tests, live infrastructure observations, operator actions, and legal/commercial approval.

## 1. Exact evidence observed

### GitHub

- `main` resolves to `66a37b91512ed5a03e5341a358eb20a36edb7994`.
- Full release-readiness run [#695](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43706507082) completed successfully on that SHA. All 13 jobs passed, including C++ GCC/Clang and sanitizers, API smoke at 5 km and 20 km, PostgreSQL migration/recovery, web build and Playwright, Supabase migration/security invariants, CodeQL, dependency audit, and container checks.
- No open pull requests were returned by the repository PR search at audit time.
- GitHub issue [#17 — protect main](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/17) remains open. Main must be protected with required checks, PR-only changes, force-push protection, and deletion protection.
- GitHub issue [#3 — deployed E2E, accessibility and deployment verification](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/3) remains open.
- GitHub issue [#10 — dispatch races and recovery](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/10) remains open for additional stress and deployed-journey evidence.

A passing CI run proves the tested commit and test environment. It does not prove that a real user can sign up, that a real passenger and driver can complete a ride on the deployed site, or that a backup can be restored into an isolated hosted project.

### Supabase — read-only live inspection

- Project status: `ACTIVE_HEALTHY`; PostgreSQL 17.11; region `ap-south-1`.
- Edge Function `rideforge-api`: `ACTIVE`, version 10, deployed during this work from the exact `main` source. The deployed bundle now imports `npm:@supabase/supabase-js@2.119.0`, matching the repository (version 9 was still using 2.49.1). Platform JWT verification remains disabled because the handler performs application-level authentication itself. The hosted `/api/v1/ready` endpoint returned `{\"status\":\"ready\",\"backend\":\"supabase\"}` in the GitHub Edge API smoke job after deployment.
- The live public schema contains 14 tables; all 14 report RLS enabled.
- The live migration history contains 26 entries.
- Security Advisor: zero findings. Health Advisor: zero findings.
- Performance Advisor: 16 informational unused-index findings. The database is effectively empty, so these are not grounds for dropping indexes; reassess after representative traffic.
- Live counts at audit time: 0 Auth users, 0 application accounts, 0 rides.

The empty production identity and ride tables mean no real signup/login or passenger-driver-admin ride lifecycle has yet been evidenced against this hosted project.

### Render — read-only live inspection

- `rideforge-web` is live at https://rideforge-web.onrender.com.
- During this work, the static site was redeployed successfully on commit `66a37b91512ed5a03e5341a358eb20a36edb7994`, matching GitHub `main`. Render reported the deployment as `live`.
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
