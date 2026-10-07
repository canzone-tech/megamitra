# MegaGoldenClub — Business Rules Register (Canonical)

**Status:** authoritative human-readable register for the MegaGoldenClub project, maintained in GitHub on `dev/local-foundation`.  
**Reviewed:** 2026-10-06.  
**Read first in every new development/UAT chat.** This register complements `docs/BUSINESS-ARCHITECTURE.md`, `docs/UAT-CHECKLIST.md` and `docs/STATEFUL-UAT-COVERAGE.md`. If a chat summary conflicts with repository code, migration history or a newer approved rule, stop and reconcile explicitly before changing business behavior.

## How to use this register

- **LOCKED** means an approved business contract, not necessarily fully enforced in code.
- **IMPLEMENTED** means repository implementation exists; human UAT is still separate from automated CI.
- **PENDING** means approved requirement not yet fully implemented/verified. Never describe it as released.
- **OPEN** means a decision is not approved. Ask the business owner rather than inventing a default.
- Record rule revisions here **in the same GitHub change** as relevant code, tests and migration. Keep applied migrations immutable; schema changes are append-only.
- Do not copy private member contact data, passwords, security tokens, raw E-PINs or payment proofs into this document.
- Development branch: `dev/local-foundation`. Make fixes directly in the GitHub repo, push, verify exact-SHA Backend CI, Frontend CI and Release Evidence, then ask the operator **only** to pull and run root `npm run verify`. That root command is the authoritative local verification gate. Never substitute a manual patch.
- A passing automated verification does **not** mean the manual business UAT or production go-live is approved.

## Locked product and identity contracts

| ID | Rule | Implementation/evidence |
| --- | --- | --- |
| ID-01 | Member's public **Username is also their Sponsor / Referral ID**. Internal `user.id` remains a separate UUID. There is no additional public sponsor code to generate. | Sponsor lookup: `backend/src/auth/member-registration.service.ts`. |
| ID-02 | For configured **AUTO** username mode: optional configured prefix (currently `MGC`) + **exactly six cryptographically random digits**, not a sequential counter. Check existing username and retry collisions; DB username is unique. Public signup does not request a username from the applicant. | `backend/src/users/random-username.ts`, `backend/src/auth/member-registration.service.ts`, `backend/src/users/users.service.ts`, `frontend/components/signup-form.tsx`. **IMPLEMENTED**. Keep registration policy in AUTO mode while signup hides the manual username field. |
| ID-03 | Public signup requires an active verified sponsor and an eligible, unused season-bound **Activation E-PIN**; its successful registration creates a season enrollment, allocates first payment and places the member in binary genealogy. | `backend/src/auth/member-registration.service.ts`. **IMPLEMENTED**, manual UAT ongoing. |
| ID-04 | India address selection: default **Karnataka / Bengaluru**, dependent State → City dropdown with Other-city fallback, required **six-digit Indian PIN Code** saved to member profile. | `frontend/lib/india-locations.ts`, `frontend/components/signup-form.tsx`, migration `0037_member_profile_postal_code`. **IMPLEMENTED** for public signup. |
| ID-05 | An owner-created first/root member can be a **bootstrap sponsor anchor** without a season enrollment. Remaining UAT members enroll through **public signup**, not the admin bootstrap form. | Business UAT procedure. Root's pending placement and not-enrolled status are expected, not paid membership. |

## Binary 1:4, commercial and season contracts

| ID | Rule | Implementation/evidence |
| --- | --- | --- |
| BIN-01 | Exactly four authoritative placement slots: `A`, `B`, `C`, `D`. `A/B → LEFT`; `C/D → RIGHT`. Deterministic breadth-first auto-placement, slot order A → B → C → D. | `docs/BUSINESS-ARCHITECTURE.md`; genealogy modules. **LOCKED / IMPLEMENTED**. |
| BIN-02 | Fixed qualifying pair lanes **A:C** and **B:D** only; no A:D or B:C cross-pairing. One qualifying unit on each side. Pair payout, caps, referral, carry-forward, eligibility are versioned configurations, never improvised in the UI. | `docs/BUSINESS-ARCHITECTURE.md`. **LOCKED**. |
| BIN-03 | The owner Binary 1:4 genealogy must show **Sponsor/Referrer independently of Placement Parent** for every descendant; sponsor controls rank/referral accounting and placement parent controls A/B/C/D tree position. The member selector includes **top-level and nested members** (not top-level roots only). Selecting any member or clicking a filled slot drills into that member's four direct slots with explicit **OPEN (empty)** or **FILLED (occupied)** status; navigating back to the placement parent must be possible. An open/filled visual label does not certify payout eligibility. | `OwnerPortalCoreService.binaryGenealogy`, `OwnerCoreV14Portal` Binary view and tests. **LOCKED / IMPLEMENTED**; manual UAT pending. |
| AUTO-01 | Normal successful member economics are **automatic after the authoritative payment/enrollment commit**: durable business-event processing, binary qualifying units, referral reward handoff/consumption, A:C / B:D pair settlement, configured caps/carry-forward and wallet/ledger posting require no owner button. Manual orchestration/settlement endpoints remain recovery-only backend capabilities and are hidden from the normal owner UI. **Lucky Draw execution/winner workflow remains manual.** Human-risk/exception decisions such as unverified QR/UPI proof approval, KYC review, withdrawals/payout authorization, refunds/cancellations and policy/RBAC configuration remain manual unless a trusted external provider is explicitly integrated. | Program automation pipeline + idempotent source keys/settlement mutexes. **LOCKED / IMPLEMENTED** for automatic orchestration/referral/binary settlement; provider-dependent/manual exception controls remain intentionally manual. |
| SEA-01 | UAT season is **MegaGoldenClub 2027**, currently coded `MGC_202610_3FC2`, ACTIVE, starting **2027-01-01**, ending **2028-06-30**, 18 monthly installments. Registration fee **₹1,000**, monthly EMI **₹1,000**; configured pair payout **₹200**, daily cap **₹5,000**. These are **current UAT configuration**, not platform-wide hardcoded prices. | Existing admin season configuration and UAT screenshots. |
| SEA-02 | **Season Code must be globally unique**; `owner_seasons.code` has a DB unique index (migration `0023_owner_management_portal`). Business rule: once ACTIVE, the code never changes, preserving printed references. Existing admin update flows restrict edits to DRAFT/REVIEW and do not update code. | **LOCKED**, application/DB uniqueness **IMPLEMENTED**; explicit **database-level immutable-after-ACTIVE guard PENDING**. Do not rename the existing ACTIVE season as part of a formatting fix. |
| SEA-03 | For **future** seasons, prefer human-readable date-based codes (e.g. `MGC-JAN27`, `MGC-JUL27`) with a disambiguating suffix if necessary to retain uniqueness. This naming preference does not force a new season each month. **Month/EMI numbers are inside a season**, not automatically new seasons. | **LOCKED preference**; existing ACTIVE `MGC_202610_3FC2` remains valid. |

## Automatic Lightning Start and Level 1–4 achievements

| ID | Locked rule | Evidence |
| --- | --- | --- |
| RANK-01 | Achievement deadlines **always start at each member's original paid joining timestamp**, never at the time they complete a preceding level. Lightning: 4 hours; Bronze: 20 days; Silver: 30 days; Gold: 60 days; Diamond: 90 days. | Flyer, approved clarification. `RankAchievementService` checks milestone crossing timestamps rather than worker runtime. |
| RANK-02 | **Every level requires NEW qualified people.** Previously counted referrals/team members are not recycled into the next level. A direct referral is an active paid personally sponsored member; team means active paid descendants of the **sponsor/referral tree**, not A/B/C/D placement. Lightning fast-start may be missed without blocking Bronze; Bronze → Silver → Gold → Diamond are progressive levels. | `rank-achievement.service.ts`; independent post-rank cohorts. |
| RANK-03 | Lightning **4 new direct within 4h → ₹1,000**. Bronze **10 new direct + 40 new team within 20 days → ₹5,000**. Silver **25 new direct + 100 new team within 30 days → Goa family trip + ₹10,000**. Gold **50 new direct + 250 new team within 60 days → Ooty family trip + ₹20,000 + ₹2,000/month × 18 months**. Diamond **100 new direct + 500 new team within 90 days → Shimla family trip + ₹50,000 + ₹5,000/month × 18 months**. | Supplied five-level flyer. Diamond also clearly states **For 18 Months**. |
| RANK-04 | Financial policy is **versioned per published program version**; amounts, deadlines, new member targets and months can be changed only via reviewed draft → publish. Already posted achievements are immutable and unique per member enrollment + tier. Cash rewards and monthly installments post automatically with balanced idempotent wallet entries; trips have an auditable **manual physical fulfilment** action. No manual qualification button, no Lucky Draw automation. | New migration `0038_rank_achievement_rewards`, RankAchievementService, admin bonus policy editor/award register. Automated CI ≠ human UAT. |
| RANK-05 | A fully refunded, inactive or cancelled membership does not generate new achievements or further monthly rank payouts. Previously posted rewards must not be silently deleted or reversed; require separate controlled financial reconciliation. | Worker queries active paid enrollments, historical ledger immutability. |
| RANK-06 | **Gold and Diamond recurring incomes are mutually exclusive, never simultaneous.** Gold grants **up to ₹2,000/month × 18 months**, but **stops immediately when Diamond is achieved** (even if some of its 18 months remain). Diamond then grants **₹5,000/month × up to 18 months**, counted from Diamond achievement. Gold installments **due before** the Diamond achievement instant stay earned and can be caught up; a Gold installment due **at or after** Diamond achievement must never be credited. Diamond does not extend/resume Gold after its own term expires. An upgrade does not silently reverse already-posted historical transactions; mismatches need reconciliation. | Owner clarification 2026-10-07; `RankAchievementService.postMonthly` checks the latest achieved income tier under the financial mutex before posting; integration regression tests validate cutoff, wallet totals and replay. |

## Activation PINs, installments and tokens

| ID | Rule | Implementation/evidence |
| --- | --- | --- |
| PAY-01 | An **ACTIVATION** E-PIN covers **registration fee + installment #1**. At signup before season starts, no extra installment E-PIN is needed. An **INSTALLMENT** E-PIN covers one additional catch-up monthly EMI. | `backend/src/auth/member-registration.service.ts`. **IMPLEMENTED**. |
| PAY-02 | Late-join catch-up uses the **season calendar** in configured business timezone: joining during month N (for monthly 18-month schedule) requires installment coverage 1…N, therefore **N−1 additional INSTALLMENT E-PINs** with the activation PIN. Example: February 2027 needs 1 extra; March needs 2. Pins must be valid, unused and same season, then are consumed once transactionally. Future monthly payments after registration use their regular payment workflow. | `requiredInstallmentCount`, `register` in `backend/src/auth/member-registration.service.ts`. **IMPLEMENTED**. |
| TOK-01 | Lucky Draw Token is a **permanent, random five-digit integer string**, 10000–99999, no leading zero. **1 confirmed paid EMI allocation → 1 token**; advance/bulk confirmed payments produce distinct tokens per allocated installment. The public receipt URL's security token, E-PIN and payment transaction reference are unrelated to this draw token. | `backend/src/lucky-draw/lucky-draw-token.util.ts`, `backend/src/lucky-draw/lucky-draw-token.service.ts`. **IMPLEMENTED**. |
| TOK-02 | **`(seasonId, token)` is the authoritative unique identity.** Same five-digit token can exist in two different seasons. Never reuse a token inside its own season, including after USED/RETIRED/refund. Duplicate generation retries; exhausted namespace must fail safely. | Migration `0034_season_scoped_lucky_draw_tokens`, `backend/test/lucky-draw-token-contract.integration-spec.ts`. **IMPLEMENTED**. |
| TOK-03 | A draw uses the token corresponding to the intended installment/season; when consumed, it is `USED` and must not be recycled. Idempotent token-ensuring reuses a previous token rather than minting a second one for a paid installment. | `backend/src/lucky-draw/lucky-draw-token.service.ts`. **IMPLEMENTED**. |
| TOK-04 | **Printed human reference = `<seasonCode>-M<2-digit installmentSequence>-<fiveDigitToken>`**. Example for a hypothetical new season: `MGC-JAN27-M01-58321`. For the EXISTING ACTIVE season, use its **actual stored code**, e.g. `MGC_202610_3FC2-M01-58321` (illustrative token only). Show the **actual 5-digit token bold green** and the complete printed reference in the receipt preview and Print/Save PDF. Never infer the token from transaction reference, never mint a new token just to render a receipt. | **LOCKED / IMPLEMENTED** for owner receipt preview + Print/Save PDF. Server formats stored token using `backend/src/lucky-draw/lucky-draw-token.util.ts`, owner receipt API returns `printedReference`, and admin shows both raw token and reference. `backend/test/lucky-draw-token-contract.integration-spec.ts` and `backend/src/owner-portal/owner-portal-finance.service.spec.ts` guard formatting/read-only linkage. **Human owner-receipt screenshot + browser Print/Save PDF preview UAT PASSED on 2026-10-06** for the first paid UAT member; broader member/public receipt and end-to-end draw UAT remain separate. |

## Time and timezone contract

| ID | Rule | Implementation/evidence |
| --- | --- | --- |
| TIME-01 | Business instants are persisted as **UTC** in MySQL `DATETIME` fields. Owner-facing finance timestamps render in the configured portal/business timezone (currently `Asia/Kolkata`). Do not derive business time from the browser locale. | E-PIN registration writes UTC DATETIME strings in `backend/src/auth/member-registration.service.ts`; finance UI formats using owner settings in `admin/components/owner-finance-portal.tsx`. **IMPLEMENTED** for new records after the timestamp fix. |
| TIME-02 | Historical/UAT timestamps already stored before a clock-fix are not silently rewritten by UI code or migrations. If transactional UAT data is later reset, re-run the scenario under the corrected clock path. | **LOCKED data-integrity rule**. |

## Receipt and payment visibility

- **View Receipt first**, then an explicit **Print / Save PDF** action below it. Print output should contain only the receipt, not the owner dashboard.
- Show company name, receipt number, member and season, date, payment mode, transaction reference, **actual authoritative allocations** (registration fee vs EMI), paid/refunded/net totals, linked lucky-draw token(s), and the printed reference from TOK-04.
- Receipts **read** existing payment-linked tokens; they must not mint a token on preview/print. If no token exists, show an explicit missing-token message and reconcile issuance separately instead of fabricating a number.
- **RECORDED** in owner payment register represents a recorded payment; it does not by itself prove that draw-token issuance or member-facing receipt has been manually verified.
- Admin receipt preview: `admin/components/owner-finance-portal.tsx`. Backend receipt read: `backend/src/owner-portal/owner-portal-finance.service.ts`. Printed human reference is **IMPLEMENTED** in admin preview/print; human UAT **PENDING**.

## Manual business UAT — evidence and remaining steps

This is a **human UAT progress note**, not a general fixture or go-live approval. Entries reflect screenshots reviewed in the project conversation on 2026-10-06, not an independent database audit.

| Step | Observation | Status |
| --- | --- | --- |
| Bootstrap root sponsor | `uatroot` created as active MEMBER, no season enrollment, no parent/slot. | Human screenshot checked |
| First public paid signup | `MGC585499` / Demo User for A created with `uatroot` sponsor, binary **A / LEFT**, active, enrolled in MegaGoldenClub 2027. | Human signup and directory screenshots checked |
| Activation payment | Screenshots show E-PIN prepaid **₹2,000** recorded; owner receipt displays **₹1,000 Registration Fee + ₹1,000 Monthly EMI** from authoritative allocations. | **Human owner-receipt UAT checked** |
| Token | Owner receipt displayed stored EMI #1 token **41483** as AVAILABLE, bold green, with printed reference **`MGC_202610_3FC2-M01-41483`**; browser print preview showed the same one-page receipt and token/reference. | **Human owner receipt + Print/Save PDF preview UAT PASS (2026-10-06)** |
| KYC | First test member initially `NOT_STARTED`. | Expected, further UAT pending |
| Additional branches, pair commissions, future EMI, member receipt, draw, winner and refunds | Not all exercised end-to-end yet. | **PENDING manual business UAT** |

## Change-control rule (important for new chats)

1. Read this document, `docs/BUSINESS-ARCHITECTURE.md`, and relevant test/migration source **before** changing identity, payments, season codes, tokens, binary or receipts.
2. Distinguish **confirmed business policy** from **currently implemented behavior** and **proposed enhancements**.
3. If there is a new business decision, update this register **and** corresponding code/tests together. Note any approved deviation explicitly; never silently change token format, uniqueness scope, fixed pair lanes or active-season identity.
4. Use GitHub branch `dev/local-foundation`; exact-SHA Backend CI + Frontend CI + Release Evidence; then operator pulls and runs root `npm run verify`. Keep production sign-off and human UAT separate.

## References

- `docs/BUSINESS-ARCHITECTURE.md` — binary and token invariants.
- `docs/UAT-CHECKLIST.md` — complete manual scenario checklist.
- `docs/STATEFUL-UAT-COVERAGE.md` — CI vs human/provider evidence matrix.
- `backend/prisma/migrations/0023_owner_management_portal/migration.sql` — unique season code.
- `backend/prisma/migrations/0034_season_scoped_lucky_draw_tokens/migration.sql` — season-scoped token uniqueness.
