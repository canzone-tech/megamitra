# Same-server database isolation — first production deployment

This is an **explicit operator-approved exception** to the original
remote-only production architecture. The Ubuntu VPS already hosts unrelated
production sites, so the migration is intentionally staged and never assumes
administrator database credentials are known. Do not touch existing databases,
Docker containers, PM2 processes, Apache sites or MySQL/MongoDB auth settings.

## MongoDB administrator credentials unavailable — approved isolated replacement (2026-10-12)

Host MongoDB (127.0.0.1:27017) uses authentication, but `admin` and
`root` logins were unsuccessful. **Never disable authentication, change
existing MongoDB users, or delete the system MongoDB service.** The
MegaGoldenClub operator opted instead to create a fresh **Mongo-only Docker
container** on `127.0.0.1:27019`. Existing
`unrelated existing MongoDB` Docker container on 27018 stays untouched regardless of
whether any application still uses it. This paragraph supersedes the earlier
27017 MongoDB references below.

The ops-only manifest is
[`megagoldenclub-mongo.compose.yaml`](megagoldenclub-mongo.compose.yaml).
It uses a dedicated Compose project/container/volume, fixed MongoDB 8.0.29
image, authenticated root bootstrap via a file-mounted secret, bounded
1 GiB memory/0.25 GiB WiredTiger cache, localhost-only published port and
bounded Docker logs. The official Mongo image runs its entrypoint as root
to adjust the dedicated DB volume before dropping to its MongoDB account;
do not drop the CHOWN capability before this initialization.

Provisioning prerequisites: confirm 27019 and the unique container/project
name are unused. Prepare `/etc/megagoldenclub/mongo` as root-owned mode
0700 and independently generate `root-password` securely (no plaintext
secrets in commands, Git, Compose environment values, chat or shell history).
The Docker Compose file secret is mounted into the container and read through
`MONGO_INITDB_ROOT_PASSWORD_FILE`. **Important official-image detail:** the
MongoDB entrypoint drops from root to the `mongodb` account *before* reading
that file; file-backed Docker Compose secrets preserve the host file's
numeric ownership/mode. Therefore a root:root mode 0600 file fails repeatedly
with `/run/secrets/mongodb_root_password: Permission denied`. This is **not**
proof that the MongoDB volume is corrupted.

Use the ops-only
[`repair-mongo-bootstrap-secret.sh`](repair-mongo-bootstrap-secret.sh)
on the VPS as root, against **only** the dedicated MongoDB container. It
verifies expected container/image/mount, root-only directory mode 0700,
discovers the official image's MongoDB numeric UID/GID, restricts the
secret to **root + MongoDB group (0440)**, checks the container user can
read the secret without printing it, restarts **only** the
`megagoldenclub-mongo` container and waits for the health ping. The host
secret's parent directory remains root:0700, so unrelated host users
cannot traverse to read it. The script does **not** delete any volumes,
change MongoDB credentials, disable authorization or modify another
Docker/host service.

**Do not use `chmod 644`**, make secrets globally readable, re-run
`docker compose down -v`, or modify the shared MongoDB on port 27017.
A newly created bootstrap volume should be preserved and allowed to
initialize normally after secret permissions are fixed.
Store a secure **off-host** copy of the bootstrap password, then run Compose
only for `megagoldenclub-mongo.compose.yaml`; never run any Compose teardown
against unrelated projects.

Once the new container is healthy, authenticate as `megagoldenclub_root` on
localhost port 27019 with an **interactive password prompt**. In database
`megagoldenclub`, create only user `megagoldenclub_app` with scoped
`readWrite` role and a separate strong password entered via
`passwordPrompt()`. Use application URI
`mongodb://megagoldenclub_app:<URL_ENCODED_PASSWORD>@127.0.0.1:27019/megagoldenclub?authSource=megagoldenclub`.
Do not put root credentials in the application API environment.

**MongoDB deletion is not approved**: never stop/remove/disable the host
MongoDB service or the existing 27018 container without verifying all
other sites, active connections, backups and explicit operator approval.
This safe separate-instance plan is intentionally reversible without
touching unrelated production MongoDB data.

## Verified inventory (2026-10-12)

- MySQL **8.0.46**, system service on `127.0.0.1:3306`.
- MongoDB **8.0.29**, system service on `127.0.0.1:27017`.
- Redis **7.4.11**, existing Docker containers bound on `127.0.0.1:6379`
  and `127.0.0.1:6380`. An unrelated MongoDB Docker container binds 27018.
- 7.8 GiB RAM (~5.6 GiB available during audit); 195 GiB disk, ~160 GiB
  free. This is **not** a load or backup capacity approval.
- MySQL root socket login without password returned `ERROR 1045`. Never
  reset database administrator passwords on this shared host.

## Isolated MegaGoldenClub assignments

| Component | Allowed bind | Separate ownership |
| --- | --- | --- |
| Financial MySQL 8 | `127.0.0.1:3306` | Database `megagoldenclub`, app principal `megagoldenclub_app` scoped to this DB; a distinct approved migration principal for DDL |
| CMS MongoDB 8 | `127.0.0.1:27019` | **New isolated Docker container**, dedicated volume; authenticated `megagoldenclub_app` scoped to `megagoldenclub` |
| Cache Redis 7.4 | `127.0.0.1:6381` | **New** `megagoldenclub-redis` container with its own ACL, volume, memory limit and Compose project |

**Safety gates before provisioning:** Verify authenticated administrative access
to MySQL without disclosing credentials. Host MongoDB authentication is enabled but administrator credentials are
not available. The project therefore uses the **new dedicated MongoDB
container** at 27019 instead; leave existing host auth and data unchanged.
Confirm that port 6381 and the new container name are free. Record
separate recoverable backups of existing shared datastores **before any
account/database administration changes**.

## MySQL application credential rotation + protected VPS storage (2026-10-12)

The operator created dedicated MySQL 8 database `megagoldenclub` and
principal `megagoldenclub_app`@`127.0.0.1` with ONLY SELECT, INSERT,
UPDATE, DELETE on `megagoldenclub.*`. An originally generated password
was displayed in chat and has already been manually rotated; never reuse
the first password. The operator has now requested server-local storage
of the scoped username and a fresh password for the compiled API.

Run [`rotate-mysql-app-credentials.sh`](rotate-mysql-app-credentials.sh)
as VPS root **once**, after exact-SHA CI and local `npm run verify`
are green. It requires a `root:megagoldenclub` mode 0750 config
directory, an existing dedicated Unix user, and no existing
`api.env` or `mysql.credentials.env`. It stages a 64-hex randomly
generated password in a protected file and prompts privately for the
existing MySQL root administrator password. It rotates **only**
`'megagoldenclub_app'@'127.0.0.1'`; it verifies scoped TCP login to
`megagoldenclub` and commits
`/etc/megagoldenclub/mysql.credentials.env` (root:megagoldenclub 0640).
No password is printed or saved to Git, PM2 metadata or terminal
history. Neither the root password nor another app's database/user
is modified.

The dedicated **username remains** `megagoldenclub_app`: renaming it
would invalidate its already-confirmed least-privilege grants. Both
`MYSQL_USER` and `MYSQL_PASSWORD`, along with host/port/database and
local `MYSQL_TLS=false`, are saved in the protected file. The script
refuses to overwrite a potentially live config. If the DB password
changes but saving the file fails, the script preserves the private
staged credential and explains how to avoid losing the secret.

This file is an **environment fragment**, not a complete running API
configuration. During an approved deployment, securely merge it into
`/etc/megagoldenclub/api.env` with root:megagoldenclub mode 0640.
Only the compiled backend API child will load that file via Node 24;
Admin/Member must never receive database secrets. Prisma schema
migrations require a **separate migration-only principal** because the
app's DB user deliberately lacks DDL permission. Keep a secure,
independently recoverable off-host copy; storing credentials on the app
VPS is necessary for runtime but not a replacement for resilience,
host security, or off-host backups.

## Production environment contract

Set `MEGAGOLDENCLUB_DATA_TOPOLOGY=local-isolated` **only** for this VPS.
`remote` remains the default and continues to require certificate-verified
transport. The local-isolated profile locks MySQL/Mongo/Redis to
`127.0.0.1` at ports 3306, 27019 and 6381, rejects other existing app
databases/ports, and requires non-placeholder credentials.

Runtime configuration concept (VALUES ARE NOT CREDENTIALS):

```dotenv
NODE_ENV=production
MEGAGOLDENCLUB_DATA_TOPOLOGY=local-isolated
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=megagoldenclub
MYSQL_USER=megagoldenclub_app
MYSQL_TLS=false
MONGODB_URI=mongodb://megagoldenclub_app:<URL_ENCODED_SECRET>@127.0.0.1:27019/megagoldenclub?authSource=megagoldenclub
REDIS_HOST=127.0.0.1
REDIS_PORT=6381
REDIS_TLS=false
MEGAGOLDENCLUB_PUBLIC_URL=https://www.megagoldenclub.com
```

`MYSQL_TLS=false` / `REDIS_TLS=false` are permitted **only** for dedicated
same-host loopback endpoints; neither service is allowed to bind publicly.
`MYSQL_PASSWORD`, `REDIS_PASSWORD`, `DATABASE_URL`, JWT/CAPTCHA secrets
and backup encryption keys are separately provisioned. The MySQL app role
must not have privileges on another project's database. Do not grant
`*.*` privileges or allow `'%' ` wildcard hosts for the application.
MongoDB must enforce authentication **server-side**, not just put a username
in a URI. Keep secrets out of command history, chat, Compose env vars and
Git. Never modify an unrelated MongoDB database/user.

## Dedicated Redis operations (not yet applied)

Ops-only files in the repository:

- `megagoldenclub-redis.compose.yaml`: a new Redis container, **only**
  `127.0.0.1:6381` published; non-root UID 10001, read-only filesystem,
  cap drop, dedicated volume, memory/process/log limits.
- `redis.conf`: no secrets; enables an ACL file and persistence.

Before an authorized deployment, transfer **only these ops config files**
outside Git onto the VPS. Create `/etc/megagoldenclub/redis/users.acl`
from a privately generated strong Redis password; file should be owned by
the container's UID 10001, mode 0400. Redis ACL default user has only
an authenticated secret. Prepare dedicated Redis data volume, validate Compose
config, confirm port 6381 remains unused, and **start only this unique
Compose project**. Never run `docker compose down` against any pre-existing
Docker project. Validate Docker bind/ACL permissions before use; do not
publish password-bearing container command arguments or environment values.

Existing containers on 6379/6380/27018 are **never** replaced or recycled.

## Migration, health, recovery

Execute production config validation from the operator/build side. For
`local-isolated` connectivity checks, a trusted isolated runner can use
SSH loopback forwards to this host's 3306/27019/6381; never expose the DB
ports publicly. Do not place Prisma schemas, migrations, local dev Compose,
or Git checkout on the application VPS.

After off-host backup and restore evidence, a separate migration runner
with time-limited DDL permission applies reviewed append-only migrations.
Its database credentials are not the PM2 API runtime account.
The compiled API then starts as the existing `megagoldenclub` Unix user
with secrets only in `/etc/megagoldenclub/api.env`; Admin/Member do not
receive database secrets. Verify all three readiness checks and protect
existing web apps. An on-box backup alone is **not** a disaster recovery plan:
retain independently accessible, encrypted off-server copies and demonstrate
isolated restoration before handling real financial activity.

Go-live remains **HOLD** until database auth, named users, backups, isolated
restore, migration, app UAT, external HTTPS and Certbot auto-renewal are
independently verified and operator/business-owner sign-off is recorded.
