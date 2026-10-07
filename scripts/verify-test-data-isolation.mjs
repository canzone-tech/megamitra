import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const candidates = [
  ...walk(resolve(rootDir, 'backend/test')).filter((file) => /\.(ts|js)$/.test(file)),
  ...walk(resolve(rootDir, 'backend/src')).filter((file) => /\.spec\.ts$/.test(file)),
];

const forbidden = [
  {
    pattern: /startsWith\s*:\s*['"]PROGRAM_EVENT:/,
    reason: 'tests must not globally query PROGRAM_EVENT-derived records by prefix',
  },
  {
    pattern: /startsWith\s*:\s*['"]BU:/,
    reason: 'tests must not globally query binary sequence state by BU: prefix',
  },
  {
    pattern: /LIKE\s+['"]PROGRAM_EVENT:%/i,
    reason: 'tests must not globally query PROGRAM_EVENT-derived records by SQL prefix',
  },
  {
    pattern: /LIKE\s+['"]BU:%/i,
    reason: 'tests must not globally query binary sequence state by SQL prefix',
  },
];

for (const file of candidates) {
  const source = readFileSync(file, 'utf8');
  for (const { pattern, reason } of forbidden) {
    if (pattern.test(source)) {
      throw new Error(
        `${relative(rootDir, file)}: ${reason}; scope cleanup to fixture-owned ids instead`,
      );
    }
  }
}

const packageJson = JSON.parse(
  readFileSync(resolve(rootDir, 'backend/package.json'), 'utf8'),
);
if (
  packageJson.scripts?.['test:integration'] !==
  'bash scripts/run-integration-tests-isolated.sh'
) {
  throw new Error(
    'backend/package.json: test:integration must use the isolated integration runner',
  );
}
if (
  !String(packageJson.scripts?.['test:integration:raw'] ?? '').includes(
    'NODE_ENV=test',
  )
) {
  throw new Error(
    'backend/package.json: test:integration:raw must force NODE_ENV=test',
  );
}

const isolatedRunner = readFileSync(
  resolve(rootDir, 'backend/scripts/run-integration-tests-isolated.sh'),
  'utf8',
);
for (const required of [
  'TEST_DB=',
  'trap drop_test_db EXIT INT TERM',
  'npx prisma migrate deploy',
  'npm run test:integration:raw',
]) {
  if (!isolatedRunner.includes(required)) {
    throw new Error(
      `backend/scripts/run-integration-tests-isolated.sh: missing isolation contract ${JSON.stringify(required)}`,
    );
  }
}

const localVerify = readFileSync(
  resolve(rootDir, 'backend/scripts/verify-local.sh'),
  'utf8',
);
if (!localVerify.includes('cleanup-stale-integration-staff.ts')) {
  throw new Error(
    'backend/scripts/verify-local.sh: stale integration staff cleanup must run before local integration verification',
  );
}

for (const workerPath of [
  'backend/src/program/program-automation.service.ts',
  'backend/src/rank-achievement/rank-achievement.service.ts',
]) {
  const worker = readFileSync(resolve(rootDir, workerPath), 'utf8');
  if (!worker.includes("process.env.JEST_WORKER_ID")) {
    throw new Error(`${workerPath}: background worker must hard-disable under Jest`);
  }
}

const orchestrationPath = resolve(
  rootDir,
  'backend/test/program-orchestration.integration-spec.ts',
);
const orchestration = readFileSync(orchestrationPath, 'utf8');

for (const required of [
  'cleanupQualifyingEventIds',
  'FROM program_binary_qualification_links',
  'WHERE businessEventId IN',
  'PROGRAM_EVENT:UAT-SENTINEL:',
  'binarySequenceKeys',
]) {
  if (!orchestration.includes(required)) {
    throw new Error(
      `backend/test/program-orchestration.integration-spec.ts: missing fixture-scoped teardown guard ${JSON.stringify(required)}`,
    );
  }
}

console.log(
  `MegaGoldenClub integration test data-isolation verification: PASS (${candidates.length} test files scanned)`,
);
