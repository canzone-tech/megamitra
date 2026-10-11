# MegaGoldenClub — Ubuntu VPS application tier

This directory is a **versioned configuration template** for Ubuntu 24.04 LTS. It is not an authorization to deploy. The production VPS must contain **only verified compiled runtimes** and necessary host service configuration — never a Git repository, original TypeScript/TSX source, migration scripts or locally hosted MySQL/MongoDB/Redis.

## Required operating boundaries

- **Runtime:** Node.js 24 matching the GitHub CI build OS/CPU architecture. Keep an unprivileged `megagoldenclub` service account, independent from the SSH/release operator.
- **Database:** dedicated remote MySQL 8 application user (authoritative), remote MongoDB (CMS/media), and remote authenticated Redis (non-authoritative). Restrict ports to private/approved networks; select and verify encrypted connections, backup retention and real restore procedures outside the application VPS.
- **Compilation:** the GitHub Actions Backend CI uploads `megagoldenclub-runtime-<SHA>` containing `megagoldenclub-runtime.tar.gz` and its portable `megagoldenclub-runtime.tar.gz.sha256`. Only these prebuilt runtime bytes are delivered to the app VPS. Do not run `npm ci`, `git pull`, `prisma migrate deploy`, `docker compose` or `npm run verify` there.
- **Release identity:** verify the checksum *after transfer*, verify embedded `RELEASE_SHA` exactly matches the approved 40-character SHA, verify forbidden source/data files are absent, stage in root-owned immutable `/opt/megagoldenclub/releases/<SHA>`, and atomically repoint `/opt/megagoldenclub/current` only during an approved deployment.
- **Processes:** `megagoldenclub-api.service` binds `127.0.0.1:3100`; `megagoldenclub-admin.service` binds `127.0.0.1:3101`; `megagoldenclub-member.service` binds `127.0.0.1:3102`. Caddy routes two distinct approved HTTPS hostnames to Admin and Member/Public. **Never expose ports 3100–3102 at the firewall.**
- **Secrets:** `/etc/megagoldenclub/api.env` is root-owned mode 0600, injected only through systemd. No root MySQL password and no credentials in any release archive, public log, Caddyfile, or GitHub artifact. Server-side Next.js apps connect to localhost API; only the API talks to the remote stores.
- **Domains:** provide `ADMIN_DOMAIN` and `MEMBER_DOMAIN` in a root-managed Caddy service environment, then use `Caddyfile.template`. Do not invent domains; TLS issuance requires real DNS and inbound 80/443.
- **Security:** firewall inbound SSH from trusted sources and public 80/443 only; provision monitoring for liveness/readiness, disk and systemd failures, backups, expired TLS, database connectivity and errors. Deploy without user or password credentials in CLI history.
- **Migrations:** reviewed append-only migrations must be executed from a separate, authorized ephemeral runner with remote DB access after verified backup. Never run Prisma from the VPS.

## Staged release and rollback

Stage the exact, checksum-verified runtime in an immutable directory (do not overwrite). Stop or drain write traffic, record the prior `current` target, perform the approved database migration separately, switch `current` using an atomic same-filesystem symlink rename, then restart the API, Admin and Member systemd services. Verify local API `/health/live` and `/health/ready` (MySQL/MongoDB/Redis all `up`), both SSR login endpoints, protected Genealogy routes, API errors, public TLS and monitoring before reopening traffic.

Rollback uses the last compatible **compiled** runtime directory, not a Git checkout. Do not undo applied financial database migrations or restore DB snapshots as an ordinary application rollback. Release sign-off, backup and rollback authority remain manual gates.

## Non-secret operator information needed before activation

Approved Admin and Member/Public domains, Ubuntu VPS architecture and release user/SSH policy, remote MySQL/MongoDB/Redis providers and network model, TLS/SMTP requirements, off-host backup/restore owner, and production go-live sign-off. **Never send passwords, tokens, private keys or database connection strings in chat.**

Follow `docs/PRODUCTION-RUNBOOK.md`, `docs/RELEASE-SIGNOFF.md`, and `docs/GO-LIVE-READINESS.md`.
