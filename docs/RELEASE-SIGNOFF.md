# MegaGoldenClub Release Sign-Off

Use one completed copy of this record per production release candidate. Do not pre-check manual gates from CI output. Attach or link evidence without copying secrets, JWTs, provider credentials, KYC data, payout destination details or backup encryption keys into the record.

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
- [ ] `release-evidence.json` references the same commit and the expected browser-UAT artifact.

Record run/artifact IDs:

- Backend CI: `<run ID>`
- Frontend CI: `<run ID>`
- Browser UAT artifact: `<artifact ID>`
- Release Evidence artifact: `<artifact ID>`

## Target-host verification

- [ ] The exact release commit was pulled on the target-like host.
- [ ] Root `npm run verify` completed successfully.

Evidence:

- Operator: `<name>`
- Host/environment reference: `<non-secret reference>`
- Date/time (UTC): `<timestamp>`
- Result/log reference: `<reference>`

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

## External providers

For each provider that will be enabled in this release, record UAT approval. Mark a provider `N/A` only when it will remain disabled.

| Provider function | Provider/reference | Status (`APPROVED` / `N/A`) | Evidence |
| --- | --- | --- | --- |
| Payment collection |  |  |  |
| Payout |  |  |  |
| SMTP/email |  |  |  |
| Product/prize fulfilment |  |  |  |

- [ ] Every enabled provider above is UAT-approved.

## Recovery readiness

Follow `docs/OFFHOST-RECOVERY.md`. Backend CI proves the repository's encrypted export/import/restore regression only; production recovery approval still requires evidence retrieved from the real off-host storage boundary.

- [ ] A fresh local backup was exported through `npm run backup:export-offhost` and its encrypted archive/checksum pair is retained under the operating retention policy.
- [ ] The encryption key is held separately from the repository and off-host backup storage boundary; no key material is present in this sign-off record.
- [ ] The encrypted archive was retrieved from the real off-host storage boundary into isolated production-like infrastructure.
- [ ] `npm run backup:import-offhost` validated the encrypted archive checksum, archive contents and inner backup checksums.
- [ ] An operational restore exercise from that imported backup succeeded in isolated production-like infrastructure.
- [ ] Post-restore root `npm run verify` passed for that exercise.
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

Review `docs/STATEFUL-UAT-COVERAGE.md` together with `docs/UAT-CHECKLIST.md`. Automated status is evidence for the contract named in the matrix; it does not pre-approve rows that still require human, provider or business-owner disposition.

- [ ] Applicable scenarios in `docs/UAT-CHECKLIST.md` are completed with evidence.
- [ ] One coherent test-data stateful journey covers paid E-PIN registration, installment submission/review, same-receipt status transition, five-digit token issuance, draw entry/winner flow and downstream KYC/fulfilment or entitlement state where applicable.
- [ ] Every `AUTOMATED + HUMAN` matrix row applicable to this release has a human evidence reference.
- [ ] Every `PROVIDER` matrix row is either UAT-approved above or explicitly `N/A` because the provider remains disabled.
- [ ] Every applicable `OPEN RULE` has an explicit approved business decision or remains a release blocker; no default was invented during UAT.
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
