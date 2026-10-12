#!/usr/bin/env bash
# GitHub-hosted Ubuntu CI only: exercise the REAL recovery against a disposable
# fixture representing the partially provisioned Redis state on the VPS.
# Never run on an operator VPS or a shared/self-hosted runner.
set -euo pipefail
set +x
umask 077

if [[ ! -v GITHUB_ACTIONS || ! -v GITHUB_RUN_ID ]]; then
  echo 'STOP: GitHub Actions-only Redis recovery integration test' >&2
  exit 1
fi
if [[ "$GITHUB_ACTIONS" != true || -z "$GITHUB_RUN_ID" || "$EUID" -ne 0 || "$#" -ne 1 ]]; then
  echo 'STOP: Redis recovery test requires GitHub Actions, root and a source directory' >&2
  exit 1
fi
SOURCE="$1"
ROOT='/etc/megagoldenclub'
DIR="$ROOT/redis"
COMPOSE="$DIR/compose.yaml"
CONTAINER='megagoldenclub-redis'
VOLUME='megagoldenclub-redis_megagoldenclub-redis-data'

# Refuse to use or modify any preexisting service identity, volume or config.
if [[ -e "$ROOT" || -L "$ROOT" ]] || id megagoldenclub >/dev/null 2>&1 ||
   getent group megagoldenclub >/dev/null 2>&1 ||
   docker container inspect "$CONTAINER" >/dev/null 2>&1 ||
   docker volume inspect "$VOLUME" >/dev/null 2>&1 ||
   ss -ltnH '( sport = :6381 )' | grep -q .; then
  echo 'STOP: test Redis identity/port already exists; do not touch it' >&2
  exit 1
fi
for f in recover-redis-volume.sh megagoldenclub-redis.compose.yaml redis.conf; do
  if [[ ! -f "$SOURCE/$f" ]]; then
    echo "STOP: reviewed Redis template missing: $f" >&2
    exit 1
  fi
done

created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
    docker network rm 'megagoldenclub-redis_default' >/dev/null 2>&1 || true
    rm -rf -- "$ROOT"
    userdel megagoldenclub >/dev/null 2>&1 || true
    groupdel megagoldenclub >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Set created before mutation so a partial fixture is cleaned up, but only
# after confirming it does not overlap any existing service identity.
created=1
groupadd megagoldenclub
useradd --system --gid megagoldenclub --no-create-home --shell /usr/sbin/nologin megagoldenclub
install -d -o root -g megagoldenclub -m 0750 "$ROOT"
install -d -o root -g root -m 0700 "$DIR"
install -o root -g root -m 0644 "$SOURCE/redis.conf" "$DIR/redis.conf"

# Independently build the OLD short-form fixture from the reviewed nocopy
# manifest. The production recovery must accept this exact prior file.
python3 - "$SOURCE/megagoldenclub-redis.compose.yaml" "$COMPOSE" <<'PY'
from pathlib import Path
import sys
reviewed = Path(sys.argv[1]).read_text()
nocopy = '''      # Avoid Docker copying the image's UID-999 /data into an empty volume:
      # that copy can undo the offline helper's UID-10001 ownership.
      - type: volume
        source: megagoldenclub-redis-data
        target: /data
        volume:
          nocopy: true
'''
assert reviewed.count(nocopy) == 1, 'Reviewed Redis Compose nocopy stanza changed'
Path(sys.argv[2]).write_text(reviewed.replace(nocopy, '      - megagoldenclub-redis-data:/data\n'))
PY
chmod 0600 "$COMPOSE"
chown root:root "$COMPOSE"

password="$(openssl rand -hex 32)"
hash="$(printf '%s' "$password" | sha256sum | cut -d ' ' -f 1)"
printf 'user default reset on #%s ~* &* +@all\n' "$hash" >"$DIR/users.acl"
chown 10001:10001 "$DIR/users.acl"
chmod 0400 "$DIR/users.acl"
printf 'REDIS_HOST=127.0.0.1\nREDIS_PORT=6381\nREDIS_PASSWORD=%s\nREDIS_TLS=false\n' "$password" >"$ROOT/redis.credentials.env"
chown root:megagoldenclub "$ROOT/redis.credentials.env"
chmod 0640 "$ROOT/redis.credentials.env"
unset password hash

docker pull redis:7.4.11-alpine >/dev/null
docker volume create \
  --label com.docker.compose.project=megagoldenclub-redis \
  --label com.docker.compose.volume=megagoldenclub-redis-data \
  "$VOLUME" >/dev/null

bash "$SOURCE/recover-redis-volume.sh" "$SOURCE"
# The recovery verifies Redis authentication, anonymous denial, and host bind.
cmp -s "$SOURCE/megagoldenclub-redis.compose.yaml" "$COMPOSE"
docker volume inspect "$VOLUME" >/dev/null
[[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" == true ]]
echo 'Redis partial-setup recovery end-to-end regression: PASS'
