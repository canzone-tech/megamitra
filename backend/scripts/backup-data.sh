#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
BACKUP_ROOT="${1:-${ROOT_DIR}/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_ROOT%/}/${STAMP}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} is missing"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MONGODB_DATABASE:?MONGODB_DATABASE is required}"

umask 077
mkdir -p "${TARGET}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

printf '%s\n' "==> Backing up authoritative MySQL data"
"${COMPOSE[@]}" exec -T mysql sh -c \
  'exec mysqldump --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
  > "${TARGET}/mysql.sql"

printf '%s\n' "==> Backing up MongoDB presentation documents"
"${COMPOSE[@]}" exec -T mongodb sh -c \
  'exec mongodump --db "$MONGO_INITDB_DATABASE" --archive --gzip' \
  > "${TARGET}/mongodb.archive.gz"

GIT_COMMIT="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
cat > "${TARGET}/manifest.txt" <<EOF
createdAtUtc=${STAMP}
gitCommit=${GIT_COMMIT}
mysqlDatabase=${MYSQL_DATABASE}
mongodbDatabase=${MONGODB_DATABASE}
redisBackup=excluded-non-authoritative
EOF

(
  cd "${TARGET}"
  sha256sum mysql.sql mongodb.archive.gz manifest.txt > SHA256SUMS
)
chmod 600 "${TARGET}"/*

printf '%s\n' "MegaGoldenClub backup created: ${TARGET}"
printf '%s\n' "Encrypt and copy this directory to protected off-host storage before considering the backup complete."
