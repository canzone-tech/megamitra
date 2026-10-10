# MegaGoldenClub — Admin-to-Member Information Audit

Updated: 2026-10-10. Branch: `dev/local-foundation`.

## Information access principles
- Members read only their enrolled session(s), own payments/tokens/wins/rewards and published season policies. Management drafts, other users' data, draw selection secrets, internal scores and operator controls remain private.
- Published values and monthwise prizes are version/configuration sourced from MySQL, never independent hardcoded flyer values.
- Qualification and actual credits come from authoritative financial/policy records, not front-end calculations or promised cash.
- Income formulas not present in the locked project business contract must not be advertised as payable.

| Admin subject | Member surface | Data/behavior | Audit |
|---|---|---|---|
| Active session, registration and EMIs | Dashboard, Payments & E-PINs, Installment history | Enrolled version, next due, monthwise net payments, refunds, receipt references | Existing; member-specific |
| Direct referrals | Dashboard referral card and referral rewards | Own referral ID, link/WhatsApp, own referral earnings and direct count | Existing |
| Binary 1:4 | Dashboard binary performance | Member qualified queue, pairs, settlement, amounts/caps under versioned policy | Existing |
| Rank achievement targets (including Lightning/levels) | **Rewards & Lucky Draw** | Published policy tiers, fresh direct/team targets, joining-date deadline, potential cash/recurring/trip benefits | **Added** |
| Earned rank/leadership | **Rewards & Lucky Draw** | Only member's recorded achievements, monthly payout count, trip status | **Added**, does not imply unearned benefits |
| Monthly draw prize schedule | **Rewards & Lucky Draw** | ACTIVE configured season month/prize names, winner counts, nominal values where configured | **Added**, does not guarantee win |
| Draw calendar, tokens, outcomes | **Rewards & Lucky Draw**, Installment history, Dashboard | Official scheduled draws, own paid-EMI tokens, own wins/claim deadlines | **Added** guide; existing token/claim read-side retained |
| Product benefit inventory | Benefits | Only explicitly granted benefits, own claim/fulfillment state | Existing; clarified not the public draw catalogue |
| Wallet and withdrawals | Dashboard, Withdrawals | Own balance, reservations, payout requests | Existing |
| KYC and account email verification | KYC, Security | Own submission/status and current email actions | Existing |
| General '9 Income Types' labels: Leadership, Recognition, Retail Sales, Community Pool | Not shown as earned income | Where formulas/published earning policies are undefined, informational Admin headings must not turn into member financial promises | **Deliberately withheld** pending approved business rules |

## Mobile and navigation regression requirements
- Desktop sidebar contains a direct route for Rewards & Lucky Draw and Benefits differentiated from Prize Catalogue.
- Mobile bottom navigation offers Home / Payments / Benefits / More.
- More is portalled to the theme root to escape header stacking/clipping. Overlay uses real clickable controls and backdrop close.
- Authenticated 390px browser verification must use actual CDP pointer events and verify the More menu is visible and hittable using `elementFromPoint`; no DOM-only `.click()` false positives.
- Desktop and mobile authenticated browser scenarios exercise the new `/member/rewards` route and fail on horizontal overflow/API errors.

## Known operational distinctions
- Rank fresh direct/team counts reset after each awarded level, deadlines are anchored to the paid joining date. Lifetime referral totals are *not* accurate per-tier qualification progress and must not be displayed as such.
- Draw tokens for confirmed monthly installments are not wins. Winners/claims require separate verified draw lifecycle.
- Prize catalogue entries are potential monthly prizes; entitlements exist only after business-policy grants. Both remain separate from member wallet earnings.
- Draw date is shown only when an actual authoritative draw instance exists; otherwise "Not scheduled".
- Human stateful UAT of member-specific publication, actual rewards and mobile touch interactions remains necessary after CI and local `npm run verify`.

## Identity and KYC controls (2026-10-10)
- A policy-defined `dateOfBirth`/`birthDate`/`dob` KYC field renders a native date input/calendar and submits the same `YYYY-MM-DD` value in its existing policy field. Other KYC inputs remain policy-driven and unchanged.
- The Member Security page displays username, email and verification state; existing email verification remains available. It no longer provides an email-change form.
- `POST /auth/email-change/request` is `SUPER_ADMIN`-role restricted, with a service-side persisted-role check. Public `POST /auth/email-change/confirm` also validates the subject still has `SUPER_ADMIN` during transactional consumption, so historical member tokens cannot bypass the new restriction.
- Password recovery and verification of the existing email are **not** disabled. No schema migration.
