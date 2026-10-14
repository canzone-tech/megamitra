# MegaGoldenClub Production Runbook

This runbook covers the immutable source-free production runtime and recovery controls. It does not introduce or redefine business rules.

## Production topology: default remote OR approved local-isolated, no source checkout

**Update, 2026-10-12:** The operator confirmed preinstalled shared-host MySQL
8.0.46, MongoDB 8.0.29 and Docker Redis 7.4.11 and selected **no external
cloud databases**. This is the explicit `MEGAGOLDENCLUB_DATA_TOPOLOGY=local-isolated`
exception. Reuse dedicated MySQL database on host port 3306. Because the host
MongoDB admin credentials are unavailable, use a **new, separate authenticated
MongoDB Docker container at 127.0.0.1:27019** and a separately owned Redis-only
container on 127.0.0.1:6381. Never alter existing host MongoDB 27017,
other Mongo container 27018, existing Redis 6379/6380, or other sites. Check existing Mongo auth and MySQL admin access first; record
off-host backup and tested isolated restore before app or migrations.
See [same-server deployment policy](../infra/ubuntu-vps/SAME-SERVER-DATABASES.md).

The paragraphs describing remote services below remain the **default remote
deployment profile** and do not override this approved local-isolated choice.

- **Production application host:** run only the GitHub CI-built, checksum-verified `megagoldenclub-runtime-<SHA>` archive. It contains the compiled NestJS API plus Next.js standalone Admin and Member applications and required runtime dependencies/static assets. Never copy Git metadata, `src/`, TS/TSX, development lockfiles, Prisma schema/migrations, Docker Compose, seed fixtures, unit/integration tests or local data-service volumes to the production runtime host. JavaScript compiled output is required by the Node.js runtime and is not the original TypeScript application source.
- **Data:** connect the API to separate managed/remote MySQL (financial source of truth), MongoDB (presentation/GridFS) and Redis (non-authoritative). Do **not** start MySQL, MongoDB or Redis containers/processes on the production application host. Use private network access and *enforced, certificate-verified* MySQL/Redis/MongoDB TLS (MYSQL_TLS=true, REDIS_TLS=true, MongoDB TLS URI, Prisma migration sslaccept=strict), authenticate with dedicated least-privilege accounts; never supply the MySQL root credential to the application host.
- **Build and verification:** source code, `npm run verify`, packaging, Prisma schema/migration files and test-only Docker Compose services stay on trusted local/CI/build infrastructure. They are never installed on the production runtime host.
- **Schema changes:** run the reviewed append-only `prisma migrate deploy` from a separately authorized, short-lived build/release runner with secure network access to the remote authoritative MySQL. Take and verify a recoverable remote backup first. Never run migrations on application startup or from the source-free runtime host.
- **Secrets:** inject at runtime via the hosting platform/secret manager; do not embed real connection strings, JWT secrets, backup keys or admin credentials in CI artifacts. Apply per-service process isolation, non-root execution, minimal write permissions, network egress controls and TLS at the HTTPS edge.
- **Recovery:** use the remote providers' verified, encrypted, off-host backup/snapshot and isolated remote restore facilities. Local Compose backup/restore scripts below remain development/CI drills, not production backup procedures.


## Verified application update: 2026-10-14

The operator supplied evidence that the **code-only** update from
`ba4750b6bf0880ebb8b3a76c6af3bc14acb8e4a4` to
`5cc5b98f4b45e40d38906a153aafcbb3e2b28a70` completed on the VPS,
using source-free runtime ZIP SHA256 validation, dedicated PM2 activation
and post-switch health checks. External curl checks returned public WWW
and Admin HTTP 200 with TLS verification 0, API public config HTTP 200,
and unauthenticated protected API HTTP 401; public `/health/live` HTTP
404 was **expected**, because the Apache API vhost intentionally blocks
all external `/health` paths. A production Prize Catalogue screenshot
showed the floating success toast. These observations are historical;
repeat the gates for every subsequent deployment. This does not
automatically close the independent business, provider, finance/payout,
off-host recovery documentation or renewal-monitoring gates.

For mandatory development → CI → local verification → approved production
handoff, see [Development and Delivery Rules](DEVELOPMENT-DELIVERY-RULES.md).

## First-deployment checkpoint

The shared-VPS HTTPS Apache vhosts and Snap Certbot certificates were
activated on 2026-10-12 (expire 2027-01-10). Apex HTTPS redirected 301 to
www; WWW/Admin/API returned 503 because their PM2 processes are not yet
started. SSL auto-renewal and external TLS must still be proven; two renewal
timers reported failures associated with an old, expired server-IP
certificate. **Do not remove old certs or alter other sites** as part of
this launch. Production local-isolated MySQL/Mongo/Redis databases and users are not
provisioned/verified yet. Follow
[`infra/ubuntu-vps/FIRST-DEPLOYMENT.md`](../infra/ubuntu-vps/FIRST-DEPLOYMENT.md)
before running production migration, PM2 or enabling any live feature.

## Ubuntu VPS implementation reference

The verified target is a **shared Ubuntu 24.04.4 LTS x86_64 VPS with Node.js 24.19.0, PM2 7.0.3 (existing pre-existing unrelated application processes) and Apache 2.4.58 + Certbot 5.8.0**. Preserve existing sites and root-owned pre-existing unrelated application PM2. Use the dedicated, non-root `megagoldenclub` Unix account with its **own PM2_HOME** and the operational config `infra/ubuntu-vps/ecosystem.config.cjs`. New processes are `megagoldenclub-api` on `127.0.0.1:3200`, `megagoldenclub-admin` on `127.0.0.1:3201`, and `megagoldenclub-member` on `127.0.0.1:3202`; do not alter existing pre-existing unrelated application ports 3100/3101. PM2 is already installed; do not install another process manager or switch Apache to Caddy.

Use `infra/ubuntu-vps/megagoldenclub-http.conf` for per-host HTTP/ACME and `infra/ubuntu-vps/megagoldenclub-ssl.conf` **only after the matching Certbot certificates exist**. Canonical hosts: `www.megagoldenclub.com` Member/Public, `admin.megagoldenclub.com` Super Admin, `api.megagoldenclub.com` public HTTPS API, and `megagoldenclub.com` redirecting to `https://www.megagoldenclub.com`. Apache 443 proxies only to those new local ports and returns 404 for externally requested `/health` and `/health/*` on the public API; health checks run against localhost. For exactly one trusted Apache edge hop, review and set `TRUST_PROXY_HOPS=1`; `MEGAGOLDENCLUB_PUBLIC_URL=https://www.megagoldenclub.com`.

**Manual DNS/TLS gate:** all four names were observed resolving to `103.228.151.134`, but the server reported only private interface addresses and HTTPS requests to public DNS **timed out from the VPS**; loopback `curl --resolve` returned the existing default Apache site, not MegaGoldenClub. Do not interpret DNS resolution or the default site's HTTP 200 as a working TLS deployment. Before Certbot/Apache activation, verify public edge/NAT/routing from an external machine, domain ownership, inbound TCP 80/443 and a live HTTP-01 challenge from all domains. Reconcile the observed public IP with the hosting-provider NAT mapping; do not assume the server's private interface is public. Do not enable a 443 site referencing missing certificate files. Record certificate issue/renewal, Apache configtest and shared-site smoke evidence in sign-off. SSH access, remote database providers, secret injection and rollout approval remain manual gates.

Verify the portable release archive `.tar.gz.sha256` **after transfer** and the embedded `RELEASE_SHA` against approved CI before atomically staging an immutable release. The PM2 ecosystem and Apache vhost files are **operational configuration only**, transferred separately without an application Git checkout or original TypeScript source. Node.js 24 `--env-file=/etc/megagoldenclub/api.env` is used only by the API child process; protect the file with a dedicated service-user-readable ACL/group (e.g. root:megagoldenclub 0640 and parent directory 0750), and do not place secrets in PM2 ecosystem env or PM2 dump. Do not run migrations, deploy application source, or run `npm run verify` on the VPS. This operator-approved local-isolated variant reuses existing loopback MySQL/Mongo; only the separate ops-only Redis container may be started after authorization.

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

The validator does not print secret values. It rejects development/CI placeholders, unauthorized loopback/local endpoints (except the dedicated stores explicitly allowed in local-isolated mode), mismatched MySQL identity between `DATABASE_URL` and `MYSQL_*`, missing Redis authentication, insecure public HTTP/loopback URLs, disabled HSTS/rate limiting, test-only rate limiting, invalid proxy-hop bounds, malformed MongoDB configuration, incomplete/insecure SMTP configuration when present, and a missing/insecure backup-key file when `--check-files` is used. Remote MySQL requires only the application DB user, **not `MYSQL_ROOT_PASSWORD`**. Config syntax checking alone does not prove DNS resolution, encrypted transport, least privilege or backup restore. Add `--require-smtp` when email-based authentication features will be enabled in the target environment.

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
4. Configure the approved data topology: for this shared VPS, dedicated `megagoldenclub` host MySQL database on port 3306, new authenticated MongoDB Docker on port 27019 and new isolated Redis Docker on port 6381. Do not change other database services. Require independently accessible off-host backups, retention, alerts, isolated restore, and approved MySQL/Mongo admin isolation.
5. From a trusted ephemeral migration runner (not the production app host), take/check a remote restore point and run append-only `prisma migrate deploy` **exactly once** with a schema/migration bundle checked out for this SHA. Review migration status, keep credentials out of images/artifacts and revoke short-lived access afterwards.
6. Verify the archive SHA256, assert its `RELEASE_SHA` matches the approved candidate, then transfer/extract only the compiled runtime onto the production application host. Use unprivileged service identities and immutable release directories, not a repository working tree.
7. Under the separate `megagoldenclub` service account (never the root pre-existing unrelated application PM2), run only the three compiled programs defined in `infra/ubuntu-vps/ecosystem.config.cjs`; their `cwd` values point to the approved, source-free runtime. API child reads `/etc/megagoldenclub/api.env` through Node 24 `--env-file`; Admin/Member never receive those DB credentials. Bind all on localhost ports 3200–3202 and expose via the four specific Apache HTTP/HTTPS VirtualHosts *after* verified external domain routing and valid Certbot certificates. Do not start Caddy or change existing Apache sites/PM2 processes. Target Node 24 x86_64 must match the CI release runtime.
8. Confirm **localhost-only** API `/health/live` and `/health/ready` report remote MySQL/MongoDB/Redis up; publicly, `https://api.megagoldenclub.com/health/ready` must be blocked (404), unauthenticated protected API requests return 401, SSR www/admin pages are healthy and the apex redirect is correct. Validate TLS and real *external* reachability; verify all pre-existing Apache sites and both original pre-existing unrelated application PM2 processes remain healthy. Check protected routes, request IDs, security headers, static assets, monitoring and controlled release UAT.
9. Perform traffic switch only after the named release owner signs the exact SHA, migration/backup checkpoints, real-provider checks and rollout evidence. Retain the previous compatible **compiled** artifact for rollback.

The runtime artifact contains no `prisma` migration CLI/schema and no build tools. If a migration or recovery needs repository tooling, use the approved separate runner; do not weaken production runtime immutability.

## Repeat release on an existing, healthy MegaGoldenClub VPS

The first-launch script is **not** for upgrades. Use the operator-only `infra/ubuntu-vps/deploy-reviewed-update.sh` for a controlled repeat release. It downloads the immutable, CI-proven source-free runtime from the GitHub pre-release and the ops-only scripts from an exact Git commit; validates artifact SHA256 and embedded `RELEASE_SHA`; stages an unoccupied release directory; reconciles only the dedicated release tree; checks that `/opt/megagoldenclub/current` references the **expected old SHA**; then atomically switches to the new SHA and restarts **only** the three `megagoldenclub-*` processes in `/var/lib/megagoldenclub/.pm2-runtime`. Readiness is verified against localhost-only API and Admin/Member ports. On failure after switching, the helper attempts to restore the previous symlink and only those three PM2 processes. No Apache, existing root PM2, other sites, migrations or data services are modified.

Before activation, the operator must verify the existing production release, real encrypted off-host recovery/restore evidence, a usable prior runtime for rollback, actual production secrets/readiness, and sign-off in `docs/RELEASE-SIGNOFF.md`. The script refuses activation without explicit `MEGAGOLDENCLUB_RECOVERY_SIGNOFF=YES` and `MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED=YES` acknowledgments; these declarations **do not create backup evidence**. Finance/payout remains on HOLD independently. This is a technical application-code update only.

Use a pinned ops commit (which may be newer than the source-free runtime commit because it only adds deployment tooling) and both exact runtime SHAs:

```bash
# Only after signing off the above recovery and release preconditions, on the VPS.
MEGAGOLDENCLUB_RECOVERY_SIGNOFF=YES MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED=YES \\
  bash deploy-reviewed-update.sh <OPS_COMMIT> <CURRENT_RELEASE_SHA> <NEW_RUNTIME_SHA>
```

### When GitHub's release API rejects a pinned older commit

GitHub Actions can download and checksum-verify the source-free runtime while its
`GITHUB_TOKEN` is unable to create a tag/release targeting a commit that changed
workflow files. Do **not** weaken the release's exact-SHA identity, relax
permissions globally, change the target to the newer ops commit, or upload any
application source to the VPS.

The already-successful pinned Backend CI run exposes a ZIP artifact called
`megagoldenclub-runtime-<NEW_RUNTIME_SHA>`. An authorized operator can
download **that exact** Actions artifact ZIP from GitHub's run page on a trusted
machine (no token/secret on the VPS), verify its published outer ZIP SHA256
against the GitHub Actions artifact metadata, then transfer that unchanged ZIP
to an access-restricted absolute path on the VPS. The staging tool accepts
`--uploaded-zip /absolute/path/to/artifact.zip <64-character-actions-artifact-sha256>`
as a separate explicit mode. It verifies the transferred ZIP's SHA256 and
then re-verifies the inner `megagoldenclub-runtime.tar.gz.sha256` and
embedded `RELEASE_SHA` before staging. Missing or tampered artifacts fail
closed. The same prior-release, recovery-signoff, dedicated PM2 and rollback
gates apply. This path needs no GitHub release write permission or broad PAT.
Do not confuse the GitHub Actions ZIP digest with the inner tar digest.

The script itself must first be fetched from the **same immutable OPS_COMMIT** and checked before running, and only from the reviewed `infra/ubuntu-vps` repository path. Never pipe an unpinned URL into `bash`, never copy an application source checkout to production, and never use the first-deployment bootstrap script on an already-running site. The GitHub workflow `publish-reviewed-runtime.yml` pins CI run IDs and refuses to overwrite an existing pre-release tag.

## Rollback

Application code may be rolled back to the previous compatible, checksum-verified source-free release artifact. Database migrations are append-only and are not edited or automatically rolled back. If a release requires a compensating schema change, add a new forward migration and validate it through CI/UAT.

Use data restore only for an actual recovery decision with an identified recovery point. Do not use restore as a routine application rollback mechanism.

## Incident minimums

For an incident, capture the release commit, UTC time window, affected request IDs, health/readiness output and operational exception queue state. Do not expose JWTs, passwords, reset tokens, payout destination references or raw KYC data in incident chat/log excerpts.
