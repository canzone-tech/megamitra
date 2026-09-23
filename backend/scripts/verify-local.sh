#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "ERROR: ${ROOT_DIR}/.env is missing"
  exit 1
fi

if [[ ! -e .env ]]; then
  ln -s ../.env .env
fi

echo "==> Starting MegaMitra data services"
docker compose --env-file "${ROOT_DIR}/.env" -f "${ROOT_DIR}/docker-compose.yml" up -d

echo "==> Installing exact backend dependencies"
npm ci

echo "==> Checking patched transitive dependency versions"
npm ls deepmerge-ts mariadb mysql2

echo "==> Validating and generating Prisma client"
npm run prisma:validate
npm run prisma:generate

echo "==> Applying pending MegaMitra migrations"
npx prisma migrate deploy
npx prisma migrate status

echo "==> Checking MegaMitra-only branding"
# Exclude this verifier itself because the forbidden-brand regex is defined below.
if grep -RniE 'FixTradeZone|fixtradezone|fix trade zone' src prisma scripts test package.json \
  --exclude-dir=generated \
  --exclude=verify-local.sh; then
  echo "ERROR: foreign project branding found"
  exit 1
fi

echo "==> Lint"
npm run lint

echo "==> Unit tests"
npm test -- --runInBand

echo "==> Integration tests"
npm run test:integration

echo "==> Build"
npm run build

PORT_VALUE="$(grep -E '^PORT=' .env | tail -n1 | cut -d= -f2- || true)"
PORT_VALUE="${PORT_VALUE:-3100}"
LOG_FILE="$(mktemp -t megamitra-api.XXXXXX.log)"
API_PID=""

cleanup() {
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
    wait "${API_PID}" 2>/dev/null || true
  fi
  rm -f "${LOG_FILE}"
}
trap cleanup EXIT INT TERM

echo "==> Booting compiled API on port ${PORT_VALUE}"
npm run start:prod >"${LOG_FILE}" 2>&1 &
API_PID=$!

HEALTH=""
for _ in $(seq 1 30); do
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "ERROR: MegaMitra API exited during startup"
    cat "${LOG_FILE}"
    exit 1
  fi
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT_VALUE}/health" 2>/dev/null || true)"
  if [[ "${HEALTH}" == *'"service":"megamitra-api"'* ]] && [[ "${HEALTH}" == *'"mysql":"up"'* ]] && [[ "${HEALTH}" == *'"redis":"up"'* ]]; then
    break
  fi
  sleep 1
done

if [[ "${HEALTH}" != *'"service":"megamitra-api"'* ]]; then
  echo "ERROR: MegaMitra health endpoint did not become ready"
  cat "${LOG_FILE}"
  exit 1
fi

printf '%s\n' "${HEALTH}"
echo "MegaMitra local backend verification: PASS"
