import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function baseEnv(keyPath: string) {
  return {
    NODE_ENV: 'production',
    PORT: '3100',
    MYSQL_ROOT_PASSWORD: 'prod-root-password-123456789',
    MYSQL_HOST: 'db.internal',
    MYSQL_PORT: '3306',
    MYSQL_DATABASE: 'megagoldenclub',
    MYSQL_USER: 'megagoldenclub_app',
    MYSQL_PASSWORD: 'prod-db-password-123456789',
    DATABASE_URL:
      'mysql://megagoldenclub_app:prod-db-password-123456789@db.internal:3306/megagoldenclub',
    MONGODB_URI: 'mongodb://mongo.internal:27017/megagoldenclub',
    REDIS_HOST: 'redis.internal',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: 'prod-redis-password-123456789',
    CAPTCHA_HMAC_SECRET: 'captcha-prod-secret-12345678901234567890',
    JWT_ACCESS_SECRET: 'access-prod-secret-123456789012345678901',
    JWT_REFRESH_SECRET: 'refresh-prod-secret-12345678901234567890',
    TRUST_PROXY_HOPS: '1',
    SECURITY_HSTS_ENABLED: 'true',
    RATE_LIMIT_ENABLED: 'true',
    RATE_LIMIT_TEST_ENABLED: 'false',
    MEGAGOLDENCLUB_PUBLIC_URL: 'https://club.example.org',
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true',
    SMTP_USERNAME: '',
    SMTP_PASSWORD: '',
    SMTP_FROM_EMAIL: '',
    SMTP_FROM_NAME: 'MegaGoldenClub',
    SMTP_TIMEOUT_MS: '10000',
    MEGAGOLDENCLUB_BACKUP_KEY_FILE: keyPath,
  };
}

function encodeEnv(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
    .concat('\n');
}

describe('MegaGoldenClub production configuration readiness contract', () => {
  let workDir = '';
  let keyPath = '';
  let envPath = '';

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'megagoldenclub-prod-readiness-'));
    keyPath = path.join(workDir, 'backup.key');
    envPath = path.join(workDir, 'production.env');
    await writeFile(keyPath, 'not-a-real-production-key\n', { mode: 0o600 });
    await chmod(keyPath, 0o600);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function run(extraArgs: string[] = []) {
    return spawnSync(
      process.execPath,
      ['scripts/verify-production-config.mjs', envPath, ...extraArgs],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
  }

  it('accepts a production-safe configuration and verifies the backup key file boundary', async () => {
    await writeFile(envPath, encodeEnv(baseEnv(keyPath)));

    const result = run(['--check-files']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('MegaGoldenClub production configuration readiness: PASS');
    expect(result.stdout).toContain('smtp=DISABLED');
    expect(result.stdout).toContain('backupKey=VERIFIED');
    expect(result.stdout).not.toContain('prod-db-password');
  });

  it('rejects placeholder secrets and insecure production switches', async () => {
    await writeFile(
      envPath,
      encodeEnv({
        ...baseEnv(keyPath),
        JWT_ACCESS_SECRET: 'CHANGE_ME_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
        SECURITY_HSTS_ENABLED: 'false',
        RATE_LIMIT_ENABLED: 'false',
        RATE_LIMIT_TEST_ENABLED: 'true',
      }),
    );

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JWT_ACCESS_SECRET still contains a development/CI placeholder');
    expect(result.stderr).toContain('SECURITY_HSTS_ENABLED must be true');
    expect(result.stderr).toContain('RATE_LIMIT_ENABLED must be true');
    expect(result.stderr).toContain('RATE_LIMIT_TEST_ENABLED must be false');
  });

  it('rejects split-brain MySQL configuration between DATABASE_URL and MYSQL_*', async () => {
    await writeFile(
      envPath,
      encodeEnv({
        ...baseEnv(keyPath),
        DATABASE_URL:
          'mysql://megagoldenclub_app:prod-db-password-123456789@different-db.internal:3306/megagoldenclub',
      }),
    );

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL must target the same host');
  });

  it('requires SMTP only when the deployment declares that email features will be enabled', async () => {
    await writeFile(envPath, encodeEnv(baseEnv(keyPath)));

    const result = run(['--require-smtp']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SMTP is required for this deployment');
  });
});
