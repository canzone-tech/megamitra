# MegaGoldenClub Go-Live Readiness

This file is the finite release-readiness ledger for the current repository contract. It separates work that can be proven by the repository from decisions or operations that require a human owner, a real deployment target, or a selected external provider. It does not invent unresolved business rules.

## Repository-controlled gates

A release candidate is technically eligible for production sign-off only when all of the following are green for the same exact commit:

- Backend CI.
- Frontend CI.
- Release Evidence.
- root `npm run verify` on the target-like host.
- `npm --prefix backend run verify:production-config -- /absolute/path/to/production.env --check-files`.
- authenticated browser UAT artifact from Backend CI.
- automated encrypted backup/export/import/restore drill from Backend CI.

The production-config command validates production-only invariants without printing secret values: production mode, MySQL identity consistency between `DATABASE_URL` and `MYSQL_*`, non-placeholder infrastructure/signing secrets, Redis authentication, HTTPS public URL, HSTS, rate limiting, proxy-hop bounds, MongoDB URI shape, SMTP completeness when configured, and the declared backup-key boundary. Use `--require-smtp` when email-based authentication features will be enabled in the target environment.

## Current provider model

The repository deliberately does not invent provider integrations that the business has not selected.

- **Payment collection:** the locked product flow is QR/UPI plus UTR/screenshot and Super Admin verification. There is no automatic payment-gateway adapter to approve today. A future gateway is a new integration and requires its own UAT before enablement.
- **Payout:** withdrawals have an audited provider/reference payout-attempt rail, but no automatic payout-provider adapter is selected. Before real payouts, the operator must UAT the chosen/manual payout process and record provider/reference evidence.
- **SMTP/email:** SMTP is the current optional external adapter. If email-based auth features remain disabled, SMTP may be `N/A`. If enabled, run the production-config gate with `--require-smtp` and complete real delivery UAT.
- **Product/prize fulfilment:** application state/approval is implemented; no external courier/vendor adapter is assumed. If an external fulfilment provider is introduced, it requires provider UAT before enablement.

`N/A` means the corresponding external integration remains disabled or is not part of the current product contract. It must not be used to waive a provider that is actually enabled.

## Human/operational gates that cannot be completed by CI

These are intentionally not auto-approved:

1. Human interaction/readability review of admin, member and public receipt surfaces on supported breakpoints.
2. One coherent stateful UAT journey using controlled test data, including paid E-PIN registration, installment submission/review, same-receipt transition, five-digit token issuance, draw participation/winner handling and downstream KYC/fulfilment or entitlement state where applicable.
3. A real encrypted off-host backup retrieved from the actual remote storage boundary and restored into isolated production-like infrastructure, followed by root `npm run verify` and critical-record sampling.
4. Production domain/TLS/edge-proxy configuration, monitoring/alert routing, retention controls and named release/rollback/recovery owners.
5. Real operator UAT for any provider/process that will move actual money, send actual email, or hand off actual fulfilment.

Evidence for these gates belongs in `docs/RELEASE-SIGNOFF.md`.

## Business-owner decisions still open

The repository must not choose defaults for these points:

- claim/KYC failure after the 30-day claim window: forfeiture versus redraw;
- exact cancellation/refund amount formula;
- exact representation of session registration close;
- treatment of overpayment beyond remaining installments;
- future overlapping sessions and re-enrollment behavior;
- final Fast Track settlement rail;
- formulas for any currently undefined income heads.

Each item must either receive an approved business decision before the affected feature is enabled or remain an explicit release blocker for that feature. Unresolved points must never be silently treated as approved.

## Definition of "remaining work = external"

Once the exact candidate passes the repository-controlled gates above, every remaining release item is listed in this file and `docs/RELEASE-SIGNOFF.md`. There should be no hidden repository-side TODO implied by a manual/provider/open-rule row. A future code change, newly selected provider, or newly approved business rule creates a new candidate and must pass the gates again.
