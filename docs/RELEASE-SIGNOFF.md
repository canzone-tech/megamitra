# MegaGoldenClub Release Sign-Off

Use one completed copy of this record per production release candidate. Do not pre-check manual gates from CI output. Attach or link evidence without copying secrets, JWTs, provider credentials, KYC data, payout destination details or backup encryption keys into the record.

Review `docs/GO-LIVE-READINESS.md` first. It is the finite ledger that separates repository-controlled gates from human, provider/process and business-owner gates.

## Candidate identity

- Release commit: `<40-character git SHA>`
- Release Evidence workflow run: `<run URL or ID>`
- Release evidence artifact: `megagoldenclub-release-evidence-<commit>`
- Candidate prepared by: `<name>`
- Environment: `<target-like / staging / production>`
- Date/time (UTC): `<timestamp>`

## Automated evidence

- [ ] Backend CI is `success` for the exact release commit.
- [ ] Frontend CI is `success` for the exact release commit.
- [ ] Release Evidence workflow is `success` for the exact release commit.
- [ ] `release-evidence.json` references the same commit, browser-UAT evidence and source-free production runtime artifact.
- [ ] The source-free runtime archive SHA256 matches the delivered archive, and `RELEASE_SHA` matches this exact commit.

Record run/artifact IDs:

- Backend CI: `<run ID>`
- Frontend CI: `<run ID>`
- Browser UAT artifact: `<artifact ID>`
- Source-free runtime artifact/checksum: `<artifact ID / SHA256>`
- Release Evidence artifact: `<artifact ID>`

## Local/target-like verification (not production application host)

- [ ] The exact release commit was pulled on the local or target-like verification machine, **not** on the production application host.
- [ ] Root `npm run verify` completed successfully.

Evidence:

- Operator: `<name>`
- Host/environment reference: `<non-secret reference>`
- Date/time (UTC): `<timestamp>`
- Result/log reference: `<reference>`

## Production configuration gate

Run the production-only validator from a trusted operator/build host against the actual **remote** deployment configuration. Do not put the repository or this configuration file on the production runtime host and do not paste secrets into this record.

```bash
npm --prefix backend run verify:production-config -- /absolute/path/to/production.env --check-files
```

Add `--require-smtp` when email-based authentication features will be enabled in the target environment.

- [ ] Production configuration readiness returned `PASS` with external MySQL/MongoDB/Redis endpoints and no MySQL root credential on the application host.
- [ ] Remote datastores use approved encrypted connections, scoped service credentials and private/network-restricted access.
- [ ] A separate short-lived, approved migration runner applied/status-checked reviewed migrations after a verified remote recovery point.
- [ ] Production app host contains only the SHA-matched compiled runtime and protected operational Apache/PM2 configuration; no source checkout, local database processes/Compose volumes, schema or migrations.
- [ ] Backup encryption key path was reported `VERIFIED` by `--check-files`.
- [ ] If email-based auth is enabled, SMTP was required by the validator and real delivery UAT is recorded below.

Production-config evidence/reference: `<non-secret log/reference>`

## Human browser review

Use the authenticated browser-UAT screenshots/metrics as baseline evidence, then interact with the supported admin/member surfaces.

- [ ] Admin desktop navigation/content is readable and usable.
- [ ] Admin mobile navigation drawer is readable and usable.
- [ ] Member desktop dashboard/navigation is readable and usable.
- [ ] Member mobile navigation remains reachable and usable.
- [ ] Appearance/theme controls render and behave as intended.
- [ ] Public payment receipt is readable without login at desktop/mobile widths and Print/Save PDF output is acceptable.

Reviewer: `<name>`  
Evidence/reference: `<reference>`

## External providers and real operator processes

Use the provider model in `docs/GO-LIVE-READINESS.md`. The current payment contract is manual QR/UPI + UTR/screenshot verification; withdrawals expose an audited provider/reference payout rail but no automatic payout adapter is selected. Mark an external integration `N/A` only when it remains disabled or is not part of the current contract. Real money/email/fulfilment processes that will be used still require operator UAT.

| Function | Provider/process reference | Status (`APPROVED` / `N/A`) | Evidence |
| --- | --- | --- | --- |
| QR/UPI payment collection + verification |  |  |  |
| Withdrawal payout process/provider |  |  |  |
| SMTP/email |  |  |  |
| Product/prize fulfilment |  |  |  |

- [ ] Every enabled provider or real operator process above is UAT-approved.

## Recovery readiness

Follow `docs/OFFHOST-RECOVERY.md`. Backend CI proves the repository's encrypted export/import/restore regression only; production recovery approval still requires evidence retrieved from the real off-host storage boundary.

- [ ] A fresh production **remote-database** backup/snapshot was taken using the selected providers' secure tools and copied or retained off-host under the approved policy. Local Compose backup scripts are not used for production.
- [ ] The encryption key is held separately from the repository and off-host backup storage boundary; no key material is present in this sign-off record.
- [ ] The encrypted archive was retrieved from the real off-host storage boundary into isolated production-like infrastructure.
- [ ] The selected remote provider's export/import/restore procedure verified the protected backup integrity and ownership. When the repository archive format is used in an isolated recovery runner, `npm run backup:import-offhost` also validates its checksums.
- [ ] An operational restore exercise from that imported backup succeeded in isolated production-like infrastructure.
- [ ] Post-restore root `npm run verify` passed on the **isolated recovery/verification host**, not on the production runtime host.
- [ ] Critical wallet/ledger totals, policy versions, payout records, entitlements, lucky-draw token/claim state, audits and presentation version were sampled after restore.

Recovery evidence:

- Off-host storage/object reference: `<non-secret reference>`
- Encrypted archive SHA-256: `<sha256>`
- Source backup/release commit: `<40-character git SHA>`
- Retrieval/restore host reference: `<non-secret reference>`
- Restore operator: `<name>`
- Restore date/time (UTC): `<timestamp>`
- Root verify result/log reference: `<reference>`
- Critical-record sample evidence/reference: `<reference>`
- Recovery owner: `<name>`

## Stateful UAT and open blockers

Review `docs/STATEFUL-UAT-COVERAGE.md`, `docs/UAT-CHECKLIST.md` and `docs/GO-LIVE-READINESS.md` together. Automated status is evidence for the contract named in the matrix; it does not pre-approve rows that still require human, provider/process or business-owner disposition.

- [ ] Applicable scenarios in `docs/UAT-CHECKLIST.md` are completed with evidence.
- [ ] One coherent test-data stateful journey covers paid E-PIN registration, installment submission/review, same-receipt status transition, five-digit token issuance, draw entry/winner flow and downstream KYC/fulfilment or entitlement state where applicable.
- [ ] Every `AUTOMATED + HUMAN` matrix row applicable to this release has a human evidence reference.
- [ ] Every `PROVIDER`/real-process row is either UAT-approved above or explicitly `N/A` for a reason allowed by `docs/GO-LIVE-READINESS.md`.
- [ ] Every applicable `OPEN RULE` has an explicit approved business decision or remains a release blocker; no default was invented during UAT.
- [ ] Canonical DNS A/AAAA resolution, HTTPS certificates and apex-to-www redirect are verified for `megagoldenclub.com`, `www.megagoldenclub.com`, `admin.megagoldenclub.com` and `api.megagoldenclub.com` against the authorized Ubuntu VPS/CDN edge (not assumed from CI).
- [ ] Verify external routing/NAT for the four names; observed DNS was `103.228.151.134` but local host showed private addresses and public HTTPS timed out during initial audit. Root cause resolved without changing unrelated sites.
- [ ] Existing root-owned `existing backend process` and `existing admin process` PM2 apps, their ports 3100/3101, Apache 80/443 and other unrelated domains continue passing smoke before and after deployment.
- [ ] MegaGoldenClub PM2 runs as dedicated non-root user, with independent PM2_HOME; Node 24 --env-file supplies backend secrets only to the compiled API child; production env file and permissions audited (secrets not exposed to web process or PM2 dump).
- [ ] Only after real HTTP-01 and Certbot certificates: MegaGoldenClub Apache HTTPS vhosts enabled, `apache2ctl configtest` successful, certificates and renewal tested, and Apache graceful reload approved.
- [ ] Apache handles only the four approved MegaGoldenClub hostnames on public 80/443; public `/health` and `/health/*` API requests are blocked (404) but localhost `127.0.0.1:3200/health/ready` succeeds; internal ports 3200–3202 and remote data ports are firewalled.
- [ ] Production `MEGAGOLDENCLUB_PUBLIC_URL` is `https://www.megagoldenclub.com`; exactly one Apache proxy hop (`TRUST_PROXY_HOPS=1` if applicable) and cookie boundaries are reviewed.
- [ ] Production domain/TLS/proxy, monitoring/alert routing, retention controls, rollback/recovery owner and release owner are recorded/approved for the target environment.
- [ ] No unresolved issue is being treated as implicitly approved.

Stateful journey evidence/reference: `<reference>`

Open blockers / approved exceptions:

`<none, or references with owner and disposition>`

## Final decision

- Release sign-off owner: `<name>`
- Rollback/recovery owner: `<name>`
- Decision: `<APPROVED / HOLD>`
- Date/time (UTC): `<timestamp>`
- Change/release reference: `<reference>`

Approval here is a human operational decision. CI evidence supports the decision but does not make it automatically.
