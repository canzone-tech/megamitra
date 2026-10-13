#!/usr/bin/env bash
set -euo pipefail
bash -n infra/ubuntu-vps/launch-dedicated-runtime.sh
node --check infra/ubuntu-vps/ecosystem.config.cjs
for wanted in \
  "PM2_HOME_DIR=" \
  "runuser -u" \
  "NODE_ENV" \
  "curl --silent" \
  "DEDICATED SOURCE-FREE DEPLOYMENT: PASS"; do
  grep -Fq "$wanted" infra/ubuntu-vps/launch-dedicated-runtime.sh
done
if grep -E 'pm2 kill|docker compose down|docker volume rm|systemctl restart apache|pm2 startup' \
    infra/ubuntu-vps/launch-dedicated-runtime.sh; then
  echo 'STOP: forbidden unrelated service mutation in launch script' >&2
  exit 1
fi

# Exercise the real home-identity check against isolated disposable fixtures.
# It must accept a pre-created service home but reject symlinks, alien owners,
# unsafe modes and any PM2 state. Never starts a PM2 daemon in CI.
TMP="$(mktemp -d -t megagoldenclub-home-fixture.XXXXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
awk '/^verify_pristine_pm2_home\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' \
  infra/ubuntu-vps/launch-dedicated-runtime.sh > "$TMP/validator.sh"
source "$TMP/validator.sh"
HOME_FIXTURE="$TMP/dedicated-home"
PM2_FIXTURE="$HOME_FIXTURE/.pm2"
UID_NOW="$(id -u)"
GID_NOW="$(id -g)"
verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"
mkdir "$HOME_FIXTURE"
chmod 0755 "$HOME_FIXTURE"
verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"
mkdir "$PM2_FIXTURE"
chmod 0700 "$PM2_FIXTURE"
verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"
touch "$PM2_FIXTURE/dump.pm2"
if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: populated PM2_HOME incorrectly accepted' >&2; exit 1
fi
rm "$PM2_FIXTURE/dump.pm2"
chmod 0777 "$HOME_FIXTURE"
if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: world-writable home incorrectly accepted' >&2; exit 1
fi
chmod 0755 "$HOME_FIXTURE"
mv "$PM2_FIXTURE" "$TMP/held-pm2"
ln -s "$TMP/held-pm2" "$PM2_FIXTURE"
if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: symlink PM2_HOME incorrectly accepted' >&2; exit 1
fi
rm "$PM2_FIXTURE"
rm -r "$HOME_FIXTURE"
ln -s "$TMP" "$HOME_FIXTURE"
if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: symlink service home incorrectly accepted' >&2; exit 1
fi
rm "$HOME_FIXTURE"
mkdir "$HOME_FIXTURE"
chmod 0700 "$HOME_FIXTURE"
if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$((UID_NOW+1))"; then
  echo 'STOP: unexpected ownership incorrectly accepted' >&2; exit 1
fi

# Existing manifest left by a failed pre-start attempt must be reused only if
# identical to the pinned reviewed ops file with protected root file identity.
awk '/^verify_existing_ecosystem\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' \
  infra/ubuntu-vps/launch-dedicated-runtime.sh > "$TMP/ecosystem-validator.sh"
source "$TMP/ecosystem-validator.sh"
OPS_FIXTURE="$TMP/reviewed-ops.cjs"
EXISTING_FIXTURE="$TMP/existing-ops.cjs"
printf '%s\n' "module.exports = { apps: [] };" > "$OPS_FIXTURE"
cp "$OPS_FIXTURE" "$EXISTING_FIXTURE"
chmod 0644 "$EXISTING_FIXTURE"
verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW"
printf '%s\n' "module.exports = { apps: ['different'] };" > "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: changed PM2 manifest incorrectly accepted' >&2; exit 1
fi
cp "$OPS_FIXTURE" "$EXISTING_FIXTURE"
chmod 0600 "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: wrong PM2 manifest permissions incorrectly accepted' >&2; exit 1
fi
chmod 0644 "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$((UID_NOW+1))" "$GID_NOW"; then
  echo 'STOP: wrong PM2 manifest owner incorrectly accepted' >&2; exit 1
fi
rm "$EXISTING_FIXTURE"
ln -s "$OPS_FIXTURE" "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: symlink PM2 manifest incorrectly accepted' >&2; exit 1
fi

echo 'Isolated first-deployment PM2 contract static regression: PASS'
