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
echo 'Isolated first-deployment PM2 contract static regression: PASS'
