#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
UPGRADE='infra/ubuntu-vps/upgrade-dedicated-runtime.sh'
DOWNLOADER='infra/ubuntu-vps/deploy-reviewed-update.sh'
bash -n "$UPGRADE"
bash -n "$DOWNLOADER"

for required in \
  'flock -n 9' \
  'PM2_HOME=$PM2_HOME_DIR' \
  'runuser -u "$SERVICE"' \
  'readlink "$CURRENT"' \
  'MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED' \
  'check_health' \
  'rollback()' \
  'ROLLBACK VERIFIED' \
  'pm2_isolated save'; do
  grep -Fq "$required" "$UPGRADE" || {
    echo "STOP: upgrade lost safety invariant: $required" >&2; exit 1;
  }
done
for required in \
  'MEGAGOLDENCLUB_RECOVERY_SIGNOFF' \
  'runtime-$NEW_SHA/megagoldenclub-runtime.zip' \
  'stage-runtime.py' \
  'reconcile-staged-runtime.py' \
  'upgrade-dedicated-runtime.sh'; do
  grep -Fq "$required" "$DOWNLOADER" || {
    echo "STOP: reviewed downloader lost safeguard: $required" >&2; exit 1;
  }
done
for forbidden in \
  'pm2 kill' 'systemctl restart apache' \
  'docker compose down' 'docker volume rm' \
  'prisma migrate' 'git checkout' 'git pull'; do
  if grep -Fiq "$forbidden" <(sed '/^[[:space:]]*#/d' "$UPGRADE" "$DOWNLOADER"); then
    echo "STOP: upgrade contains forbidden unsafe operation: $forbidden" >&2
    exit 1
  fi
done

# Test the same real atomic switch function on disposable symlinks.
# Failures must not delete the previous target or silently overwrite mismatch.
TMP="$(mktemp -d -t megagoldenclub-update-fixture.XXXXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
awk '/^atomic_switch\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' "$UPGRADE" >"$TMP/atomic.sh"
source "$TMP/atomic.sh"
BASE="$TMP"
CURRENT="$BASE/current"
OLD="$BASE/releases/old"
NEW="$BASE/releases/new"
LINK_TMP="$BASE/.pending-current-test"
mkdir -p "$OLD" "$NEW"
ln -s "$OLD" "$CURRENT"
atomic_switch "$OLD" "$NEW"
[[ "$(readlink "$CURRENT")" == "$NEW" && -d "$OLD" && ! -e "$LINK_TMP" ]]
atomic_switch "$NEW" "$OLD"
[[ "$(readlink "$CURRENT")" == "$OLD" && -d "$NEW" ]]
if atomic_switch "$NEW" "$OLD"; then
  echo 'STOP: mismatched old release should not be replaced' >&2; exit 1
fi
[[ "$(readlink "$CURRENT")" == "$OLD" ]]
touch "$LINK_TMP"
if atomic_switch "$OLD" "$NEW"; then
  echo 'STOP: occupied pending-switch path should fail closed' >&2; exit 1
fi
[[ "$(readlink "$CURRENT")" == "$OLD" ]]
echo 'Existing production release scoped update/atomic rollback regression: PASS'
