# MegaMitra Production Runbook

This runbook covers deployment and recovery controls after business milestone 0024. It does not introduce or redefine business rules.

## Release gate

A release candidate must be built from the intended commit on `dev/local-foundation` and must have green backend and frontend CI. On the deployment host, run from the repository root:

```bash
npm run verify
```

Do not deploy when migrations, lint, tests, production builds, frontend route smoke, API readiness, or UAT smoke fail.

## Production environment

Use unique production secrets for CAPTCHA HMAC, JWT access and refresh signing. Do not reuse development or CI values. Set `NODE_ENV=production`.

When the API is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops. Do not use a broad trust-proxy value. Enable `SECURITY_HSTS_ENABLED=true` only after HTTPS is enforced end-to-end at the public edge.

Rate limiting is Redis-coordinated and non-authoritative. Production defaults may be overridden with the `RATE_LIMIT_*` environment variables after reviewing expected traffic. Keep `RATE_LIMIT_ENABLED=true` in production.

SMTP and external payout/payment/fulfilment provider credentials remain provider-specific deployment inputs. Do not enable a provider integration until that provider is selected, configured and UAT-approved.

## Health and observability

Use `GET /health/live` for process liveness. It intentionally does not depend on databases.

Use `GET /health/ready` for traffic readiness. It requires MySQL, Redis and MongoDB to be reachable. `GET /health` remains a compatibility alias for readiness.

Every API response carries `X-Request-Id`. A valid incoming request ID is preserved; malformed IDs are replaced. API logs include method, path without query string, status, duration and request ID. Use the request ID to correlate application and edge-proxy logs without logging reset/verification query tokens.

## Backup

MySQL is the authoritative business/financial system of record. MongoDB stores presentation/theme/template documents. Redis is non-authoritative and is intentionally excluded from backups.

From `backend/`:

```bash
npm run backup:data
```

The command writes a timestamped directory under `../backups/` by default with:

- `mysql.sql`
- `mongodb.archive.gz`
- `manifest.txt`
- `SHA256SUMS`

A local backup is not complete until the directory is encrypted and copied to protected off-host storage. Retention and encryption keys must be managed outside the repository.

Run scheduled backup jobs only after checking available disk space and monitoring command exit status. Perform a restore drill regularly on an isolated environment.

## Restore drill / disaster recovery

Restore is destructive. Stop application traffic first and use an isolated host for drills whenever possible.

From `backend/`:

```bash
MEGAMITRA_RESTORE_CONFIRM=YES npm run restore:data -- /absolute/path/to/backup
```

The restore command verifies checksums, restores MySQL and MongoDB, clears Redis to prevent stale non-authoritative state, and runs `prisma migrate status`.

After restore, return to the repository root and run:

```bash
npm run verify
```

Do not reopen traffic until verification passes and critical balances, policy versions, presentation versions, payout states and audit records are sampled against the backup manifest/date.

## Deployment order

1. Confirm backend and frontend CI green for the exact commit.
2. Take and export a fresh backup.
3. Put write traffic into the deployment maintenance procedure used by the hosting environment.
4. Pull the exact release commit and install exact dependencies.
5. Run `npx prisma migrate deploy` once from the release artifact.
6. Start/restart API, admin and member/public applications.
7. Wait for `/health/ready` to return HTTP 200 with MySQL, Redis and MongoDB `up`.
8. Run `npm run uat:smoke` from `backend/` against the deployed API. Supply `UAT_ADMIN_TOKEN` and `UAT_MEMBER_TOKEN` when authenticated smoke is required.
9. Complete the stateful checks in `docs/UAT-CHECKLIST.md` before production sign-off.

## Rollback

Application code may be rolled back to the previous compatible release artifact. Database migrations are append-only and are not edited or automatically rolled back. If a release requires a compensating schema change, add a new forward migration and validate it through CI/UAT.

Use data restore only for an actual recovery decision with an identified recovery point. Do not use restore as a routine application rollback mechanism.

## Incident minimums

For an incident, capture the release commit, UTC time window, affected request IDs, health/readiness output and operational exception queue state. Do not expose JWTs, passwords, reset tokens, payout destination references or raw KYC data in incident chat/log excerpts.
