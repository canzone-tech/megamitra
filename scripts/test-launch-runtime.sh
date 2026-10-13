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
# Safely accept legacy empty PM2_HOME from root/service bootstrap.
for MODE in 700 750 755; do
  chmod "$MODE" "$PM2_FIXTURE"
  verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"
done
chmod 0700 "$PM2_FIXTURE"
for MODE in 777 775 770 2755; do
  chmod "$MODE" "$PM2_FIXTURE"
  if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$UID_NOW" "$GID_NOW"; then
    echo "STOP: unsafe PM2_HOME mode $MODE incorrectly accepted" >&2; exit 1
  fi
done
chmod 0700 "$PM2_FIXTURE"
if verify_pristine_pm2_home "$HOME_FIXTURE" "$PM2_FIXTURE" "$((UID_NOW+1))" "$((GID_NOW+1))"; then
  echo 'STOP: foreign PM2_HOME owner incorrectly accepted' >&2; exit 1
fi
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

# Real VPS observation: a prior failed attempt left legacy .pm2 with
# module_conf.json, logs/, modules/, pids/, pm2.log, touch. A future first
# launch must NOT delete it, nor treat it as the application PM2_HOME.
LEGACY_HOME="$TMP/legacy-service-home"
mkdir -p "$LEGACY_HOME/.pm2/logs" "$LEGACY_HOME/.pm2/modules" \
  "$LEGACY_HOME/.pm2/pids"
chmod 0700 "$LEGACY_HOME" "$LEGACY_HOME/.pm2"
touch "$LEGACY_HOME/.pm2/module_conf.json" "$LEGACY_HOME/.pm2/pm2.log"
verify_pristine_pm2_home "$LEGACY_HOME" "$LEGACY_HOME/.pm2-runtime" "$UID_NOW" "$GID_NOW"
mkdir "$LEGACY_HOME/.pm2-runtime"
chmod 0700 "$LEGACY_HOME/.pm2-runtime"
verify_pristine_pm2_home "$LEGACY_HOME" "$LEGACY_HOME/.pm2-runtime" "$UID_NOW" "$GID_NOW"
touch "$LEGACY_HOME/.pm2-runtime/dump.pm2"
if verify_pristine_pm2_home "$LEGACY_HOME" "$LEGACY_HOME/.pm2-runtime" "$UID_NOW" "$GID_NOW"; then
  echo 'STOP: active runtime PM2_HOME incorrectly accepted' >&2
  exit 1
fi
test -f "$LEGACY_HOME/.pm2/module_conf.json"
echo 'Preserve legacy PM2 bootstrap state and use clean runtime PM2_HOME: PASS'

# Existing bootstrap manifest must be reused if its bytes are identical,
# root-owned, and safely readable. Refuse altered/linked/world-writable files.
awk '/^verify_existing_ecosystem\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' \
  infra/ubuntu-vps/launch-dedicated-runtime.sh > "$TMP/ecosystem-validator.sh"
source "$TMP/ecosystem-validator.sh"
OPS_FIXTURE="$TMP/reviewed-ops.cjs"
EXISTING_FIXTURE="$TMP/existing-ops.cjs"
printf '%s\n' "module.exports = { apps: [] };" > "$OPS_FIXTURE"
cp "$OPS_FIXTURE" "$EXISTING_FIXTURE"
for MODE in 600 640 644; do
  chmod "$MODE" "$EXISTING_FIXTURE"
  verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW" "$GID_NOW"
  # Simulate root:megagoldenclub 0640: noncanonical group, but dedicated
  # service group is authorized. No chown or real production accounts in CI.
  verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$((GID_NOW+1))" "$GID_NOW"
done
chmod 0644 "$EXISTING_FIXTURE"
printf '%s\n' "module.exports = { apps: ['different'] };" > "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: changed PM2 manifest incorrectly accepted' >&2; exit 1
fi
cp "$OPS_FIXTURE" "$EXISTING_FIXTURE"
for MODE in 660 664 666 777 755; do
  chmod "$MODE" "$EXISTING_FIXTURE"
  if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW" "$GID_NOW"; then
    echo "STOP: unsafe PM2 manifest mode $MODE incorrectly accepted" >&2; exit 1
  fi
done
chmod 0644 "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$((UID_NOW+1))" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: unexpected PM2 manifest owner incorrectly accepted' >&2; exit 1
fi
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$((GID_NOW+1))" "$((GID_NOW+2))"; then
  echo 'STOP: foreign PM2 manifest group incorrectly accepted' >&2; exit 1
fi
ln "$EXISTING_FIXTURE" "$TMP/linked-manifest.cjs"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: hardlinked PM2 manifest incorrectly accepted' >&2; exit 1
fi
rm "$TMP/linked-manifest.cjs"
rm "$EXISTING_FIXTURE"
ln -s "$OPS_FIXTURE" "$EXISTING_FIXTURE"
if verify_existing_ecosystem "$EXISTING_FIXTURE" "$OPS_FIXTURE" "$UID_NOW" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: symlink PM2 manifest incorrectly accepted' >&2; exit 1
fi

# Prove old root-private staging dirs can be reconciled without recursion,
# after validating ALL boundaries. Fixture owned by this CI runner.
awk '/^ensure_staged_runtime_traversal\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' \
  infra/ubuntu-vps/launch-dedicated-runtime.sh > "$TMP/release-validator.sh"
source "$TMP/release-validator.sh"
FIX_BASE="$TMP/megagoldenclub"
FIX_RELEASE="$FIX_BASE/releases/ba4750b6bf0880ebb8b3a76c6af3bc14acb8e4a4"
mkdir -p "$FIX_RELEASE/api/dist"
chmod 0700 "$FIX_BASE" "$FIX_BASE/releases" "$FIX_RELEASE"
printf 'compiled\n' > "$FIX_RELEASE/api/dist/main.js"
chmod 0644 "$FIX_RELEASE/api/dist/main.js"
ensure_staged_runtime_traversal "$FIX_BASE" "$FIX_RELEASE" "$UID_NOW" "$GID_NOW" "$GID_NOW"
for DIRECTORY in "$FIX_BASE" "$FIX_BASE/releases" "$FIX_RELEASE"; do
  [[ "$(stat -c %a "$DIRECTORY")" == 755 ]]
done
[[ "$(stat -c %a "$FIX_RELEASE/api/dist/main.js")" == 644 ]]
chmod 0700 "$FIX_BASE" "$FIX_BASE/releases" "$FIX_RELEASE"
chmod 0777 "$FIX_RELEASE"
if ensure_staged_runtime_traversal "$FIX_BASE" "$FIX_RELEASE" "$UID_NOW" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: unsafe release root was incorrectly accepted' >&2; exit 1
fi
[[ "$(stat -c %a "$FIX_BASE")" == 700 ]]
[[ "$(stat -c %a "$FIX_BASE/releases")" == 700 ]]
chmod 0700 "$FIX_RELEASE"
if ensure_staged_runtime_traversal "$FIX_BASE" "$FIX_RELEASE" "$((UID_NOW+1))" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: foreign release owner was incorrectly accepted' >&2; exit 1
fi
mv "$FIX_RELEASE" "$FIX_BASE/releases/actual"
ln -s "$FIX_BASE/releases/actual" "$FIX_RELEASE"
if ensure_staged_runtime_traversal "$FIX_BASE" "$FIX_RELEASE" "$UID_NOW" "$GID_NOW" "$GID_NOW"; then
  echo 'STOP: symlink release root was incorrectly accepted' >&2; exit 1
fi
echo 'Root-private staged-release traversal reconciliation regression: PASS'

# Exercise the actual PM2 wrapper without running the production PM2 daemon.
# The launch command is typically invoked from a root-only directory; PM2
# must enter the dedicated service home BEFORE the privilege drop.
awk '/^pm2_isolated\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' \
  infra/ubuntu-vps/launch-dedicated-runtime.sh > "$TMP/pm2-wrapper.sh"
source "$TMP/pm2-wrapper.sh"
HOME_DIR="$TMP/dedicated-runtime-home"
PM2_HOME_DIR="$HOME_DIR/.pm2-runtime"
SERVICE='fixture-service'
PM2_BIN="$TMP/fake-pm2"
mkdir -p "$PM2_HOME_DIR" "$TMP/private-root"
chmod 0700 "$TMP/private-root"
cat > "$PM2_BIN" <<'FAKE_PM2'
#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 2 && "$1" == start && "$2" == test-ecosystem.cjs ]]
[[ "$(pwd -P)" == "$HOME" ]]
[[ "$PM2_HOME" == "$HOME/.pm2-runtime" ]]
printf 'CWD_CORRECT\n' > "$PM2_TEST_OUTPUT"
FAKE_PM2
chmod 0700 "$PM2_BIN"
# Function override replaces only runuser in disposable fixture. It validates
# the desired privilege-boundary invocation and executes the fake PM2 script.
runuser() {
  [[ "$1" == -u && "$2" == "$SERVICE" && "$3" == -- && "$4" == env ]]
  shift 4
  env "$@"
}
export PM2_TEST_OUTPUT="$TMP/pm2-cwd.result"
(
  cd "$TMP/private-root"
  pm2_isolated start test-ecosystem.cjs
)
[[ "$(<"$PM2_TEST_OUTPUT")" == CWD_CORRECT ]]
echo 'PM2 child process working directory isolation regression: PASS'

echo 'Isolated first-deployment PM2 contract static regression: PASS'
