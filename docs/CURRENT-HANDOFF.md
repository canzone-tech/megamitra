# MegaGoldenClub — CURRENT HANDOFF

Last refreshed: **2026-10-10 evening IST**  
Repository: `canzone-tech/megamitra`  
**ONLY working branch:** `dev/local-foundation`  
**Last verified APPLICATION code commit:** `52180b77be193ce0e325e11680da4057ef7325af`  
The commit updating this document is documentation-only; confirm fresh branch HEAD when resuming.

## Strict working contract

Be the production engineer: examine the authoritative repo, existing design, schema/migrations, contracts, tests and CI, and address root causes. **Make edits in GitHub on `dev/local-foundation`, push them, and confirm Backend CI + Frontend CI + Release Evidence**. User then does only:

```bash
git pull
npm run verify
```

Root `npm run verify` is the authoritative local gate. Do not give manual file edits or workaround patches. Do not edit `main`, rewrite history or modify migrations already applied to a real environment (append-only new migrations after release).

## CURRENT HIGH PRIORITY — Installment Income Recovery Reserve

**Confirmed client requirement (2026-10-10), no need to re-ask:**
- Reserve starts **only on the day AFTER the configured monthly Lucky Draw date** (using the season/draw timezone). Example: Jan 17 draw → earliest Jan 18, not on the draw date.
- Only if next applicable EMI (or an earlier missed EMI) is not fully paid; a month's draw N unlocks installment N+1, not distant future EMIs.
- Only **newly earned income** after the trigger qualifies: configurable default **50% earning → installment reserve; 50% stays spendable**. Existing wallet balances and historical earnings are not retrospectively swept.
- Cap reserve at remaining EMI due (consider payment allocations, refunds and already-held reserve). No double reserve on retry.
- At full coverage, **automatically settle EMI** through internal ledger-funded payment (not an external UPI/cash receipt), record auditable payment/allocations, issue/link permanent Lucky Draw Token, update Member Installment History. **No manual Admin approval/reconciliation**.
- Once applicable EMI fully paid, 100% of subsequent earnings remain available, subject to separate withdrawal rules; do not hold future EMI before its draw trigger.
- Keep Installment Reserve **separate** from spendable USER_WALLET and withdrawal payout reservation. Configurable season policy (Super Admin), source-keyed idempotent and fully balanced financial transactions. Do not promise automatic cash payout: withdrawal remains a separate process.

**IMPLEMENTED in repo**, at application commit `52180b7`. Relevant files:
- `docs/INSTALLMENT-INCOME-RECOVERY.md` — detailed locked rule, triggers, accounting, verification.
- `backend/prisma/migrations/0041_installment_income_recovery/migration.sql` — append-only policy/holds/settlements, new ledger kinds.
- `backend/src/installment-recovery/installment-recovery.engine.ts` — same-transaction hold, auto-EMI settlement and token.
- Earning integration in `referral-reward.service.ts`, `binary-settlement.service.ts`, `rank-achievement.service.ts`; external EMI payment coexistence in `program-payment.service.ts`; withdrawal reserve exclusion.
- Super Admin configurable versioned policy at **Season Management → Advanced Season Policy → After-Draw Installment Reserve**.
- Member Dashboard and Withdrawals display dedicated reserve; auto-paid EMI shows in monthwise Installment History.
- Unit and financial integration tests: `backend/src/installment-recovery/installment-recovery.engine.spec.ts`, `backend/test/installment-recovery.integration-spec.ts`. Synthetic scenario exercises pre-/post-draw earnings, five ₹400 earnings → five ₹200 holds → one ₹1,000 auto payment + token, balances and replay idempotency.
- Recent fix `52180b7`: reject unbalanced cash refunds of EMI payments funded through income reserve.

**GitHub CI confirmed PASS at code commit `52180b7`:**
- Backend: https://github.com/canzone-tech/megamitra/actions/runs/38055136509
- Frontend: https://github.com/canzone-tech/megamitra/actions/runs/38055136502
- Release Evidence: https://github.com/canzone-tech/megamitra/actions/runs/38055136699

**NOT YET CONFIRMED:** User's local `npm run verify` for application commit `52180b7` and human UAT against their actual 2027 draw/session, real earnings and wallet. Do not claim these green or that real future draw has occurred. The latest conversation was interrupted because chat is full, not because an implementation blocker remained.

## Other implementation completed during Member/Admin portal UAT

### Member features / UI
- Dashboard: referral ID, Copy Link, WhatsApp share, real sponsor-prefill/verification, wallet, referrals, Binary 1:4, rank/draw summaries and navigation.
- **Monthwise Installments**: EMI 1..N, due dates, net paid/remaining, original receipt IDs/provider, linked Lucky Draw Token; automatic idempotent linkage for confirmed old cash/Auth Code payments on receipt/history. No normal Super Admin reconciliation step.
- **Rewards & Lucky Draw** member guide: published rank targets (fresh direct/team/deadline, bonus/monthly/trip), member achievements, session monthwise ACTIVE prize catalogue, official draw dates, own tokens, verified wins/claims. Do not show unpublished policies, other users' details or promise future earnings. Product Benefits are **granted entitlements**, not same as advertised possible Lucky Draw prizes. See `docs/MEMBER-INFORMATION-AUDIT.md`.
- QR/UPI upload: frontend image processing with backend compatible bounded data URL and image optimization; member payment QR and receipt flows tested.
- Mobile More navigation: stacking-safe portal overlay, pointer-hit tested at 390px; shared theme consistency.
- KYC Date of Birth uses native calendar; Member Security **does not** offer Change Email, and email-change request/confirmation is restricted to SUPER_ADMIN at backend. Existing email verification and password recovery remain.
- Member Withdrawal form estimates gross/service charge/TDS/net and reads authoritative policy and balance/reserve.

### Withdrawal / Finance
- Admin **Finance & Security → Withdrawals** queue, approve/reject, payout processing, explicit confirm paid/failed, review policy, mobile access. See `docs/ADMIN-WITHDRAWAL-UAT.md`.
- Separate configurable versioned **Service Charge** (FIXED/PERCENTAGE) and **TDS percentage** (default 0) per withdrawal; request snapshots immutable; TDS payable separate from service revenue. Tax applicability/rate/remittance require independent tax/accounting approval. See `docs/WITHDRAWAL-TDS-SERVICE-CHARGES.md`.
- `PUBLISHED` policy is not automatically `ACTIVE`. Member withdrawals require currency default + published + effective date window. Admin now shows ACTIVE/SCHEDULED/NOT_DEFAULT/EXPIRED and safe explicit Set as default / Activate now. Existing published rates and historical withdrawal records unchanged.
- Normal payout process should never auto-mark funds PAID merely on initiating attempt; verify actual transfer externally first.
- Past screenshot verified ₹400 estimated gross → ₹40 (10%) service → ₹20 (5%) TDS → ₹340 net; these are configured fixture values, **not statutory rates** and not necessarily current balances.

### Program/draw/owner workflow
- Super Admin/Admin portal earlier underwent full UAT: accounts, RBAC, member directory, payments/bills, wallets, E-PIN, Payment Authorization Code, Season Management, Monthwise Prize Catalogue, Nine Income read-side, Binary 1:4 read-side, rank achievements, management dashboard.
- Payment Authorization Code operator assignment: active, reusable for multiple payment authorizations until expiry; validate operator and purpose. Cash EMI payment and token issuance are idempotent.
- Prize Catalogue production starts blank/client-configured. Export/import deployment package UI/backend endpoints retired.
- Historical UAT draw: `MegaGoldenClub 2027`, month 1, **MANUAL / EXTERNAL**, **SCHEDULED** for **2027-01-17**. Draw lifecycle **not manually executed yet**: Eligibility Lock → External Winner Recording → Finalize → Verify → Approve → Publish/Fulfil. Do NOT force future events to complete UAT.
- Historical examples only (NOT current balances): referral ₹250, binary pair ₹200, daily cap ₹5,000, Lightning ₹1,000, earlier wallet ₹2,400. Canonical dashboard must show real joining/EMI/registration values, not zeros.

## Architecture and finance invariants
- Admin/member: Next.js + TypeScript. Backend: NestJS + TypeScript REST.
- **MySQL 8 + Prisma authoritative** for business, wallet and financial truth; MongoDB ONLY CMS/presentation/theme; Redis non-authoritative temporary cache, queue and locks.
- **Binary 1:4**, configurable/version-policy driven, NOT the illustrative VisionRise demo's 2:2.
- Never fabricate payments, token, tax rules, payouts, achievements, draw wins or member balances. Version policies; maintain audit logs, balanced ledger and source-key idempotency.
- Respect existing strict dependency allowScripts and audits; do not blind-force audit fixes.
- Tests, migrations and CI are mandatory for financial changes.

## Next chat sequence
1. User message can simply say: **“MegaGoldenClub continue bro — read docs/CURRENT-HANDOFF.md on dev/local-foundation. Resume Installment Income Recovery UAT.”**
2. Reconfirm branch HEAD and latest CI (docs-only commit after `52180b7` may shift SHA).
3. Do **not** implement recovery from scratch: its code, migration, tests and Admin/Member UI have already been pushed. Inspect `docs/INSTALLMENT-INCOME-RECOVERY.md` first.
4. Request only `git pull` and root `npm run verify` for local gate, when GitHub CI on current HEAD has passed. Wait for user report. Then verify configured season policy and member after-draw reserve/auto-EMI real UAT; respect Jan 2027 future draw, do not fake production dates.
5. If local verify or UAT fails, investigate actual logs/flows and **fix in GitHub** on `dev/local-foundation`, push, confirm Backend/Frontend/Release green, user pulls/re-runs verify. No manual patch instructions.

This handoff supersedes the obsolete 2026-10-09 16:24 IST status; latest GitHub code and dedicated docs remain authoritative.
