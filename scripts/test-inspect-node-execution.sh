#!/usr/bin/env bash
set -euo pipefail
bash -n infra/ubuntu-vps/inspect-node-execution.sh
source_file=infra/ubuntu-vps/inspect-node-execution.sh
for marker in \
 'runuser -u "$SERVICE" -- "$NODE" --version' \
 'namei -l' \
 'findmnt -T' \
 'Dedicated PM2_HOME immediate entry names' \
 'READ ONLY' \
 'DEDICATED NODE/PM2 DIAGNOSTIC: COMPLETE'; do
  grep -Fq "$marker" "$source_file"
done
if grep -E 'chmod |chown |kill -|pm2 (start|delete|kill|restart|reload)|systemctl (restart|stop)|rm -|docker (stop|rm|restart)' "$source_file"; then
  echo 'Unsafe mutation included in read-only node/PM2 diagnostic' >&2
  exit 1
fi
echo 'Read-only dedicated Node/PM2 diagnosis static gate: PASS'
