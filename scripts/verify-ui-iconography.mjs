import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const roots = [path.join(rootDir, 'admin'), path.join(rootDir, 'frontend')];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const ignoredDirectories = new Set(['node_modules', '.next', 'dist', 'coverage']);

const placeholderIcons = new Set([
  '▦', '↗', '●', '◇', '⌁', '□', '◆', '★', '▣', '¤', '▤', '⌘', '◈',
  '♟', '⌾', '▥', '◉', '?', '⚙', '◐', '≡', '+', 'i', '=', '1', 'A', '₹', '✓',
]);

const expectedOwnerNav = new Map(Object.entries({
  dashboard: '🏠',
  income: '📈',
  members: '👥',
  binary: '🌳',
  seasons: '📅',
  draw: '🎲',
  winners: '🏆',
  prizes: '🎁',
  payments: '💳',
  'member-payments': '✅',
  wallet: '📒',
  epins: '🔑',
  'auth-codes': '🔐',
  staff: '🧑‍💼',
  rbac: '🛡️',
  reports: '📊',
  notifications: '🔔',
  support: '🎫',
  settings: '⚙️',
}));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectLiteralIcons(source) {
  const values = [];
  const patterns = [
    /symbol:\s*['"]([^'"]+)['"]/g,
    /icon="([^"]+)"/g,
    /sectionIcon}>([^<{][^<]*)<\/span>/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      values.push({ value: match[1].trim(), index: match.index ?? 0 });
    }
  }
  return values;
}

const failures = [];
for (const root of roots) {
  for (const file of await walk(root)) {
    const source = await readFile(file, 'utf8');
    for (const icon of collectLiteralIcons(source)) {
      if (placeholderIcons.has(icon.value)) {
        failures.push(
          `${path.relative(rootDir, file)}:${lineNumber(source, icon.index)} uses placeholder icon "${icon.value}"`,
        );
      }
    }
  }
}

const navPath = path.join(rootDir, 'admin/components/owner-management-nav.ts');
const navSource = await readFile(navPath, 'utf8');
const navIcons = new Map();
for (const match of navSource.matchAll(
  /\{ section: '([^']+)', label: '[^']+', symbol: '([^']+)', group: '[^']+' \}/g,
)) {
  navIcons.set(match[1], match[2]);
}
for (const [section, expectedIcon] of expectedOwnerNav) {
  const actual = navIcons.get(section);
  if (actual !== expectedIcon) {
    failures.push(
      `admin/components/owner-management-nav.ts: ${section} icon must be ${expectedIcon}, found ${actual ?? 'missing'}`,
    );
  }
}
for (const section of navIcons.keys()) {
  if (!expectedOwnerNav.has(section)) {
    failures.push(`admin/components/owner-management-nav.ts: unexpected nav section ${section}`);
  }
}

if (failures.length) {
  console.error('MegaGoldenClub UI iconography verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `MegaGoldenClub UI iconography verification: PASS (${expectedOwnerNav.size} owner navigation icons + project literal icon scan)`,
);
