#!/usr/bin/env bash
# Root-only, one-time SUPER_ADMIN bootstrap. Requires pinned companion .mjs.
# Password never goes in shell history, process arguments, env, or a file.
set -euo pipefail
set +x
umask 077

SHA='ba4750b6bf0880ebb8b3a76c6af3bc14acb8e4a4'
RELEASE="/opt/megagoldenclub/releases/$SHA"
ROOT='/etc/megagoldenclub'
SERVICE='megagoldenclub'
HELPER="${1:-}"

if (( EUID != 0 )) || (( $# != 1 )) || [[ ! -f "$HELPER" || -L "$HELPER" ]]; then
  echo 'STOP: root-only bootstrap expects the reviewed companion .mjs path' >&2
  exit 1
fi
if [[ ! -L /opt/megagoldenclub/current ||
      "$(readlink /opt/megagoldenclub/current)" != "$RELEASE" ||
      ! -f "$RELEASE/RELEASE_SHA" ||
      "$(<"$RELEASE/RELEASE_SHA")" != "$SHA" ]]; then
  echo 'STOP: pinned source-free runtime is not active' >&2
  exit 1
fi
if [[ "$(stat -c '%U:%G:%a' "$ROOT")" != 'root:megagoldenclub:750' ||
      "$(stat -c '%U:%G:%a' "$ROOT/api.env")" != 'root:megagoldenclub:640' ]]; then
  echo 'STOP: protected configuration identity invalid' >&2
  exit 1
fi
id "$SERVICE" >/dev/null
runuser -u "$SERVICE" -- test -r "$RELEASE/api/dist/app.module.js"
runuser -u "$SERVICE" -- test -r "$ROOT/api.env"
test -r /dev/tty && test -w /dev/tty || {
  echo 'STOP: interactive private terminal required' >&2
  exit 1
}

TEMP_HELPER="$(mktemp "$ROOT/.first-super-admin.XXXXXXXX.mjs")"
PASS=''
CONFIRM=''
cleanup() {
  unset PASS CONFIRM
  rm -f -- "$TEMP_HELPER"
}
trap cleanup EXIT
install -o root -g "$SERVICE" -m 0440 -- "$HELPER" "$TEMP_HELPER"
/usr/bin/node --check "$TEMP_HELPER"

echo 'Creating first SUPER_ADMIN username: superadmin'
IFS= read -rs -p 'Choose initial strong password: ' PASS </dev/tty
printf '\n' >&2
IFS= read -rs -p 'Confirm initial password: ' CONFIRM </dev/tty
printf '\n' >&2
if [[ -z "$PASS" || "$PASS" != "$CONFIRM" ]]; then
  echo 'STOP: empty or mismatched passwords' >&2
  exit 1
fi
unset CONFIRM
# Change cwd before dropping privileges to avoid PM2-style root-cwd EACCES.
(
  cd /var/lib/megagoldenclub
  printf '%s\n' "$PASS" |
    runuser -u "$SERVICE" -- /usr/bin/node \
      "--env-file=$ROOT/api.env" "$TEMP_HELPER"
)
unset PASS
echo 'ONE-TIME SUPER_ADMIN BOOTSTRAP: COMPLETE'
