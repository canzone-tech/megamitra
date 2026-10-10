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
