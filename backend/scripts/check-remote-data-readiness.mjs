#!/usr/bin/env node
// Run only from a trusted, short-lived operator/migration runner, NEVER from
// the compiled source-free application VPS. Connects read-only to all three
// remote production datastores and never prints credentials or server URIs.
// Requires backend npm ci, real remote endpoints, provisioned scoped users,
// valid CA chains, and the production secret file outside the repository.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { validateProductionConfig } from './verify-production-config.mjs';

const input = process.argv.slice(2);
if (input.length !== 1 || input[0].startsWith('-')) {
  console.error('Usage: node scripts/check-remote-data-readiness.mjs /secure/production.env');
  process.exit(2);
}
let config;
try {
  const filename = resolve(input[0]);
  if (!existsSync(filename)) throw new Error('missing production environment file');
  config = parseEnv(readFileSync(filename, 'utf8'));
} catch {
  console.error('Remote database readiness: FAIL (production config unavailable or malformed)');
  process.exit(1);
}
const validated = validateProductionConfig(config, { checkFiles: true });
if (!validated.ok) {
  // The validator's messages contain only setting names / static explanations,
  // never emit connection errors or raw third-party service error text.
  console.error('Remote database readiness: FAIL (production configuration)');
  for (const detail of validated.errors) console.error(`- ${detail}`);
  process.exit(1);
}

const positivePort = (key) => Number(config[key]);
function tlsOptions(prefix) {
  const file = config[`${prefix}_TLS_CA_FILE`];
  return {
    rejectUnauthorized: true,
    ...(file ? { ca: readFileSync(file, 'utf8') } : {}),
  };
}
let mysql;
let mongo;
let redis;
let current = 'mysql';
try {
  // Dynamic imports occur only after configuration has been rejected or
  // approved; CI can test fail-closed behavior without real providers.
  const [{ default: mariadb }, { MongoClient }, { default: Redis }] = await Promise.all([
    import('mariadb'),
    import('mongodb'),
    import('ioredis'),
  ]);

  mysql = await mariadb.createConnection({
    host: config.MYSQL_HOST,
    port: positivePort('MYSQL_PORT'),
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    ssl: tlsOptions('MYSQL'),
    connectTimeout: 5000,
    timezone: '+00:00',
  });
  const versions = await mysql.query('SELECT VERSION() AS serverVersion');
  const version = String(versions?.[0]?.serverVersion ?? '');
  if (!/^8\./.test(version) || /mariadb/i.test(version)) {
    throw new Error('MySQL 8 provider required');
  }
  const sslStatus = await mysql.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (!sslStatus?.[0]?.Value) throw new Error('MySQL negotiated SSL cipher missing');

  current = 'mongodb';
  mongo = new MongoClient(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    tls: true,
  });
  await mongo.connect();
  if ((await mongo.db().command({ ping: 1 })).ok !== 1) {
    throw new Error('MongoDB ping failed');
  }

  current = 'redis';
  redis = new Redis({
    host: config.REDIS_HOST,
    port: positivePort('REDIS_PORT'),
    password: config.REDIS_PASSWORD,
    tls: tlsOptions('REDIS'),
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  // A failed Redis TLS handshake may emit errors: consume without emitting
  // messages containing provider details or credential-bearing connection URIs.
  redis.on('error', () => {});
  await redis.connect();
  if ((await redis.ping()) !== 'PONG') throw new Error('Redis ping failed');

  console.log('Remote database readiness: PASS');
  console.log('mysql=up engine=mysql8 tls=verified');
  console.log('mongodb=up tls=verified');
  console.log('redis=up tls=verified');
  console.log('This is connectivity evidence only, NOT provider backup/restore or migration approval.');
} catch {
  console.error(`Remote database readiness: FAIL (store=${current}; TLS, network, identity or auth)`);
  console.error('Inspect provider configuration privately. No connection strings or secrets printed.');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    mysql?.end(),
    mongo?.close(),
    Promise.resolve(redis?.disconnect()),
  ]);
}
