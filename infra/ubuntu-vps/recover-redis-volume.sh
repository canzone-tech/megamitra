#!/usr/bin/env bash
# Recovery ONLY for partial first MegaGoldenClub Redis provisioning:
# the ACL/credentials/volume exist, but Redis has never started.
# Never regenerate passwords, delete/recreate the volume, or modify other apps.
set -euo pipefail
set +x
umask 077

ROOT='/etc/megagoldenclub'
DIR="$ROOT/redis"
COMPOSE="$DIR/compose.yaml"
CONFIG="$DIR/redis.conf"
ACL="$DIR/users.acl"
CREDS="$ROOT/redis.credentials.env"
CONTAINER='megagoldenclub-redis'
IMAGE='redis:7.4.11-alpine'
VOLUME='megagoldenclub-redis_megagoldenclub-redis-data'

echo '=== VERIFY INCOMPLETE REDIS SETUP ==='
if [[ "$EUID" -ne 0 || "$#" -ne 1 || ! -d "$1" ]]; then
  echo 'STOP: run as root with reviewed Redis template directory' >&2; exit 1
fi
SRC="$1"
if [[ "$(stat -c '%U:%G:%a' "$ROOT" 2>/dev/null || true)" != 'root:megagoldenclub:750' ||
      ! -d "$DIR" || -L "$DIR" ||
      "$(stat -c '%u:%a' "$DIR" 2>/dev/null || true)" != '0:700' ]]; then
  echo 'STOP: service/Redis directories not securely owned' >&2; exit 1
fi
for f in "$COMPOSE" "$CONFIG" "$ACL" "$CREDS"; do
  if [[ ! -f "$f" || -L "$f" || ! -s "$f" ]]; then
    echo "STOP: staged Redis file missing/unsafe: $f" >&2; exit 1
  fi
done
if [[ "$(stat -c '%U:%G:%a' "$COMPOSE")" != 'root:root:600' ||
      "$(stat -c '%U:%G:%a' "$CONFIG")" != 'root:root:644' ||
      "$(stat -c '%u:%g:%a' "$ACL")" != '10001:10001:400' ||
      "$(stat -c '%U:%G:%a' "$CREDS")" != 'root:megagoldenclub:640' ]]; then
  echo 'STOP: staged Redis ownership/modes differ from initial setup' >&2; exit 1
fi
if ! id megagoldenclub >/dev/null 2>&1 ||
   ! runuser -u megagoldenclub -- test -r "$CREDS"; then
  echo 'STOP: app account cannot read its Redis credentials' >&2; exit 1
fi
for f in megagoldenclub-redis.compose.yaml redis.conf; do
  if [[ ! -f "$SRC/$f" || -L "$SRC/$f" ]]; then
    echo 'STOP: reviewed Redis config file missing' >&2; exit 1
  fi
done
if ! cmp -s "$SRC/megagoldenclub-redis.compose.yaml" "$COMPOSE" ||
   ! cmp -s "$SRC/redis.conf" "$CONFIG"; then
  echo 'STOP: staged Redis config differs from reviewed release' >&2; exit 1
fi
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo 'STOP: dedicated Redis container already exists; do not recreate' >&2; exit 1
fi
if ss -ltnH '( sport = :6381 )' | grep -q .; then
  echo 'STOP: port 6381 is in use' >&2; exit 1
fi
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo 'STOP: dedicated Redis volume is missing; do not recreate' >&2; exit 1
fi
if [[ "$(docker volume inspect --format '{{.Driver}}' "$VOLUME")" != 'local' ||
      "$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$VOLUME")" != 'megagoldenclub-redis' ||
      "$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$VOLUME")" != 'megagoldenclub-redis-data' ]]; then
  echo 'STOP: volume driver/identity mismatch' >&2; exit 1
fi
if [[ -n "$(docker ps -a --filter "volume=$VOLUME" --format '{{.ID}}')" ]]; then
  echo 'STOP: an existing container uses the Redis volume' >&2; exit 1
fi
if [[ -z "$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)" ]]; then
  echo 'STOP: pinned Redis image is absent' >&2; exit 1
fi

echo '=== VERIFY EXISTING PASSWORD/ACL WITHOUT DISPLAY ==='
if [[ "$(wc -l < "$CREDS")" -ne 4 ]]; then
  echo 'STOP: unexpected Redis env file length' >&2; exit 1
fi
password=''
host_count=0
port_count=0
tls_count=0
pass_count=0
while IFS='=' read -r key value; do
  case "$key" in
    REDIS_HOST) host_count=$((host_count+1)); [[ "$value" == '127.0.0.1' ]] || exit 1 ;;
    REDIS_PORT) port_count=$((port_count+1)); [[ "$value" == '6381' ]] || exit 1 ;;
    REDIS_TLS) tls_count=$((tls_count+1)); [[ "$value" == 'false' ]] || exit 1 ;;
    REDIS_PASSWORD) pass_count=$((pass_count+1)); password="$value" ;;
    *) echo 'STOP: unknown Redis env setting' >&2; exit 1 ;;
  esac
done < "$CREDS"
if [[ "$host_count" -ne 1 || "$port_count" -ne 1 ||
      "$tls_count" -ne 1 || "$pass_count" -ne 1 ||
      ! "$password" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'STOP: Redis env keys/password invalid' >&2; exit 1
fi
hash="$(printf '%s' "$password" | sha256sum | cut -d ' ' -f 1)"
if [[ "$(cat "$ACL")" != "user default reset on #$hash ~* &* +@all" ]]; then
  echo 'STOP: Redis ACL does not match existing password' >&2; exit 1
fi
docker compose -f "$COMPOSE" config --quiet
echo 'Redis credentials and ACL: MATCH (secrets hidden)'

echo '=== REPAIR DEDICATED DATA VOLUME OWNERSHIP ==='
# /data is owned by Redis-image account initially, so CAP_CHOWN alone
# cannot chmod another UID's directory. Add FOWNER ONLY to this offline,
# ephemeral helper; the actual Redis container remains cap_drop ALL.
docker run --rm --pull=never --network none --read-only \
  --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER \
  --mount "type=volume,src=$VOLUME,dst=/data" \
  --entrypoint sh "$IMAGE" -ec \
  'chown 10001:10001 /data && chmod 0700 /data'
docker run --rm --pull=never --network none --read-only \
  --user 10001:10001 --cap-drop ALL \
  --mount "type=volume,src=$VOLUME,dst=/data" \
  --entrypoint sh "$IMAGE" -ec 'test -w /data && test -x /data'
echo 'Dedicated Redis volume UID 10001 writable: PASS'

echo '=== START ONLY DEDICATED REDIS ==='
docker compose -f "$COMPOSE" up -d --no-deps redis

echo '=== VERIFY PASSWORD LOGIN AND LOCALHOST BIND ==='
auth_pass=0
for attempt in $(seq 1 30); do
  response="$(printf '%s' "$password" |
    docker exec -i "$CONTAINER" redis-cli --raw -x AUTH 2>/dev/null || true)"
  if [[ "$response" == 'OK' ]]; then auth_pass=1; break; fi
  sleep 2
done
if [[ "$auth_pass" != 1 ]]; then
  echo 'STOP: dedicated Redis authentication not ready; keep secrets/volume' >&2; exit 1
fi
anonymous="$(docker exec "$CONTAINER" redis-cli --raw PING 2>/dev/null || true)"
if [[ "$anonymous" != *'NOAUTH'* ]]; then
  echo 'STOP: passwordless Redis PING not rejected' >&2; exit 1
fi
binding="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}' "$CONTAINER")"
if [[ "$binding" != '127.0.0.1:6381' ]]; then
  echo 'STOP: Redis Docker port binding is not loopback-only' >&2; exit 1
fi
unset password hash
echo 'Redis password authentication: PASS'
echo 'Redis anonymous access: DENIED'
echo 'Redis host bind: 127.0.0.1:6381'
echo "Original protected credentials retained: $CREDS"
echo 'REDIS STARTUP AND AUTHENTICATION RECOVERY: PASS'
echo 'MySQL, MongoDB and unrelated Redis instances: UNTOUCHED'
