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

echo "==> Verifying canonical UAT documentation"
node "${ROOT_DIR}/scripts/verify-uat-docs.mjs"

echo "==> Verifying integration test data isolation"
node "${ROOT_DIR}/scripts/verify-test-data-isolation.mjs"

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

echo "==> Checking for safely recoverable rank migration interruption"
node scripts/recover-failed-rank-migration.mjs

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
UAT_FIXTURE_FILE="$(mktemp -t megagoldenclub-uat-auth.XXXXXX)"
UAT_FIXTURE_READY=""
UAT_ADMIN_TOKEN_VALUE=""
UAT_MEMBER_TOKEN_VALUE=""
API_PID=""

assert_port_available() {
  node -e '
    const net = require("node:net");
    const port = Number(process.argv[1]);
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => process.exit(error ? 1 : 0));
    });
  ' "${PORT_VALUE}"
}

terminate_api() {
  if [[ -z "${API_PID}" ]]; then
    return 0
  fi

  kill -TERM -- "-${API_PID}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if ! kill -0 -- "-${API_PID}" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  kill -KILL -- "-${API_PID}" 2>/dev/null || true
  wait "${API_PID}" 2>/dev/null || true
  API_PID=""
}

cleanup_uat_fixture() {
  if [[ -z "${UAT_FIXTURE_READY}" ]]; then
    rm -f "${UAT_FIXTURE_FILE}"
    return 0
  fi
  npx ts-node scripts/uat-auth-fixture.ts cleanup "${UAT_FIXTURE_FILE}"
  UAT_FIXTURE_READY=""
  UAT_ADMIN_TOKEN_VALUE=""
  UAT_MEMBER_TOKEN_VALUE=""
  rm -f "${UAT_FIXTURE_FILE}"
}

cleanup() {
  terminate_api
  if [[ -n "${UAT_FIXTURE_READY}" ]]; then
    npx ts-node scripts/uat-auth-fixture.ts cleanup "${UAT_FIXTURE_FILE}" >/dev/null 2>&1 || true
    UAT_FIXTURE_READY=""
  fi
  rm -f "${UAT_FIXTURE_FILE}" "${LOG_FILE}"
}
trap cleanup EXIT INT TERM

if ! assert_port_available; then
  echo "ERROR: port ${PORT_VALUE} is already in use before compiled API verification"
  exit 1
fi

echo "==> Creating ephemeral authenticated UAT principals"
npx ts-node scripts/uat-auth-fixture.ts create "${UAT_FIXTURE_FILE}"
UAT_FIXTURE_READY=1
UAT_ADMIN_TOKEN_VALUE="$(node -e 'const fs=require("fs"); const state=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(state.admin.accessToken || "")' "${UAT_FIXTURE_FILE}")"
UAT_MEMBER_TOKEN_VALUE="$(node -e 'const fs=require("fs"); const state=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(state.member.accessToken || "")' "${UAT_FIXTURE_FILE}")"
if [[ -z "${UAT_ADMIN_TOKEN_VALUE}" || -z "${UAT_MEMBER_TOKEN_VALUE}" ]]; then
  echo "ERROR: authenticated UAT fixture did not produce both access tokens"
  exit 1
fi

echo "==> Booting compiled API on port ${PORT_VALUE}"
setsid npm run start:prod >"${LOG_FILE}" 2>&1 &
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
MEGAGOLDENCLUB_UAT_BASE_URL="http://127.0.0.1:${PORT_VALUE}" \
UAT_ADMIN_TOKEN="${UAT_ADMIN_TOKEN_VALUE}" \
UAT_MEMBER_TOKEN="${UAT_MEMBER_TOKEN_VALUE}" \
./scripts/uat-smoke.sh

echo "==> Verifying compiled API cleanup"
terminate_api
echo "==> Cleaning authenticated UAT principals"
if ! cleanup_uat_fixture; then
  echo "ERROR: authenticated UAT fixture cleanup failed"
  exit 1
fi
rm -f "${LOG_FILE}"
trap - EXIT INT TERM
if ! assert_port_available; then
  echo "ERROR: verification left port ${PORT_VALUE} in use"
  exit 1
fi

echo "MegaGoldenClub local backend verification: PASS"
