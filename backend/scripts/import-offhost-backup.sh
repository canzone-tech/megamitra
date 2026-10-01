#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"
ARCHIVE_PATH="${1:-}"
OUTPUT_ROOT="${2:-}"
KEY_FILE="${MEGAGOLDENCLUB_BACKUP_KEY_FILE:-}"
PBKDF2_ITERATIONS=200000

if [[ -z "${ARCHIVE_PATH}" || -z "${OUTPUT_ROOT}" ]]; then
  echo "Usage: MEGAGOLDENCLUB_BACKUP_KEY_FILE=/secure/key ./scripts/import-offhost-backup.sh /off-host/backup.tar.gz.enc /restore/workdir"
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
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "ERROR: encrypted backup archive is missing: ${ARCHIVE_PATH}"
  exit 1
fi
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
if [[ ! -f "${CHECKSUM_PATH}" ]]; then
  echo "ERROR: encrypted backup checksum is missing: ${CHECKSUM_PATH}"
  exit 1
fi

KEY_MODE="$(stat -c '%a' "${KEY_FILE}" 2>/dev/null || true)"
if [[ -n "${KEY_MODE}" && "${KEY_MODE}" != "600" && "${KEY_MODE}" != "400" ]]; then
  echo "ERROR: backup encryption key file must have mode 600 or 400, found ${KEY_MODE}"
  exit 1
fi

ARCHIVE_DIR="$(cd "$(dirname "${ARCHIVE_PATH}")" && pwd)"
ARCHIVE_NAME="$(basename "${ARCHIVE_PATH}")"
CHECKSUM_NAME="$(basename "${CHECKSUM_PATH}")"
(
  cd "${ARCHIVE_DIR}"
  sha256sum -c "${CHECKSUM_NAME}"
)

umask 077
mkdir -p "${OUTPUT_ROOT}"
TARGET_DIR="${OUTPUT_ROOT%/}/imported"
if [[ -e "${TARGET_DIR}" ]]; then
  echo "ERROR: refusing to overwrite existing import directory ${TARGET_DIR}"
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/megagoldenclub-offhost-import.XXXXXX")"
DECRYPTED_ARCHIVE="${WORK_DIR}/backup.tar.gz"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT INT TERM

printf '%s\n' "==> Decrypting off-host backup"
openssl enc -d -aes-256-cbc -pbkdf2 -iter "${PBKDF2_ITERATIONS}" \
  -pass "file:${KEY_FILE}" -in "${ARCHIVE_PATH}" -out "${DECRYPTED_ARCHIVE}"

mapfile -t ARCHIVE_ENTRIES < <(tar -tzf "${DECRYPTED_ARCHIVE}" | sort)
EXPECTED_ENTRIES=(SHA256SUMS manifest.txt mongodb.archive.gz mysql.sql)
if [[ "${#ARCHIVE_ENTRIES[@]}" -ne "${#EXPECTED_ENTRIES[@]}" ]]; then
  echo "ERROR: encrypted backup contains unexpected file count"
  exit 1
fi
for index in "${!EXPECTED_ENTRIES[@]}"; do
  if [[ "${ARCHIVE_ENTRIES[$index]}" != "${EXPECTED_ENTRIES[$index]}" ]]; then
    echo "ERROR: encrypted backup contains unexpected entry '${ARCHIVE_ENTRIES[$index]}'"
    exit 1
  fi
done

mkdir -p "${TARGET_DIR}"
tar -xzf "${DECRYPTED_ARCHIVE}" -C "${TARGET_DIR}" --no-same-owner --no-same-permissions
chmod 700 "${TARGET_DIR}"
chmod 600 "${TARGET_DIR}"/*
(
  cd "${TARGET_DIR}"
  sha256sum -c SHA256SUMS
)

printf '%s\n' "MegaGoldenClub encrypted backup import: PASS"
printf '%s\n' "backupDir=${TARGET_DIR}"
