# MegaGoldenClub — Technology & Data Architecture Lock

## Locked technology stack

### Runtime / operating environment
- Ubuntu 24.04 LTS
- Docker
- Docker Compose

### Public frontend and member portal
- Next.js
- TypeScript

### Admin console
- Next.js
- TypeScript

### Backend
- NestJS
- TypeScript
- REST API initially

### Data layer
- MySQL 8 — primary system of record for relational, financial and business-state data
- Prisma — ORM / schema tooling for MySQL
- MongoDB — flexible CMS, theme, template and presentation documents
- Redis — cache, queues, temporary state, distributed coordination and rate limiting

### Authentication
- JWT access tokens
- JWT refresh tokens
- Argon2 password hashing

### Delivery
- Git / GitHub
- GitHub Actions for CI/CD

## Database ownership rules

### MySQL is authoritative for
- users, roles, permissions and KYC state
- binary genealogy / placements
- programs and program versions
- subscriptions / enrollments
- fees and installments
- referral relationships
- pair-volume accounting and matched pairs
- commission-plan versions and applied rules
- eligibility decisions
- payments, refunds and adjustments
- wallets and immutable ledger entries
- withdrawals and payouts
- rewards and entitlements
- draw campaigns, rounds, entries, winners and fulfilment
- products and prize catalogue references
- audit logs and material configuration-version metadata

Business and financial truth MUST NOT depend on MongoDB or Redis.

### MongoDB is for flexible presentation content
- landing-page templates
- themes and style configuration
- CMS sections
- page composition
- media metadata where appropriate
- template/page version documents

MongoDB must not be the authoritative store for balances, commissions, binary volume, payouts, eligibility outcomes or accounting.

### Redis is non-authoritative
Redis may be used for:
- caching
- queues / background jobs
- rate limiting
- distributed locks
- temporary/session state
- short-lived computed data

Any material business outcome must ultimately be persisted in MySQL.

## Configuration and versioning rule

Commercial values must not be hard-coded in application logic. Examples:
- registration / joining fee
- monthly installment
- program duration
- referral reward
- pair payout
- pair ratio
- daily / monthly caps
- carry-forward policy
- qualification / eligibility requirements
- draw eligibility requirements

Application code defines the supported rule types. Published configuration defines the current business plan.

Every material financial/business event must retain references to the effective configuration version(s) used for the calculation so historical results remain reproducible.

## Financial integrity rule

Money-moving operations follow:

```text
Business Event
    -> validated calculation
    -> immutable financial/commission event
    -> ledger transaction / entries
    -> derived or controlled wallet state
```

Direct, unaudited mutation of a member balance is not an accepted architecture pattern.
