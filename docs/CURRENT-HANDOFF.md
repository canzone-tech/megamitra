# MegaGoldenClub / MegaMitra Current Handoff

Last updated: 2026-10-09 16:24 IST  
Working branch: `dev/local-foundation`  
Remote head at handoff: `99ea53ced49924b38dd8475fddf18422967f9196` (`security: approve frontend resolver install script`)

## Mandatory development workflow

Work only on `dev/local-foundation`. Make fixes directly in the GitHub repository, push them, verify GitHub Backend CI + Frontend CI (and Release Evidence when present), then ask the user only to:

```bash
git pull
npm run verify
```

Root `npm run verify` is the authoritative local gate. Do not switch to manual local patch instructions unless explicitly requested. Do not modify `main`. Applied migrations are immutable; schema corrections use append-only migrations.

## Current remote verification state

At remote head `99ea53ce`:

- Backend CI: PASS
- Frontend CI: PASS
- Release Evidence: PASS
- Busy-port verification fallback: covered
- Dependency audit policy: covered
- Authenticated compiled API/browser UAT: covered by Backend CI

The user has **not yet reported a full local `npm run verify` PASS on head `99ea53ce`**.

The user's most recent local run was on an earlier checkout and failed while installing exact admin dependencies with:

```text
npm error code ESTRICTALLOWSCRIPTS
npm error --strict-allow-scripts: 1 package(s) have install scripts not covered by allowScripts:
npm error   unrs-resolver@1.12.2 (postinstall: node postinstall.js)
```

That failure is addressed on the current remote head. Both `admin/package.json` and `frontend/package.json` explicitly approve:

```json
"allowScripts": {
  "unrs-resolver@1.12.2": true
}
```

Therefore the first action in the next chat is **not** to patch locally. Ask the user to pull the current branch and rerun root verification.

## Dependency/security status

The earlier install output showed deprecation warnings plus a vulnerability count. This was converted into an enforced repository security contract rather than ignored.

Current backend policy:

- `backend/.npmrc`: `strict-allow-scripts=true`
- reviewed install scripts are explicitly version-pinned in `backend/package.json`
- runtime dependency audit must be completely clean
- full dependency audit must have 0 high and 0 critical findings
- only the explicitly reviewed dev-only moderate advisory `GHSA-HP3W-G68C-FV3C` is allowlisted
- `backend/scripts/verify-dependency-audit.mjs` enforces the policy in both local verify and Backend CI
- MariaDB is overridden to `3.5.4` in backend package policy to clear the prior runtime MariaDB audit findings

Expected audit messages from the policy are:

```text
MegaGoldenClub production dependency audit: PASS (0 vulnerabilities)
MegaGoldenClub full dependency audit: PASS (... reviewed dev-only moderate finding(s), 0 high, 0 critical)
```

Do not run `npm audit fix --force` blindly.

Deprecation notices such as old `glob` / unsupported `eslint` may still be visible during install even when the enforced security gate passes. Treat those separately as maintenance/toolchain work, not as a reason to bypass the audit contract.

## Local verify port behavior

A previous authoritative local verify failed because the user's running dev/UAT API already occupied port 3100.

This is fixed. `backend/scripts/verify-local.sh` now:

- keeps an existing local API/session untouched
- selects a temporary free verification port when configured port 3100 is busy
- boots the compiled API using that temporary port
- runs authenticated UAT against that port
- cleans up only its own temporary API process
- verifies that its temporary port is released

Regression coverage lives in:

- `backend/scripts/select-verify-port.mjs`
- `backend/scripts/test-select-verify-port.mjs`

## Admin / SUPER_ADMIN UAT status

The following areas have been exercised and are considered closed unless a new regression appears:

- Admins & Agents account lifecycle
- password-change-required behavior
- role / permission enforcement and missing-permission boundaries
- Members directory / access boundary behavior
- Payments / Bills
- Member Payment Verification / QR-UPI settings
- Wallet / Ledger
- E-PIN Management
- Auth Codes / Payment Authorization
- Season Management
- Prize Catalogue monthwise editor
- 9 Income / Reward Types read-side
- Binary 1:4 read-side and earlier pair/wallet verification

### Auth Code contract locked by UAT

- only Payment Authorization is exposed as a user-facing purpose
- SUPER_ADMIN assigns codes to an existing ADMIN / AGENT operator
- assigned operator sees the full active code
- same operator + same purpose cannot receive a duplicate active unexpired code
- a code is reusable for multiple payment operations until expiry
- using the code does not consume it
- expired / invalid / wrong-operator code must fail
- two separate ₹1,000 payments were successfully recorded with the same active code and the code remained ACTIVE

### Prize Catalogue contract

Production starts from blank client-owned configuration. Deployment package migration tooling is retired.

Removed from Prize Catalogue:

- Export Deployment Package
- Import Deployment Package
- Import / Sync Package
- Prize Catalogue Export CSV

Old deployment package backend endpoints are retired and regression-protected as 404.

The Monthwise Editor itself remains and was already used to create the current prize schedule/products/images.

## Monthly Draw / Winners status

Read-side and preparation were exercised.

Current UAT draw:

- season: MegaGoldenClub 2027
- month: 1
- mode: MANUAL / EXTERNAL (intentionally selected by the user)
- status: SCHEDULED
- draw date: 2027-01-17
- draw register entry created successfully
- same draw appears in Winners workflow

The future draw execution lifecycle is **not** considered manually completed yet because the scheduled entry window / draw time is in the future. Do not force state transitions just to close UAT.

Remaining real-time lifecycle later:

`Eligibility Lock -> External Winner Recording -> Finalize -> Verification -> Approval -> Publish/Fulfil`

Backend integration tests already cover the lifecycle mechanics.

## Management Dashboard work

The original dashboard was too sparse and has been expanded into a read-only management cockpit using authoritative data.

Current dashboard includes:

- active season
- MEMBER-only account count
- active MEMBER count
- active enrollments
- placed Binary 1:4 members
- KYC state
- qualified / total pair metrics
- pair payout value and daily cap
- gross collections, refunds and net collections
- member wallet credits, debits and combined balance
- E-PIN inventory
- active authorization codes
- open draws, winners and open prize claims
- rank achievement count / cash awarded
- latest MEMBER accounts
- latest payment records
- current configuration
- automatic earnings-processing summary

Important semantic fix: Dashboard `Members` now counts strictly users with role `MEMBER`; ADMIN / AGENT / SUPER_ADMIN accounts are not mixed into that number.

Mobile table overflow was caught by browser UAT and fixed with grid/card min-width containment and internal table scrolling.

### Dashboard commercial-value fix

A visual UAT screenshot showed:

```text
Joining: ₹0.00 = ₹0.00 monthly EMI + ₹0.00 registration.
```

Root cause: dashboard used a simplified season query that did not hydrate program commercial values.

Dashboard now uses the same canonical `seasonSelectSql()` / formatted season path as Season Management, including registration fee, monthly EMI, installment count, currency and related program-version values.

A regression in authenticated runtime UAT locks these fields against the paid-registration fixture.

After the next successful local pull/verify, visually spot-check Current Configuration once to confirm the real active season values display instead of ₹0.00.

## Financial/UAT reference already observed

Earlier UAT established:

- Direct Referral: ₹250
- Binary Pair: ₹200
- Daily cap: ₹5,000
- Lightning Start Bonus: ₹1,000
- wallet ledger previously showed referral + rank + binary credits
- a missing binary sweep was diagnosed/fixed earlier and wallet total returned to ₹2,400 in that test state

Do not infer current database balances from these historical UAT values; they are reference observations from the test state.

## Architecture / contracts that must not drift

- Next.js + TypeScript admin/member portals
- NestJS + TypeScript REST backend
- MySQL 8 is authoritative for business/financial truth
- Prisma ORM
- MongoDB only for flexible presentation/CMS/theme documents
- Redis is non-authoritative cache/queue/lock/temp state
- Binary 1:4 is configurable and version/policy driven
- financial history must remain auditable/idempotent
- shared design system/theme consistency is required
- configuration over hardcoding

## Next chat continuation

Start from this exact sequence:

1. Confirm branch is `dev/local-foundation`.
2. Confirm current remote head (handoff head was `99ea53ce`).
3. User should run only:
   ```bash
   git pull
   npm run verify
   ```
4. If local verify is green, refresh Dashboard and visually confirm Current Configuration has real Joining / monthly EMI / registration values.
5. If dashboard is clean, treat SUPER_ADMIN/Admin portal as substantially closed and continue **member/user portal UAT**.
6. If local verify fails, reproduce/root-cause the exact failure, fix directly in the repo, push, verify Backend + Frontend CI, then ask the user only to pull and rerun root verify.

Do not repeat already-closed UAT modules unless a regression directly involves them.
