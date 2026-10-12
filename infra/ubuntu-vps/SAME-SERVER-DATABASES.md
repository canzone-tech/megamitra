# Same-server database isolation — first production deployment

This is an **explicit operator-approved exception** to the original
remote-only production architecture. The Ubuntu VPS already hosts unrelated
production sites, so the migration is intentionally staged and never assumes
administrator database credentials are known. Do not touch existing databases,
Docker containers, PM2 processes, Apache sites or MySQL/MongoDB auth settings.

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
| CMS MongoDB 8 | `127.0.0.1:27017` | Database `megagoldenclub`, dedicated `megagoldenclub_app` user scoped to that DB and authenticated via `authSource=megagoldenclub` |
| Cache Redis 7.4 | `127.0.0.1:6381` | **New** `megagoldenclub-redis` container with its own ACL, volume, memory limit and Compose project |

**Safety gates before provisioning:** Verify authenticated administrative access
to MySQL without disclosing credentials. Verify host MongoDB
`security.authorization: enabled` and that the host instance has
appropriately protected unrelated databases. If host MongoDB authorization
is disabled, **STOP**: enabling auth or rewriting its config could break
other sites. Decide on a separately authenticated Mongo container instead,
then update/verify the topology contract in GitHub before deploying.
Confirm that port 6381 and the new container name are free. Record
separate recoverable backups of existing shared datastores **before any
account/database administration changes**.

## Production environment contract

Set `MEGAGOLDENCLUB_DATA_TOPOLOGY=local-isolated` **only** for this VPS.
`remote` remains the default and continues to require certificate-verified
transport. The local-isolated profile locks MySQL/Mongo/Redis to
`127.0.0.1` at ports 3306, 27017 and 6381, rejects other existing app
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
MONGODB_URI=mongodb://megagoldenclub_app:<URL_ENCODED_SECRET>@127.0.0.1:27017/megagoldenclub?authSource=megagoldenclub
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
SSH loopback forwards to this host's 3306/27017/6381; never expose the DB
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
