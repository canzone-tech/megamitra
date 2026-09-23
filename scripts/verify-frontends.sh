#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

verify_app() {
  local name="$1"
  local dir="$2"

  echo "==> Installing exact ${name} dependencies"
  npm --prefix "${dir}" install --no-package-lock --include=dev

  echo "==> Linting ${name}"
  npm --prefix "${dir}" run lint

  echo "==> Type-checking ${name}"
  npm --prefix "${dir}" run typecheck

  echo "==> Building ${name}"
  npm --prefix "${dir}" run build
}

FORBIDDEN_REGEX='Fix''TradeZone|fix''tradezone|fix trade zone'
if grep -RniE "${FORBIDDEN_REGEX}" "${ROOT_DIR}/admin" "${ROOT_DIR}/frontend" "${ROOT_DIR}/packages" \
  --exclude-dir=node_modules --exclude-dir=.next; then
  echo "ERROR: foreign project branding found in frontend foundation"
  exit 1
fi

verify_app "MegaMitra admin" "${ROOT_DIR}/admin"
verify_app "MegaMitra public/member web" "${ROOT_DIR}/frontend"

echo "MegaMitra frontend verification: PASS"
