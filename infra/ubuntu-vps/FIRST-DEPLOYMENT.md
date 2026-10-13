# MegaGoldenClub first production launch — operator-only runbook

This is the **first** MegaGoldenClub launch.

**2026-10-12 operator decision:** no external cloud database services; same
shared Ubuntu VPS already runs MySQL 8.0.46, MongoDB 8.0.29 and Docker
Redis 7.4.11. MySQL admin access is verified and the dedicated app database/user
have been created. Host Mongo administrator login was unsuccessful; therefore
use the explicit `local-isolated` profile with a **new independent MongoDB
Docker instance at 27019** and an isolated Redis-only instance at 6381,
without changing either existing MongoDB process/container., NOT the unrelated databases
or containers. [Same-server database gate](SAME-SERVER-DATABASES.md)
**supersedes the remote-provider stages below for this deployment**.
Do not create cloud accounts or assume existing database admin credentials.
 The existing shared Ubuntu 24.04.4
application VPS already serves other websites through Apache and root-owned PM2.
Do NOT change that existing PM2 daemon, existing apps, their ports 3100/3101,
their certificates or other Apache VirtualHosts. No application Git checkout,
TypeScript/TSX source, database servers, Docker database volumes, migrations or
root MySQL credentials may be placed on the application VPS.

## Stage 0 — HTTPS already provisioned (observed 2026-10-12)

- All four hostnames point to the public edge at `103.228.151.134`.
- Apache HTTP and HTTPS vhosts for `megagoldenclub.com`, `www`, `admin`
  and `api` are enabled; Apache configtest returned `Syntax OK`.
- Snap Certbot successfully issued apex+www, admin, and api certificates,
  expiring **2027-01-10**. Internal localhost HTTPS tests verified the apex
  301 to www; www/admin/api returned **503**, expected until PM2 apps run.
- **Not yet signed off:** external HTTPS certificate validation, certificate
  automatic renewal (old expired IP certificate and two renewal jobs are
  still generating errors), existing-site regression checks.

Never interpret HTTPS proxy 503 as a certificate failure, or the successful
issuance as proof that Certbot renewal is healthy. Do not disable old IP
certificate or timers without a separate approved unrelated-site change.

## Stage 1 — provision the three REMOTE data services (not on this VPS)

Provision these independently, through provider consoles or an independently
authorized database host, with exact endpoint details securely held outside Git:

| Store | Purpose | Minimum activation evidence |
| --- | --- | --- |
| MySQL 8 | Financial/ledger single source of truth | remote DNS/private endpoint, MySQL 8 identity, app account least privilege with SSL required, separate migration runner grant, encryption, PITR/snapshot and restore proof |
| MongoDB | CMS/presentation/media | separate authenticated database, `mongodb+srv://` or `mongodb://...?tls=true`, valid chain, IP allowlist/private networking, secure snapshot and restore proof |
| Redis | Non-financial cache/coordination | external authenticated Redis, TLS enabled, network restriction and predictable reconnect behavior; not authoritative and not backed up |

Choose actual remote providers/endpoints through authorized cloud management.
**Do not fabricate a provider, endpoint, invoice or connection success.**
Keep provider passwords, DB URLs and secret keys out of chat, repo, CI logs
and PM2 config/dump. Never use the production app host as a DB/migration host.

## Stage 2 — configure TLS and secrets (separate trusted operator environment)

The API **requires** `MYSQL_TLS=true` and `REDIS_TLS=true` in production.
The MongoDB URI must use `mongodb+srv://` (default verified TLS) or explicitly
`mongodb://...?tls=true`. Reject insecure certificates/hostnames; supply any
private provider CAs by absolute `MYSQL_TLS_CA_FILE` or
`REDIS_TLS_CA_FILE` paths. If a public trusted CA is used, leave those two
optional paths empty. TLS does not remove the need for private/firewalled access.

`DATABASE_URL` is for the **separate Prisma migration runner**, not the
runtime ORM's MariaDB adapter. It must point to the same remote MySQL identity
as the `MYSQL_*` settings and include `?sslaccept=strict`. If a provider
requires a custom CA for Prisma Migrate, use provider-supported `sslcert`
on the separate migration runner, where paths are resolved relative to its
Prisma folder. Supply secrets securely; URI-encode reserved password chars.
The app's MariaDB driver independently uses `MYSQL_TLS=true` and optional CA.

Set `MEGAGOLDENCLUB_PUBLIC_URL=https://www.megagoldenclub.com`,
`TRUST_PROXY_HOPS=1` for the single trusted Apache hop,
`SECURITY_HSTS_ENABLED=true`, production rate limiting enabled and test
bypass disabled. Distinct CAPTCHA/JWT secrets are mandatory. SMTP is only
required when email-dependent flows will be enabled.

Run production config validation on **trusted operator/build infrastructure**
(not the source-free app VPS) against a real secret file and verify CA paths:

`npm --prefix backend run verify:production-config -- /secure/production.env --check-files`

Use `--require-smtp` if email features are active. Do not publish the file or
command output containing credentials.

### Read-only remote connectivity check (trusted operator runner)

After provisioning, from an **isolated operator/build host with backend dependencies
installed and access to the actual remote secrets**, run:

`npm --prefix backend run verify:remote-data -- /secure/production.env`

The command fails closed if production settings/CA files are invalid, then
makes **read-only** queries: MySQL 8 server version and negotiated TLS cipher,
MongoDB TLS-authenticated ping, Redis TLS-authenticated ping. Its output reports
only status, never credentials, endpoints, server exception messages or raw
connection strings. This probe does **not** create provider accounts, approve
snapshots, guarantee backup recovery, apply migrations or deploy anything.
Do not copy this source script to the compiled-only application VPS.

### Ops-only local-isolated API environment staging (not a deployment)

For this VPS, after verifying the protected dedicated MySQL, MongoDB and Redis
credential files, use the reviewed [`stage-api-env.mjs`](stage-api-env.mjs) from
the exact approved GitHub commit. Transfer **only this ops script** into a
private temporary directory on the VPS; never check out application source.
The root-only script reads existing credentials without evaluating them as
shell code, verifies the exact dedicated loopback ports/accounts, generates
three distinct CAPTCHA/JWT signing secrets, then creates
`/etc/megagoldenclub/api.env` **once** with `root:megagoldenclub 0640`.
It refuses preexisting files (including symlinks), changed credential file
modes, or any conflicting service identity. Secrets never appear in console
output, CLI parameters, PM2 metadata, Git or Docker Compose environments.

This is **configuration staging only**. It does not start PM2, migrate MySQL,
touch MongoDB/Redis services, perform backups, transfer a runtime artifact or
approve the release. Production config validation on the separate trusted
operator/build runner still requires its real recovery-key file and valid
runtime configuration. The off-host backup encryption key is **not** created
or copied onto the production application host by this script. Complete a
real encrypted off-host backup and isolated restore, migration-only approval,
and release sign-off before launching any applications.

### Pre-migration metadata inventory (read-only; no backup override)

For the explicitly approved local-isolated VPS, ops-only
[`inspect-mysql-schema.mjs`](inspect-mysql-schema.mjs) is a repeatable
read-only inventory of **only** the dedicated `megagoldenclub` MySQL schema.
Transfer the exact-SHA script into a temporary root-only location and invoke
with `/usr/bin/node` as root; do not install application source. It reads
the existing root:megagoldenclub 0640 `api.env` without shell evaluation,
validates the exact `megagoldenclub_app@127.0.0.1` connection, stores the
existing generated MySQL secret only in a temporary root-private
mysql options file, and queries information_schema and optional
`_prisma_migrations` metadata. It reports only counts and classification.
The options file is deleted on exit. No DDL, DML, migration, credentials
rotation, startup, backup or database/container changes are performed.

**2026-10-13 operator request:** omit backup provisioning for now and
continue non-destructive setup. This request is NOT a successful backup
or restore gate. Production financial go-live and irreversible migrations
remain on HOLD until an explicitly authorized and independently recoverable
backup, isolated restore evidence and migration-runner approval exist.
Schema inventory is information only and cannot clear these gates.

### Explicit one-time empty-DB migration exception (2026-10-13)

The operator specifically authorized a **temporary migration runner on the
existing VPS** after a read-only identity check confirmed exactly zero
tables and no migration history in the dedicated `megagoldenclub` database.
Backups are intentionally deferred by operator choice; this DOES NOT approve
financial transactions, withdrawals or production go-live.

The ops-only [`migrate-empty-mysql.mjs`](migrate-empty-mysql.mjs) and
[`empty-db-migration-manifest.json`](empty-db-migration-manifest.json) are
downloaded together from a CI-green reviewed SHA, without a Git checkout.
The manifest pins all 41 SQL migrations, `schema.prisma` and
`prisma.config.ts` by Git blob checksum to the earlier reviewed migration
source SHA. The script verifies each downloaded file, installs the exact
Prisma CLI 7.10.0 and dotenv 17.4.1 into root-private temporary storage,
and repeats the **empty schema** and exact application account check
immediately before using a temporary migration-only MySQL account.

The operator enters their existing MySQL root password at local MySQL
interactive prompts; the root credential is never put into an environment,
file or argv by this runner. Temporary SQL credentials are generated
privately and granted DDL rights on **only** `megagoldenclub.*`; successful
`prisma migrate deploy` and `prisma migrate status` are followed by an
attempt to DROP the temporary migration account. The app account never
receives DDL permissions. Check `_prisma_migrations` for exactly 41
completed migrations, and stop on any discrepancy. If migration fails or
account removal is not confirmed, **do not blindly rerun**: inspect the
partial ledger and revoke/drop temporary access before continuing.

**This exception is not a reusable VPS migration policy.** It does not
restore the independent backup/restore gate, start PM2, copy application
source, touch another database, or authorize real financial transactions.

## Stage 3 — remote backup, migration, artifact staging

Record a recoverable remote MySQL/MongoDB snapshot and a tested **isolated
restore** with approved retention and off-host protection. From a separate
short-lived runner, validate and apply the reviewed, append-only MySQL
migrations using a migration-only credential—not from the app VPS or PM2.

Select one exact GitHub SHA with Backend CI, Frontend CI, Release Evidence,
local `npm run verify`, browser UAT and source-free runtime artifact green.
Transfer **only** its compiled artifact plus checksum (never a Git checkout),
verify archive SHA256 and embedded RELEASE_SHA after transfer, inspect for
forbidden source/data files, stage immutable
`/opt/megagoldenclub/releases/<SHA>` and atomically switch the `current`
symlink during an explicitly approved deployment window.

Transfer **ops-only** `ecosystem.config.cjs` to a protected configuration
directory, run the three MegaGoldenClub PM2 apps with a dedicated non-root
Unix account and independent PM2_HOME. No root-owned existing PM2
processes may be touched. Protect `/etc/megagoldenclub/api.env` for
only the API service account/group; Node.js 24 `--env-file` loads the
secrets in the API child, while Admin/Member receive only the localhost
API URL. **Do not store application secrets in PM2 env metadata.**

### Existing staged-runtime permission reconciliation

The original Python tar extraction under operator umask 077 can leave
**nested** standalone API/Next.js files and directories root-only, even
when the release root is traversable. The reviewed ops-only
[`reconcile-staged-runtime.py`](reconcile-staged-runtime.py) validates the
pinned SHA, all release boundaries and every nested filesystem entry first,
then grants read/traverse permissions **only to the dedicated Unix group**.
It never follows symlinks, changes unrelated paths, touches databases or
alters an active PM2 process. CI tests nested files, executable binaries,
internal/external symlinks, foreign ownership and hardlinks. The first-launch
script invokes it before starting any PM2 process, and the service account
then verifies it can read each compiled entrypoint.

### Source-free runtime staging and first PM2 launch

Use only the exact-SHA CI artifact ZIP named `megagoldenclub-runtime-<SHA>`
(the download contains `megagoldenclub-runtime.tar.gz` plus `.sha256`).
The deployment uses **ops-only** [`stage-runtime.py`](stage-runtime.py)
to verify the inner tarball SHA-256, safe extracted tar members,
the embedded `RELEASE_SHA`, forbidden source/secrets, and API/Admin/Member
standalone entrypoints. Stage under immutable `/opt/megagoldenclub/releases/<SHA>`.
No passwords, migration schemas, original application source, or Git
checkout belong in this artifact. The full artifact is downloaded from the
successful GitHub Backend CI run and transferred using the operator's
trusted SSH transport (not uploaded into a public web directory).

After staging, the first-use [`launch-dedicated-runtime.sh`](launch-dedicated-runtime.sh)
verifies the unchanged root:megagoldenclub protected API env, all three
unclaimed localhost ports, an absent prior MegaGoldenClub release symlink,
an absent separate PM2 home and a reviewed secret-free PM2 manifest.
It creates only the dedicated account's PM2 home and a `current` symlink,
starts exactly `megagoldenclub-api`, `megagoldenclub-admin`,
`megagoldenclub-member` as the dedicated **non-root** Unix user, and
checks API MySQL/MongoDB/Redis health plus two local frontend HTTP responses.
On a failed readiness check, it attempts to stop only those three dedicated
PM2 processes and removes only the newly-created symlink; it leaves the
source-free staged release in place for investigation. Existing root PM2
apps, Docker databases, Apache sites and original certificates are untouched.

**Important:** starting these apps makes the already-proxied public sites
reachable. It is technical deployment, NOT business/finance approval;
the operator-deferred backup, real restore, TLS auto-renewal, provider/UAT
and unrelated-site regression gates remain open. Do not enable real-money
transactions merely because local health checks pass. PM2 startup-on-reboot
still needs a separate dedicated-user systemd assessment.

## Stage 4 — live verification + approval

- Reconfirm port 3200/3201/3202 available and bound **only** to 127.0.0.1.
- `http://127.0.0.1:3200/health/ready`: MySQL, MongoDB, Redis all `up`.
- Public `api.megagoldenclub.com/health/ready`: Apache 404.
- HTTPS Admin/Member work with role-separated accounts, mobile/desktop.
- `megagoldenclub.com` redirects to HTTPS www and certificates verify
  from **outside** the VPS, including renewed expiry paths.
- Existing unrelated Apache sites and original PM2 processes unaffected.
- Confirm error monitoring, backup restore operator, rollback SHA and
  finance/KYC/payment flows approved per `docs/RELEASE-SIGNOFF.md`.

No automatic go-live or payment enablement: business-owner, provider,
recovery and manual UAT decisions remain formal approval gates.
