#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_PID=""
MEMBER_PID=""
ADMIN_LOG=""
MEMBER_LOG=""

cleanup_smoke() {
  if [[ -n "${ADMIN_PID}" ]] && kill -0 "${ADMIN_PID}" 2>/dev/null; then
    kill "${ADMIN_PID}" 2>/dev/null || true
    wait "${ADMIN_PID}" 2>/dev/null || true
  fi
  if [[ -n "${MEMBER_PID}" ]] && kill -0 "${MEMBER_PID}" 2>/dev/null; then
    kill "${MEMBER_PID}" 2>/dev/null || true
    wait "${MEMBER_PID}" 2>/dev/null || true
  fi
  [[ -z "${ADMIN_LOG}" ]] || rm -f "${ADMIN_LOG}"
  [[ -z "${MEMBER_LOG}" ]] || rm -f "${MEMBER_LOG}"
}

verify_token_copy() {
  local target="$1"
  if ! cmp -s "${ROOT_DIR}/packages/design-tokens/tokens.css" "${target}"; then
    echo "ERROR: MegaMitra design token copy drifted from canonical tokens.css: ${target}"
    exit 1
  fi
}

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

smoke_frontends() {
  echo "==> Smoke-testing production Next.js routes"
  ADMIN_LOG="$(mktemp -t megamitra-admin.XXXXXX.log)"
  MEMBER_LOG="$(mktemp -t megamitra-member.XXXXXX.log)"
  trap cleanup_smoke EXIT INT TERM

  npm --prefix "${ROOT_DIR}/admin" run start >"${ADMIN_LOG}" 2>&1 &
  ADMIN_PID=$!
  npm --prefix "${ROOT_DIR}/frontend" run start >"${MEMBER_LOG}" 2>&1 &
  MEMBER_PID=$!

  wait_for_url "http://127.0.0.1:3101/login" "${ADMIN_PID}" "${ADMIN_LOG}"
  wait_for_url "http://127.0.0.1:3102/" "${MEMBER_PID}" "${MEMBER_LOG}"

  expect_status 307 "http://127.0.0.1:3101/operations"
  expect_status 307 "http://127.0.0.1:3102/member"
  expect_status 400 -X POST -H 'content-type: application/json' --data '{' "http://127.0.0.1:3101/api/session/login"
  expect_status 400 -X POST -H 'content-type: application/json' --data '{' "http://127.0.0.1:3102/api/session/login"

  cleanup_smoke
  trap - EXIT INT TERM
  ADMIN_PID=""
  MEMBER_PID=""
  ADMIN_LOG=""
  MEMBER_LOG=""
}

FORBIDDEN_REGEX='Fix''TradeZone|fix''tradezone|fix trade zone'
if grep -RniE "${FORBIDDEN_REGEX}" "${ROOT_DIR}/admin" "${ROOT_DIR}/frontend" "${ROOT_DIR}/packages" \
  --exclude-dir=node_modules --exclude-dir=.next; then
  echo "ERROR: foreign project branding found in frontend foundation"
  exit 1
fi

echo "==> Verifying shared MegaMitra design token contract"
verify_token_copy "${ROOT_DIR}/admin/app/tokens.css"
verify_token_copy "${ROOT_DIR}/frontend/app/tokens.css"

verify_app "MegaMitra admin" "${ROOT_DIR}/admin"
verify_app "MegaMitra public/member web" "${ROOT_DIR}/frontend"
smoke_frontends

echo "MegaMitra frontend verification: PASS"
