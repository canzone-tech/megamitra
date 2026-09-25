import fs from 'node:fs';
import path from 'node:path';

const roots = ['admin/app', 'admin/components', 'frontend/app', 'frontend/components'];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith('.tsx')) files.push(file);
  }
}
roots.forEach(walk);

const forbiddenCopy = [
  /\bMitra\b/i,
  /\bHttpOnly\b/i,
  /\bsession tokens?\b/i,
  /verified by (?:the )?(?:MegaGoldenClub )?API/i,
  /canonical .*security flow/i,
];

const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenCopy) {
    if (pattern.test(source)) failures.push(`${file}: forbidden client-facing source pattern ${pattern}`);
  }
  for (const match of source.matchAll(/<form\b[^>]*>/g)) {
    const tag = match[0];
    if (/\bonSubmit=/.test(tag) && !/\bmethod=/.test(tag)) {
      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${file}:${line}: interactive form must declare method="post" to prevent native GET fallback`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('MegaGoldenClub frontend safety verification: PASS');
