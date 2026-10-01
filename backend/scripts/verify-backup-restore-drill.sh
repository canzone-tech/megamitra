#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ "${MEGAGOLDENCLUB_RESTORE_DRILL_CONFIRM:-}" != "YES" ]]; then
  echo "ERROR: recovery drill is destructive. Set MEGAGOLDENCLUB_RESTORE_DRILL_CONFIRM=YES only in an isolated environment"
  exit 1
fi
if [[ "${NODE_ENV:-}" != "test" ]]; then
  echo "ERROR: automated recovery drill is restricted to NODE_ENV=test isolated environments"
  exit 1
fi

COMPOSE=(docker compose -f "${ROOT_DIR}/docker-compose.yml")
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")
fi

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MONGODB_DATABASE:?MONGODB_DATABASE is required}"

DRILL_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))")"
MUTATED_TOKEN="mutated-${DRILL_TOKEN}"
DRILL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/megagoldenclub-recovery-drill.XXXXXX")"
LOCAL_BACKUP_ROOT="${DRILL_ROOT}/local-backups"
OFFHOST_ROOT="${DRILL_ROOT}/simulated-off-host"
IMPORT_ROOT="${DRILL_ROOT}/imported-backup"
KEY_FILE="${DRILL_ROOT}/off-host-backup.key"
MYSQL_CANARY_TABLE="backup_restore_drill_canary"
MONGO_CANARY_COLLECTION="backup_restore_drill_canary"
REDIS_CANARY_KEY="megagoldenclub:backup-restore-drill"

cleanup() {
  set +e
  "${COMPOSE[@]}" exec -T mysql sh -c \
    'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "DROP TABLE IF EXISTS backup_restore_drill_canary"' \
    >/dev/null 2>&1
  "${COMPOSE[@]}" exec -T mongodb mongosh --quiet --eval \
    'db.getSiblingDB(process.env.MONGO_INITDB_DATABASE).backup_restore_drill_canary.drop()' \
    >/dev/null 2>&1
  "${COMPOSE[@]}" exec -T redis redis-cli DEL "${REDIS_CANARY_KEY}" >/dev/null 2>&1
  rm -rf "${DRILL_ROOT}"
}
trap cleanup EXIT INT TERM

printf '%s\n' "==> Seeding isolated recovery canaries"
"${COMPOSE[@]}" exec -T -e DRILL_TOKEN="${DRILL_TOKEN}" mysql sh -c '
  mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<SQL
DROP TABLE IF EXISTS backup_restore_drill_canary;
CREATE TABLE backup_restore_drill_canary (
  id INT NOT NULL PRIMARY KEY,
  canaryValue VARCHAR(191) NOT NULL
) ENGINE=InnoDB;
INSERT INTO backup_restore_drill_canary (id, canaryValue) VALUES (1, "$DRILL_TOKEN");
SQL
'
"${COMPOSE[@]}" exec -T -e DRILL_TOKEN="${DRILL_TOKEN}" mongodb mongosh --quiet --eval '
  const target = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
  target.backup_restore_drill_canary.drop();
  target.backup_restore_drill_canary.insertOne({_id: "singleton", canaryValue: process.env.DRILL_TOKEN});
' >/dev/null
"${COMPOSE[@]}" exec -T redis redis-cli SET "${REDIS_CANARY_KEY}" "${DRILL_TOKEN}" >/dev/null

printf '%s\n' "==> Creating drill backup"
mkdir -p "${LOCAL_BACKUP_ROOT}"
cd "${BACKEND_DIR}"
npm run backup:data -- "${LOCAL_BACKUP_ROOT}"

mapfile -t BACKUP_DIRS < <(find "${LOCAL_BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -print)
if [[ "${#BACKUP_DIRS[@]}" -ne 1 ]]; then
  echo "ERROR: recovery drill expected exactly one backup directory, found ${#BACKUP_DIRS[@]}"
  exit 1
fi
BACKUP_DIR="${BACKUP_DIRS[0]}"
EXPECTED_COMMIT="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
(
  cd "${BACKUP_DIR}"
  sha256sum -c SHA256SUMS
)
grep -Fx "gitCommit=${EXPECTED_COMMIT}" "${BACKUP_DIR}/manifest.txt" >/dev/null
grep -Fx "mysqlDatabase=${MYSQL_DATABASE}" "${BACKUP_DIR}/manifest.txt" >/dev/null
grep -Fx "mongodbDatabase=${MONGODB_DATABASE}" "${BACKUP_DIR}/manifest.txt" >/dev/null
grep -Fx "redisBackup=excluded-non-authoritative" "${BACKUP_DIR}/manifest.txt" >/dev/null

printf '%s\n' "==> Exporting encrypted backup to simulated off-host boundary"
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64') + '\n')" > "${KEY_FILE}"
chmod 600 "${KEY_FILE}"
mkdir -p "${OFFHOST_ROOT}"
MEGAGOLDENCLUB_BACKUP_KEY_FILE="${KEY_FILE}" \
  npm run backup:export-offhost -- "${BACKUP_DIR}" "${OFFHOST_ROOT}"

mapfile -t OFFHOST_ARCHIVES < <(find "${OFFHOST_ROOT}" -mindepth 1 -maxdepth 1 -type f -name '*.tar.gz.enc' -print)
if [[ "${#OFFHOST_ARCHIVES[@]}" -ne 1 ]]; then
  echo "ERROR: recovery drill expected exactly one encrypted off-host archive, found ${#OFFHOST_ARCHIVES[@]}"
  exit 1
fi
OFFHOST_ARCHIVE="${OFFHOST_ARCHIVES[0]}"
if [[ ! -f "${OFFHOST_ARCHIVE}.sha256" ]]; then
  echo "ERROR: encrypted off-host archive checksum is missing"
  exit 1
fi

printf '%s\n' "==> Simulating loss of the primary-host backup"
rm -rf "${LOCAL_BACKUP_ROOT}"
if [[ -e "${BACKUP_DIR}" ]]; then
  echo "ERROR: local backup still exists after simulated host loss"
  exit 1
fi

printf '%s\n' "==> Importing only from encrypted off-host archive"
MEGAGOLDENCLUB_BACKUP_KEY_FILE="${KEY_FILE}" \
  npm run backup:import-offhost -- "${OFFHOST_ARCHIVE}" "${IMPORT_ROOT}"
IMPORTED_BACKUP_DIR="${IMPORT_ROOT}/imported"
for required in mysql.sql mongodb.archive.gz manifest.txt SHA256SUMS; do
  if [[ ! -f "${IMPORTED_BACKUP_DIR}/${required}" ]]; then
    echo "ERROR: imported off-host backup is missing ${required}"
    exit 1
  fi
done
(
  cd "${IMPORTED_BACKUP_DIR}"
  sha256sum -c SHA256SUMS
)
grep -Fx "gitCommit=${EXPECTED_COMMIT}" "${IMPORTED_BACKUP_DIR}/manifest.txt" >/dev/null

printf '%s\n' "==> Mutating canaries after off-host export"
"${COMPOSE[@]}" exec -T -e MUTATED_TOKEN="${MUTATED_TOKEN}" mysql sh -c '
  mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
    -e "UPDATE backup_restore_drill_canary SET canaryValue = \"$MUTATED_TOKEN\" WHERE id = 1"
'
"${COMPOSE[@]}" exec -T -e MUTATED_TOKEN="${MUTATED_TOKEN}" mongodb mongosh --quiet --eval '
  const target = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
  target.backup_restore_drill_canary.updateOne({_id: "singleton"}, {$set: {canaryValue: process.env.MUTATED_TOKEN}});
' >/dev/null
"${COMPOSE[@]}" exec -T redis redis-cli SET "${REDIS_CANARY_KEY}" "${MUTATED_TOKEN}" >/dev/null

printf '%s\n' "==> Restoring imported off-host backup"
MEGAGOLDENCLUB_RESTORE_CONFIRM=YES npm run restore:data -- "${IMPORTED_BACKUP_DIR}"

printf '%s\n' "==> Verifying restored authoritative and presentation state"
MYSQL_VALUE="$("${COMPOSE[@]}" exec -T mysql sh -c '
  mysql -N -B -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
    -e "SELECT canaryValue FROM backup_restore_drill_canary WHERE id = 1"
' 2>/dev/null | tr -d '\r')"
if [[ "${MYSQL_VALUE}" != "${DRILL_TOKEN}" ]]; then
  echo "ERROR: MySQL recovery canary was not restored"
  exit 1
fi

MONGO_VALUE="$("${COMPOSE[@]}" exec -T mongodb mongosh --quiet --eval '
  const target = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
  const row = target.backup_restore_drill_canary.findOne({_id: "singleton"});
  if (row) print(row.canaryValue);
' | tr -d '\r')"
if [[ "${MONGO_VALUE}" != "${DRILL_TOKEN}" ]]; then
  echo "ERROR: MongoDB recovery canary was not restored"
  exit 1
fi

REDIS_EXISTS="$("${COMPOSE[@]}" exec -T redis redis-cli EXISTS "${REDIS_CANARY_KEY}" | tr -d '\r')"
if [[ "${REDIS_EXISTS}" != "0" ]]; then
  echo "ERROR: Redis non-authoritative state was not cleared during restore"
  exit 1
fi

printf '%s\n' "MegaGoldenClub encrypted off-host backup/restore drill: PASS"
