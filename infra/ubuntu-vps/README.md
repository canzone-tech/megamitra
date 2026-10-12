# MegaGoldenClub — Ubuntu VPS application tier

This directory is a **versioned configuration template** for Ubuntu 24.04 LTS. It is not an authorization to deploy. The production VPS must contain **only verified compiled runtimes** and necessary host service configuration — never a Git repository, original TypeScript/TSX source, migration scripts or locally hosted MySQL/MongoDB/Redis.

## Required operating boundaries

- **Runtime:** Node.js 24 matching the GitHub CI build OS/CPU architecture. Keep an unprivileged `megagoldenclub` service account, independent from the SSH/release operator.
- **Database:** dedicated remote MySQL 8 application user (authoritative), remote MongoDB (CMS/media), and remote authenticated Redis (non-authoritative). Restrict ports to private/approved networks; select and verify encrypted connections, backup retention and real restore procedures outside the application VPS.
- **Compilation:** the GitHub Actions Backend CI uploads `megagoldenclub-runtime-<SHA>` containing `megagoldenclub-runtime.tar.gz` and its portable `megagoldenclub-runtime.tar.gz.sha256`. Only these prebuilt runtime bytes are delivered to the app VPS. Do not run `npm ci`, `git pull`, `prisma migrate deploy`, `docker compose` or `npm run verify` there.
- **Release identity:** verify the checksum *after transfer*, verify embedded `RELEASE_SHA` exactly matches the approved 40-character SHA, verify forbidden source/data files are absent, stage in root-owned immutable `/opt/megagoldenclub/releases/<SHA>`, and atomically repoint `/opt/megagoldenclub/current` only during an approved deployment.
- **Processes:** `megagoldenclub-api.service` binds `127.0.0.1:3100`; `megagoldenclub-admin.service` binds `127.0.0.1:3101`; `megagoldenclub-member.service` binds `127.0.0.1:3102`. Caddy routes the canonical public website, Super Admin and HTTPS API hostnames. **Never expose ports 3100–3102 at the firewall**; only Caddy publicly reaches the API through TLS.
- **Secrets:** `/etc/megagoldenclub/api.env` is root-owned mode 0600, injected only through systemd. No root MySQL password and no credentials in any release archive, public log, Caddyfile, or GitHub artifact. Server-side Next.js apps connect to localhost API; only the API talks to the remote stores.
- **Canonical domains:** `www.megagoldenclub.com` → Member/Public (`127.0.0.1:3102`); `admin.megagoldenclub.com` → Super Admin (`127.0.0.1:3101`); `api.megagoldenclub.com` → authenticated API (`127.0.0.1:3100`); apex `megagoldenclub.com` permanently redirects to HTTPS `www`. These are pinned in `Caddyfile.template`; no invented hostnames or environment placeholders.
- **DNS:** arrange records `@`, `www`, `admin`, and `api` pointing to the **actual** production edge/VPS IPv4 (A) and optional configured IPv6 (AAAA). A `www` CNAME to the apex is also acceptable if DNS provider supports it. Never invent or publish a VPS IP. Certificates require correct public resolution and inbound TCP 80/443 before activating the config.
- **HTTPS/API boundary:** the public API is accessible only at `https://api.megagoldenclub.com` through Caddy; the backend process still binds localhost. Caddy returns 404 for public `/health` and `/health/*` (dependency details stay private); monitor `/health/ready` locally. Public authentication/role guards, Redis rate limits and per-origin cookie boundaries still apply. Next.js Admin/Member server-side requests stay on `http://127.0.0.1:3100` (no browser-facing CORS dependency). Set `MEGAGOLDENCLUB_PUBLIC_URL=https://www.megagoldenclub.com`; `TRUST_PROXY_HOPS=1` only for a single local Caddy proxy hop.
- **Security:** firewall inbound SSH from trusted sources and public 80/443 only; provision monitoring for liveness/readiness, disk and systemd failures, backups, expired TLS, database connectivity and errors. Deploy without user or password credentials in CLI history.
- **Migrations:** reviewed append-only migrations must be executed from a separate, authorized ephemeral runner with remote DB access after verified backup. Never run Prisma from the VPS.

## Staged release and rollback

Stage the exact, checksum-verified runtime in an immutable directory (do not overwrite). Stop or drain write traffic, record the prior `current` target, perform the approved database migration separately, switch `current` using an atomic same-filesystem symlink rename, then restart the API, Admin and Member systemd services. Verify local API `/health/live` and `/health/ready` (MySQL/MongoDB/Redis all `up`), HTTPS `www` and Admin SSR login endpoints, API unauthenticated requests returning 401, public API `/health/ready` returning 404, protected Genealogy routes, apex-to-www redirect, certificate issuance/renewal, 80/443 firewall rules, and monitoring before reopening traffic.

Rollback uses the last compatible **compiled** runtime directory, not a Git checkout. Do not undo applied financial database migrations or restore DB snapshots as an ordinary application rollback. Release sign-off, backup and rollback authority remain manual gates.

## Non-secret operator information needed before activation

Ubuntu VPS public IP/IPv6 and release user/SSH policy, DNS administration for the approved four hostnames, remote MySQL/MongoDB/Redis providers and network model, TLS/SMTP requirements, off-host backup/restore owner, and production go-live sign-off. **Never send passwords, tokens, private keys or database connection strings in chat.**

Follow `docs/PRODUCTION-RUNBOOK.md`, `docs/RELEASE-SIGNOFF.md`, and `docs/GO-LIVE-READINESS.md`.
