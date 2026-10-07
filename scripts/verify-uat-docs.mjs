import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

function count(content, needle) {
  return content.split(needle).length - 1;
}

function requireExactlyOnce(relativePath, content, needle) {
  const occurrences = count(content, needle);
  if (occurrences !== 1) {
    throw new Error(
      `${relativePath}: expected exactly one occurrence of ${JSON.stringify(needle)}, found ${occurrences}`,
    );
  }
}

const canonicalDocs = [
  ['docs/BUSINESS-RULES-REGISTER.md', '# MegaGoldenClub — Business Rules Register (Canonical)'],
  ['docs/UAT-CHECKLIST.md', '# MegaGoldenClub UAT Checklist'],
  ['docs/STATEFUL-UAT-COVERAGE.md', '# MegaGoldenClub Stateful UAT Coverage'],
];

for (const [relativePath, heading] of canonicalDocs) {
  const content = read(relativePath);
  if (!content.startsWith(`${heading}\n`)) {
    throw new Error(`${relativePath}: canonical heading must be the first line`);
  }
  requireExactlyOnce(relativePath, content, heading);
}

const statefulPath = 'docs/STATEFUL-UAT-COVERAGE.md';
const stateful = read(statefulPath);

for (const section of [
  '## Stateful business journey matrix',
  '## Required manual stateful release pass',
  '## Open-rule blockers',
  '## Automated baseline completion rule',
]) {
  requireExactlyOnce(statefulPath, stateful, section);
}

for (const invariant of [
  '| Identity, registration, sponsor and paid E-PIN activation |',
  '| Lucky-draw token uniqueness and never-reuse within a Season |',
  '| Payment collection, payout, SMTP and external fulfilment providers |',
  '`^[1-9][0-9]{4}$` format',
]) {
  requireExactlyOnce(statefulPath, stateful, invariant);
}

console.log('MegaGoldenClub canonical UAT documentation verification: PASS');
