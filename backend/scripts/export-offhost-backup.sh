#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
BACKUP_DIR="${1:-}"
DESTINATION_DIR="${2:-}"
KEY_FILE="${MEGAGOLDENCLUB_BACKUP_KEY_FILE:-}"
PBKDF2_ITERATIONS=200000

if [[ -z "${BACKUP_DIR}" || -z "${DESTINATION_DIR}" ]]; then
  echo "Usage: MEGAGOLDENCLUB_BACKUP_KEY_FILE=/secure/key ./scripts/export-offhost-backup.sh /path/to/backup /mounted/off-host/path"
  exit 1
fi
if [[ -z "${KEY_FILE}" ]]; then
  echo "ERROR: MEGAGOLDENCLUB_BACKUP_KEY_FILE is required"
  exit 1
fi
if [[ ! -s "${KEY_FILE}" ]]; then
  echo "ERROR: backup encryption key file is missing or empty: ${KEY_FILE}"
  exit 1
fi

KEY_MODE="$(stat -c '%a' "${KEY_FILE}" 2>/dev/null || true)"
if [[ -n "${KEY_MODE}" && "${KEY_MODE}" != "600" && "${KEY_MODE}" != "400" ]]; then
  echo "ERROR: backup encryption key file must have mode 600 or 400, found ${KEY_MODE}"
  exit 1
fi

for required in mysql.sql mongodb.archive.gz manifest.txt SHA256SUMS; do
  if [[ ! -f "${BACKUP_DIR}/${required}" ]]; then
    echo "ERROR: missing ${BACKUP_DIR}/${required}"
    exit 1
  fi
done

(
  cd "${BACKUP_DIR}"
  sha256sum -c SHA256SUMS
)

manifest_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "${BACKUP_DIR}/manifest.txt" | tail -n 1
}

CREATED_AT="$(manifest_value createdAtUtc)"
GIT_COMMIT="$(manifest_value gitCommit)"
if [[ -z "${CREATED_AT}" ]]; then
  echo "ERROR: backup manifest is missing createdAtUtc"
  exit 1
fi

SAFE_STAMP="$(printf '%s' "${CREATED_AT}" | tr -cd '0-9TZ')"
if [[ -z "${SAFE_STAMP}" ]]; then
  echo "ERROR: backup manifest createdAtUtc is invalid"
  exit 1
fi

umask 077
mkdir -p "${DESTINATION_DIR}"
ARCHIVE_NAME="megagoldenclub-backup-${SAFE_STAMP}.tar.gz.enc"
ARCHIVE_PATH="${DESTINATION_DIR%/}/${ARCHIVE_NAME}"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
TEMP_ARCHIVE="${ARCHIVE_PATH}.tmp.$$"

if [[ -e "${ARCHIVE_PATH}" || -e "${CHECKSUM_PATH}" ]]; then
  echo "ERROR: refusing to overwrite existing off-host backup ${ARCHIVE_PATH}"
  exit 1
fi

cleanup() {
  rm -f "${TEMP_ARCHIVE}"
}
trap cleanup EXIT INT TERM

printf '%s\n' "==> Encrypting backup for off-host storage"
tar -C "${BACKUP_DIR}" -czf - mysql.sql mongodb.archive.gz manifest.txt SHA256SUMS \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter "${PBKDF2_ITERATIONS}" \
      -pass "file:${KEY_FILE}" -out "${TEMP_ARCHIVE}"
chmod 600 "${TEMP_ARCHIVE}"
mv "${TEMP_ARCHIVE}" "${ARCHIVE_PATH}"
(
  cd "${DESTINATION_DIR}"
  sha256sum "${ARCHIVE_NAME}" > "${ARCHIVE_NAME}.sha256"
)
chmod 600 "${CHECKSUM_PATH}"
trap - EXIT INT TERM

printf '%s\n' "MegaGoldenClub encrypted backup export: PASS"
printf '%s\n' "archive=${ARCHIVE_PATH}"
printf '%s\n' "checksum=${CHECKSUM_PATH}"
printf '%s\n' "sourceGitCommit=${GIT_COMMIT:-unknown}"
printf '%s\n' "Copy/retain both files in protected off-host storage. Keep the key in a separate secret-management boundary."
