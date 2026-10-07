#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

COMPOSE_ARGS=(-f "${ROOT_DIR}/docker-compose.yml")
if [[ -f "${ROOT_DIR}/.env" ]]; then
  COMPOSE_ARGS=(--env-file "${ROOT_DIR}/.env" "${COMPOSE_ARGS[@]}")
fi

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

BASE_DB="$(compose exec -T mysql printenv MYSQL_DATABASE | tr -d '\r')"
APP_USER="$(compose exec -T mysql printenv MYSQL_USER | tr -d '\r')"
APP_PASSWORD="$(compose exec -T mysql printenv MYSQL_PASSWORD | tr -d '\r')"
PUBLISHED_PORT="$(compose port mysql 3306 | tail -n1 | awk -F: '{print $NF}')"
MYSQL_HOST_VALUE="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT_VALUE="${MYSQL_PORT:-${PUBLISHED_PORT}}"

if [[ ! "${BASE_DB}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: unsafe MYSQL_DATABASE value for isolated integration schema"
  exit 1
fi
if [[ ! "${APP_USER}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: unsafe MYSQL_USER value for isolated integration schema"
  exit 1
fi
if [[ ! "${MYSQL_PORT_VALUE}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: invalid MySQL port for isolated integration schema"
  exit 1
fi

BASE_PREFIX="${BASE_DB:0:36}"
TEST_DB="${BASE_PREFIX}_integration_$$"

drop_test_db() {
  printf 'DROP DATABASE IF EXISTS `%s`;\n' "${TEST_DB}" |
    compose exec -T mysql sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' >/dev/null
}
trap drop_test_db EXIT INT TERM

printf "CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nGRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'%%';\nFLUSH PRIVILEGES;\n"   "${TEST_DB}" "${TEST_DB}" "${APP_USER}" |
  compose exec -T mysql sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' >/dev/null

TEST_DATABASE_URL="$(
  node -e '
    const [host, port, user, password, database] = process.argv.slice(1);
    const url = new URL("mysql://placeholder:placeholder@localhost/");
    url.hostname = host;
    url.port = port;
    url.username = user;
    url.password = password;
    url.pathname = "/" + database;
    process.stdout.write(url.toString());
  ' "${MYSQL_HOST_VALUE}" "${MYSQL_PORT_VALUE}" "${APP_USER}" "${APP_PASSWORD}" "${TEST_DB}"
)"

echo "==> Applying migrations to disposable integration schema ${TEST_DB}"
NODE_ENV=test MYSQL_HOST="${MYSQL_HOST_VALUE}" MYSQL_PORT="${MYSQL_PORT_VALUE}" MYSQL_DATABASE="${TEST_DB}" MYSQL_USER="${APP_USER}" MYSQL_PASSWORD="${APP_PASSWORD}" DATABASE_URL="${TEST_DATABASE_URL}" npx prisma migrate deploy

echo "==> Running integration tests against disposable integration schema"
NODE_ENV=test MYSQL_HOST="${MYSQL_HOST_VALUE}" MYSQL_PORT="${MYSQL_PORT_VALUE}" MYSQL_DATABASE="${TEST_DB}" MYSQL_USER="${APP_USER}" MYSQL_PASSWORD="${APP_PASSWORD}" DATABASE_URL="${TEST_DATABASE_URL}" npm run test:integration:raw

echo "MegaGoldenClub isolated integration verification: PASS"
