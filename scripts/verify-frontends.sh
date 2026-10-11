#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
ADMIN_PID=""
MEMBER_PID=""
ADMIN_LOG=""
MEMBER_LOG=""
LEGACY_UI_BRAND='Mega''Mitra'

cleanup_smoke() {
  if [[ -n "${ADMIN_PID}" ]] && kill -0 "${ADMIN_PID}" 2>/dev/null; then
    kill -- -"${ADMIN_PID}" 2>/dev/null || true
    wait "${ADMIN_PID}" 2>/dev/null || true
  fi
  if [[ -n "${MEMBER_PID}" ]] && kill -0 "${MEMBER_PID}" 2>/dev/null; then
    kill -- -"${MEMBER_PID}" 2>/dev/null || true
    wait "${MEMBER_PID}" 2>/dev/null || true
  fi
  [[ -z "${ADMIN_LOG}" ]] || rm -f "${ADMIN_LOG}"
  [[ -z "${MEMBER_LOG}" ]] || rm -f "${MEMBER_LOG}"
}

verify_token_copy() {
  local target="$1"
  if ! cmp -s "${ROOT_DIR}/packages/design-tokens/tokens.css" "${target}"; then
    echo "ERROR: MegaGoldenClub design token copy drifted from canonical tokens.css: ${target}"
    exit 1
  fi
}

verify_app() {
  local name="$1"
  local dir="$2"

  if [[ ! -f "${dir}/package-lock.json" ]]; then
    echo "ERROR: missing deterministic dependency lockfile: ${dir}/package-lock.json"
    exit 1
  fi

  echo "==> Installing exact ${name} dependencies"
  npm --prefix "${dir}" ci --include=dev --no-audit --no-fund

  echo "==> Linting ${name}"
  npm --prefix "${dir}" run lint

  echo "==> Type-checking ${name}"
  npm --prefix "${dir}" run typecheck

  echo "==> Building ${name}"
  npm --prefix "${dir}" run build
}

wait_for_url() {
  local url="$1"
  local pid="$2"
  local log="$3"
  for _ in $(seq 1 30); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "ERROR: frontend process exited while waiting for ${url}"
      cat "${log}"
      exit 1
    fi
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: frontend route did not become ready: ${url}"
  cat "${log}"
  exit 1
}

expect_status() {
  local expected="$1"
  shift
  local actual
  actual="$(curl -sS -o /dev/null -w '%{http_code}' "$@")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "ERROR: expected HTTP ${expected}, got ${actual}: curl $*"
    exit 1
  fi
}

expect_security_headers() {
  local url="$1"
  local headers
  headers="$(curl -sS -D - -o /dev/null "${url}" | tr -d '\r')"
  if ! grep -qi '^x-content-type-options: nosniff$' <<<"${headers}"; then
    echo "ERROR: missing X-Content-Type-Options on ${url}"
    exit 1
  fi
  if ! grep -qi '^x-frame-options: DENY$' <<<"${headers}"; then
    echo "ERROR: missing X-Frame-Options on ${url}"
    exit 1
  fi
  if grep -qi '^x-powered-by:' <<<"${headers}"; then
    echo "ERROR: framework powered-by header leaked on ${url}"
    exit 1
  fi
}

expect_body_text() {
  local url="$1"
  local text="$2"
  if ! curl -fsS "${url}" | grep -Fq -- "${text}"; then
    echo "ERROR: expected rendered text not found on ${url}: ${text}"
    exit 1
  fi
}

expect_body_absent() {
  local url="$1"
  local text="$2"
  if curl -fsS "${url}" | grep -Fiq -- "${text}"; then
    echo "ERROR: forbidden rendered text found on ${url}: ${text}"
    exit 1
  fi
}

expect_post_form() {
  local url="$1"
  if ! curl -fsS "${url}" | grep -Eq '<form[^>]*method="post"'; then
    echo "ERROR: rendered auth form does not declare method=post on ${url}"
    exit 1
  fi
}

smoke_frontends() {
  echo "==> Smoke-testing production Next.js routes"
  ADMIN_LOG="$(mktemp -t megagoldenclub-admin.XXXXXX.log)"
  MEMBER_LOG="$(mktemp -t megagoldenclub-member.XXXXXX.log)"
  trap cleanup_smoke EXIT INT TERM

  # Existing local dev instances must remain untouched. Use the shared API
  # verify-port fallback instead of assuming ports 3101/3102 are free.
  local admin_port member_port admin_base_url member_base_url
  admin_port="$(node "${ROOT_DIR}/backend/scripts/select-verify-port.mjs" 3101)"
  member_port="$(node "${ROOT_DIR}/backend/scripts/select-verify-port.mjs" 3102)"
  if [[ "${admin_port}" == "${member_port}" ]]; then
    echo 'ERROR: Admin and Member smoke selected the same port' >&2
    exit 1
  fi
  admin_base_url="http://127.0.0.1:${admin_port}"
  member_base_url="http://127.0.0.1:${member_port}"

  setsid bash -c 'cd "$1"; exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$2"' \
    _ "${ROOT_DIR}/admin" "${admin_port}" >"${ADMIN_LOG}" 2>&1 &
  ADMIN_PID=$!
  setsid bash -c 'cd "$1"; exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$2"' \
    _ "${ROOT_DIR}/frontend" "${member_port}" >"${MEMBER_LOG}" 2>&1 &
  MEMBER_PID=$!

  wait_for_url "${admin_base_url}/login" "${ADMIN_PID}" "${ADMIN_LOG}"
  wait_for_url "${member_base_url}/" "${MEMBER_PID}" "${MEMBER_LOG}"
  expect_security_headers "${admin_base_url}/login"
  expect_security_headers "${member_base_url}/"

  expect_body_text "${admin_base_url}/login" "MegaGoldenClub"
  expect_body_absent "${admin_base_url}/login" "${LEGACY_UI_BRAND}"
  expect_body_absent "${admin_base_url}/login" "HttpOnly"
  expect_body_absent "${admin_base_url}/login" "verified by the API"
  expect_post_form "${admin_base_url}/login"
  expect_body_text "${member_base_url}/login" "MegaGoldenClub"
  expect_body_absent "${member_base_url}/login" "${LEGACY_UI_BRAND}"
  expect_body_absent "${member_base_url}/login" "HttpOnly"
  expect_post_form "${member_base_url}/login"
  expect_body_text "${member_base_url}/" "MegaGoldenClub"
  expect_body_absent "${member_base_url}/" "${LEGACY_UI_BRAND}"

  expect_status 307 "${admin_base_url}/operations"
  expect_status 307 "${admin_base_url}/business-plan"
  expect_status 307 "${admin_base_url}/presentation"
  expect_status 307 "${admin_base_url}/kyc"
  expect_status 307 "${admin_base_url}/withdrawals"
  expect_status 307 "${admin_base_url}/entitlements"
  expect_status 307 "${admin_base_url}/security"
  expect_status 200 "${admin_base_url}/forgot-password"
  expect_status 200 "${admin_base_url}/request-email-verification"

  expect_status 307 "${member_base_url}/member"
  expect_status 307 "${member_base_url}/member/payments"
  expect_status 307 "${member_base_url}/member/change-password"
  expect_status 307 "${member_base_url}/member/kyc"
  expect_status 307 "${member_base_url}/member/withdrawals"
  expect_status 307 "${member_base_url}/member/entitlements"
  expect_status 307 "${member_base_url}/member/security"
  expect_status 200 "${member_base_url}/forgot-password"
  expect_status 200 "${member_base_url}/request-email-verification"
  expect_status 200 "${member_base_url}/reset-password?token=smoke-test-token"
  expect_status 200 "${member_base_url}/verify-email?token=smoke-test-token"
  expect_status 200 "${member_base_url}/confirm-email-change?token=smoke-test-token"

  expect_status 400 -X POST -H 'content-type: application/json' --data '{' "${admin_base_url}/api/session/login"
  expect_status 400 -X POST -H 'content-type: application/json' --data '{' "${member_base_url}/api/session/login"

  cleanup_smoke
  trap - EXIT INT TERM
  ADMIN_PID=""
  MEMBER_PID=""
  ADMIN_LOG=""
  MEMBER_LOG=""
}

echo "==> Verifying MegaGoldenClub branding contract"
bash "${ROOT_DIR}/scripts/verify-branding.sh"
echo "==> Verifying frontend privacy and native-form safety"
node "${ROOT_DIR}/scripts/verify-frontend-safety.mjs"

echo "==> Verifying semantic UI iconography"
node "${ROOT_DIR}/scripts/verify-ui-iconography.mjs"

echo "==> Verifying shared MegaGoldenClub design token contract"
verify_token_copy "${ROOT_DIR}/admin/app/tokens.css"
verify_token_copy "${ROOT_DIR}/frontend/app/tokens.css"

verify_app "MegaGoldenClub admin" "${ROOT_DIR}/admin"
verify_app "MegaGoldenClub public/member web" "${ROOT_DIR}/frontend"
smoke_frontends

echo "MegaGoldenClub frontend verification: PASS"
