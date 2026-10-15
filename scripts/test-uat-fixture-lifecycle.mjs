// Regression contract for the local verify hang after authenticated UAT cleanup.
// The GitHub Backend CI exercises the REAL fixture create/cleanup with MySQL;
// this dependency-free test checks signal, isolation and bounded-exit guarantees.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = readFileSync(resolve(root, 'backend/scripts/uat-auth-fixture.ts'), 'utf8');
const verifier = readFileSync(resolve(root, 'backend/scripts/verify-local.sh'), 'utf8');

assert.ok(fixture.includes('class UatAuthFixtureModule'), 'UAT fixture needs a scoped Nest module');
assert.ok(fixture.includes('createApplicationContext(UatAuthFixtureModule'),
  'Fixture must start only the scoped context');
assert.ok(!fixture.includes("from '../src/app.module'"),
  'Do not initialize the full background-worker API in one-shot UAT fixture');
assert.ok(fixture.includes('PrismaModule') && fixture.includes('JwtModule.register({})'));
assert.ok(fixture.includes('providers: [PasswordService]'));
assert.ok(fixture.includes('await app.close();'), 'Prisma context must close before exit');
assert.ok(fixture.indexOf('await app.close();') < fixture.indexOf("if (completed)"),
  'Do not log fixture cleanup success before the application actually closes');
assert.ok(fixture.includes('process.exit(0)') && fixture.includes('process.exit(124)'),
  'One-shot fixture cannot retain active handles indefinitely; timeout must fail');
assert.ok(verifier.includes('timeout --signal=TERM --kill-after=3s'),
  'Verifier fixture create/cleanup needs bounded termination');
assert.ok(verifier.includes('cleanup) seconds=35') && verifier.includes('create) seconds=95'));
assert.ok(verifier.includes("trap 'exit 130' INT"),
  'Ctrl+C must terminate verification with a failed exit status');
assert.ok(verifier.includes('trap cleanup EXIT'), 'Cleanup must run on exit');
assert.ok(!verifier.includes('trap cleanup EXIT INT TERM'),
  'SIGINT cleanup alone previously allowed verification to resume and hang');

// Confirm GNU timeout will terminate a child that ignores SIGTERM.
// Runs in isolation; never interacts with existing user processes or ports.
const child = spawnSync('timeout', [
  '--signal=TERM', '--kill-after=1s', '1s',
  process.execPath, '-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 250)',
], { timeout: 5000, encoding: 'utf8' });
assert.ifError(child.error);
assert.ok([124, 137].includes(child.status), 'Hanging subprocess must exit after TERM/KILL timeout (124 or 137)');
console.log('Authenticated UAT fixture lifecycle and Ctrl+C safety: PASS');
