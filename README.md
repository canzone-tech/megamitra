# MegaGoldenClub

MegaGoldenClub is a configurable consumer rewards and binary-network platform with a shared template-based design system across the public website, member portal, and administration console.

## Canonical business rules (read first)

**[Business Rules Register](docs/BUSINESS-RULES-REGISTER.md)** is the cross-chat source of truth for approved decisions, current implementation, pending gaps and manual business UAT progress. Read it **before changing** identity, binary, E-PIN, season code, draw-token or payment-receipt logic. Rules must be documented alongside code and test changes; prior-chat memory is not the authority.

## Architecture status

The repository is being bootstrapped from a clean initial state. The following project-level decisions are locked for the foundation:

- Frontend / member portal: Next.js + TypeScript
- Admin: Next.js + TypeScript
- Backend: NestJS + TypeScript
- API: REST initially
- Primary relational database: MySQL 8
- ORM: Prisma
- Flexible CMS/template documents: MongoDB
- Cache, queues, temporary state and rate limiting: Redis
- Authentication: JWT access/refresh tokens + Argon2 password hashing
- Infrastructure: Ubuntu 24.04 LTS, Docker, Docker Compose
- Source control / delivery: GitHub, CI/CD via GitHub Actions

## Core product principles

1. **Binary 1:4 engine** — authoritative genealogy uses four placement slots A/B/C/D. A/B aggregate to the LEFT settlement lane, C/D aggregate to the RIGHT settlement lane, and the current topology permits fixed qualifying pair lanes A:C and B:D. Pair payout, caps, carry-forward and eligibility remain versioned policy configuration.
2. **Configuration over hard-coding** — commercial values such as registration fee, monthly amount, program duration, pair payout, referral reward and daily caps are versioned configuration.
3. **Historical reproducibility** — every earning, reward and eligibility decision records the policy/version applied at that time.
4. **Financial integrity** — payments, commissions, payouts and wallet movements are represented through auditable relational records and ledger entries in MySQL.
5. **One design system** — flyer-derived MegaGoldenClub branding is implemented through reusable theme tokens, components and page templates across the full project.
6. **Template-based UI** — templates and presentation content remain separate from business logic.

## Planned repository layout

```text
megagoldenclub/
├── frontend/       # public website + member portal
├── admin/          # administration console
├── backend/        # NestJS REST API and business engines
├── database/       # schema notes, baselines and database documentation
├── infra/          # Docker, deployment and operational configuration
├── docs/           # architecture, business rules and design-system locks
├── docker-compose.yml
├── .env.example
└── README.md
```

See `docs/TECH-STACK.md`, `docs/BUSINESS-ARCHITECTURE.md`, and `docs/DESIGN-SYSTEM.md` for the current foundation locks.
