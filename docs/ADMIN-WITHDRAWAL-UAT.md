# Admin Withdrawals — Member Request Workflow

Branch: `dev/local-foundation`

## Navigation

Super Admin / authorized operators: **Finance & Security → Withdrawals** at `/portal/withdrawals`. The previous `/withdrawals` route now redirects to the same workspace, rather than to Wallet / Ledger. Both desktop sidebar and mobile More menu use the shared owner-management navigation.

## Existing authoritative workflow (reused without changing financial logic)

1. Member creates a withdrawal request. The amount moves into a reserved balance, and the request enters `REQUESTED`. No money is sent automatically.
2. An authorized operator opens the **Request queue** (filter by status), reviews member, KYC snapshot, destination reference, amount, fee, net and policy/version.
3. `REQUESTED`: **Approve** or **Reject** (reason mandatory to reject). Rejection releases the reservation.
4. `APPROVED` or retryable `PAYOUT_FAILED`: **Start payout** with the selected external payment provider/reference. Initiating a manual payout attempt is NOT confirmation that funds were sent.
5. `PROCESSING`: **Confirm paid** only after independent verification of the external transfer, or **Mark failed** with a reason. Financial ledger debit is committed only upon confirmed payout. All transitions remain enforced by the existing backend, with `withdrawal.read` and `withdrawal.manage` permissions.
6. Versioned policies remain available below the queue, separated from individual payout approval. Do not alter a published policy to process a pending request.

## Regression coverage

- Existing `backend/test/withdrawal.integration-spec.ts` covers KYC gate, wallet reservation, approve, payout fail/retry/confirmation and policy version lifecycle.
- Authenticated Chrome browser UAT now opens `/portal/withdrawals` with an authorized Admin user at desktop and 390px mobile widths, waits for both queue/policy API calls, and checks that the shared navigation contains Withdrawals without a second layout header or page-level horizontal overflow.
- Local release verification remains `npm run verify`. Production/live manual payout confirmation requires a real verified transfer and must not be simulated by clicking **Confirm paid** on a production request.

## Live UAT pending

The screenshot-reported ₹2,000 `REQUESTED` withdrawal should appear in the queue on the user's local database after pulling and running `npm run verify`. CI exercises isolated fixtures, not the user's actual payout. No live request status was changed by this code change.

## Published vs active default policy troubleshooting

If the member says **No active default withdrawal policy is available**, an Admin policy version labelled `PUBLISHED` is not sufficient. The backend requires **(1)** the policy to be the sole `isDefault=TRUE` policy for that currency, **(2)** version lifecycle `PUBLISHED`, and **(3)** `effectiveFrom <= database CURRENT_TIMESTAMP(3) < effectiveTo` (when an end time exists). Retiring an already-active older version while the new version is future-scheduled creates an intentional availability gap. **Never** silently fall back to an expired or retired version, and never change historical withdrawal amounts.

The Admin policy list now displays the database-evaluated state **ACTIVE / SCHEDULED / NOT_DEFAULT / EXPIRED** as well as `Effective from` and the default badge. For a published non-default policy use **Set as default** (explicit privileged, audited action); for a default published future-scheduled version use **Activate now** (audited; changes only future scheduling, not rates). Neither action is allowed to overwrite an overlapping published effective window. The legacy create-version default starts one minute in the past, allowing immediate activation unless the operator explicitly schedules a future start. **Retire** now prompts that member withdrawals may stop if no active replacement remains. Member page gives a scheduled activation date or directs members to Admin, without exposing internal policy configuration.

This is a **configuration availability issue**, not an indication of insufficient wallet balance or unapproved KYC. The earlier ₹2,000 PAID withdrawal remains immutable; new policy effects apply only to new requests. Integration regression creates a future PUBLISHED, non-default test policy, checks the member is unavailable, explicitly sets default and activates it, checks availability restored, then retires it. On an existing local database the exact cause of a missing active version cannot be inferred from screenshots; the new activation badges show it reliably after local verification.
