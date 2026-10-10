# Withdrawal service charge and TDS configuration

Effective on new, confirmed withdrawal requests after policy version publication; historical requests remain unchanged.

## Admin workflow

**Admin → Finance & Security → Withdrawals → Create policy version.** Select a policy, effective window, and:

- **Service charge mode:** `FIXED` for a flat monetary charge or `PERCENTAGE` of gross withdrawal. `feeValue` determines its amount; any configured fee min/max caps are still enforced by the backend.
- **TDS withholding (% of gross):** editable `tdsRatePercent` from 0 to 100; `0` means off. The system deliberately supplies NO statutory default.
- Choose KYC, permitted destinations, amount limits and max pending requests independently. Create a draft, review it, and publish it. Existing published version windows cannot overlap. An existing active version must be appropriately retired or end-dated before replacing it.

Request-time server calculation uses decimal half-up rounding per component:

`gross = service charge + TDS withholding + net member payout`.

Example of **illustrative, not statutory** settings: ₹2,000 gross, 2% service charge = ₹40, 5% TDS = ₹100, member receives ₹1,860. The entire ₹2,000 is reserved when the member requests it. On confirmed payout, ₹1,860 is credited to withdrawal clearing, ₹40 to service charge revenue, and ₹100 to an independent **WITHDRAWAL_TDS_PAYABLE** account, balancing the ₹2,000 wallet debit.

Every withdrawal stores service-charge amount (`feeAmount` for backward compatibility), TDS (`tdsAmount`), net (`netAmount`) and original `policyVersionId`. Later policy edits **never** alter queued/approved/processing/historical withdrawal deductions. Retrying the same request does not duplicate financial activity. Declined/cancelled requests release gross reservation.

## Compliance boundary

TDS statutory rates, payment nature, income-year thresholds, identity documentation, exemptions, tax returns, remittance and certification depend on current law and facts. This workflow does NOT automatically decide whether tax is applicable and does not file, remit or issue certificates. Tax/accounting review is required before enabling withholding. Zero remains the backwards-compatible default; do not claim tax compliance from this configuration alone.

## Surfaces and tests

Member Withdrawals discloses the configured service rate and TDS percentage, shows a pre-submission **estimate**, then displays the *server-frozen* exact amounts in request history. Admin queue and detail show the separate snapshot amounts; policies list shows the configured tax rate.

Database migration `0040_withdrawal_tds_service_charge_breakdown` adds TDS policy/request columns, extends the balanced request check and the ledger-account kind enum. It never rewrites old rows. Unit pricing tests, existing full withdrawal integration suite and a versioned TDS policy API assertion protect behavior.
