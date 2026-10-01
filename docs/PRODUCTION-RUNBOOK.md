# MegaGoldenClub Production Runbook

This runbook covers deployment and recovery controls after business milestone 0024. It does not introduce or redefine business rules.

## Release gate

A release candidate must be built from the intended commit on `dev/local-foundation` and must have green Backend CI, Frontend CI and Release Evidence workflows for that exact commit. The Release Evidence workflow waits for Backend CI and Frontend CI on the same SHA, requires the authenticated browser-UAT artifact from Backend CI, and uploads exact-SHA JSON/Markdown evidence.

The Release Evidence artifact proves the automated candidate gates only. It intentionally records production approval as pending manual sign-off and does not mark target-host verification, human visual review, provider UAT, off-host recovery exercise or release ownership complete.

On the deployment host, pull the exact candidate commit and run from the repository root:

```bash
npm run verify
```

Record the operator, environment, exact commit and result in the release sign-off record. Do not deploy when migrations, lint, tests, production builds, frontend route smoke, API readiness, authenticated UAT smoke, browser UAT, release-evidence collection or target-host verification fail.

## Release evidence and sign-off

For each release candidate, retain the `megagoldenclub-release-evidence-<commit>` artifact produced by the Release Evidence workflow. Its `release-evidence.json` and `release-evidence.md` files tie Backend CI, Frontend CI and the browser-UAT artifact to one exact commit.

Complete `docs/RELEASE-SIGNOFF.md` for the same commit. Automated evidence may be referenced by run/artifact ID, but manual checks must be completed and signed by a human operator. At minimum, record:

- root `npm run verify` on the target-like host;
- production configuration validation against the actual target environment file;
- human interaction/readability review of the supported admin/member breakpoints using the browser-UAT screenshots as baseline evidence;
- provider/operator-process UAT for each real money/email/fulfilment process that will actually be enabled;
- an operational restore exercise from an encrypted off-host backup into production-like isolated infrastructure;
- rollback/recovery owner and release sign-off owner.

Use `docs/GO-LIVE-READINESS.md` as the finite ledger of repository-controlled versus external/manual/business-owner gates. Do not treat an unchecked, not-applicable-without-reason or missing manual gate as implicitly approved.

## Production environment

Use unique production secrets for CAPTCHA HMAC, JWT access and refresh signing. Do not reuse development or CI values. Set `NODE_ENV=production`.

Before production sign-off, validate the actual deployment environment file from the repository root:

```bash
npm --prefix backend run verify:production-config -- /absolute/path/to/production.env --check-files
```

The validator does not print secret values. It rejects development/CI placeholders, mismatched MySQL identity between `DATABASE_URL` and `MYSQL_*`, missing Redis authentication, insecure public HTTP/loopback URLs, disabled HSTS/rate limiting, test-only rate limiting, invalid proxy-hop bounds, malformed MongoDB configuration, incomplete/insecure SMTP configuration when present, and a missing/insecure backup-key file when `--check-files` is used. Add `--require-smtp` when email-based authentication features will be enabled in the target environment.

A validator `PASS` is necessary but not sufficient for production approval: domain/TLS/edge routing, monitoring/alerts, retention controls, provider/process UAT and the real off-host restore exercise remain operational gates.

When the API is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops. Do not use a broad trust-proxy value. Production release requires HTTPS at the public edge and `SECURITY_HSTS_ENABLED=true` after HTTPS is enforced end-to-end.

Rate limiting is Redis-coordinated and non-authoritative. Production defaults may be overridden with the `RATE_LIMIT_*` environment variables after reviewing expected traffic. Keep `RATE_LIMIT_ENABLED=true` and `RATE_LIMIT_TEST_ENABLED=false` in production.

The current payment contract is QR/UPI plus UTR/screenshot verification rather than an automatic payment-gateway adapter. Withdrawal payout records support an audited provider/reference process but no automatic payout adapter is selected. SMTP is the current optional external adapter. Product/prize fulfilment state is implemented without assuming a courier/vendor adapter. Do not invent or enable a new provider integration until it is selected, configured and UAT-approved; see `docs/GO-LIVE-READINESS.md`.

## SUPER_ADMIN lifecycle

`SUPER_ADMIN` is a normal persisted user with the `SUPER_ADMIN` role. MySQL stores the user record and password hash; environment files are not the credential source of truth.

First-install bootstrap is create-only. Supply bootstrap credentials only in the invoking process environment and remove them from shell history/automation secret context after use. Do not add them to `.env` or commit them:

```bash
SUPER_ADMIN_USERNAME='founder' \
SUPER_ADMIN_EMAIL='founder@example.com' \
SUPER_ADMIN_PASSWORD='<one-time-strong-password>' \
npm --prefix backend run super-admin:bootstrap
```

If the username already belongs to a `SUPER_ADMIN`, bootstrap exits without changing its password, status or sessions. Normal password changes and account recovery must use the application flows.

If normal recovery is impossible, use the explicit break-glass reset. The command requires an authorization phrase and incident reason, rejects a reset to the current password, preserves account status, revokes active sessions, invalidates outstanding auth-action tokens, forces password change at next login and writes an audit record:

```bash
BREAK_GLASS_SUPER_ADMIN_USERNAME='founder' \
BREAK_GLASS_SUPER_ADMIN_PASSWORD='<temporary-strong-password>' \
BREAK_GLASS_REASON='INC-1234 recovery approved by on-call lead' \
BREAK_GLASS_CONFIRM='RESET_SUPER_ADMIN_PASSWORD' \
npm --prefix backend run super-admin:reset-break-glass
```

Treat break-glass use as an incident action. Record the operator, approval and ticket outside the application as required by the operating organization. Never place the temporary password in tickets, chat, logs or source control.

## Health and observability

Use `GET /health/live` for process liveness. It intentionally does not depend on databases.

Use `GET /health/ready` for traffic readiness. It requires MySQL, Redis and MongoDB to be reachable. `GET /health` remains a compatibility alias for readiness.

Every API response carries `X-Request-Id`. A valid incoming request ID is preserved; malformed IDs are replaced. API logs include method, path without query string, status, duration and request ID. Use the request ID to correlate application and edge-proxy logs without logging reset/verification query tokens.

## Backup

MySQL is the authoritative business/financial system of record. MongoDB stores presentation/theme/template documents. Redis is non-authoritative and is intentionally excluded from backups.

From `backend/`:

```bash
npm run backup:data
```

The command writes a timestamped directory under `../backups/` by default with:

- `mysql.sql`
- `mongodb.archive.gz`
- `manifest.txt`
- `SHA256SUMS`

The backup/restore commands use the repository-root `.env` when present and otherwise accept the same required database settings from the invoking process environment. The manifest records the source git commit and database names. Restore rejects a backup whose manifest database identities do not match the configured MySQL and MongoDB targets.

A local backup is not complete until it is exported in encrypted form and copied/retained in protected off-host storage. Use `docs/OFFHOST-RECOVERY.md` as the authoritative operator procedure. The repository provides provider-neutral encrypted handoff commands:

```bash
MEGAGOLDENCLUB_BACKUP_KEY_FILE=/secure/megagoldenclub-backup.key \
  npm run backup:export-offhost -- /absolute/path/to/backup /mounted/off-host/path
```

The export validates the inner backup checksums, encrypts the expected backup files using AES-256-CBC with PBKDF2 and salt, writes a sibling SHA-256 file for the encrypted archive, and refuses overwrite. The key file must have mode `600` or `400` and must be managed outside the repository and outside the backup-storage failure/security boundary.

Retention, storage-provider access controls, immutability/versioning and encryption-key recovery remain deployment/operations responsibilities. Run scheduled backup jobs only after checking available disk space and monitoring command exit status. Perform a restore drill regularly on isolated production-like infrastructure.

## Restore drill / disaster recovery

Restore is destructive. Stop application traffic first and use an isolated host for drills whenever possible.

For an off-host recovery exercise, first retrieve both the encrypted archive and its `.sha256` file from the real remote storage boundary, then import it:

```bash
MEGAGOLDENCLUB_BACKUP_KEY_FILE=/secure/megagoldenclub-backup.key \
  npm run backup:import-offhost -- /recovery/incoming/backup.tar.gz.enc /recovery/work
```

The import validates the encrypted archive SHA-256 before decryption, rejects unexpected archive entries, validates the inner `SHA256SUMS`, and produces `/recovery/work/imported`.

Then restore from the verified imported directory:

```bash
MEGAGOLDENCLUB_RESTORE_CONFIRM=YES npm run restore:data -- /recovery/work/imported
```

The restore command verifies checksums and manifest database identity, restores MySQL and MongoDB, clears Redis to prevent stale non-authoritative state, and runs `prisma migrate status`.

Backend CI also runs an automated recovery regression only in its ephemeral `NODE_ENV=test` data services. It seeds isolated MySQL/MongoDB/Redis canaries, takes a real backup, exports it through the encrypted off-host format, deletes the original local backup to simulate primary-host loss, imports only the encrypted archive, restores it, proves MySQL and MongoDB returned to the backed-up values, proves Redis was cleared, and removes the canaries. The drill requires the explicit `MEGAGOLDENCLUB_RESTORE_DRILL_CONFIRM=YES` guard and refuses to run outside `NODE_ENV=test`.

The automated CI drill protects backup/encryption/import/restore code paths but does **not** replace an operational disaster-recovery exercise using an encrypted archive retrieved from the real off-host storage boundary and restored into production-like isolated infrastructure.

After an operational restore, return to the repository root and run:

```bash
npm run verify
```

Do not reopen traffic until verification passes and critical balances, policy versions, presentation versions, payout states, entitlements, lucky-draw token/claim state and audit records are sampled against the backup manifest/date. Record the remote object reference and encrypted archive SHA-256 without recording encryption-key material.

## Deployment order

1. Confirm Backend CI, Frontend CI and Release Evidence are green for the exact commit; retain the exact-SHA release-evidence artifact.
2. Pull the exact release commit on the target-like host and run root `npm run verify`; record the result in `docs/RELEASE-SIGNOFF.md`.
3. Run `verify:production-config` against the actual production environment with `--check-files` and record the non-secret PASS evidence; add `--require-smtp` if email-based auth will be enabled.
4. Complete the remaining applicable human/provider/process/recovery/business-owner gates in `docs/GO-LIVE-READINESS.md` and `docs/RELEASE-SIGNOFF.md`.
5. Take a fresh backup, export it with `backup:export-offhost`, and record the protected off-host object/checksum reference.
6. Put write traffic into the deployment maintenance procedure used by the hosting environment.
7. Install exact dependencies from the release artifact/commit.
8. Run `npx prisma migrate deploy` once from the release artifact.
9. Start/restart API, admin and member/public applications.
10. Wait for `/health/ready` to return HTTP 200 with MySQL, Redis and MongoDB `up`.
11. Run `npm run uat:smoke` from `backend/` against the deployed API. Supply `UAT_ADMIN_TOKEN` and `UAT_MEMBER_TOKEN` when authenticated smoke is required.
12. Complete the stateful checks in `docs/UAT-CHECKLIST.md` and record final release approval before opening normal traffic.

## Rollback

Application code may be rolled back to the previous compatible release artifact. Database migrations are append-only and are not edited or automatically rolled back. If a release requires a compensating schema change, add a new forward migration and validate it through CI/UAT.

Use data restore only for an actual recovery decision with an identified recovery point. Do not use restore as a routine application rollback mechanism.

## Incident minimums

For an incident, capture the release commit, UTC time window, affected request IDs, health/readiness output and operational exception queue state. Do not expose JWTs, passwords, reset tokens, payout destination references or raw KYC data in incident chat/log excerpts.
