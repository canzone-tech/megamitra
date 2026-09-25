#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LEGACY_BRAND='Mega''Mitra'
LEGACY_SLUG='mega''mitra'
FOREIGN_BRAND_REGEX='Fix''TradeZone|fix''tradezone|fix trade'' zone'

if git grep -n "${LEGACY_BRAND}" -- ':!backend/prisma/migrations/**'; then
  echo "ERROR: legacy product branding found outside immutable migration history"
  exit 1
fi

if git grep -ni "${LEGACY_SLUG}" -- \
  ':!backend/prisma/migrations/**' \
  ':!.env.example' \
  ':!.github/workflows/backend-ci.yml' \
  ':!backend/test/presentation.integration-spec.ts' \
  ':!docker-compose.yml'; then
  echo "ERROR: legacy product slug found outside approved persistence compatibility identifiers"
  exit 1
fi

if git grep -niE "${FOREIGN_BRAND_REGEX}" -- ':!backend/prisma/migrations/**'; then
  echo "ERROR: foreign project branding found"
  exit 1
fi

echo "MegaGoldenClub branding verification: PASS"
