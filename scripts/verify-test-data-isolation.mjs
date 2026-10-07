import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const relativePath = 'backend/test/program-orchestration.integration-spec.ts';
const content = readFileSync(resolve(rootDir, relativePath), 'utf8');

const forbidden = [
  /sourceKey\s*:\s*\{\s*startsWith\s*:\s*['"]PROGRAM_EVENT:['"]\s*\}/,
  /sourceKey\s+LIKE\s+['"]PROGRAM_EVENT:%['"]/i,
];

for (const pattern of forbidden) {
  if (pattern.test(content)) {
    throw new Error(
      `${relativePath}: integration teardown must never globally sweep PROGRAM_EVENT data; scope cleanup to fixture business-event/qualifying-event ids`,
    );
  }
}

for (const required of [
  'cleanupQualifyingEventIds',
  'FROM program_binary_qualification_links',
  'WHERE businessEventId IN',
  'PROGRAM_EVENT:UAT-SENTINEL:',
]) {
  if (!content.includes(required)) {
    throw new Error(
      `${relativePath}: missing fixture-scoped teardown guard ${JSON.stringify(required)}`,
    );
  }
}

console.log('MegaGoldenClub integration test data-isolation verification: PASS');
