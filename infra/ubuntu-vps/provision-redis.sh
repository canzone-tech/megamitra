#!/usr/bin/env bash
# One-time, fail-closed provisioning for the NEW MegaGoldenClub Redis ONLY.
# After a partial run, use recover-redis-volume.sh; NEVER rerun this initializer.
# Requires three exact-commit downloaded repo files in a private temp folder:
# provision-redis.sh, megagoldenclub-redis.compose.yaml, redis.conf
# Never modifies existing Docker containers, MySQL, MongoDB, or PM2.
set -euo pipefail
set +x
umask 077

ROOT='/etc/megagoldenclub'
REDIS_DIR="$ROOT/redis"
COMPOSE="$REDIS_DIR/compose.yaml"
CONFIG="$REDIS_DIR/redis.conf"
ACL="$REDIS_DIR/users.acl"
APP_CREDENTIALS="$ROOT/redis.credentials.env"
CONTAINER='megagoldenclub-redis'
IMAGE='redis:7.4.11-alpine'
VOLUME='megagoldenclub-redis_megagoldenclub-redis-data'

echo '=== VERIFY REDIS DEPLOYMENT BOUNDARY ==='
if [[ "$EUID" -ne 0 || "$#" -ne 1 || ! -d "$1" ]]; then
  echo 'STOP: root and a downloaded source directory are required' >&2
  exit 1
fi
SOURCE_DIR="$1"
if [[ "$(stat -c '%U:%G:%a' "$ROOT" 2>/dev/null || true)" != 'root:megagoldenclub:750' ]]; then
  echo 'STOP: expected root:megagoldenclub 0750 service directory missing' >&2
  exit 1
fi
if ! id megagoldenclub >/dev/null 2>&1; then
  echo 'STOP: dedicated MegaGoldenClub Unix account missing' >&2
  exit 1
fi
for file in "$SOURCE_DIR/megagoldenclub-redis.compose.yaml" "$SOURCE_DIR/redis.conf"; do
  if [[ ! -f "$file" || -L "$file" || ! -s "$file" ]]; then
    echo 'STOP: verified GitHub Redis configuration files not supplied' >&2
    exit 1
  fi
done
for destination in "$COMPOSE" "$CONFIG" "$ACL" "$APP_CREDENTIALS"; do
  if [[ -e "$destination" || -L "$destination" ]]; then
    echo "STOP: Redis deployment file already exists: $destination" >&2
    exit 1
  fi
done
if [[ -e "$REDIS_DIR" || -L "$REDIS_DIR" ]]; then
  echo "STOP: Redis config directory already exists: $REDIS_DIR" >&2
  exit 1
fi
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo 'STOP: Redis container name already exists' >&2
  exit 1
fi
if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo 'STOP: dedicated Redis Docker volume already exists' >&2
  exit 1
fi
if ss -ltnH '( sport = :6381 )' | grep -q .; then
  echo 'STOP: Redis loopback port 6381 occupied' >&2
  exit 1
fi
command -v openssl >/dev/null
command -v sha256sum >/dev/null
docker compose version >/dev/null

echo '=== VALIDATE EXACT REDIS ISOLATION CONFIGURATION ==='
grep -Fqx 'name: megagoldenclub-redis' "$SOURCE_DIR/megagoldenclub-redis.compose.yaml"
grep -Fq 'container_name: megagoldenclub-redis' "$SOURCE_DIR/megagoldenclub-redis.compose.yaml"
grep -Fq '127.0.0.1:6381:6379' "$SOURCE_DIR/megagoldenclub-redis.compose.yaml"
grep -Fq 'user: "10001:10001"' "$SOURCE_DIR/megagoldenclub-redis.compose.yaml"
grep -Fq 'external: true' "$SOURCE_DIR/megagoldenclub-redis.compose.yaml"
grep -Fq 'name: megagoldenclub-redis_megagoldenclub-redis-data' "$SOURCE_DIR/megagoldenclub-redis.compose.yaml"
grep -Fqx 'aclfile /run/redis/users.acl' "$SOURCE_DIR/redis.conf"

echo '=== PREPARE PROTECTED SERVER-ONLY CONFIGURATION ==='
install -d -o root -g root -m 0700 "$REDIS_DIR"
install -o root -g root -m 0600 "$SOURCE_DIR/megagoldenclub-redis.compose.yaml" "$COMPOSE"
install -o root -g root -m 0644 "$SOURCE_DIR/redis.conf" "$CONFIG"

echo '=== GENERATE REDIS ACL SECRET WITHOUT LOGGING ==='
PASSWORD="$(openssl rand -hex 32)"
if [[ ! "$PASSWORD" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'STOP: Redis password entropy check failed' >&2
  exit 1
fi
PASSWORD_HASH="$(printf '%s' "$PASSWORD" | sha256sum | cut -d ' ' -f 1)"
if [[ ! "$PASSWORD_HASH" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'STOP: Redis ACL password hashing failed' >&2
  exit 1
fi
# Hash stored in Redis ACL; plaintext password stays only in protected API env.
printf 'user default reset on #%s ~* &* +@all\n' "$PASSWORD_HASH" > "$ACL"
chown 10001:10001 "$ACL"
chmod 0400 "$ACL"
{
  printf 'REDIS_HOST=127.0.0.1\n'
  printf 'REDIS_PORT=6381\n'
  printf 'REDIS_PASSWORD=%s\n' "$PASSWORD"
  printf 'REDIS_TLS=false\n'
} > "$APP_CREDENTIALS"
chown root:megagoldenclub "$APP_CREDENTIALS"
chmod 0640 "$APP_CREDENTIALS"
runuser -u megagoldenclub -- test -r "$APP_CREDENTIALS"

echo '=== VALIDATE COMPOSE BEFORE CHANGING DOCKER STATE ==='
docker compose -f "$COMPOSE" config --quiet

echo '=== PREPARE DEDICATED REDIS DATA VOLUME FOR NON-ROOT UID ==='
docker pull "$IMAGE" >/dev/null
docker volume create \
  --label com.docker.compose.project=megagoldenclub-redis \
  --label com.docker.compose.volume=megagoldenclub-redis-data \
  "$VOLUME" >/dev/null
docker run --rm --pull=never --network none \
  --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER \
  --mount "type=volume,src=$VOLUME,dst=/data,volume-nocopy" \
  --entrypoint sh "$IMAGE" -ec \
  'chown 10001:10001 /data && chmod 0700 /data'
docker run --rm --pull=never --network none --read-only \
  --user 10001:10001 --cap-drop ALL \
  --mount "type=volume,src=$VOLUME,dst=/data,volume-nocopy" \
  --entrypoint sh "$IMAGE" -ec \
  'test -w /data && test -x /data && touch /data/.redis-volume-write-test && rm /data/.redis-volume-write-test'
echo 'Redis data volume ownership: PASS'

echo '=== START ONLY DEDICATED REDIS ==='
docker compose -f "$COMPOSE" up -d --no-deps redis

echo '=== VERIFY PASSWORD AUTHENTICATION AND ANONYMOUS ACCESS DENIAL ==='
AUTH_PASS=0
for attempt in $(seq 1 30); do
  response="$(printf '%s' "$PASSWORD" | \
    docker exec -i "$CONTAINER" redis-cli --raw -x AUTH 2>/dev/null || true)"
  if [[ "$response" == 'OK' ]]; then
    AUTH_PASS=1
    break
  fi
  sleep 2
done
if [[ "$AUTH_PASS" != 1 ]]; then
  echo 'STOP: Redis password authentication failed; leave credentials and volume intact' >&2
  exit 1
fi
anonymous="$(docker exec "$CONTAINER" redis-cli --raw PING 2>/dev/null || true)"
if [[ "$anonymous" != *'NOAUTH'* ]]; then
  echo 'STOP: Redis anonymous access was not explicitly denied' >&2
  exit 1
fi
BIND_PORT="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}' "$CONTAINER")"
if [[ "$BIND_PORT" != '127.0.0.1:6381' ]]; then
  echo 'STOP: Redis published bind is not loopback-only 127.0.0.1:6381' >&2
  exit 1
fi
unset PASSWORD PASSWORD_HASH
echo 'Redis password authentication: PASS'
echo 'Redis anonymous access: DENIED'
echo 'Redis host bind: 127.0.0.1:6381'
echo "Protected API Redis env fragment: $APP_CREDENTIALS"
echo 'MEGAGOLDENCLUB REDIS STARTUP AND LOGIN: PASS'
echo 'Existing MongoDB, MySQL, Redis 6379/6380, other containers: UNTOUCHED'
