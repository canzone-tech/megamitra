# MegaGoldenClub Stateful UAT Coverage

This document is the release-grade coverage map for the stateful business journeys that must be evidenced before production approval. It complements `docs/UAT-CHECKLIST.md`; it does not replace human UAT, provider UAT, recovery evidence, or unresolved business decisions.

## Status model

- **AUTOMATED** — the repository has deterministic automated evidence for the stated contract. The exact release commit must still pass Backend CI, Frontend CI, Release Evidence and target-host root `npm run verify`.
- **AUTOMATED + HUMAN** — automated coverage exists for the core contract, but the cross-surface or business journey still needs human interaction/readability/state confirmation before release sign-off.
- **PROVIDER** — approval depends on a real external provider configured for the release. Mark `N/A` only when that provider remains disabled.
- **OPEN RULE** — implementation/release approval is blocked on an explicit business decision. Do not invent a default.

## Stateful business journey matrix

| Journey | Automated evidence | Automated scope | Remaining release evidence | Status |
| --- | --- | --- | --- | --- |
| Identity, registration, sponsor and paid E-PIN activation | `backend/test/auth.integration-spec.ts`, `backend/test/authenticated-runtime-uat.integration-spec.ts`, `backend/test/paid-registration.fixture.ts` | MEMBER-only registration, sponsor lookup, E-PIN-backed paid registration fixture, replay/access boundaries, authenticated runtime role checks | Human signup/login/member-entry flow on supported desktop/mobile surfaces | AUTOMATED + HUMAN |
| Program version, enrollment and installment ledger | `backend/test/program-enrollment.integration-spec.ts`, `backend/test/program-orchestration.integration-spec.ts` | Published-version immutability, enrollment idempotency, allocation/progress, completion and orchestration | Human confirmation that member/admin screens show the same authoritative state | AUTOMATED + HUMAN |
| Refund and reconciliation | `backend/test/program-enrollment.integration-spec.ts`, `backend/test/referral-handoff-refund.integration-spec.ts`, `backend/test/operational-completion.integration-spec.ts` | Refund idempotency, enrollment reopening, referral/reconciliation handoff and audited operational completion | Human Operations queue/action review; exact refund amount policy remains an OPEN RULE where product policy has not defined it | AUTOMATED + HUMAN |
| Member installment submission → Super Admin review → receipt → lucky-draw token | `backend/src/member-payments/tokenized-member-payment.service.ts`, `backend/test/lucky-draw-token-contract.integration-spec.ts`, `scripts/verify-public-receipt.mjs`, Frontend CI production build | Confirmed installment review triggers token provisioning; public receipt exposes tokens only for confirmed installments; five-digit non-zero-leading token contract and permanent global registry schema are verified; pending/rejected receipt copy is guarded | Human state transition using a real test submission: `PENDING VERIFICATION` → `CONFIRMED/PAID` or `REJECTED`, public-link readability/print/share check | AUTOMATED + HUMAN |
| E-PIN purchase request, verification and assignment/reassignment | Member-payment module/service, admin payment verification surface, authenticated runtime E-PIN controls | Core E-PIN lifecycle code, role boundaries and paid-registration consumption are compiled/tested; used E-PIN replay is covered by auth integration | One stateful test purchase through member submission → Super Admin confirmation → assigned pins; verify unused reassignment and used-pin non-reuse in UI | AUTOMATED + HUMAN |
| Binary 1:4 placement, ancestry and volume routing | `backend/test/business-domain.integration-spec.ts`, `backend/test/pair-settlement.integration-spec.ts`, `backend/test/authenticated-runtime-uat.integration-spec.ts` | Authoritative A/B/C/D placement, aggregate-side compatibility, qualifying-pair settlement, cap/carry and authenticated runtime boundaries | Human member/admin genealogy and settlement display comparison | AUTOMATED + HUMAN |
| Direct referral reward and reversal | `backend/test/referral-reward.integration-spec.ts`, `backend/test/referral-handoff-refund.integration-spec.ts` | Reward eligibility/posting, replay protection and refund/reconciliation behavior | Human member/admin gross/reversed/net display comparison | AUTOMATED + HUMAN |
| Draw calendar, preparation, snapshot and execution | `backend/test/owner-lucky-draw-schedule.integration-spec.ts`, `backend/test/owner-lucky-draw-workflow.integration-spec.ts`, `backend/test/lucky-draw.integration-spec.ts` | Versioned schedule rules, replay/conflict handling, draw workflow and execution contracts | Human owner review of intended session/month/calendar and winner output | AUTOMATED + HUMAN |
| Lucky-draw token uniqueness and never-reuse within a Season | migrations `0029_global_lucky_draw_tokens` + `0034_season_scoped_lucky_draw_tokens`, `backend/test/lucky-draw-token-contract.integration-spec.ts` | Exact five-digit `^[1-9][0-9]{4}$` format; `(seasonId, token)` uniqueness for Season-bound tokens; legacy/non-Season tokens retain an isolated global scope; generator namespace `10000..99999` | No manual rule override is allowed; monitor the finite 90,000-token namespace per Season | AUTOMATED |
| Winner claim, KYC gate and prize fulfilment | `backend/test/lucky-draw-fulfillment.integration-spec.ts`, `backend/test/kyc.integration-spec.ts` | Claim/fulfilment state machine, KYC workflow and operational visibility | Human claim/fulfilment review. Outcome after 30-day claim/KYC failure is an OPEN RULE | AUTOMATED + HUMAN |
| Non-winner/product entitlement and fulfilment | `backend/test/entitlement.integration-spec.ts`, `backend/test/entitlement-orchestration.integration-spec.ts` | Eligibility/grant, claim, fulfilment orchestration/retry and duplicate-grant protection | Human member/admin status comparison; external product/prize fulfilment is PROVIDER when enabled | AUTOMATED + HUMAN |
| Withdrawal reservation, payout and concurrency | `backend/test/withdrawal.integration-spec.ts`, `backend/test/financial-concurrency.integration-spec.ts`, `backend/test/kyc.integration-spec.ts` | KYC gating, reservation/payout state, idempotency/concurrency and duplicate-debit protection | Human member/admin state review; real payout rail is PROVIDER when enabled | AUTOMATED + HUMAN |
| Operations/read models/audit | `backend/test/operational-read-models.integration-spec.ts`, `backend/test/operational-completion.integration-spec.ts`, `backend/test/authenticated-runtime-uat.integration-spec.ts` | Authenticated role boundaries, exception/read-model aggregation, audited completion actions | Human usability and seeded-count reconciliation in release candidate | AUTOMATED + HUMAN |
| Public/member/admin frontend runtime | Frontend CI, Backend CI authenticated browser UAT, `scripts/verify-public-receipt.mjs` | Production builds, protected admin/member desktop/mobile baseline, navigation/overflow metrics and receipt surface contract | Human visual/readability/interaction review | AUTOMATED + HUMAN |
| Backup, encrypted off-host handoff and restore | Backend CI recovery drill, `backend/scripts/backup-data.sh`, `backend/scripts/export-offhost-backup.sh`, `backend/scripts/import-offhost-backup.sh`, `backend/scripts/restore-data.sh`, `backend/scripts/verify-backup-restore-drill.sh` | Isolated CI creates backup, validates inner checksums, encrypts/exports it, deletes the local source, imports only the encrypted archive, validates outer/archive/inner integrity, restores MySQL/MongoDB canaries and clears Redis | Retrieve a real protected off-host object into production-like isolated infrastructure, restore it, run root `npm run verify`, and sample critical records per `docs/OFFHOST-RECOVERY.md` | AUTOMATED + HUMAN |
| Payment collection, payout, SMTP and external fulfilment providers | Provider adapters/configuration and provider-dependent surfaces | Repository can keep providers disabled until configured | Real-provider UAT evidence for every enabled provider | PROVIDER |

## Required manual stateful release pass

Automated suites intentionally remain narrow rather than creating one fragile monolithic integration test. Before release approval, perform one coherent test-data journey and attach evidence to `docs/RELEASE-SIGNOFF.md`:

1. Register a MEMBER with valid sponsor and E-PIN; confirm the pin is consumed once and enrollment/activation state is correct.
2. Submit an installment payment with UTR/reference and screenshot; verify the same public receipt begins `PENDING VERIFICATION`.
3. Super Admin confirms the submission; verify the same receipt becomes confirmed/paid, installment allocation advances, and each confirmed installment allocation has one distinct five-digit token.
4. Open the public receipt without login; verify member ID, purpose, installment allocation, amount/reference/timestamps and token presentation. Exercise print/save-PDF and mobile readability.
5. Prepare/snapshot the applicable draw and verify the member receives at most one entry for that scheduled draw and the bound token is not reused.
6. Complete a test draw; verify winner state, future-draw exclusion for the winner, KYC gating and the permitted claim/fulfilment flow.
7. Exercise a non-winner/product entitlement path with an eligible test enrollment and verify no duplicate grant.
8. Exercise cancellation/refund/reversal only within already-defined policy. Preserve genealogy/history and verify future eligibility exclusions.
9. Compare member, admin and Operations views for the same records and preserve evidence references.

Do not use this pass to decide an OPEN RULE implicitly.

## Open-rule blockers

The following are intentionally unresolved until the business owner decides them. They must be listed as blockers/approved exceptions in release sign-off when applicable:

- Claim/KYC failure after the 30-day window: forfeiture versus redraw.
- Exact cancellation/refund amount formula.
- Exact session registration-close representation.
- Overpayment beyond remaining installments.
- Future overlapping sessions/re-enrollment.
- Final Fast Track settlement rail.
- Undefined income-head formulas.

## Automated baseline completion rule

The automated stateful baseline for a release candidate is complete only when all of the following reference the same exact commit:

1. Backend CI = `success`.
2. Frontend CI = `success`.
3. Release Evidence = `success` and references the expected browser-UAT artifact.
4. Target-like root `npm run verify` = PASS.

Passing this baseline does **not** auto-approve production. Human browser/stateful UAT, real off-host recovery, enabled-provider UAT and unresolved business-rule decisions remain explicit release gates.
