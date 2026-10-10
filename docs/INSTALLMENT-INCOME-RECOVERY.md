# MegaGoldenClub — After-Draw EMI Income Reserve

Confirmed client rule (2026-10-10): **The calendar day AFTER a configured monthly Lucky Draw**, if the corresponding next EMI is not fully paid, new eligible income is split into an **Installment Reserve** and an available wallet component. Default **50% reserve / 50% wallet**. Only newly earned income events dated after that draw day qualify. Previously earned or already-held wallet funds are never swept retrospectively.

## Eligibility and cap

- The authoritative draw is `owner_draw_runs` → `lucky_draw_instances.drawAt` for the member's season. Its `drawTimezone` determines the first eligible day, starting at midnight of the next local calendar day. The draw date is never hardcoded, and a voided/cancelled draw is not eligible.
- Draw month N unlocks reserve for EMI N+1 and any **earlier missed EMIs**; it does not prematurely withhold for future EMI N+2.
- The next unpaid EMI's net due is calculated from program payment allocations **minus refunds**, not an independent editable balance.
- Each **new** posted referral, binary pair or rank/monthly earning is credited normally and then moves the configured percentage to a dedicated per-installment reserve ledger account within that **same financial transaction**. Half-up rounded to paisa, capped at the EMI's remaining due after subtracting already-held reserve. An earning's source transaction can contribute only once.
- The reserve has its own ledger account kind, distinct from the **withdrawal payout reservation** and **spendable USER_WALLET**. Withdrawal balance derives from USER_WALLET and therefore excludes EMI reserve automatically.
- On 100% coverage the same transaction converts reserve to an **INCOME_RESERVE** payment attempt + payment record + installment allocation + business event, debits the reserve to internal clearing, and issues/links the existing global unique 5-digit token. No admin/manual cash approval is required.
- When the installment is paid, no further holds apply to that month's target. A later EMI can only become eligible after its preceding draw. If an external cash/UPI payment covers part/all of an EMI while reserve exists, the confirmation transaction reconciles/auto-pays the outstanding balance and refunds any excess hold to the spendable wallet.
- The automatically generated payment is an **internal ledger-funded payment**, not an external bank/UPI transfer. Accounting clearing is not platform fee revenue and does not produce a second wallet debit.
- Confirmed payments retain permanent payment allocation, receipt and token history. All ledger events are balanced and idempotently source-keyed.

## Super Admin configuration

At **Season Management → Advanced Season Policy → After-Draw Installment Reserve**, publish a new version of the enabled flag and percentage from 0–100 (default 50%). The prior version becomes RETIRED; existing earning holds retain the policy version used at creation. Configuring disabled/0 stops future holds, without deleting or rewriting historical payment entries. Seeded 50% policy applies to existing ACTIVE seasons; newly activated seasons receive an initial 50% version if no custom version exists.

## Member surfaces

Dashboard and Withdrawals show a dedicated **Installment reserve** figure. Available to Withdraw is based on the member wallet, after installment reserve has been moved out and after separate pending payout reservations. Auto-confirmed EMI appears under **Installment history** with the provider `INCOME_RESERVE` and a permanent draw token.

## Verification

The financial integration spec simulates a recorded scheduled draw, a member with paid month 1 and unpaid month 2, a pre-draw earning and five post-draw ₹400 earnings, verifies ₹200 held from each, one and only one ₹1,000 internal EMI payment and token, balanced wallet, and idempotent replay. This is synthetic CI data; human UAT of real 2027 draw dates and actual program enrollments remains separate. Existing withdrawal/EMI/referral/rank integration and desktop/mobile browser checks must remain green.
