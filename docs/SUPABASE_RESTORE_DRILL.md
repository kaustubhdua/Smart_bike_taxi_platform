# Supabase encrypted backup and restore drill

This procedure verifies the **RideForge public application schema backup**, not a full Supabase project clone.

## Create a backup

1. Provision the dedicated `rideforge_backup` database role as described in [SUPABASE_OPERATIONS.md](SUPABASE_OPERATIONS.md). It is intentionally created disabled (`NOLOGIN`) and has SELECT-only access.
2. Configure GitHub Actions secrets `RIDEFORGE_BACKUP_DATABASE_URL` and `RIDEFORGE_BACKUP_PASSPHRASE`. Use the Supabase Session pooler URI on port 5432 with TLS required and the dedicated role. Keep the database password and encryption passphrase separate.
3. Run [Supabase encrypted backup](../.github/workflows/supabase-backup.yml). It produces the artifact `rideforge-supabase-backup-<run_id>` containing an AES-256 GPG-encrypted custom-format `pg_dump --schema=public` and SHA-256 checksum.
4. Record the workflow run ID, artifact retention deadline and backup completion time in the operations log.

## Restore drill

1. Open [Supabase backup restore drill](../.github/workflows/supabase-restore-drill.yml) and choose **Run workflow**.
2. Supply the numeric GitHub Actions run ID that created the backup artifact. The workflow uses the existing `RIDEFORGE_BACKUP_PASSPHRASE` secret to decrypt it.
3. The workflow verifies the encrypted artifact checksum, decrypts it in a temporary workspace, prepares minimal local Supabase Auth roles/functions, and restores the public schema into a disposable PostgreSQL 17 service.
4. It verifies core tables, RLS on every restored public table, and at least 24 application migration ledger entries. Review the workflow summary and retain the run URL.

The restore job does not connect to or modify the production database. Its disposable PostgreSQL instance is destroyed with the runner.

## Scope limitation — not a full-project recovery

The backup command explicitly uses `pg_dump --schema=public`. It does not include:

- Supabase-managed Auth users, identities, sessions, MFA factors, provider configuration or Auth settings.
- Storage metadata in managed schemas or Storage object bytes.
- Edge Function bundles, per-function settings, project secrets, API keys, Vault secrets or other project configuration.
- DNS, custom domains, redirect allowlists, SMTP, network settings or platform-level configuration.

A passing drill proves only that the encrypted RideForge public schema can be recovered into PostgreSQL. It does not prove complete Supabase disaster recovery. Maintain a separate, reviewed recovery inventory for Auth, Storage, Edge Functions, secrets and platform configuration, and use the Supabase platform's supported backup/restore or project-cloning capabilities where available. Never claim full-project RPO/RTO from this schema-only drill.

## Acceptance record

For every drill, record:
- Source backup workflow run ID and artifact name.
- Backup timestamp, encrypted artifact checksum and retention deadline.
- Restore workflow run ID and result.
- Time to complete the restore (measured RTO for this schema-only scope).
- Any missing objects, extensions, privileges or data.
- Separate recovery evidence for Auth, Storage, Edge Functions and project settings.
