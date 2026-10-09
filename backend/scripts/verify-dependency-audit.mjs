import { spawnSync } from 'node:child_process';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const ALLOWED_DEV_MODERATE_ADVISORIES = new Set([
  'GHSA-hp3w-g68c-fv3c',
]);

function runAudit(extraArgs = []) {
  const result = spawnSync(NPM, ['audit', '--json', ...extraArgs], {
    encoding: 'utf8',
    env: process.env,
  });

  if (!result.stdout?.trim()) {
    throw new Error(
      `npm audit produced no JSON output${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
    );
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse npm audit JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (report.error) {
    throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`);
  }

  return report;
}

function counts(report) {
  const value = report?.metadata?.vulnerabilities ?? {};
  return {
    info: Number(value.info ?? 0),
    low: Number(value.low ?? 0),
    moderate: Number(value.moderate ?? 0),
    high: Number(value.high ?? 0),
    critical: Number(value.critical ?? 0),
    total: Number(value.total ?? 0),
  };
}

function advisoryId(url) {
  const match = String(url ?? '').match(/GHSA-[0-9A-Za-z-]+/i);
  return match ? match[0].toUpperCase() : null;
}

function sourceAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      const id = advisoryId(via.url);
      if (!id) continue;
      advisories.set(id, {
        id,
        severity: String(via.severity ?? '').toLowerCase(),
        title: String(via.title ?? ''),
        url: String(via.url ?? ''),
      });
    }
  }
  return [...advisories.values()];
}

const production = runAudit(['--omit=dev']);
const productionCounts = counts(production);
if (productionCounts.total !== 0) {
  throw new Error(
    `Production dependency audit must be clean; found ${JSON.stringify(productionCounts)}`,
  );
}
console.log('MegaGoldenClub production dependency audit: PASS (0 vulnerabilities)');

const full = runAudit();
const fullCounts = counts(full);
if (fullCounts.high > 0 || fullCounts.critical > 0) {
  throw new Error(
    `High/critical dependency findings are not allowed; found ${JSON.stringify(fullCounts)}`,
  );
}

const advisories = sourceAdvisories(full);
const unknownModerate = advisories.filter(
  (item) =>
    item.severity === 'moderate' &&
    !ALLOWED_DEV_MODERATE_ADVISORIES.has(item.id),
);
if (unknownModerate.length > 0) {
  throw new Error(
    `Unreviewed moderate dependency advisories found: ${unknownModerate
      .map((item) => `${item.id} ${item.title}`)
      .join('; ')}`,
  );
}

const allowedModerate = advisories.filter(
  (item) =>
    item.severity === 'moderate' &&
    ALLOWED_DEV_MODERATE_ADVISORIES.has(item.id),
);

if (
  fullCounts.moderate > 0 &&
  allowedModerate.length === 0
) {
  throw new Error(
    `Moderate dependency findings exist without a reviewed source advisory: ${JSON.stringify(fullCounts)}`,
  );
}

console.log(
  `MegaGoldenClub full dependency audit: PASS (${fullCounts.moderate} reviewed dev-only moderate finding(s), 0 high, 0 critical)`,
);
if (allowedModerate.length > 0) {
  console.log(
    `Reviewed upstream dev-only advisory: ${allowedModerate
      .map((item) => item.id)
      .sort()
      .join(', ')}`,
  );
}
