# MegaMitra UAT Checklist

Use this checklist against a release candidate after automated verification is green. Record tester, environment, release commit, date/time and evidence for each completed scenario. Use test accounts and non-production provider references unless the release procedure explicitly authorizes production validation.

## Automated baseline

- [ ] Backend CI is green for the exact release commit.
- [ ] Frontend CI is green for the exact release commit.
- [ ] `npm run verify` passes on the target-like environment.
- [ ] `/health/live` returns HTTP 200.
- [ ] `/health/ready` returns HTTP 200 with MySQL, Redis and MongoDB `up`.
- [ ] `npm run uat:smoke` passes; authenticated admin/member smoke is run when tokens are available.

## Identity and access

- [ ] Registration follows the currently published identity/security configuration.
- [ ] Login, refresh, logout and forced password-change flows behave correctly.
- [ ] Forgot/reset password and email verification/change flows do not disclose account existence beyond the intended response contract.
- [ ] Repeated auth/recovery requests are rate-limited in the production-like environment.
- [ ] Member tokens cannot access admin-only operations.
- [ ] Admin permissions restrict KYC, payout, entitlement, business-plan and presentation actions as configured.

## Program, payment and refund

- [ ] Create/enrol a member under the intended published program version.
- [ ] Confirm a payment and verify allocations/installment progress.
- [ ] Replay the same idempotency/source key and verify no duplicate financial/business record is created.
- [ ] Confirm an eligible refund and verify allocation/reversal effects.
- [ ] Verify refund reconciliation-required cases appear in Operations and can be retried through the existing audited action.

## Binary and referral

- [ ] Confirm qualifying units reach the correct upline side under the published binary plan.
- [ ] Run/match settlement and verify paid pairs, cap handling and carry-forward display.
- [ ] Replay settlement/source operations and verify duplicate payout is prevented.
- [ ] Confirm direct referral reward posting under the published referral policy.
- [ ] Refund a referred payment and verify configured referral reversal/reconciliation behavior.

## Lucky draw and prize fulfilment

- [ ] Create/snapshot/draw using the intended published draw policy/version.
- [ ] Verify winner/claim records and deadlines.
- [ ] Exercise claim then fulfilment using test references.
- [ ] Exercise cancel/reversal where permitted and verify ledger/audit visibility.
- [ ] Verify Operations surfaces pending/overdue prize claims.

## KYC, withdrawals and payouts

- [ ] Submit and review KYC through the configured policy.
- [ ] Verify KYC gating blocks withdrawals when required.
- [ ] Create a withdrawal destination and request.
- [ ] Verify pending reservation affects available balance without mutating settled ledger balance.
- [ ] Approve/start payout and confirm/fail using test provider references.
- [ ] Replay payout source keys and verify no duplicate settled debit.
- [ ] Verify failed/pending payout states are visible to member and Operations/admin views.

## Product entitlements and fulfilment

- [ ] Generate the configured non-winner/product entitlement for an eligible completed enrollment.
- [ ] Verify an ineligible/winner enrollment does not receive a duplicate/inappropriate grant.
- [ ] Claim the entitlement before deadline.
- [ ] Start fulfilment, fail once, retry with a new source key, then complete.
- [ ] Verify fulfillment history and operational exception visibility.

## Member portal

- [ ] Dashboard reflects authoritative wallet balance, outstanding installments and progress.
- [ ] Binary today/settlement/carry-forward context matches backend records.
- [ ] Referral rewards show gross/reversed/net effects correctly.
- [ ] Withdrawal/payout, draw/benefit and entitlement statuses match admin/operations records.
- [ ] Desktop sidebar/topbar and mobile navigation are usable at the supported breakpoints.

## Admin presentation and configuration

- [ ] Business-plan published versions are immutable; new changes require a draft/new version.
- [ ] Theme editor changes sidebar, topbar and color/gradient controls in preview.
- [ ] Publishing a presentation version changes the intended runtime surface.
- [ ] Historical published/retired presentation versions remain inspectable.
- [ ] Presentation changes do not alter MySQL business/financial truth.

## Operations and audit

- [ ] Operations summary attention counts match seeded exception records.
- [ ] Refund, orchestration/referral, withdrawal, product fulfillment and prize claim queues are usable.
- [ ] Retry/reconciliation actions create the expected audit/history evidence.
- [ ] Error responses carry a request ID and do not echo sensitive query tokens.

## Concurrency and idempotency spot checks

Run concurrent duplicate requests only in an isolated/test environment.

- [ ] Duplicate payment confirmation does not double-allocate.
- [ ] Duplicate binary settlement/match does not double-pay.
- [ ] Duplicate referral consumption does not double-reward.
- [ ] Duplicate entitlement generation does not double-grant.
- [ ] Duplicate withdrawal/payout confirmation does not double-debit.
- [ ] Duplicate draw/fulfilment source keys resolve as replay/conflict according to the existing domain contract.

## Recovery and release readiness

- [ ] Create a backup with `npm run backup:data` and copy it off-host/encrypted for the drill.
- [ ] Restore that backup into an isolated environment using the documented confirmation flag.
- [ ] Run `npm run verify` after restore.
- [ ] Sample wallet/ledger totals, policy versions, payout records, entitlements, draw claims, audits and presentation version after restore.
- [ ] Confirm rollback/recovery owner and release sign-off owner are identified before production deployment.
