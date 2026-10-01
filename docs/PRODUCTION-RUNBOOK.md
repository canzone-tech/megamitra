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
- human interaction/readability review of the supported admin/member breakpoints using the browser-UAT screenshots as baseline evidence;
- provider UAT for each payment, payout, SMTP or fulfilment provider that will actually be enabled;
- an operational restore exercise from an encrypted off-host backup into production-like isolated infrastructure;
- rollback/recovery owner and release sign-off owner.

Do not treat an unchecked, not-applicable-without-reason or missing manual gate as implicitly approved.

## Production environment

Use unique production secrets for CAPTCHA HMAC, JWT access and refresh signing. Do not reuse development or CI values. Set `NODE_ENV=production`.

When the API is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops. Do not use a broad trust-proxy value. Enable `SECURITY_HSTS_ENABLED=true` only after HTTPS is enforced end-to-end at the public edge.

Rate limiting is Redis-coordinated and non-authoritative. Production defaults may be overridden with the `RATE_LIMIT_*` environment variables after reviewing expected traffic. Keep `RATE_LIMIT_ENABLED=true` in production.

SMTP and external payout/payment/fulfilment provider credentials remain provider-specific deployment inputs. Do not enable a provider integration until that provider is selected, configured and UAT-approved.

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

A local backup is not complete until the directory is encrypted and copied to protected off-host storage. Retention and encryption keys must be managed outside the repository.

Run scheduled backup jobs only after checking available disk space and monitoring command exit status. Perform a restore drill regularly on an isolated environment.

## Restore drill / disaster recovery

Restore is destructive. Stop application traffic first and use an isolated host for drills whenever possible.

From `backend/`:

```bash
MEGAGOLDENCLUB_RESTORE_CONFIRM=YES npm run restore:data -- /absolute/path/to/backup
```

The restore command verifies checksums and manifest database identity, restores MySQL and MongoDB, clears Redis to prevent stale non-authoritative state, and runs `prisma migrate status`.

Backend CI also runs an automated recovery regression only in its ephemeral `NODE_ENV=test` data services. It seeds isolated MySQL/MongoDB/Redis canaries, takes a real backup, mutates the canaries, restores the backup, proves MySQL and MongoDB returned to the backed-up values, proves Redis was cleared, and removes the canaries. The drill requires the explicit `MEGAGOLDENCLUB_RESTORE_DRILL_CONFIRM=YES` guard and refuses to run outside `NODE_ENV=test`.

The automated CI drill protects backup/restore code paths but does **not** replace an operational disaster-recovery exercise using an encrypted off-host backup and production-like isolated infrastructure.

After an operational restore, return to the repository root and run:

```bash
npm run verify
```

Do not reopen traffic until verification passes and critical balances, policy versions, presentation versions, payout states and audit records are sampled against the backup manifest/date.

## Deployment order

1. Confirm Backend CI, Frontend CI and Release Evidence are green for the exact commit; retain the exact-SHA release-evidence artifact.
2. Pull the exact release commit on the target-like host and run root `npm run verify`; record the result in `docs/RELEASE-SIGNOFF.md`.
3. Complete the remaining applicable human/provider/recovery ownership gates in `docs/RELEASE-SIGNOFF.md`.
4. Take and export a fresh backup.
5. Put write traffic into the deployment maintenance procedure used by the hosting environment.
6. Install exact dependencies from the release artifact/commit.
7. Run `npx prisma migrate deploy` once from the release artifact.
8. Start/restart API, admin and member/public applications.
9. Wait for `/health/ready` to return HTTP 200 with MySQL, Redis and MongoDB `up`.
10. Run `npm run uat:smoke` from `backend/` against the deployed API. Supply `UAT_ADMIN_TOKEN` and `UAT_MEMBER_TOKEN` when authenticated smoke is required.
11. Complete the stateful checks in `docs/UAT-CHECKLIST.md` and record final release approval before opening normal traffic.

## Rollback

Application code may be rolled back to the previous compatible release artifact. Database migrations are append-only and are not edited or automatically rolled back. If a release requires a compensating schema change, add a new forward migration and validate it through CI/UAT.

Use data restore only for an actual recovery decision with an identified recovery point. Do not use restore as a routine application rollback mechanism.

## Incident minimums

For an incident, capture the release commit, UTC time window, affected request IDs, health/readiness output and operational exception queue state. Do not expose JWTs, passwords, reset tokens, payout destination references or raw KYC data in incident chat/log excerpts.
