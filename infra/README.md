# MegaGoldenClub Infrastructure

Production target: Ubuntu 24.04 LTS, Node.js 24 runtime and immutable, checksum-verified artifacts built by GitHub Actions.

**Strict production boundary:** No Git checkout, TypeScript/TSX application source, build tools, Prisma migration scripts or local database containers/volumes on the application host. Deploy only the `megagoldenclub-runtime-<SHA>` compiled API and Next.js standalone Admin/Member archive from Backend CI, matching the approved release SHA.

**Data topology:** default `remote` uses independently hosted, encrypted MySQL 8/MongoDB/Redis. Operator-approved `local-isolated` on this shared Ubuntu VPS uses existing host MySQL 8/MongoDB with dedicated authenticated databases and a new Redis-only isolated container on port 6381. Credentials are scoped, data binds loopback only and independently accessible off-host backups plus restore tests remain mandatory. Never put a MySQL root password in the application runtime.

**Separate control planes:** GitHub CI/build runner compiles and smoke-tests the artifact against disposable isolated test databases; a trusted, short-lived remote migration runner executes append-only reviewed schema updates; production runs only the compiled server processes. Root `docker-compose.yml` is for development and CI only; the optional production-only `infra/ubuntu-vps/megagoldenclub-redis.compose.yaml` starts **one** separately isolated Redis instance.

Production reverse proxy supplies HTTPS routing to the compiled API/Admin/Member processes. Runtime secrets come from secret management, and backups must have independently stored off-host recovery points for either topology.

See `docs/PRODUCTION-RUNBOOK.md`, `docs/GO-LIVE-READINESS.md` and `docs/RELEASE-SIGNOFF.md` for deployment order and remaining human/provider gates.

Ubuntu application-host templates, HTTPS proxy routing, and release boundaries: [infra/ubuntu-vps/README.md](ubuntu-vps/README.md).

**Shared VPS implementation (2026-10-12 audit):** Apache 2.4.58 and PM2 7.0.3 already serve pre-existing unrelated application and unrelated domains on this Ubuntu 24.04.4 server. Do not replace Apache with Caddy, restart unrelated apps or reuse occupied pre-existing unrelated application ports 3100/3101. A separate `megagoldenclub` PM2 account and Apache VirtualHosts on localhost 3200/3201/3202 are specified in `infra/ubuntu-vps/`. HTTPS localhost verification passed, though external reachability and Certbot renewal remain gates. Dedicated local database credentials/auth, recovery and live application readiness remain unverified.
