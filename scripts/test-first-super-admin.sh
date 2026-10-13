#!/usr/bin/env bash
set -euo pipefail
bash -n infra/ubuntu-vps/bootstrap-first-super-admin.sh
node --check infra/ubuntu-vps/bootstrap-first-super-admin.mjs
node scripts/verify-super-admin-lifecycle.mjs
grep -Fq 'bootstrapCreateOnly' infra/ubuntu-vps/bootstrap-first-super-admin.mjs
grep -Fq 'existingAdmins !== 0' infra/ubuntu-vps/bootstrap-first-super-admin.mjs
grep -Fq "username = 'superadmin'" infra/ubuntu-vps/bootstrap-first-super-admin.mjs
grep -Fq 'createRequire' infra/ubuntu-vps/bootstrap-first-super-admin.mjs
grep -Fq 'mustChangePassword: true' backend/src/auth/super-admin-lifecycle.service.ts
grep -Fq 'read -rs' infra/ubuntu-vps/bootstrap-first-super-admin.sh
grep -Fq 'runuser -u "$SERVICE"' infra/ubuntu-vps/bootstrap-first-super-admin.sh
grep -Fq 'unset PASS' infra/ubuntu-vps/bootstrap-first-super-admin.sh
for forbidden in 'npm install' 'npm ci' 'prisma migrate' 'mysql -u' 'docker ' 'pm2 ' 'systemctl restart' 'chmod -R' 'SUPER_ADMIN_PASSWORD='; do
  if grep -Fq "$forbidden" infra/ubuntu-vps/bootstrap-first-super-admin.sh; then
    echo "STOP: unsafe first-admin operation: $forbidden" >&2
    exit 1
  fi
done
echo 'First SUPER_ADMIN source-free create-only bootstrap contract: PASS'
