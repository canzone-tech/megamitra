# MegaGoldenClub — Configurable Binary Business Architecture

> **Change-control source:** [Business Rules Register](BUSINESS-RULES-REGISTER.md) tracks confirmed contracts, implemented behavior, pending gaps and manual UAT. Read both documents before modifying season identity, lucky-draw tokens, E-PINs or binary rules.

## Product model

MegaGoldenClub combines:

1. a consumer/rewards program with installments, products, draws, prizes and fulfilment; and
2. a configurable binary-network compensation layer for eligible members/partners.

The source flyer/plan is treated as the first configuration, not as hard-coded software behavior.

## Binary 1:4 genealogy

The authoritative genealogy topology is 1:4. Each placement parent can directly hold four ordered slots:

```text
                    MEMBER
          /           |           |           \
       A              B           C             D
     LEFT           LEFT        RIGHT         RIGHT
```

Slots `A/B/C/D` are the placement authority. `LEFT/RIGHT` remains a derived aggregate dimension used by the existing volume, settlement and historical reporting engine:

- `A` -> `LEFT`
- `B` -> `LEFT`
- `C` -> `RIGHT`
- `D` -> `RIGHT`

The current MegaGoldenClub 1:4 business topology has two fixed qualifying pair lanes:

- `A:C`
- `B:D`

Generic cross-pairing is not part of the current plan. The genealogy topology and lane identity must not be redefined by a generic left/right ratio editor. Commercial behavior such as payout amount, caps, carry-forward and eligibility remains versioned configuration.

Auto-placement traverses the genealogy breadth-first and fills the first available slot in deterministic order `A -> B -> C -> D` before continuing below existing children.

### Binary data that must be persisted

- sponsor relationship
- placement parent
- authoritative placement slot: `A / B / C / D`
- derived aggregate settlement side: `LEFT / RIGHT`
- genealogy ancestry / traversal support
- first-leg slot and first-leg aggregate side for ancestry propagation
- qualifying volume events
- consumed/matched volume
- carry-forward volume
- matched pair events
- paid pair events
- policy version used
- adjustments / reversals

Genealogy placement history must be auditable and must not be casually rewritten after financial events depend on it. Legacy LEFT/RIGHT compatibility must never override an already-persisted authoritative slot.

## Versioned policy engines

### Program policy

Configurable fields include:

- program code/name
- registration/joining fee
- recurring installment amount
- duration
- grace period
- start/end/effective dates
- product/reward entitlement rules
- active/paused/closed state

### Referral policy

- fixed amount or percentage
- qualifying-event definition
- eligibility requirements
- holding / refund period
- effective dates

### Binary / pair policy

The 1:4 topology contract is fixed at the platform layer for the current MegaGoldenClub plan:

- four placement slots `A/B/C/D`
- `A/B = LEFT`, `C/D = RIGHT`
- qualifying lanes `A:C` and `B:D`
- one qualifying unit per lane side for the current 1:4 model
- generic cross-pairing disabled

Versioned policy configuration controls commercial and settlement behavior such as:

- qualifying unit definition within the supported topology contract
- pair value / pair payout amount
- daily/monthly pair caps
- carry-forward enabled/disabled
- carry-forward expiry
- flush behavior
- inactive-member behavior
- qualification rules that do not change the authoritative topology
- settlement timezone and currency

### Eligibility policy

Used by commissions, rewards, draws and payouts. Rule inputs may include:

- account status
- KYC status
- payment/installment status
- refund/cancellation state
- program/subscription state
- direct referral requirements
- configurable business qualifications

### Lucky-draw policy

- campaign
- round/month
- draw date and cutoff
- eligible-entry rules
- repeat-winner policy
- prize groups and quantities
- consolation-prize rules
- winner state and fulfilment state

### Lucky-draw token identity

Lucky-draw entry tokens are permanent business identifiers, separate from the long random security token used by a public receipt URL.

- Every production lucky-draw token is exactly five decimal digits.
- The first digit is never zero; the valid namespace is `10000` through `99999`.
- A token is unique within its Season. The authoritative identity is `seasonId + token`; the same five-digit number may be reused by a different Season.
- Within one Season, once issued, a token is never recycled, even after use, cancellation, refund, rejection, archival or historical cleanup.
- A confirmed installment payment receives one token per confirmed installment allocation. An advance/bulk payment therefore receives multiple different tokens rather than reusing one token across future draws.
- When an owner monthly draw consumes the token corresponding to that installment sequence, the token becomes `USED` and remains permanently recorded.
- Historical/generic draw entries that are not Season-bound remain in the legacy global token scope. Season-bound owner draws always resolve tokens inside their `seasonId` scope.
- The five-digit namespace contains 90,000 possible values per Season. Exhaustion inside a Season is a hard error; the system must never silently recycle a token within that Season or expand the format without an explicit business-contract revision.

## Policy lifecycle

Policies use explicit lifecycle states such as:

```text
DRAFT -> PUBLISHED -> RETIRED
```

Publishing creates an immutable business reference. Existing historical records continue to reference the version that was effective when they were created.

Changes such as:

- pair payout 100 -> 125
- daily cap 50 -> 40
- referral reward 250 -> 300
- duration 18 -> 24 months

must be possible through configuration/version publishing rather than source-code deployment. Changes to the locked 1:4 topology itself are not ordinary business-policy edits and require an explicit platform contract revision and migration strategy.

## Suggested backend modules

```text
Auth
Users
RBAC
KYC
Programs
Subscriptions
Payments
Products
Entitlements
Referrals
BinaryGenealogy
BinaryVolume
CommissionPolicies
CommissionEngine
Rewards
Eligibility
DrawCampaigns
DrawEngine
PrizeFulfilment
Wallet
Ledger
Withdrawals
Payouts
Audit
CMSIntegration
SystemConfiguration
```

## Calculation invariants

1. The calculation engine consumes published policy versions only.
2. Every earning event has an idempotent source key.
3. Pair volume cannot be paid twice.
4. Refunds/cancellations create explicit reversal/adjustment events; history is not silently deleted.
5. Caps are applied by the effective policy and recorded with the settlement.
6. Carry-forward is a state derived from verified volume and prior consumption.
7. Financial outcomes are written transactionally with the ledger where money is credited/debited.
8. Reprocessing the same event must not duplicate earnings.
9. Authoritative placement capacity is four direct slots per parent, not two aggregate sides.
10. Slot-to-side mapping is deterministic: `A/B -> LEFT`, `C/D -> RIGHT`.
11. Current 1:4 pair matching is lane-bound to `A:C` and `B:D`; generic cross-pairing is rejected.
12. Placement and ancestry records retain slot identity even when downstream settlement aggregates by LEFT/RIGHT.
13. Lucky-draw tokens match `^[1-9][0-9]{4}$` and are unique within their Season for their entire lifetime; authoritative uniqueness is `(seasonId, token)`, and the same five-digit token may exist in a different Season.
14. A lucky-draw token is consumed at most once and is never deleted/recycled by application workflows.
15. Bulk installment confirmation creates distinct tokens for distinct installment allocations; one token is never reused for multiple scheduled draws.

## Admin configuration principle

> Code defines the rule capabilities; administrators configure and publish the actual business plan.

The admin UI must therefore expose controlled versioned editors rather than raw database fields. It may configure commercial values and supported policy rules, but it must not present the locked 1:4 topology as an arbitrary generic left/right ratio.
