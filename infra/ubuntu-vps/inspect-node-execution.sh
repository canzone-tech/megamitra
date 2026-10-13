#!/usr/bin/env bash
# Read-only, dedicated-account diagnostic for failed PM2 daemon exec.
# Never starts PM2, changes permissions, deletes a file, or reads secrets.
set -euo pipefail
set +x
SERVICE=megagoldenclub
NODE=/usr/bin/node
HOME_DIR=/var/lib/megagoldenclub
PM2_DIR="$HOME_DIR/.pm2"

if [[ "$EUID" -ne 0 || "$#" -ne 0 ]]; then
  echo 'STOP: run as root without arguments (read-only check)' >&2
  exit 1
fi
id "$SERVICE" >/dev/null 2>&1 || { echo 'STOP: dedicated Unix account not found'; exit 1; }

echo '=== DEDICATED NODE EXECUTION DIAGNOSTIC (READ ONLY) ==='
printf 'Dedicated user: %s (uid=%s gid=%s)\n' \
  "$SERVICE" "$(id -u "$SERVICE")" "$(id -g "$SERVICE")"
echo 'Node path: /usr/bin/node'
if [[ -L "$NODE" ]]; then
  echo "Node symlink target: $(readlink -- "$NODE")"
fi
if [[ -e "$NODE" ]]; then
  stat -Lc 'Resolved Node type=%F owner=%U group=%G mode=%a' -- "$NODE" || true
  readlink -e -- "$NODE" || true
  if command -v namei >/dev/null 2>&1; then
    echo '=== NODE PATH COMPONENT MODES ==='
    namei -l -- "$NODE" || true
    RESOLVED="$(readlink -e -- "$NODE" || true)"
    if [[ -n "$RESOLVED" && "$RESOLVED" != "$NODE" ]]; then
      namei -l -- "$RESOLVED" || true
    fi
  fi
  if command -v findmnt >/dev/null 2>&1; then
    echo '=== NODE FILESYSTEM MOUNT (READ ONLY) ==='
    findmnt -T "$NODE" -n -o TARGET,FSTYPE,OPTIONS || true
  fi
  if command -v getfacl >/dev/null 2>&1; then
    echo '=== NODE EXECUTABLE ACL (READ ONLY) ==='
    getfacl -cp -- "$NODE" 2>/dev/null || true
  fi
else
  echo 'Node executable: MISSING'
fi

echo '=== EXECUTE SAME SYSTEM NODE AS DEDICATED SERVICE USER ==='
if runuser -u "$SERVICE" -- test -x "$NODE"; then
  echo 'Dedicated user test -x /usr/bin/node: PASS'
else
  echo 'Dedicated user test -x /usr/bin/node: FAIL'
fi
if command -v timeout >/dev/null 2>&1; then
  if timeout 12s runuser -u "$SERVICE" -- "$NODE" --version; then
    echo 'Dedicated user actual Node exec: PASS'
  else
    echo 'Dedicated user actual Node exec: FAIL'
  fi
else
  if runuser -u "$SERVICE" -- "$NODE" --version; then
    echo 'Dedicated user actual Node exec: PASS'
  else
    echo 'Dedicated user actual Node exec: FAIL'
  fi
fi
PM2_BIN="$(command -v pm2 || true)"
if [[ -n "$PM2_BIN" ]]; then
  echo '=== PM2 EXECUTABLE PATH (DO NOT START PM2) ==='
  printf 'PM2 binary path: %s\n' "$PM2_BIN"
  stat -Lc 'PM2 executable owner=%U group=%G mode=%a type=%F' -- "$PM2_BIN" || true
  if runuser -u "$SERVICE" -- test -x "$PM2_BIN"; then
    echo 'Dedicated service account PM2 binary test -x: PASS'
  else
    echo 'Dedicated service account PM2 binary test -x: FAIL'
  fi
fi

echo '=== DEDICATED PM2 HOME (METADATA ONLY; NO PM2 INVOCATION) ==='
for directory in "$HOME_DIR" "$PM2_DIR"; do
  if [[ -e "$directory" || -L "$directory" ]]; then
    stat -c '%n owner=%U group=%G mode=%a type=%F' -- "$directory" || true
  else
    printf '%s ABSENT\n' "$directory"
  fi
done
if [[ -d "$PM2_DIR" && ! -L "$PM2_DIR" ]]; then
  echo 'Dedicated PM2_HOME immediate entry names (no contents):'
  find "$PM2_DIR" -mindepth 1 -maxdepth 1 -printf '  %f (%y)\n' 2>/dev/null | sort || true
fi
echo '=== EXISTING DEDICATED USER PROCESSES (NO ARGUMENTS/SECRETS) ==='
ps -eo user=,pid=,comm= | awk '$1 == "megagoldenclub" { print $1, $2, $3 }' || true
echo 'DEDICATED NODE/PM2 DIAGNOSTIC: COMPLETE (READ ONLY)'
