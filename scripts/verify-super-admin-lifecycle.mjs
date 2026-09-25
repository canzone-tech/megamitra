import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('backend/package.json'));
const envExample = read('.env.example');
const bootstrap = read('backend/scripts/bootstrap-super-admin.ts');
const breakGlass = read('backend/scripts/reset-super-admin-password.ts');
const failures = [];

if (packageJson.scripts?.['super-admin:bootstrap'] !== 'ts-node scripts/bootstrap-super-admin.ts') {
  failures.push('backend/package.json: super-admin:bootstrap contract drifted');
}
if (packageJson.scripts?.['super-admin:reset-break-glass'] !== 'ts-node scripts/reset-super-admin-password.ts') {
  failures.push('backend/package.json: super-admin:reset-break-glass contract drifted');
}

for (const forbidden of ['SUPER_ADMIN_PASSWORD=', 'SUPER_ADMIN_ROTATE_PASSWORD', 'BREAK_GLASS_SUPER_ADMIN_PASSWORD']) {
  if (envExample.includes(forbidden)) {
    failures.push(`.env.example: persistent privileged credential/control is forbidden: ${forbidden}`);
  }
}

if (bootstrap.includes('SUPER_ADMIN_ROTATE_PASSWORD')) {
  failures.push('bootstrap-super-admin.ts: bootstrap must never rotate an existing password');
}
if (/prisma\.user\.update\s*\(/.test(bootstrap) || /authSession\.updateMany\s*\(/.test(bootstrap)) {
  failures.push('bootstrap-super-admin.ts: bootstrap must be create-only');
}
if (!/prisma\.user\.create\s*\(/.test(bootstrap) || !/userRole\.create\s*\(/.test(bootstrap)) {
  failures.push('bootstrap-super-admin.ts: expected first-install user and SUPER_ADMIN role creation');
}

for (const required of [
  'BREAK_GLASS_CONFIRM',
  'RESET_SUPER_ADMIN_PASSWORD',
  'BREAK_GLASS_REASON',
  'mustChangePassword: true',
  "revocationReason: 'break_glass_password_reset'",
  'auditLog.create',
  "operation: 'break_glass_super_admin_password_reset'",
]) {
  if (!breakGlass.includes(required)) {
    failures.push(`reset-super-admin-password.ts: required break-glass control missing: ${required}`);
  }
}
if (/status\s*:/.test(breakGlass)) {
  failures.push('reset-super-admin-password.ts: break-glass password reset must not change account status');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('MegaGoldenClub SUPER_ADMIN lifecycle verification: PASS');
