# MegaGoldenClub Infrastructure

Production target: Ubuntu 24.04 LTS, Node.js 24 runtime and immutable, checksum-verified artifacts built by GitHub Actions.

**Strict production boundary:** No Git checkout, TypeScript/TSX application source, build tools, Prisma migration scripts or local database containers/volumes on the application host. Deploy only the `megagoldenclub-runtime-<SHA>` compiled API and Next.js standalone Admin/Member archive from Backend CI, matching the approved release SHA.

**Data services are remote:** managed/isolated MySQL 8 (sole financial/business source of truth), MongoDB (presentation and media) and Redis (non-authoritative coordination). Connections require scoped credentials, network restrictions, approved encryption and tested backups. The app host never holds a MySQL root password.

**Separate control planes:** GitHub CI/build runner compiles and smoke-tests the artifact against disposable isolated test databases; a trusted, short-lived remote migration runner executes append-only reviewed schema updates; production runs only the compiled server processes. Local `docker-compose.yml` is for development and CI only, never production databases.

Production reverse proxy supplies HTTPS routing to the compiled API/Admin/Member processes. Runtime secrets come from secret management, and backups originate from the remote data providers with independent off-host recovery.

See `docs/PRODUCTION-RUNBOOK.md`, `docs/GO-LIVE-READINESS.md` and `docs/RELEASE-SIGNOFF.md` for deployment order and remaining human/provider gates.

Ubuntu application-host templates, HTTPS proxy routing, and release boundaries: [infra/ubuntu-vps/README.md](ubuntu-vps/README.md).
