#!/usr/bin/env bash
set -euo pipefail

# CI-only disposable smoke test of the EXACT bytes shipped to production.
if [[ "${NODE_ENV:-}" != test ]]; then
  echo 'ERROR: artifact runtime smoke is restricted to NODE_ENV=test' >&2
  exit 1
fi

RELEASE_DIR="${1:?Usage: verify-production-artifact.sh /absolute/runtime/directory}"
for needed in api/dist/main.js admin/server.js member/server.js RELEASE_SHA; do
  test -f "${RELEASE_DIR}/${needed}" || {
    echo "ERROR: missing runtime output ${needed}" >&2
    exit 1
  }
done
for app in admin member; do
  test -d "${RELEASE_DIR}/${app}/.next/static" || {
    echo "ERROR: missing ${app} production static assets" >&2; exit 1;
  }
done

declare -a PIDS=()
LOG_API="$(mktemp -t megagoldenclub-artifact-api.XXXXXX.log)"
LOG_ADMIN="$(mktemp -t megagoldenclub-artifact-admin.XXXXXX.log)"
LOG_MEMBER="$(mktemp -t megagoldenclub-artifact-member.XXXXXX.log)"
cleanup() {
  for pid in "${PIDS[@]}"; do
    kill -TERM -- "-${pid}" 2>/dev/null || true
  done
  for pid in "${PIDS[@]}"; do wait "${pid}" 2>/dev/null || true; done
  rm -f "${LOG_API}" "${LOG_ADMIN}" "${LOG_MEMBER}"
}
trap cleanup EXIT INT TERM

(
  cd "${RELEASE_DIR}/api"
  PORT=3210 setsid node dist/main.js
) >"${LOG_API}" 2>&1 &
PIDS+=("$!")

for spec in 'admin:3211' 'member:3212'; do
  app="${spec%%:*}"
  port="${spec##*:}"
  log="${LOG_ADMIN}"
  if [[ "${app}" == member ]]; then log="${LOG_MEMBER}"; fi
  (
    cd "${RELEASE_DIR}/${app}"
    NODE_ENV=production HOSTNAME=127.0.0.1 PORT="${port}" \
      MEGAGOLDENCLUB_API_URL=http://127.0.0.1:3210 setsid node server.js
  ) >"${log}" 2>&1 &
  PIDS+=("$!")
done

wait_for() {
  local url="$1" expected="$2" label="$3"
  local code=""
  for _ in $(seq 1 60); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true)"
    if [[ "${code}" == "${expected}" ]]; then
      echo "PASS: ${label}"
      return 0
    fi
    for pid in "${PIDS[@]}"; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        echo "ERROR: runtime process exited before ${label}" >&2
        cat "${LOG_API}" "${LOG_ADMIN}" "${LOG_MEMBER}" >&2
        exit 1
      fi
    done
    sleep 1
  done
  echo "ERROR: ${label} expected HTTP ${expected}, got ${code}" >&2
  cat "${LOG_API}" "${LOG_ADMIN}" "${LOG_MEMBER}" >&2
  exit 1
}

wait_for http://127.0.0.1:3210/health/ready 200 'artifact API remote-compatible readiness'
if ! curl -fsS http://127.0.0.1:3210/health/ready |
    grep -q '"mysql":"up".*"redis":"up".*"mongodb":"up"'; then
  echo 'ERROR: packaged API dependencies are not ready' >&2
  exit 1
fi
wait_for http://127.0.0.1:3211/login 200 'artifact Admin SSR'
wait_for http://127.0.0.1:3212/login 200 'artifact Member SSR'
wait_for http://127.0.0.1:3211/portal/binary 307 'artifact protected Admin Genealogy'
wait_for http://127.0.0.1:3212/member/genealogy 307 'artifact protected Member Genealogy'

for url in http://127.0.0.1:3211/login http://127.0.0.1:3212/login; do
  if ! curl -fsS -D - -o /dev/null "${url}" | tr -d '\r' |
    grep -qi '^x-content-type-options: nosniff$'; then
    echo "ERROR: source-free runtime security header missing for ${url}" >&2
    exit 1
  fi
done
echo 'MegaGoldenClub packaged runtime smoke: PASS'
