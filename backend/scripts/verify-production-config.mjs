#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(message) {
  throw new Error(message);
}

function value(env, key) {
  return String(env[key] ?? '').trim();
}

function requireValue(env, key) {
  const result = value(env, key);
  if (!result) fail(`${key} is required`);
  return result;
}

function parseBoolean(env, key) {
  const raw = requireValue(env, key).toLowerCase();
  if (raw !== 'true' && raw !== 'false') fail(`${key} must be true or false`);
  return raw === 'true';
}

function parseInteger(env, key, min, max) {
  const raw = requireValue(env, key);
  if (!/^-?\d+$/.test(raw)) fail(`${key} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail(`${key} must be between ${min} and ${max}`);
  }
  return parsed;
}

function isPlaceholderSecret(secret) {
  const normalized = secret.toLowerCase();
  return (
    normalized.includes('change_me') ||
    normalized.includes('changeme') ||
    normalized.includes('replace_me') ||
    normalized.includes('replace-me') ||
    normalized.includes('test_password') ||
    normalized.includes('test-password') ||
    normalized.includes('ci-secret') ||
    normalized.includes('ci_') ||
    normalized === 'password' ||
    normalized === 'secret'
  );
}

function requireSecret(env, key, minLength = 16) {
  const secret = requireValue(env, key);
  if (secret.length < minLength) fail(`${key} must be at least ${minLength} characters`);
  if (isPlaceholderSecret(secret)) fail(`${key} still contains a development/CI placeholder`);
  return secret;
}

function normalizeHost(host) {
  return host.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function assertExternalHost(host, label) {
  const name = normalizeHost(host);
  // A production application host must never fall back to its own or Compose's
  // datastore processes. Private/VPC DNS and addresses remain valid.
  const forbidden = new Set([
    'localhost', 'localhost.localdomain', '0.0.0.0', '::', '::1',
    'host.docker.internal', 'gateway.docker.internal', 'mysql', 'mongodb', 'redis',
  ]);
  if (forbidden.has(name) || name.endsWith('.localhost') ||
      /^127(?:\.\d{1,3}){3}$/.test(name) ||
      /^::ffff:127\./.test(name) || /^169\.254\./.test(name)) {
    fail(`${label} must be an external service, not a local or Docker Compose endpoint`);
  }
}

function topology(env) {
  const selected = value(env, 'MEGAGOLDENCLUB_DATA_TOPOLOGY') || 'remote';
  if (!['remote', 'local-isolated'].includes(selected)) {
    fail('MEGAGOLDENCLUB_DATA_TOPOLOGY must be remote or local-isolated');
  }
  return selected;
}

function assertDatastoreHost(host, label, mode) {
  if (mode === 'local-isolated') {
    if (normalizeHost(host) !== '127.0.0.1') {
      fail(`${label} must be 127.0.0.1 for local-isolated topology`);
    }
    return;
  }
  assertExternalHost(host, label);
}

function validateDatabaseIdentity(env, mode) {
  const mysqlHost = requireValue(env, 'MYSQL_HOST');
  const mysqlPort = parseInteger(env, 'MYSQL_PORT', 1, 65535);
  const mysqlDatabase = requireValue(env, 'MYSQL_DATABASE');
  const mysqlUser = requireValue(env, 'MYSQL_USER');
  const mysqlPassword = requireSecret(env, 'MYSQL_PASSWORD');
  // The app needs only its own least-privilege user; root stays off the runtime host.

  let url;
  try {
    url = new URL(requireValue(env, 'DATABASE_URL'));
  } catch {
    fail('DATABASE_URL must be a valid mysql:// URL');
  }
  if (url.protocol !== 'mysql:') fail('DATABASE_URL must use mysql://');
  if (mode === 'remote') {
    if (url.searchParams.get('sslaccept') !== 'strict') {
      fail('DATABASE_URL must enforce sslaccept=strict for the separate Prisma migration runner');
    }
    if (!parseBoolean(env, 'MYSQL_TLS')) fail('MYSQL_TLS must be true in production');
  } else {
    if (mysqlPort !== 3306) fail('MYSQL_PORT must be 3306 for local-isolated topology');
    if (mysqlDatabase !== 'megagoldenclub' || mysqlUser !== 'megagoldenclub_app') {
      fail('Local-isolated MySQL requires its dedicated megagoldenclub database and app user');
    }
    // A host-local loopback TCP connection is never exposed to the external
    // network. Local TLS is optional; remote TLS remains mandatory.
  }
  const urlPort = Number(url.port || '3306');
  const urlDatabase = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const urlUser = decodeURIComponent(url.username);
  const urlPassword = decodeURIComponent(url.password);

  assertDatastoreHost(mysqlHost, 'MYSQL_HOST', mode);
  if (
    normalizeHost(url.hostname) !== normalizeHost(mysqlHost) ||
    urlPort !== mysqlPort ||
    urlDatabase !== mysqlDatabase ||
    urlUser !== mysqlUser ||
    urlPassword !== mysqlPassword
  ) {
    fail('DATABASE_URL must target the same host, port, database, user and password as MYSQL_*');
  }
}

function validatePublicUrl(env) {
  let url;
  try {
    url = new URL(requireValue(env, 'MEGAGOLDENCLUB_PUBLIC_URL'));
  } catch {
    fail('MEGAGOLDENCLUB_PUBLIC_URL must be a valid URL');
  }
  if (url.protocol !== 'https:') fail('MEGAGOLDENCLUB_PUBLIC_URL must use https:// in production');
  const host = normalizeHost(url.hostname);
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    fail('MEGAGOLDENCLUB_PUBLIC_URL must not use a loopback host in production');
  }
}

function validateMongo(env, mode) {
  const raw = requireValue(env, 'MONGODB_URI');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('MONGODB_URI must be a valid mongodb:// or mongodb+srv:// URL');
  }
  if (url.protocol !== 'mongodb:' && url.protocol !== 'mongodb+srv:') {
    fail('MONGODB_URI must use mongodb:// or mongodb+srv://');
  }
  if (!url.hostname) fail('MONGODB_URI must include a host');
  assertDatastoreHost(url.hostname, 'MONGODB_URI', mode);
  if (mode === 'local-isolated') {
    if (url.protocol !== 'mongodb:' || Number(url.port || '27017') !== 27017) {
      fail('Local-isolated MongoDB must use mongodb://127.0.0.1:27017');
    }
    if (decodeURIComponent(url.pathname.replace(/^\\/+/, '')) !== 'megagoldenclub' ||
        url.searchParams.get('authSource') !== 'megagoldenclub') {
      fail('Local-isolated MongoDB must use its dedicated megagoldenclub database and authSource');
    }
    if (decodeURIComponent(url.username) !== 'megagoldenclub_app' ||
        decodeURIComponent(url.password).length < 16 ||
        isPlaceholderSecret(decodeURIComponent(url.password))) {
      fail('Local-isolated MongoDB must authenticate using a dedicated non-placeholder user');
    }
  }
  const tls = url.searchParams.get('tls') ?? url.searchParams.get('ssl');
  if (mode === 'remote' && ((url.protocol === 'mongodb:' && tls !== 'true') || tls === 'false')) {
    fail('Production MONGODB_URI must enable TLS (mongodb+srv:// or mongodb://?tls=true)');
  }
  for (const param of ['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames']) {
    if (url.searchParams.get(param) === 'true') {
      fail(`Production MONGODB_URI must not disable certificate verification (${param})`);
    }
  }
}

function validateSmtp(env, requireSmtp) {
  const host = value(env, 'SMTP_HOST');
  const from = value(env, 'SMTP_FROM_EMAIL');
  const username = value(env, 'SMTP_USERNAME');
  const password = String(env.SMTP_PASSWORD ?? '');
  const configured = Boolean(host || from || username || password);

  if (!configured) {
    if (requireSmtp) fail('SMTP is required for this deployment but SMTP_HOST/SMTP_FROM_EMAIL are not configured');
    return 'DISABLED';
  }

  if (!host || !from) fail('SMTP_HOST and SMTP_FROM_EMAIL are both required when SMTP is configured');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) fail('SMTP_FROM_EMAIL is invalid');
  parseInteger(env, 'SMTP_PORT', 1, 65535);
  const secure = parseBoolean(env, 'SMTP_SECURE');
  const requireTls = parseBoolean(env, 'SMTP_REQUIRE_TLS');
  if (!secure && !requireTls) fail('SMTP must use SMTP_SECURE=true or SMTP_REQUIRE_TLS=true in production');
  if (Boolean(username) !== Boolean(password)) {
    fail('SMTP_USERNAME and SMTP_PASSWORD must either both be set or both be empty');
  }
  if (password && (password.length < 12 || isPlaceholderSecret(password))) {
    fail('SMTP_PASSWORD must be a non-placeholder secret of at least 12 characters');
  }
  return 'CONFIGURED';
}

function validateTlsCaFile(env, key, checkFiles) {
  const file = value(env, key);
  if (!file) return;
  if (!file.startsWith('/')) fail(`${key} must be an absolute path`);
  if (!checkFiles) return;
  if (!existsSync(file)) fail(`${key} does not exist on this host`);
  const stat = statSync(file);
  if (!stat.isFile() || stat.size === 0) fail(`${key} must be a non-empty file`);
}

function validateBackupKey(env, checkFiles) {
  const keyFile = requireValue(env, 'MEGAGOLDENCLUB_BACKUP_KEY_FILE');
  if (!keyFile.startsWith('/')) fail('MEGAGOLDENCLUB_BACKUP_KEY_FILE must be an absolute path');
  if (!checkFiles) return 'DECLARED';

  if (!existsSync(keyFile)) fail('MEGAGOLDENCLUB_BACKUP_KEY_FILE does not exist on this host');
  const stat = statSync(keyFile);
  if (!stat.isFile() || stat.size === 0) fail('MEGAGOLDENCLUB_BACKUP_KEY_FILE must be a non-empty file');
  const mode = stat.mode & 0o777;
  if (mode !== 0o600 && mode !== 0o400) {
    fail('MEGAGOLDENCLUB_BACKUP_KEY_FILE must have mode 600 or 400');
  }
  return 'VERIFIED';
}

export function validateProductionConfig(env, options = {}) {
  const errors = [];
  const capture = (fn) => {
    try {
      return fn();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  };

  if (value(env, 'NODE_ENV') !== 'production') errors.push('NODE_ENV must be production');
  if (value(env, 'MYSQL_ROOT_PASSWORD')) errors.push('MYSQL_ROOT_PASSWORD must not be present on the production runtime host');

  const mode = capture(() => topology(env));
  if (mode) {
    capture(() => validateDatabaseIdentity(env, mode));
    capture(() => validateMongo(env, mode));
    capture(() => assertDatastoreHost(requireValue(env, 'REDIS_HOST'), 'REDIS_HOST', mode));
    const redisPort = capture(() => parseInteger(env, 'REDIS_PORT', 1, 65535));
    if (mode === 'local-isolated' && redisPort !== undefined && redisPort !== 6381) {
      errors.push('REDIS_PORT must be 6381 for dedicated local-isolated Redis');
    }
    capture(() => requireSecret(env, 'REDIS_PASSWORD'));
    if (mode === 'remote' && capture(() => parseBoolean(env, 'REDIS_TLS')) === false) {
      errors.push('REDIS_TLS must be true in production');
    }
  }
  capture(() => validateTlsCaFile(env, 'MYSQL_TLS_CA_FILE', options.checkFiles === true));
  capture(() => validateTlsCaFile(env, 'REDIS_TLS_CA_FILE', options.checkFiles === true));

  const captcha = capture(() => requireSecret(env, 'CAPTCHA_HMAC_SECRET', 32));
  const access = capture(() => requireSecret(env, 'JWT_ACCESS_SECRET', 32));
  const refresh = capture(() => requireSecret(env, 'JWT_REFRESH_SECRET', 32));
  const presentSigningSecrets = [captcha, access, refresh].filter(Boolean);
  if (new Set(presentSigningSecrets).size !== presentSigningSecrets.length) {
    errors.push('CAPTCHA_HMAC_SECRET, JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct');
  }

  capture(() => parseInteger(env, 'TRUST_PROXY_HOPS', 0, 10));
  if (capture(() => parseBoolean(env, 'SECURITY_HSTS_ENABLED')) === false) {
    errors.push('SECURITY_HSTS_ENABLED must be true for the production HTTPS release');
  }
  if (capture(() => parseBoolean(env, 'RATE_LIMIT_ENABLED')) === false) {
    errors.push('RATE_LIMIT_ENABLED must be true in production');
  }
  if (capture(() => parseBoolean(env, 'RATE_LIMIT_TEST_ENABLED')) === true) {
    errors.push('RATE_LIMIT_TEST_ENABLED must be false in production');
  }

  capture(() => validatePublicUrl(env));
  const smtp = capture(() => validateSmtp(env, options.requireSmtp === true));
  const backupKey = capture(() => validateBackupKey(env, options.checkFiles === true));

  if (errors.length) return { ok: false, errors, smtp: smtp ?? 'INVALID', backupKey: backupKey ?? 'INVALID' };
  return { ok: true, errors: [], smtp, backupKey };
}

function usage() {
  console.error(
    'Usage: node scripts/verify-production-config.mjs <production-env-file> [--check-files] [--require-smtp]',
  );
}

async function main() {
  const args = process.argv.slice(2);
  const envPath = args.find((arg) => !arg.startsWith('--'));
  const options = new Set(args.filter((arg) => arg.startsWith('--')));
  for (const option of options) {
    if (option !== '--check-files' && option !== '--require-smtp') {
      usage();
      process.exitCode = 2;
      return;
    }
  }
  if (!envPath) {
    usage();
    process.exitCode = 2;
    return;
  }

  let env;
  try {
    env = parseEnv(readFileSync(envPath, 'utf8'));
  } catch (error) {
    console.error('MegaGoldenClub production configuration readiness: FAIL');
    console.error(`- unable to read/parse production env file: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = validateProductionConfig(env, {
    checkFiles: options.has('--check-files'),
    requireSmtp: options.has('--require-smtp'),
  });

  if (!result.ok) {
    console.error('MegaGoldenClub production configuration readiness: FAIL');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('MegaGoldenClub production configuration readiness: PASS');
  console.log(`smtp=${result.smtp}`);
  console.log(`backupKey=${result.backupKey}`);
  console.log(`dataTopology=${value(env, 'MEGAGOLDENCLUB_DATA_TOPOLOGY') || 'remote'}`);
  console.log('No secret values were printed.');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await main();
}
