#!/usr/bin/env bash
# Repair ONLY the dedicated MegaGoldenClub MongoDB bootstrap secret.
# The official mongo image drops to the "mongodb" Unix user before reading
# MONGO_INITDB_ROOT_PASSWORD_FILE, while Docker Compose file-backed secrets
# preserve host UID/GID/mode (Compose file secrets cannot remap ownership).
# A root:root 0600 host file therefore produces Permission denied.
set -euo pipefail
umask 077

IMAGE='mongo:8.0.29-noble'
CONTAINER='megagoldenclub-mongo'
SECRET='/etc/megagoldenclub/mongo/root-password'
SECRET_DIR='/etc/megagoldenclub/mongo'

if [[ "${EUID}" -ne 0 ]]; then
  echo 'STOP: run as root on the application VPS' >&2
  exit 1
fi

echo '=== VERIFY DEDICATED MONGODB CONTAINER ==='
if [[ "$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)" != "$IMAGE" ]]; then
  echo 'STOP: expected dedicated MongoDB container/image not found' >&2
  exit 1
fi
if [[ "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/mongodb_root_password"}}{{.Source}}{{end}}{{end}}' "$CONTAINER")" != "$SECRET" ]]; then
  echo 'STOP: dedicated secret bind path does not match' >&2
  exit 1
fi

echo '=== VERIFY PRIVATE HOST SECRET FILE ==='
if [[ ! -d "$SECRET_DIR" || -L "$SECRET_DIR" || ! -f "$SECRET" || -L "$SECRET" || ! -s "$SECRET" ]]; then
  echo 'STOP: expected private secret file not found or unsafe' >&2
  exit 1
fi
if [[ "$(stat -c '%u:%a' "$SECRET_DIR")" != '0:700' ||
      "$(stat -c '%u' "$SECRET")" != '0' ]]; then
  echo 'STOP: secret directory must be root:0700 and secret root-owned' >&2
  exit 1
fi

echo '=== RESOLVE OFFICIAL IMAGE MONGODB UID/GID ==='
mongo_uid="$(docker run --rm --pull=never --network none \
  --entrypoint id "$IMAGE" -u mongodb)"
mongo_gid="$(docker run --rm --pull=never --network none \
  --entrypoint id "$IMAGE" -g mongodb)"
if [[ ! "$mongo_uid" =~ ^[0-9]+$ || ! "$mongo_gid" =~ ^[0-9]+$ ||
      "$mongo_uid" -eq 0 || "$mongo_gid" -eq 0 ]]; then
  echo 'STOP: invalid mongodb user identity in official image' >&2
  exit 1
fi

echo '=== RESTRICT SECRET READABILITY TO MONGODB GROUP ==='
chown "0:$mongo_gid" "$SECRET"
chmod 0440 "$SECRET"

echo '=== VERIFY SECRET READABLE TO CONTAINER ACCOUNT ==='
docker run --rm --pull=never --network none --read-only \
  --user "$mongo_uid:$mongo_gid" \
  --mount "type=bind,src=$SECRET,dst=/run/secrets/mongodb_root_password,readonly" \
  --entrypoint sh "$IMAGE" -ec \
  'test -r /run/secrets/mongodb_root_password && test -s /run/secrets/mongodb_root_password'
echo 'Secret access: PASS (secret contents not displayed)'

echo '=== RESTART DEDICATED MONGODB ONLY ==='
docker restart "$CONTAINER" >/dev/null

echo '=== WAIT FOR MONGODB STARTUP ==='
for attempt in $(seq 1 40); do
  if docker exec "$CONTAINER" mongosh --quiet \
    --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -qx '1'; then
    if [[ "$(docker inspect --format '{{.State.Status}}' "$CONTAINER")" == 'running' ]]; then
      echo 'Dedicated MongoDB started: PASS'
      echo 'Existing host MongoDB and unrelated containers: UNTOUCHED'
      echo 'Next gate: authenticate root and create dedicated app user.'
      exit 0
    fi
  fi
  sleep 2
done

echo 'STOP: MongoDB did not become ready; inspect ONLY its container logs' >&2
docker inspect --format 'Status={{.State.Status}} ExitCode={{.State.ExitCode}} Restarts={{.RestartCount}}' "$CONTAINER" >&2
exit 1
