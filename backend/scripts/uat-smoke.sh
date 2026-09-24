#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MEGAMITRA_UAT_BASE_URL:-http://127.0.0.1:${PORT:-3100}}"
HEADERS_FILE="$(mktemp -t megamitra-uat-headers.XXXXXX)"
BODY_FILE="$(mktemp -t megamitra-uat-body.XXXXXX)"

cleanup() {
  rm -f "${HEADERS_FILE}" "${BODY_FILE}"
}
trap cleanup EXIT INT TERM

request() {
  local expected="$1"
  local path="$2"
  local token="${3:-}"
  local request_id="uat-$(date +%s%N)"
  local args=(-sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' -H "X-Request-Id: ${request_id}")
  if [[ -n "${token}" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi
  local status
  status="$(curl "${args[@]}" "${BASE_URL}${path}")"
  if [[ "${status}" != "${expected}" ]]; then
    echo "ERROR: ${path} returned ${status}; expected ${expected}"
    cat "${BODY_FILE}"
    exit 1
  fi
  if ! tr -d '\r' < "${HEADERS_FILE}" | grep -qi "^x-request-id: ${request_id}$"; then
    echo "ERROR: ${path} did not preserve the request correlation id"
    exit 1
  fi
  if ! tr -d '\r' < "${HEADERS_FILE}" | grep -qi '^x-content-type-options: nosniff$'; then
    echo "ERROR: ${path} is missing X-Content-Type-Options"
    exit 1
  fi
}

printf '%s\n' "==> UAT smoke: liveness"
request 200 /health/live
if ! grep -q '"status":"ok"' "${BODY_FILE}"; then
  echo "ERROR: liveness payload is not healthy"
  exit 1
fi

printf '%s\n' "==> UAT smoke: dependency readiness"
request 200 /health/ready
for dependency in mysql redis mongodb; do
  if ! grep -q "\"${dependency}\":\"up\"" "${BODY_FILE}"; then
    echo "ERROR: ${dependency} is not ready"
    cat "${BODY_FILE}"
    exit 1
  fi
done

printf '%s\n' "==> UAT smoke: protected API boundary"
request 401 /auth/me

if [[ -n "${UAT_ADMIN_TOKEN:-}" ]]; then
  printf '%s\n' "==> UAT smoke: admin operations read"
  request 200 /admin/operations/summary "${UAT_ADMIN_TOKEN}"
else
  printf '%s\n' "==> UAT admin token not supplied; authenticated admin smoke skipped"
fi

if [[ -n "${UAT_MEMBER_TOKEN:-}" ]]; then
  printf '%s\n' "==> UAT smoke: member dashboard read"
  request 200 /member/dashboard "${UAT_MEMBER_TOKEN}"
else
  printf '%s\n' "==> UAT member token not supplied; authenticated member smoke skipped"
fi

printf '%s\n' "MegaMitra UAT smoke: PASS"
