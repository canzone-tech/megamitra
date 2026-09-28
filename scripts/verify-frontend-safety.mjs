import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['admin/app', 'admin/components', 'frontend/app', 'frontend/components'];
const files = [];
function walk(relativeDir) {
  const dir = path.join(repoRoot, relativeDir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativeFile = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) walk(relativeFile);
    else if (entry.isFile() && relativeFile.endsWith('.tsx')) files.push(relativeFile);
  }
}
roots.forEach(walk);

const forbiddenCopy = [
  /\bMitra\b/i,
  /\bHttpOnly\b/i,
  /\bsession tokens?\b/i,
  /verified by (?:the )?(?:MegaGoldenClub )?API/i,
  /canonical .*security flow/i,
  /\bJWT\b/i,
  /\b(?:access|refresh|bearer) token\b/i,
  /Binary 2:2/i,
];

const ownerConfigFiles = new Set([
  'admin/components/business-plan-config.tsx',
  'admin/components/business-plan-forms.tsx',
  'admin/components/entitlements-admin.tsx',
]);
const forbiddenOwnerConfigCopy = [
  /validated configuration payload/i,
  /grant items json/i,
  /published entitlement policy version id/i,
  /\benrollment id\b/i,
  /\bpolicy version id\b/i,
];
const activeRegistrationFiles = new Set([
  'admin/components/owner-core-v14-portal.tsx',
  'admin/components/owner-members-portal.tsx',
  'frontend/components/signup-form.tsx',
]);
const forbiddenMemberTypeCopy = [
  /Optional E-PIN/i,
  /name=["']memberType["']/i,
  />\s*Partner\s*</i,
  />\s*Customer\s*</i,
];

const failures = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  for (const pattern of forbiddenCopy) {
    if (pattern.test(source)) failures.push(`${file}: forbidden client-facing source pattern ${pattern}`);
  }
  for (const match of source.matchAll(/<form\b[^>]*>/g)) {
    const tag = match[0];
    if (/\bonSubmit=/.test(tag) && !/\bmethod=["']post["']/i.test(tag)) {
      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${file}:${line}: interactive form must declare method="post" to prevent native GET fallback`);
    }
  }

  if (ownerConfigFiles.has(file)) {
    for (const pattern of forbiddenOwnerConfigCopy) {
      if (pattern.test(source)) failures.push(`${file}: owner configuration UI exposes technical input ${pattern}`);
    }
    if (/<textarea\b[^>]*className=["'][^"']*mm-json/i.test(source)) {
      failures.push(`${file}: owner configuration UI must not expose a raw JSON editor`);
    }
  }

  if (activeRegistrationFiles.has(file)) {
    for (const pattern of forbiddenMemberTypeCopy) {
      if (pattern.test(source)) failures.push(`${file}: active member registration exposes retired contract ${pattern}`);
    }
  }
}

const navPath = 'admin/components/owner-management-nav.ts';
const navSource = fs.readFileSync(path.join(repoRoot, navPath), 'utf8');
for (const required of [
  "label: 'Binary 1:4'",
  "label: 'Admins & Agents'",
  "label: 'Roles & Permissions'",
]) {
  if (!navSource.includes(required)) failures.push(`${navPath}: missing canonical navigation entry ${required}`);
}
for (const sharedPortal of [
  'admin/components/owner-finance-portal.tsx',
  'admin/components/owner-control-portal.tsx',
]) {
  const source = fs.readFileSync(path.join(repoRoot, sharedPortal), 'utf8');
  if (!source.includes('OwnerManagementShell')) {
    failures.push(`${sharedPortal}: must use canonical OwnerManagementShell navigation`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('MegaGoldenClub frontend safety verification: PASS');
