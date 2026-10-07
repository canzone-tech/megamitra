import 'dotenv/config';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import mariadb from 'mariadb';

export const FAILED_RANK_MIGRATION = '0038_rank_achievement_rewards';
export const OWNED_RANK_TABLES = Object.freeze([
  'rank_monthly_payouts',
  'rank_achievements',
  'rank_reward_policy_versions',
]);

const OWNED_RANK_TABLE_SET = new Set(OWNED_RANK_TABLES);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Fail-closed decision on an existing database. Never change a successful
 * migration, any other failed migration, a remotely hosted database,
 * a populated rank table or objects with unknown dependents.
 */
export function rankRecoveryDecision({
  pendingFailures,
  priorSuccessfulRankMigration = false,
  databaseHost,
  existingTables = [],
  externalReferences = [],
  triggers = [],
} = {}) {
  if (!Array.isArray(pendingFailures) || !Array.isArray(existingTables) ||
      !Array.isArray(externalReferences) || !Array.isArray(triggers)) {
    return { action: 'refuse', reason: 'Migration recovery safety inputs are incomplete' };
  }
  if (pendingFailures.length === 0) {
    return { action: 'none', reason: 'No failed migrations' };
  }
  if (pendingFailures.length !== 1 ||
      pendingFailures[0]?.migration_name !== FAILED_RANK_MIGRATION) {
    return { action: 'refuse', reason: 'A different or additional migration is failed' };
  }
  if (priorSuccessfulRankMigration) {
    return { action: 'refuse', reason: 'Rank migration already has a successful history entry' };
  }
  if (!LOOPBACK_HOSTS.has(String(databaseHost))) {
    return { action: 'refuse', reason: 'Automatic recovery is limited to the local database' };
  }
  if (existingTables.some((table) => !OWNED_RANK_TABLE_SET.has(table.name))) {
    return { action: 'refuse', reason: 'Unexpected schema objects in rank recovery inspection' };
  }
  if (existingTables.some((table) =>
    table.type !== 'BASE TABLE' || !Number.isSafeInteger(table.rows) || table.rows !== 0
  )) {
    return { action: 'refuse', reason: 'Rank tables contain data or are not ordinary empty tables' };
  }
  if (externalReferences.length > 0 || triggers.length > 0) {
    return { action: 'refuse', reason: 'Rank tables have external dependencies or triggers' };
  }
  return {
    action: 'recover',
    reason: 'Only the known rank migration failed; owned tables are absent or empty',
    dropTables: OWNED_RANK_TABLES.filter((name) =>
      existingTables.some((table) => table.name === name)
    ),
  };
}

function databaseOptions() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set; cannot inspect failed migration safely');
  }
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== 'mysql:') {
    throw new Error('Automatic recovery supports only the project MySQL datasource');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error('DATABASE_URL has no database name');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    timezone: '+00:00',
    connectTimeout: 5000,
  };
}

export async function recoverFailedRankMigration() {
  const options = databaseOptions();
  let connection;
  try {
    connection = await mariadb.createConnection(options);
    const historyExists = await connection.query(
      "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='_prisma_migrations'"
    );
    if (Number(historyExists[0]?.total) === 0) {
      console.log('Migration recovery: fresh database; normal Prisma deploy will initialize history.');
      return;
    }

    const history = await connection.query(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name=? OR (finished_at IS NULL AND rolled_back_at IS NULL)",
      [FAILED_RANK_MIGRATION],
    );
    const failures = history.filter((item) => item.finished_at == null && item.rolled_back_at == null);
    if (failures.length === 0) {
      console.log('Migration recovery: no active failed migration; no changes made.');
      return;
    }

    const existing = await connection.query(
      "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)",
      [...OWNED_RANK_TABLES],
    );
    const inspected = [];
    for (const table of existing) {
      const name = String(table.name);
      if (!OWNED_RANK_TABLE_SET.has(name)) throw new Error('Unexpected recovery table ' + name);
      const count = await connection.query('SELECT COUNT(*) AS total FROM \`' + name + '\`');
      inspected.push({
        name, type: String(table.type), rows: Number(count[0]?.total),
      });
    }

    const externalReferences = await connection.query(
      "SELECT TABLE_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IN (?,?,?) AND TABLE_NAME NOT IN (?,?,?)",
      [...OWNED_RANK_TABLES, ...OWNED_RANK_TABLES],
    );
    const triggers = await connection.query(
      "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (?,?,?)",
      [...OWNED_RANK_TABLES],
    );
    const decision = rankRecoveryDecision({
      pendingFailures: failures,
      priorSuccessfulRankMigration: history.some((item) =>
        item.migration_name === FAILED_RANK_MIGRATION && item.finished_at != null
      ),
      databaseHost: options.host,
      existingTables: inspected,
      externalReferences,
      triggers,
    });
    if (decision.action !== 'recover') {
      throw new Error('Migration recovery stopped safely: ' + decision.reason +
        '. Existing database state was not modified. Migration requires operator review.');
    }

    console.log('Migration recovery: confirmed one known failed rank migration on local MySQL.');
    if (decision.dropTables.length > 0) {
      console.log('Migration recovery: removing only empty partial rank tables before replay.');
      for (const name of decision.dropTables) {
        // Drop in FK dependency order; no unknown references and no rows are allowed.
        // Recheck immediately before each DDL. No member/ledger tables are dropped.
        const rowCount = await connection.query('SELECT COUNT(*) AS total FROM \`' + name + '\`');
        if (Number(rowCount[0]?.total) !== 0) {
          throw new Error('Rank recovery stopped: ' + name + ' was populated during preflight');
        }
        await connection.query('DROP TABLE \`' + name + '\`');
        console.log('Migration recovery: cleared empty partial table ' + name);
      }
    }
  } finally {
    if (connection) await connection.end();
  }

  // The official Prisma CLI writes its migration history. Never mutate
  // _prisma_migrations directly or use --applied on a partial migration.
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'migrate', 'resolve', '--rolled-back', FAILED_RANK_MIGRATION],
    { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      env: process.env, stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Prisma failed to mark the inspected rank migration rolled back');
  }
  console.log('Migration recovery: known failed rank migration rolled back in Prisma history.');
  console.log('Migration recovery: next Prisma deploy will apply current 0038 without resetting data.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  recoverFailedRankMigration().catch((error) => {
    console.error('ERROR: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
