# MegaGoldenClub UAT Checklist

Use this checklist against a release candidate after automated verification is green. Record tester, environment, release commit, date/time and evidence for each completed scenario. Use test accounts and non-production provider references unless the release procedure explicitly authorizes production validation.

`docs/STATEFUL-UAT-COVERAGE.md` is the release-grade map from each stateful business journey to its automated evidence and remaining human/provider/open-rule gate. Do not mark a manual or provider-dependent row complete solely because CI is green.

For cross-chat continuity, read [Business Rules Register](BUSINESS-RULES-REGISTER.md) before UAT. Owner printed-reference formatting is implemented and its first owner receipt / Print-Save-PDF UAT scenario is recorded below; database-level season-code immutable-after-ACTIVE hardening remains pending and must not be treated as shipped.

## Automated baseline

- [ ] Backend CI is green for the exact release commit.
- [ ] Frontend CI is green for the exact release commit.
- [ ] Release Evidence is green for the exact release commit and its `megagoldenclub-release-evidence-<commit>` artifact references the same Backend CI, Frontend CI and browser-UAT evidence.
- [ ] `npm run verify` passes on the target-like environment.
- [ ] `/health/live` returns HTTP 200.
- [ ] `/health/ready` returns HTTP 200 with MySQL, Redis and MongoDB `up`.
- [ ] `npm run uat:smoke` passes; authenticated admin/member runtime smoke is run when tokens are available.
- [ ] Integration tests pass authenticated admin/member authorization, self-scoping and core read-model checks even when external UAT tokens are not supplied.
- [ ] Owner lucky-draw schedule integration passes January/third-Sunday defaults, admin/member authorization, recurrence enforcement and exact-replay/conflicting-replay behavior.
- [ ] Lucky-draw token contract verification confirms five non-zero-leading digits and Season-scoped uniqueness by `(seasonId, token)` after migration `0034`; the same five-digit number may exist in another Season, while reuse inside the same Season is rejected; migration deployment succeeds separately on the release database.
- [ ] Public receipt surface verification passes confirmed-only token rendering, pending/rejected token messaging, mobile layout and print layout contracts.
- [ ] Backend CI authenticated browser UAT renders protected admin/member production builds at desktop and mobile widths, checks page-level horizontal overflow, exercises the admin mobile More drawer, verifies member mobile navigation actions remain visible, and uploads screenshots/metrics for the exact release commit.

## Identity and access

- [ ] Registration follows the currently published identity/security configuration.
- [ ] Login, refresh, logout and forced password-change flows behave correctly.
- [ ] Forgot/reset password and email verification/change flows do not disclose account existence beyond the intended response contract.
- [ ] Repeated auth/recovery requests are rate-limited in the production-like environment.
- [ ] Member tokens cannot access admin-only operations.
- [ ] Admin permissions restrict KYC, payout, entitlement, business-plan and presentation actions as configured.

## Recorded manual UAT evidence

- **2026-10-06 — Owner activation-payment receipt:** first paid public signup under the bootstrap sponsor was visible in the owner payment register. Owner receipt showed the recorded ₹2,000 activation payment split into ₹1,000 Registration Fee + ₹1,000 Monthly EMI, stored Lucky Draw Token `41483` for EMI #1 as AVAILABLE, and printed reference `MGC_202610_3FC2-M01-41483`. Browser Print/Save PDF preview rendered the same receipt and token/reference on one page without printing the owner dashboard. **PASS for this owner-receipt scenario only.** This does not pre-check the separate public/member receipt, future installments, draw consumption, winner, refund or full business-UAT rows below.

## Program, payment, receipt, E-PIN and refund

- [ ] Register a MEMBER with a valid sponsor and E-PIN; verify the pin is consumed once and the intended session/enrollment activation state is created.
- [ ] Create/enrol a member under the intended published program version.
- [ ] Submit an installment payment with test UTR/reference and screenshot; verify the public receipt is immediately available as `PENDING VERIFICATION` and does not expose a lucky-draw token.
- [ ] Confirm the installment submission as Super Admin and verify the same receipt becomes confirmed/paid, allocations/installment progress advance, and each confirmed installment allocation has one distinct five-digit non-zero-leading token.
- [ ] Reject a separate test installment submission and verify the same receipt becomes `REJECTED` without issuing a lucky-draw token.
- [ ] Open the confirmed public receipt without login and verify member ID, payment purpose, session, amount, UTR/reference, timestamps, installment allocation and token state; exercise mobile readability and Print/Save PDF.
- [ ] Replay the same idempotency/source key and verify no duplicate financial/business record or duplicate token is created.
- [ ] Submit a test E-PIN purchase request as MEMBER, verify it as Super Admin and confirm session-bound pins are assigned to the member.
- [ ] Reassign one unused E-PIN and verify a used E-PIN cannot be reactivated, reassigned or reused.
- [ ] Confirm an eligible refund and verify allocation/reversal effects.
- [ ] Verify refund reconciliation-required cases appear in Operations and can be retried through the existing audited action.

## Binary 1:4 and referral

- [ ] Confirm a placement parent can hold authoritative slots `A`, `B`, `C` and `D` in deterministic slot order.
- [ ] Confirm `A/B` aggregate to `LEFT` and `C/D` aggregate to `RIGHT` for settlement/reporting without losing authoritative slot identity.
- [ ] Confirm a second placement into an already occupied parent slot is rejected.
- [ ] Confirm auto-placement fills `A -> B -> C -> D` before traversing below existing children.
- [ ] Confirm ancestry preserves both first-leg slot and derived aggregate side.
- [ ] Confirm qualifying units reach the correct upline aggregate side from their authoritative first-leg slot.
- [ ] Confirm the current 1:4 plan matches only the fixed lanes `A:C` and `B:D`; generic cross-pairing is not accepted.
- [ ] Run/match settlement and verify paid pairs, cap handling and carry-forward display.
- [ ] Replay settlement/source operations and verify duplicate payout is prevented.
- [ ] Confirm legacy LEFT/RIGHT compatibility inputs do not override or collapse existing `A/B/C/D` placement authority.
- [ ] Confirm direct referral reward posting under the published referral policy.
- [ ] Refund a referred payment and verify configured referral reversal/reconciliation behavior.

## Lucky draw and prize fulfilment

- [ ] Confirm a new Season defaults to a January start, monthly recurrence and third Sunday in the Season draw timezone.
- [ ] In DRAFT/REVIEW, change draw start month, week-of-month and weekday and verify the versioned Season calendar updates; after activation confirm the calendar is locked.
- [ ] Prepare Month 1 on the configured calendar date and verify a wrong month/week/weekday is rejected.
- [ ] Replay the exact same prepared-draw payload and verify the same draw run is returned without duplication.
- [ ] Replay the same Season/month with a different entry window, draw time or claim window and verify HTTP 409/conflict rather than silently changing or reusing incompatible settings.
- [ ] Create/snapshot/draw using the intended published draw policy/version.
- [ ] Verify a member receives at most one entry for the scheduled draw and the bound five-digit token has not appeared in any earlier/future draw entry.
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
- [ ] Binary today/settlement/carry-forward context matches backend records and the member's authoritative 1:4 genealogy.
- [ ] Referral rewards show gross/reversed/net effects correctly.
- [ ] Withdrawal/payout, draw/benefit and entitlement statuses match admin/operations records.
- [ ] Desktop sidebar/topbar and mobile navigation are usable at the supported breakpoints; use the automated browser artifact as baseline evidence, then complete a human interaction/readability pass before release sign-off.

## Admin presentation and configuration

- [ ] Business-plan published versions are immutable; new changes require a draft/new version.
- [ ] Binary business-plan editing preserves the locked 1:4 topology and does not expose it as an arbitrary two-leg ratio.
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

- [ ] Duplicate payment confirmation does not double-allocate or issue duplicate installment tokens.
- [ ] Duplicate binary settlement/match does not double-pay.
- [ ] Duplicate referral consumption does not double-reward.
- [ ] Duplicate entitlement generation does not double-grant.
- [ ] Duplicate withdrawal/payout confirmation does not double-debit.
- [ ] Duplicate draw/fulfilment source keys resolve as replay/conflict according to the existing domain contract.

## Recovery and release readiness

- [ ] Review `docs/STATEFUL-UAT-COVERAGE.md` for the exact candidate and record all `AUTOMATED + HUMAN`, `PROVIDER` and `OPEN RULE` dispositions in release evidence/sign-off.
- [ ] Create a backup with `npm run backup:data` and copy it off-host/encrypted for the drill.
- [ ] Restore that backup into an isolated environment using the documented confirmation flag.
- [ ] Run `npm run verify` after restore.
- [ ] Sample wallet/ledger totals, policy versions, payout records, entitlements, draw claims, audits and presentation version after restore.
- [ ] Complete `docs/RELEASE-SIGNOFF.md` for the same exact commit and reference the Release Evidence artifact plus target-host `npm run verify` result.
- [ ] Confirm rollback/recovery owner and release sign-off owner are identified before production deployment.
