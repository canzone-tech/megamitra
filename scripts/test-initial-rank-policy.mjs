// Frontend and local verification guard for first-time owner rank policy setup.
// This is a static UI contract; Jest covers the backend default-tier DRAFT behavior.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const panel = readFileSync(resolve(root,'admin/components/rank-achievement-panel.tsx'),'utf8');
const service = readFileSync(resolve(root,'backend/src/rank-achievement/rank-achievement.service.ts'),'utf8');

for (const required of [
  '/api/backend/admin/programs',
  '/api/backend/admin/owner-portal/seasons',
  "'ACTIVE', 'PAUSED'",
  "version.lifecycle === 'PUBLISHED'",
  'version.programVersionId === program.programVersionId',
  'CREATE INITIAL BONUS DRAFT',
  'programVersionId: target.programVersionId',
  'PUBLISH APPROVED DRAFT',
  'finance/payout HOLD stays in place',
]) {
  assert.ok(panel.includes(required), 'First-policy setup UI contract missing: ' + required);
}
assert.ok(panel.includes('CREATE DRAFT FROM PUBLISHED'), 'Existing draft-cloning flow must remain');
assert.ok(panel.includes("window.confirm("), 'First draft and publish need explicit confirmation');
assert.ok(service.includes('rawTiers ?? this.initialFlyerTiers()'),
  'Missing defaults for first DRAFT');
assert.ok(service.includes('lifecycle: PolicyLifecycle.DRAFT'),
  'First policy must remain unpublished');
console.log('First rank-policy draft setup contract: PASS');
