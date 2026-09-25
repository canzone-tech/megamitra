# MegaGoldenClub — Configurable Binary Business Architecture

## Product model

MegaGoldenClub combines:

1. a consumer/rewards program with installments, products, draws, prizes and fulfilment; and
2. a configurable binary-network compensation layer for eligible members/partners.

The source flyer/plan is treated as the first configuration, not as hard-coded software behavior.

## Binary genealogy

Each binary-network member has two placement legs:

```text
             MEMBER
            /      \
         LEFT      RIGHT
```

A qualifying pair is formed according to the published pair policy. The initial plan concept is 1 qualifying unit on the left plus 1 qualifying unit on the right, but the engine must support policy-driven ratios and qualification rules.

### Binary data that must be persisted
- sponsor relationship
- placement parent
- placement side: LEFT / RIGHT
- genealogy ancestry / traversal support
- qualifying volume events
- consumed/matched volume
- carry-forward volume
- matched pair events
- paid pair events
- policy version used
- adjustments / reversals

Genealogy placement history must be auditable and must not be casually rewritten after financial events depend on it.

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
- qualifying unit definition
- left/right pairing ratio
- pair value
- per-pair payout
- daily/monthly pair caps
- carry-forward enabled/disabled
- carry-forward expiry
- flush behavior
- inactive-member behavior
- qualification rules

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

must be possible through configuration/version publishing rather than source-code deployment.

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

## Admin configuration principle

> Code defines the rule capabilities; administrators configure and publish the actual business plan.

The admin UI must therefore expose controlled versioned editors rather than raw database fields.
