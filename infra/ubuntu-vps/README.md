# MegaGoldenClub on the existing shared Ubuntu VPS

**Observed server audit (2026-10-12):** Ubuntu 24.04.4 LTS x86_64, Node.js 24.19.0, npm 11.17.0, PM2 7.0.3, Apache 2.4.58, Certbot 5.8.0. The current root-owned PM2 apps `existing admin process` (`127.0.0.1:3101`) and `existing backend process` (`127.0.0.1:3100`) are online. Apache serves multiple unrelated domains on ports 80/443. There is roughly 5.5 GiB available RAM and 160 GB disk, but capacity and performance must still be confirmed under load. Ports 3200–3202 had no listeners at the audit time; recheck immediately before approved rollout.

**Decision:** reuse existing Node 24, Apache and PM2. **No Caddy, Nginx, another Node installation, Docker stack, local MySQL/MongoDB/Redis or on-server Git checkout.** Do not stop, reload or modify existing Apache sites or root-owned pre-existing unrelated application PM2 processes.

## Production mapping

| Public host | Apache HTTPS behavior | Compiled app | Local bind |
| --- | --- | --- | --- |
| `megagoldenclub.com` | Permanent redirect to HTTPS www | — | — |
| `www.megagoldenclub.com` | Apache reverse proxy | Member/public Next.js standalone | `127.0.0.1:3202` |
| `admin.megagoldenclub.com` | Apache reverse proxy | Admin Next.js standalone | `127.0.0.1:3201` |
| `api.megagoldenclub.com` | Apache reverse proxy; hide public health endpoints | Compiled NestJS API | `127.0.0.1:3200` |

Only Apache serves port 80/443. Application ports 3200–3202 are local and firewall-blocked. Admin/Member server-side calls use `MEGAGOLDENCLUB_API_URL=http://127.0.0.1:3200`. API queries only **external** MySQL 8 (financial authoritative), MongoDB (CMS/media) and Redis (nonauthoritative); use private/restricted network, approved encrypted transport, least-privilege accounts, provider backups and recovery tests. No MySQL root password on the VPS.

## What the repo contains

- `ecosystem.config.cjs`: **ops-only** PM2 manifest defining exactly three MegaGoldenClub processes. Copy to a protected operations configuration path such as `/etc/megagoldenclub/ecosystem.config.cjs`; do not install repository source.
- `megagoldenclub-http.conf`: four domain-specific Apache port-80 VirtualHosts and Certbot HTTP-01 webroot exception at `/var/lib/letsencrypt`. This is the **bootstrap** stage; it does not require a certificate or start the application.
- `megagoldenclub-ssl.conf`: four domain-specific Apache port-443 VirtualHosts, cert paths, permanent apex redirect, backend proxies and public health-status protection. **Never enable until all matching certificate files actually exist.**
- `scripts/verify-ubuntu-vps-config.mjs`: CI and root `npm run verify` static regression gate. Backend CI also syntax-checks both Apache templates inside isolated Ubuntu CI, with dummy certificates. These tests do not alter the actual production Apache/PM2 state.

## Secrets and PM2 user isolation

Create a dedicated non-root `megagoldenclub` Unix account with its **own** home and PM2_HOME, separate from the existing root PM2 daemon. Admin and Member must NOT receive backend/database secrets. The API entry uses Node 24 `--env-file=/etc/megagoldenclub/api.env`, loading secrets into the **Node API child only** rather than serializing them into PM2 app metadata. A tightly controlled API env file can be owned `root:megagoldenclub` mode `0640` in an access-restricted `/etc/megagoldenclub` directory (e.g. `0750`); install secrets using a trusted operator/secret manager, never Git or an artifact. Do not paste these values into chat or command history. Avoid running `pm2` as root for new MegaGoldenClub apps; its app list and dump are a separate security boundary. PM2 persistence/startup should be configured **for this account only** after checking the current existing PM2 startup service, not globally overwritten.

Stage only the exact SHA256-verified `megagoldenclub-runtime-<SHA>` precompiled GitHub artifact (`api/`, `admin/`, `member/` plus RELEASE_SHA) under immutable `/opt/megagoldenclub/releases/<SHA>`; switch the `current` symlink only on signed-off deployment. The VPS never receives the original app TS/TSX, Prisma migrations, repository, test fixtures or local Compose volumes. A trusted separate migration runner handles remote MySQL migration *after* verified remote recovery point.

## DNS and certificate blockers observed

All four MegaGoldenClub names resolved to `103.228.151.134` in the operator's VPS session, while `hostname -I` showed `10.200.5.11` plus Docker bridge addresses. Public HTTPS requests to each hostname **timed out from inside that VPS**, but HTTPS loopback with `--resolve <host>:443:127.0.0.1` returned HTTP 200 from the **existing default Apache site**. Neither proves those domains are correctly hosted. The provider/NAT edge mapping, real external access, Apache vhost ownership and certificates still need verification; do not assume an IP assignment or auto-enable a site.

For an approved rollout, the operator must first validate public 80/443 from outside the VPS, enable the HTTP-only dedicated vhosts after Apache `configtest`, verify actual HTTP-01 access, then issue real Certbot certificates using webroot (apex+www as one SAN cert; admin and api as independent certs). Only afterward enable the HTTPS vhosts and run Apache `configtest` before a graceful reload. Certbot renewal must be tested and its Apache reload hook reviewed. Do not use Certbot's automatic Apache rewriter against unrelated vhosts. This file documents the sequence, **not authorization for execution**.

## Release, health and rollback gates

Before exposing traffic, confirm local `/health/ready` reports MySQL/MongoDB/Redis up, `www` and Admin login pages work through externally valid HTTPS, public API `/health/ready` returns 404, protected unauthenticated API calls return 401, apex redirects to www, and TLS is valid. Check current unrelated domains and the existing pre-existing unrelated application processes are unchanged, and require monitoring/backup restore/operator UAT/sign-off. `npm run verify` is the authoritative gate on the **local or isolated verification host**, never on the production application VPS.

Application rollback means atomically switching to the prior compatible compiled release and restarting **only the three dedicated MegaGoldenClub PM2 names** under the dedicated user. It must not roll back financial database migrations or alter existing unrelated PM2 apps. Live deployment remains pending external DNS/network, remote data providers, credentials, migrations, backup restore and explicit sign-off.

See `docs/PRODUCTION-RUNBOOK.md`, `docs/GO-LIVE-READINESS.md`, `docs/RELEASE-SIGNOFF.md`.
