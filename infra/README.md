# MegaMitra Infrastructure

Infrastructure and deployment configuration for Ubuntu 24.04 LTS.

Planned platform services:
- MySQL 8 — authoritative relational database
- MongoDB — flexible CMS/theme/template documents
- Redis — cache, queues, locks, rate limiting and temporary state
- Docker / Docker Compose for local and deployable service orchestration
- GitHub Actions for CI/CD

Secrets must be injected through environment/secret management and must never be committed to the repository.
