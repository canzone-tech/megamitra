import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('backend/package.json'));
const envExample = read('.env.example');
const bootstrap = read('backend/scripts/bootstrap-super-admin.ts');
const breakGlass = read('backend/scripts/reset-super-admin-password.ts');
const lifecycle = read('backend/src/auth/super-admin-lifecycle.service.ts');
const authModule = read('backend/src/auth/auth.module.ts');
const failures = [];

if (packageJson.scripts?.['super-admin:bootstrap'] !== 'ts-node scripts/bootstrap-super-admin.ts') {
  failures.push('backend/package.json: super-admin:bootstrap contract drifted');
}
if (packageJson.scripts?.['super-admin:reset-break-glass'] !== 'ts-node scripts/reset-super-admin-password.ts') {
  failures.push('backend/package.json: super-admin:reset-break-glass contract drifted');
}

for (const forbidden of ['SUPER_ADMIN_PASSWORD=', 'SUPER_ADMIN_ROTATE_PASSWORD', 'BREAK_GLASS_SUPER_ADMIN_PASSWORD']) {
  if (envExample.includes(forbidden)) failures.push(`.env.example: persistent privileged credential/control is forbidden: ${forbidden}`);
}

if (bootstrap.includes('SUPER_ADMIN_ROTATE_PASSWORD')) failures.push('bootstrap-super-admin.ts: bootstrap must never rotate an existing password');
if (!bootstrap.includes('bootstrapCreateOnly')) failures.push('bootstrap-super-admin.ts: wrapper must delegate to bootstrapCreateOnly');
if (/prisma\.|passwords\./.test(bootstrap)) failures.push('bootstrap-super-admin.ts: wrapper must not own persistence/password logic');

for (const required of ['BREAK_GLASS_CONFIRM', 'RESET_SUPER_ADMIN_PASSWORD', 'BREAK_GLASS_REASON', 'breakGlassReset']) {
  if (!breakGlass.includes(required)) failures.push(`reset-super-admin-password.ts: required wrapper control missing: ${required}`);
}
if (/prisma\.|passwords\./.test(breakGlass)) failures.push('reset-super-admin-password.ts: wrapper must not own persistence/password logic');

for (const required of [
  'bootstrapCreateOnly',
  'tx.user.create',
  'tx.userRole.create',
  'already_exists',
  'breakGlassReset',
  'mustChangePassword: true',
  "revocationReason: 'break_glass_password_reset'",
  'tx.auditLog.create',
  "operation: 'break_glass_super_admin_password_reset'",
]) {
  if (!lifecycle.includes(required)) failures.push(`super-admin-lifecycle.service.ts: required lifecycle invariant missing: ${required}`);
}
if (!/bootstrapCreateOnly[\s\S]*?if \(existing\)[\s\S]*?return \{ status: 'already_exists'/.test(lifecycle)) {
  failures.push('super-admin-lifecycle.service.ts: existing SUPER_ADMIN must return without mutation');
}
const breakGlassBody = lifecycle.split('async breakGlassReset')[1] ?? '';
if (/data:\s*\{[\s\S]{0,300}\bstatus\s*:/.test(breakGlassBody)) failures.push('super-admin-lifecycle.service.ts: break-glass reset must not change account status');
if (!authModule.includes('SuperAdminLifecycleService')) failures.push('auth.module.ts: lifecycle service must be registered and exported');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('MegaGoldenClub SUPER_ADMIN lifecycle verification: PASS');
