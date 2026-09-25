#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
BACKUP_DIR="${1:-}"

if [[ -z "${BACKUP_DIR}" ]]; then
  echo "Usage: MEGAGOLDENCLUB_RESTORE_CONFIRM=YES ./scripts/restore-data.sh /path/to/backup"
  exit 1
fi
if [[ "${MEGAGOLDENCLUB_RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo "ERROR: restore is destructive. Re-run with MEGAGOLDENCLUB_RESTORE_CONFIRM=YES"
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} is missing"
  exit 1
fi
for required in mysql.sql mongodb.archive.gz manifest.txt SHA256SUMS; do
  if [[ ! -f "${BACKUP_DIR}/${required}" ]]; then
    echo "ERROR: missing ${BACKUP_DIR}/${required}"
    exit 1
  fi
done

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

(
  cd "${BACKUP_DIR}"
  sha256sum -c SHA256SUMS
)

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")
"${COMPOSE[@]}" up -d mysql mongodb redis

printf '%s\n' "==> Restoring MySQL system of record"
cat "${BACKUP_DIR}/mysql.sql" | "${COMPOSE[@]}" exec -T mysql sh -c \
  'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

printf '%s\n' "==> Restoring MongoDB presentation store"
cat "${BACKUP_DIR}/mongodb.archive.gz" | "${COMPOSE[@]}" exec -T mongodb sh -c \
  'exec mongorestore --drop --gzip --archive --nsInclude="$MONGO_INITDB_DATABASE.*"'

printf '%s\n' "==> Clearing non-authoritative Redis state"
"${COMPOSE[@]}" exec -T redis redis-cli FLUSHDB >/dev/null

printf '%s\n' "==> Verifying schema state"
cd "${BACKEND_DIR}"
npx prisma migrate status

printf '%s\n' "MegaGoldenClub restore completed. Run npm run verify before reopening traffic."
