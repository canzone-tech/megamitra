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

echo "==> Validating operational shell scripts"
bash -n scripts/*.sh

echo "==> Starting MegaGoldenClub data services"
docker compose --env-file "${ROOT_DIR}/.env" -f "${ROOT_DIR}/docker-compose.yml" up -d

echo "==> Verifying MongoDB presentation store"
MONGO_READY=""
for _ in $(seq 1 30); do
  MONGO_READY="$(docker compose --env-file "${ROOT_DIR}/.env" -f "${ROOT_DIR}/docker-compose.yml" exec -T mongodb mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null || true)"
  if [[ "${MONGO_READY}" == *"1"* ]]; then
    break
  fi
  sleep 1
done
if [[ "${MONGO_READY}" != *"1"* ]]; then
  echo "ERROR: MongoDB presentation store did not become ready"
  docker compose --env-file "${ROOT_DIR}/.env" -f "${ROOT_DIR}/docker-compose.yml" ps
  exit 1
fi

echo "==> Installing exact backend dependencies"
npm ci

echo "==> Checking patched transitive dependency versions"
npm ls deepmerge-ts mariadb mongodb mysql2

echo "==> Validating and generating Prisma client"
npm run prisma:validate
npm run prisma:generate

echo "==> Applying pending MegaGoldenClub migrations"
npx prisma migrate deploy
npx prisma migrate status

echo "==> Checking MegaGoldenClub branding contract"
bash "${ROOT_DIR}/scripts/verify-branding.sh"

echo "==> Lint"
npm run lint

echo "==> Unit tests"
npm test -- --runInBand

echo "==> Integration tests"
npm run test:integration

echo "==> Cleaning backend build artifacts"
rm -rf dist
find . -maxdepth 1 -type f -name '*.tsbuildinfo' -delete

echo "==> Build backend"
npm run build

echo "==> Verifying compiled production entrypoint"
if [[ ! -f dist/main.js ]]; then
  echo "ERROR: expected compiled API entrypoint backend/dist/main.js was not produced"
  find dist -maxdepth 3 -type f -name 'main.js' -print 2>/dev/null || true
  exit 1
fi

echo "==> Verify Next.js admin and public/member apps"
bash "${ROOT_DIR}/scripts/verify-frontends.sh"

PORT_VALUE="$(grep -E '^PORT=' .env | tail -n1 | cut -d= -f2- || true)"
PORT_VALUE="${PORT_VALUE:-3100}"
LOG_FILE="$(mktemp -t megagoldenclub-api.XXXXXX.log)"
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
    echo "ERROR: MegaGoldenClub API exited during startup"
    cat "${LOG_FILE}"
    exit 1
  fi
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT_VALUE}/health/ready" 2>/dev/null || true)"
  if [[ "${HEALTH}" == *'"service":"megagoldenclub-api"'* ]] && \
     [[ "${HEALTH}" == *'"mysql":"up"'* ]] && \
     [[ "${HEALTH}" == *'"redis":"up"'* ]] && \
     [[ "${HEALTH}" == *'"mongodb":"up"'* ]]; then
    break
  fi
  sleep 1
done

if [[ "${HEALTH}" != *'"service":"megagoldenclub-api"'* ]]; then
  echo "ERROR: MegaGoldenClub readiness endpoint did not become ready"
  cat "${LOG_FILE}"
  exit 1
fi

printf '%s\n' "${HEALTH}"
MEGAGOLDENCLUB_UAT_BASE_URL="http://127.0.0.1:${PORT_VALUE}" ./scripts/uat-smoke.sh
echo "MegaGoldenClub local backend verification: PASS"
