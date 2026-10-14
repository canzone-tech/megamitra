#!/usr/bin/env node
// Contract: scripts invoked directly must remain executable after git pull.
// Verify both Git index (for CI) and checked-out filesystem (for local parity).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredExecutable = [
  'backend/scripts/verify-local.sh',
  'scripts/verify-branding.sh',
  'scripts/verify-frontends.sh',
  'scripts/test-upgrade-runtime.sh',
  'infra/ubuntu-vps/deploy-reviewed-update.sh',
  'infra/ubuntu-vps/upgrade-dedicated-runtime.sh',
];

for (const relative of requiredExecutable) {
  const index = execFileSync('git', ['ls-files', '--stage', '--', relative], { cwd: root, encoding: 'utf8' }).trim();
  assert.match(index, /^100755 [0-9a-f]{40} 0\t/, `${relative} must have executable mode 100755 in Git index`);
  if (process.platform !== 'win32') {
    const mode = statSync(resolve(root, relative)).mode & 0o111;
    assert.notEqual(mode, 0, `${relative} lost its executable permission in this checkout`);
  }
}
console.log('Executable deployment and verification script modes: PASS');
