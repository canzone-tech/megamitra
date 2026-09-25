# MegaGoldenClub Database

Database documentation, relational schema notes, migration/baseline guidance and data-integrity decisions belong here.

Primary source of truth: MySQL 8.

Key domains include users/RBAC, program versions, binary genealogy, qualifying volume, pair settlements, commission policies, eligibility decisions, payments/refunds, ledger/wallets, payouts, rewards, draw campaigns/entries/winners, products/prizes and audit history.

All money fields must use exact decimal representations; historical financial and commission events must remain auditable and reproducible.
