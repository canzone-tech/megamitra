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

  setsid npm --prefix "${ROOT_DIR}/admin" run start >"${ADMIN_LOG}" 2>&1 &
  ADMIN_PID=$!
  setsid npm --prefix "${ROOT_DIR}/frontend" run start >"${MEMBER_LOG}" 2>&1 &
  MEMBER_PID=$!

  wait_for_url "http://127.0.0.1:3101/login" "${ADMIN_PID}" "${ADMIN_LOG}"
  wait_for_url "http://127.0.0.1:3102/" "${MEMBER_PID}" "${MEMBER_LOG}"
  expect_security_headers "http://127.0.0.1:3101/login"
  expect_security_headers "http://127.0.0.1:3102/"

  expect_body_text "http://127.0.0.1:3101/login" "MegaGoldenClub"
  expect_body_absent "http://127.0.0.1:3101/login" "${LEGACY_UI_BRAND}"
  expect_body_absent "http://127.0.0.1:3101/login" "HttpOnly"
  expect_body_absent "http://127.0.0.1:3101/login" "verified by the API"
  expect_post_form "http://127.0.0.1:3101/login"
  expect_body_text "http://127.0.0.1:3102/login" "MegaGoldenClub"
  expect_body_absent "http://127.0.0.1:3102/login" "${LEGACY_UI_BRAND}"
  expect_body_absent "http://127.0.0.1:3102/login" "HttpOnly"
  expect_post_form "http://127.0.0.1:3102/login"
  expect_body_text "http://127.0.0.1:3102/" "MegaGoldenClub"
  expect_body_absent "http://127.0.0.1:3102/" "${LEGACY_UI_BRAND}"

  expect_status 307 "http://127.0.0.1:3101/operations"
  expect_status 307 "http://127.0.0.1:3101/business-plan"
  expect_status 307 "http://127.0.0.1:3101/presentation"
  expect_status 307 "http://127.0.0.1:3101/kyc"
  expect_status 307 "http://127.0.0.1:3101/withdrawals"
  expect_status 307 "http://127.0.0.1:3101/entitlements"
  expect_status 307 "http://127.0.0.1:3101/security"
  expect_status 200 "http://127.0.0.1:3101/forgot-password"
  expect_status 200 "http://127.0.0.1:3101/request-email-verification"

  expect_status 307 "http://127.0.0.1:3102/member"
  expect_status 307 "http://127.0.0.1:3102/member/kyc"
  expect_status 307 "http://127.0.0.1:3102/member/withdrawals"
  expect_status 307 "http://127.0.0.1:3102/member/entitlements"
  expect_status 307 "http://127.0.0.1:3102/member/security"
  expect_status 200 "http://127.0.0.1:3102/forgot-password"
  expect_status 200 "http://127.0.0.1:3102/request-email-verification"
  expect_status 200 "http://127.0.0.1:3102/reset-password?token=smoke-test-token"
  expect_status 200 "http://127.0.0.1:3102/verify-email?token=smoke-test-token"
  expect_status 200 "http://127.0.0.1:3102/confirm-email-change?token=smoke-test-token"

  expect_status 400 -X POST -H 'content-type: application/json' --data '{' "http://127.0.0.1:3101/api/session/login"
  expect_status 400 -X POST -H 'content-type: application/json' --data '{' "http://127.0.0.1:3102/api/session/login"

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

echo "==> Verifying shared MegaGoldenClub design token contract"
verify_token_copy "${ROOT_DIR}/admin/app/tokens.css"
verify_token_copy "${ROOT_DIR}/frontend/app/tokens.css"

verify_app "MegaGoldenClub admin" "${ROOT_DIR}/admin"
verify_app "MegaGoldenClub public/member web" "${ROOT_DIR}/frontend"
smoke_frontends

echo "MegaGoldenClub frontend verification: PASS"
