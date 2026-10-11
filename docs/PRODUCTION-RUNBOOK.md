# MegaGoldenClub Production Runbook

This runbook covers the immutable source-free production runtime and recovery controls. It does not introduce or redefine business rules.

## Locked production topology: remote data, no source checkout

- **Production application host:** run only the GitHub CI-built, checksum-verified `megagoldenclub-runtime-<SHA>` archive. It contains the compiled NestJS API plus Next.js standalone Admin and Member applications and required runtime dependencies/static assets. Never copy Git metadata, `src/`, TS/TSX, development lockfiles, Prisma schema/migrations, Docker Compose, seed fixtures, unit/integration tests or local data-service volumes to the production runtime host. JavaScript compiled output is required by the Node.js runtime and is not the original TypeScript application source.
- **Data:** connect the API to separate managed/remote MySQL (financial source of truth), MongoDB (presentation/GridFS) and Redis (non-authoritative). Do **not** start MySQL, MongoDB or Redis containers/processes on the production application host. Use private network access and provider-supported encrypted transport, authenticate with dedicated least-privilege accounts; never supply the MySQL root credential to the application host.
- **Build and verification:** source code, `npm run verify`, packaging, Prisma schema/migration files and test-only Docker Compose services stay on trusted local/CI/build infrastructure. They are never installed on the production runtime host.
- **Schema changes:** run the reviewed append-only `prisma migrate deploy` from a separately authorized, short-lived build/release runner with secure network access to the remote authoritative MySQL. Take and verify a recoverable remote backup first. Never run migrations on application startup or from the source-free runtime host.
- **Secrets:** inject at runtime via the hosting platform/secret manager; do not embed real connection strings, JWT secrets, backup keys or admin credentials in CI artifacts. Apply per-service process isolation, non-root execution, minimal write permissions, network egress controls and TLS at the HTTPS edge.
- **Recovery:** use the remote providers' verified, encrypted, off-host backup/snapshot and isolated remote restore facilities. Local Compose backup/restore scripts below remain development/CI drills, not production backup procedures.


## Ubuntu VPS implementation reference

For an Ubuntu 24.04 LTS application VPS, use the versioned templates in `infra/ubuntu-vps/`: three unprivileged systemd services bound to `127.0.0.1`, and a two-domain Caddy HTTPS reverse proxy. The domains, SSH/host access, off-host database providers, Caddy certificate issuance, secret injection and rollout approval must be supplied by the operator; none are assumed by CI.

The application release artifact's portable `.tar.gz.sha256` must be checked after transfer, and the embedded `RELEASE_SHA` must match the approved exact commit before installing an immutable release directory. Never provision local MySQL/MongoDB/Redis, install a source checkout or run migration tooling on that VPS. No source checkout is needed to operate systemd services.

## Release gate

A release candidate must be built from the intended commit on `dev/local-foundation` and must have green Backend CI, Frontend CI and Release Evidence workflows for that exact commit. The Release Evidence workflow waits for Backend CI and Frontend CI on the same SHA, requires the authenticated browser-UAT artifact from Backend CI, and uploads exact-SHA JSON/Markdown evidence.

The Release Evidence artifact proves the automated candidate gates only. It intentionally records production approval as pending manual sign-off and does not mark target-host verification, human visual review, provider UAT, off-host recovery exercise or release ownership complete.

On the **trusted local or target-like verification machine** (not on the production runtime host), pull the exact candidate commit and run from the repository root:

```bash
npm run verify
```

The production application host receives only the corresponding source-free release artifact after approval.

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

Before production sign-off, validate the actual deployment secrets and remote endpoint configuration on a **secure operator/build machine** with the repository (never a production source checkout):

```bash
npm --prefix backend run verify:production-config -- /absolute/path/to/production.env --check-files
```

The validator does not print secret values. It rejects development/CI placeholders, loopback and local Compose MySQL/MongoDB/Redis endpoints, mismatched MySQL identity between `DATABASE_URL` and `MYSQL_*`, missing Redis authentication, insecure public HTTP/loopback URLs, disabled HSTS/rate limiting, test-only rate limiting, invalid proxy-hop bounds, malformed MongoDB configuration, incomplete/insecure SMTP configuration when present, and a missing/insecure backup-key file when `--check-files` is used. Remote MySQL requires only the application DB user, **not `MYSQL_ROOT_PASSWORD`**. Config syntax checking alone does not prove DNS resolution, encrypted transport, least privilege or backup restore. Add `--require-smtp` when email-based authentication features will be enabled in the target environment.

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

**The following repository backup command is for local development/isolated CI data services only; never run it on the production runtime host.** Remote production backups require provider-native encrypted snapshots/exports, off-host retention, restore testing and an approved recovery point. From `backend/` on a local/CI test instance only:

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

## Source-free deployment order

1. Confirm Backend CI, Frontend CI and Release Evidence all green for **the exact candidate SHA**; require the source-free `megagoldenclub-runtime-<SHA>` archive, companion SHA256 checksum, and authenticated browser-UAT evidence.
2. On the local/target-like verification host only, run root `npm run verify`. Validate the real production environment securely from an operator/build machine with `verify:production-config --check-files`; record evidence. **Never git clone or execute `npm run verify` on the production application host.**
3. Resolve applicable manual visual/stateful UAT, business-owner, domain/TLS, monitoring, provider-operator, retention and off-host recovery gates in `docs/RELEASE-SIGNOFF.md`. Automated green does not authorize public traffic.
4. Configure **remote** MySQL/MongoDB/Redis with scoped accounts, private networking and encrypted access; verify connection reachability from the application network. Approve remote backups, retention, alerts and a tested isolated restore. No local database container or local DB socket is allowed on the app host.
5. From a trusted ephemeral migration runner (not the production app host), take/check a remote restore point and run append-only `prisma migrate deploy` **exactly once** with a schema/migration bundle checked out for this SHA. Review migration status, keep credentials out of images/artifacts and revoke short-lived access afterwards.
6. Verify the archive SHA256, assert its `RELEASE_SHA` matches the approved candidate, then transfer/extract only the compiled runtime onto the production application host. Use unprivileged service identities and immutable release directories, not a repository working tree.
7. Inject production environment and secrets at runtime. Start `node api/dist/main.js`, `node admin/server.js`, `node member/server.js` in their respective artifact subdirectories, behind HTTPS reverse proxy with the approved ports, domains, health policy and rollback routing. Node 24 Linux target must match the CI release-build architecture.
8. Confirm `/health/live` and `/health/ready` report healthy remote MySQL, MongoDB and Redis, check admin/member SSR, protected routes, X-Request-Id, response security headers, static assets, monitoring and all relevant release UAT with controlled accounts.
9. Perform traffic switch only after the named release owner signs the exact SHA, migration/backup checkpoints, real-provider checks and rollout evidence. Retain the previous compatible **compiled** artifact for rollback.

The runtime artifact contains no `prisma` migration CLI/schema and no build tools. If a migration or recovery needs repository tooling, use the approved separate runner; do not weaken production runtime immutability.

## Rollback

Application code may be rolled back to the previous compatible, checksum-verified source-free release artifact. Database migrations are append-only and are not edited or automatically rolled back. If a release requires a compensating schema change, add a new forward migration and validate it through CI/UAT.

Use data restore only for an actual recovery decision with an identified recovery point. Do not use restore as a routine application rollback mechanism.

## Incident minimums

For an incident, capture the release commit, UTC time window, affected request IDs, health/readiness output and operational exception queue state. Do not expose JWTs, passwords, reset tokens, payout destination references or raw KYC data in incident chat/log excerpts.
