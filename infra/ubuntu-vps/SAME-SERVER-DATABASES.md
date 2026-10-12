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

**Verified MongoDB staging status (2026-10-12):** Docker container on
`127.0.0.1:27019` recovered successfully from its permission-related
startup loop. A *subsequent authenticated inspection* proved
`megagoldenclub_app` was **NOT CREATED**, and
`/etc/megagoldenclub/mongo/app-password` was absent. The earlier
creation attempt stopped at `STOP: MongoDB not ready` before changing
the database. Do not label MongoDB application auth complete on the
basis of the container ping.

Run the one-time ops-only
[`create-mongo-app-user.sh`](create-mongo-app-user.sh) on the VPS **as
root**, only after CI green and the operator's root `npm run verify`
green. The script verifies the exact dedicated MongoDB Docker image
and its running state, root:0700 secret directory, existing admin root
password, dedicated Unix service account and that no Mongo app user or
saved credential file already exists. It stages a fresh 64-hex app
password before any user change, authenticates against the **dedicated
MongoDB container only**, creates `megagoldenclub_app` on database
`megagoldenclub` with only `readWrite` role and SCRAM-SHA-256,
verifies authentication as the new app user, then atomically saves
`/etc/megagoldenclub/mongo/app-password` (root 0600) and
`/etc/megagoldenclub/mongo.credentials.env`
(root:megagoldenclub 0640; `MONGODB_URI` for API deployment).

Passwords are passed to the MongoDB CLI exclusively via protected
**STDIN**, never as command-line arguments or printed. If an
unconfirmed MongoDB error occurs after the create attempt, **private
staged files are deliberately preserved** to avoid losing the only
recoverable password: investigate before retrying, do not recreate the
MongoDB container or delete the database/volume. The script refuses
to overwrite an existing app user/password or otherwise reset MongoDB
credentials. Merge the saved Mongo URI env fragment into protected
`/etc/megagoldenclub/api.env` later, only for the compiled API child.
Recoverably back up the secret off-VPS; no passwords belong in Git
or chat.

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

## Dedicated Redis (VPS recovery verified 2026-10-12)

MySQL runtime credentials are saved at `/etc/megagoldenclub/mysql.credentials.env`
and the operator's MongoDB user creation returned **MONGODB APPLICATION
LOGIN AND CREDENTIAL STORAGE: PASS**, confirming
`/etc/megagoldenclub/mongo.credentials.env` and
`/etc/megagoldenclub/mongo/app-password`. Both user accounts have
been verified as database-scoped. **Redis recovered successfully** after the original volume permission failure.
VPS operator output confirmed `Dedicated Redis volume UID 10001 writable: PASS`,
`Redis password authentication: PASS`, `Redis anonymous access: DENIED`,
`Redis host bind: 127.0.0.1:6381` and
`REDIS STARTUP AND AUTHENTICATION RECOVERY: PASS` (2026-10-12).
Original credentials, ACL and dedicated volume were retained.
MySQL, MongoDB and unrelated Redis instances were reported untouched.
**Never rerun `provision-redis.sh` or `recover-redis-volume.sh` after this PASS.**

The official Redis 7.4.11 Alpine image runs as a fixed non-root user
UID/GID `10001:10001`. The script prepares private host config
`/etc/megagoldenclub/redis` (root:0700), creates
`users.acl` (10001:10001 mode 0400), and stores **only the SHA-256
password hash** in the ACL file. A distinct random 64-hex plaintext
password is saved to server-only
`/etc/megagoldenclub/redis.credentials.env` (root:megagoldenclub
0640) along with `REDIS_HOST`, `REDIS_PORT`, and `REDIS_TLS`
for later secure merge into the compiled API's `api.env`. No
credentials appear in Compose environment, Git, Docker args, output or
chat.

The isolated Redis Compose uses an **explicitly external** named
volume `megagoldenclub-redis_megagoldenclub-redis-data` so the ops
script can create it once and prepare `/data` ownership for UID 10001
*before* launching Redis. A default root-owned volume would otherwise
break AOF persistence in the non-root Redis container. Its Docker
container has no access to other apps' Mongo/MySQL/Redis volumes or
configs. The script verifies authenticated CLI access, rejects
passwordless PING, and checks exact host binding
`127.0.0.1:6381`.

**No reset/removal**: do not run `docker compose down -v`,
`docker volume rm`, or modify Redis on ports 6379/6380. If
startup/verification fails, keep the new files and dedicated
volume intact for focused troubleshooting; rerunning this
one-time initializer must stop rather than silently rotate secrets
or replace containers. Secure independent backups of MySQL/Mongo
and isolated restore evidence are still required before go-live.

### First Redis attempt: dedicated volume permission failure (2026-10-12)

The operator's first run reached `PREPARE DEDICATED REDIS DATA
VOLUME FOR NON-ROOT UID` and stopped with `chmod: /data: Operation
not permitted`. All earlier provisioning phases succeeded: the
unique Redis config directory, hashed ACL, protected
`/etc/megagoldenclub/redis.credentials.env` and new named Docker
volume **already exist**. The failure happened *before* Compose
started the Redis service. **Do not rerun `provision-redis.sh`**:
the initializer deliberately refuses to overwrite credentials,
configuration or the volume.

**Two linked root causes were confirmed by GitHub Docker CI:** the
Alpine image initializes `/data` with UID 999; a restricted helper
needs both `CAP_CHOWN` and `CAP_FOWNER` to chown/chmod that inode.
Moreover, **Docker copies the image's `/data` into an empty named
volume on every fresh mount with copy enabled**, resetting ownership
back to UID 999 (observed explicitly across two CI containers) even
after a successful repair. Therefore CAP_FOWNER alone is insufficient.
The fixed Compose manifest uses **`volume.nocopy: true`** for Redis
`/data`, and the helper and write-verification containers mount with
**`volume-nocopy`**. CI now checks that the 10001:10001 ownership
survives a separate container and a real file can be written.
Only the offline helper gets CHOWN+FOWNER; actual Redis remains
non-root UID 10001, cap_drop ALL.

Run the reviewed
[`recover-redis-volume.sh`](recover-redis-volume.sh) as VPS root,
with the exact commit's two Redis template files downloaded
into a private temporary directory. The recovery verifies that the
server's original saved Compose equals the exact legacy manifest
reconstructed from the reviewed new nocopy template, then **upgrades
only the dedicated Redis Compose file** to `volume.nocopy: true`,
while preserving ACL, password and volume. It requires the
preexisting root-only staged file modes, expected reviewed templates,
an unclaimed 6381 port, absent Redis container, isolated
Docker volume with expected Compose labels and no container
mounting it. It parses the **existing** Redis password without
printing it, compares its SHA-256 to the preexisting ACL hash,
repairs only the dedicated volume, tests actual UID10001
write access, starts only `megagoldenclub-redis` and verifies
authentication, unauthenticated denial and `127.0.0.1:6381`
binding. **No password rotation, MongoDB/MySQL changes,
Docker teardown or data deletion.** If any invariant differs,
the recovery stops for investigation.

A GitHub Backend CI ephemeral Docker-volume regression test checks
CHOWN + FOWNER, stable ownership across container boundaries via
volume-nocopy, and non-root UID 10001 file-write permissions, in
addition to static/script syntax checks.
This is not proof of VPS success: request the operator's
`REDIS STARTUP AND AUTHENTICATION RECOVERY: PASS` output.

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
