# MegaGoldenClub

MegaGoldenClub is a configurable consumer rewards and binary-network platform with a shared template-based design system across the public website, member portal, and administration console.

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

1. **Binary plan engine** — every member has left/right placement legs; matching, pair value, caps, carry-forward and eligibility are policy-driven.
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
