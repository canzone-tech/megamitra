#!/usr/bin/env node
// CI/local static gate for the ACTUAL shared Ubuntu host: Apache + isolated PM2.
// Never touches running Apache, PM2, or other applications.
// Root npm run verify also tests the read-only dedicated MySQL inventory.
import './test-inspect-mysql-schema.mjs';
// One-time empty-DB runner is checksum-tied to all 41 reviewed SQL migrations.
import './test-empty-db-migration-runner.mjs';
// Root npm run verify must cover the one-time API env staging contract.
import './test-stage-api-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const require = createRequire(import.meta.url);
const pm2 = require(resolve(root, 'infra/ubuntu-vps/ecosystem.config.cjs'));
assert.equal(pm2.apps.length, 3, 'Exactly three MegaGoldenClub processes');
const specs = [
  { name: 'api', port: 3200, script: 'dist/main.js' },
  { name: 'admin', port: 3201, script: 'server.js' },
  { name: 'member', port: 3202, script: 'server.js' },
];
for (const { name, port, script } of specs) {
  const app = pm2.apps.find(x => x.name === `megagoldenclub-${name}`);
  assert.ok(app, `Missing isolated PM2 app: ${name}`);
  assert.equal(app.cwd, `/opt/megagoldenclub/current/${name}`);
  assert.equal(app.script, script);
  assert.equal(app.interpreter, '/usr/bin/node');
  assert.equal(app.exec_mode, 'fork');
  assert.equal(app.instances, 1);
  assert.equal(app.watch, false);
  assert.equal(app.env.NODE_ENV, 'production');
  assert.equal(app.env.PORT, String(port));
  assert.deepEqual(
    Object.keys(app.env).sort(),
    name === 'api'
      ? ['HOST', 'NODE_ENV', 'PORT'].sort()
      : ['HOSTNAME', 'MEGAGOLDENCLUB_API_URL', 'NODE_ENV', 'PORT'].sort(),
    'PM2 config may not embed secrets',
  );
  if (name === 'api') {
    assert.equal(app.env.HOST, '127.0.0.1');
    assert.equal(app.node_args, '--env-file=/etc/megagoldenclub/api.env');
  } else {
    assert.equal(app.env.HOSTNAME, '127.0.0.1');
    assert.equal(app.env.MEGAGOLDENCLUB_API_URL, 'http://127.0.0.1:3200');
    assert.ok(!app.node_args, 'Web process must not load API secrets');
  }
}
const conf = {
  http: read('infra/ubuntu-vps/megagoldenclub-http.conf'),
  https: read('infra/ubuntu-vps/megagoldenclub-ssl.conf'),
};
const allDomains = [
  'megagoldenclub.com',
  'www.megagoldenclub.com',
  'admin.megagoldenclub.com',
  'api.megagoldenclub.com',
];
for (const [scheme, config] of Object.entries(conf)) {
  const port = scheme === 'http' ? 80 : 443;
  const blocks = [...config.matchAll(/<VirtualHost \*:(80|443)>\s*([\s\S]*?)<\/VirtualHost>/g)];
  assert.equal(blocks.length, 4, `Four separate Apache ${scheme} vhosts required`);
  for (const [, configuredPort, body] of blocks) {
    assert.equal(Number(configuredPort), port, 'Apache port mismatch');
    assert.doesNotMatch(body, /^\s*ServerAlias\s+/m, 'No shared-server catchall aliases');
    assert.match(body, /^\s*ServerName (\S+)$/m);
  }
  for (const domain of allDomains) {
    assert.equal(
      blocks.filter(([, , body]) => new RegExp(`^\\s*ServerName ${domain.replaceAll('.', '\\.')}$`, 'm').test(body)).length,
      1,
      `Missing or duplicated ${scheme} hostname ${domain}`,
    );
  }
}
const apacheSite = (scheme, domain) => {
  const match = [...conf[scheme].matchAll(/<VirtualHost \*:(?:80|443)>\s*([\s\S]*?)<\/VirtualHost>/g)]
    .find(([, body]) => body.includes(`ServerName ${domain}\n`));
  assert.ok(match, `Missing Apache ${scheme} ${domain}`);
  return match[1];
};
for (const domain of allDomains) {
  const http = apacheSite('http', domain);
  assert.match(http, /Alias "\/\.well-known\/acme-challenge\/" "\/var\/lib\/letsencrypt\/\.well-known\/acme-challenge\/"/);
  assert.match(http, /RewriteRule \^\/\\\.well-known\/acme-challenge\/ - \[END\]/);
  assert.match(http, /\[R=301,L,NE\]/);
  const tls = apacheSite('https', domain);
  assert.match(tls, /SSLEngine On/);
  assert.match(tls, /SSLCertificateFile \/etc\/letsencrypt\/live\/[^\s]+\/fullchain.pem/);
  assert.match(tls, /SSLCertificateKeyFile \/etc\/letsencrypt\/live\/[^\s]+\/privkey.pem/);
}
assert.match(apacheSite('https', 'megagoldenclub.com'), /https:\/\/www\.megagoldenclub\.com%\{REQUEST_URI\}/);
for (const [domain, port] of [
  ['www.megagoldenclub.com', 3202],
  ['admin.megagoldenclub.com', 3201],
  ['api.megagoldenclub.com', 3200],
]) {
  const body = apacheSite('https', domain);
  assert.match(body, /ProxyRequests Off/);
  assert.match(body, /ProxyPreserveHost On/);
  assert.match(body, /RequestHeader set X-Forwarded-Proto "https"/);
  assert.ok(body.includes(`ProxyPass "/" "http://127.0.0.1:${port}/"`));
  assert.ok(body.includes(`ProxyPassReverse "/" "http://127.0.0.1:${port}/"`));
}
assert.match(apacheSite('https', 'api.megagoldenclub.com'), /RewriteRule \^\/health\(\?:\/\|\$\) - \[R=404,L\]/);
assert.doesNotMatch(conf.http + conf.https, /ProxyPass.*:(?:3100|3101|3102)|ProxyPass.*0\.0\.0\.0|ServerAlias\s+\*/);
// The optional single-host topology creates exactly one NEW, non-root,
// password-ACL Redis container with no access to existing application ports.
const redisCompose = read('infra/ubuntu-vps/megagoldenclub-redis.compose.yaml');
const redisConf = read('infra/ubuntu-vps/redis.conf');
for (const expected of [
  'name: megagoldenclub-redis',
  'container_name: megagoldenclub-redis',
  'image: redis:7.4.11-alpine',
  'user: "10001:10001"',
  '127.0.0.1:6381:6379',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'users.acl',
]) assert.ok(redisCompose.includes(expected), `Missing safe Redis Compose setting: ${expected}`);
for (const blocked of ['0.0.0.0:6381', '127.0.0.1:6380', '127.0.0.1:6379', '27018']) {
  assert.ok(!redisCompose.includes(blocked), `Redis Compose must not use existing/broad bind: ${blocked}`);
}
assert.ok(redisCompose.includes('nocopy: true'));
assert.ok(redisCompose.includes('external: true'));
assert.ok(redisCompose.includes('name: megagoldenclub-redis_megagoldenclub-redis-data'));
const redisProvision = read('infra/ubuntu-vps/provision-redis.sh');
for (const expected of [
  "CONTAINER='megagoldenclub-redis'",
  "IMAGE='redis:7.4.11-alpine'",
  "VOLUME='megagoldenclub-redis_megagoldenclub-redis-data'",
  'redis.credentials.env',
  'openssl rand -hex 32',
  'sha256sum',
  'user default reset on #%s ~* &* +@all',
  'chown 10001:10001',
  'chmod 0400',
  'chmod 0640',
  'docker volume create',
  'docker compose -f "$COMPOSE" up -d --no-deps redis',
  'redis-cli --raw -x AUTH',
  'redis-cli --raw PING',
  'NOAUTH',
  "'127.0.0.1:6381'",
]) assert.ok(redisProvision.includes(expected), `Missing isolated Redis provision invariant: ${expected}`);
assert.ok(redisProvision.includes('--cap-add CHOWN --cap-add FOWNER'));
assert.ok(redisProvision.includes('chown 10001:10001 /data && chmod 0700 /data'));
assert.ok(redisProvision.includes('dst=/data,volume-nocopy'));
assert.ok(redisProvision.includes('test -w /data && test -x /data && touch /data/.redis-volume-write-test'));
const redisRecovery = read('infra/ubuntu-vps/recover-redis-volume.sh');
for (const required of [
  "CONTAINER='megagoldenclub-redis'",
  "VOLUME='megagoldenclub-redis_megagoldenclub-redis-data'",
  'redis.credentials.env',
  'cmp -s',
  'com.docker.compose.project',
  'com.docker.compose.volume',
  'sha256sum',
  'user default reset on #$hash ~* &* +@all',
  'docker compose -f "$SRC/megagoldenclub-redis.compose.yaml" config --quiet',
  '--cap-drop ALL --cap-add CHOWN --cap-add FOWNER',
  'chown 10001:10001 /data && chmod 0700 /data',
  'dst=/data,volume-nocopy',
  'nocopy: true',
  'INSTALL REVIEWED NOCOPY MANIFEST',
  'test -w /data && test -x /data && touch /data/.redis-volume-write-test',
  '--user 10001:10001 --cap-drop ALL',
  'test -w /data && test -x /data',
  'redis-cli --raw -x AUTH',
  'NOAUTH',
  "'127.0.0.1:6381'",
  'REDIS STARTUP AND AUTHENTICATION RECOVERY: PASS',
]) assert.ok(redisRecovery.includes(required), `Missing safe Redis recovery invariant: ${required}`);
for (const unsafe of [
  'docker compose down',
  'docker volume rm',
  'docker rm',
  'openssl rand',
  'docker volume create',
  'systemctl restart redis',
]) assert.ok(!redisRecovery.includes(unsafe), `Unsafe Redis recovery operation: ${unsafe}`);
for (const forbidden of [
  'docker compose down',
  'docker volume rm',
  'docker rm',
  'systemctl restart redis',
  'chmod 777',
  'chmod 644',
  'requirepass',
]) assert.ok(!redisProvision.includes(forbidden), `Unsafe Redis provision command: ${forbidden}`);
assert.ok(redisConf.includes('aclfile /run/redis/users.acl'));
assert.doesNotMatch(redisConf, /requirepass|CHANGE_ME|password=/i);
// Separate MongoDB avoids unsafe changes to the host's existing mongod
// and unrelated :27018 Docker mongo; never publish Mongo to the internet.
const mongoCompose = read('infra/ubuntu-vps/megagoldenclub-mongo.compose.yaml');
for (const expected of [
  'name: megagoldenclub-mongo',
  'container_name: megagoldenclub-mongo',
  'image: mongo:8.0.29-noble',
  '127.0.0.1:27019:27017',
  'MONGO_INITDB_ROOT_PASSWORD_FILE: /run/secrets/mongodb_root_password',
  'file: /etc/megagoldenclub/mongo/root-password',
  'megagoldenclub-mongo-data:/data/db',
  '--auth',
  'restart: unless-stopped',
  'mem_limit: 1024m',
]) assert.ok(mongoCompose.includes(expected), `Missing safe Mongo Compose setting: ${expected}`);
for (const blocked of [
  '0.0.0.0:27019',
  '127.0.0.1:27017:27017',
  '127.0.0.1:27018:27017',
  'MONGO_INITDB_ROOT_PASSWORD:',
]) assert.ok(!mongoCompose.includes(blocked), `Mongo Compose may not share existing data or a public port: ${blocked}`);
const mongoRecovery = read('infra/ubuntu-vps/repair-mongo-bootstrap-secret.sh');
for (const requirement of [
  "CONTAINER='megagoldenclub-mongo'",
  "SECRET='/etc/megagoldenclub/mongo/root-password'",
  "'0:700'",
  "'0'",
  '--entrypoint id',
  'mongo_gid=',
  'chown "0:$mongo_gid" "$SECRET"',
  'chmod 0440 "$SECRET"',
  'test -r /run/secrets/mongodb_root_password',
  'docker restart "$CONTAINER"',
  'db.adminCommand({ping:1}).ok',
]) assert.ok(mongoRecovery.includes(requirement), `Mongo secret recovery must preserve boundary: ${requirement}`);
for (const forbidden of [
  'docker compose down',
  'docker rm',
  'docker volume rm',
  'chmod 644',
  'systemctl restart mongod',
]) assert.ok(!mongoRecovery.includes(forbidden), `Mongo secret recovery must not affect existing sites: ${forbidden}`);
// Once the dedicated MongoDB container is up, its application user is still
// absent until this dedicated, password-safe initializer has been executed.
const mongoUser = read('infra/ubuntu-vps/create-mongo-app-user.sh');
for (const required of [
  "CONTAINER='megagoldenclub-mongo'",
  "IMAGE='mongo:8.0.29-noble'",
  "APP_DB='megagoldenclub'",
  "APP_USER='megagoldenclub_app'",
  'mongo.credentials.env',
  'app-password',
  'root-password',
  'openssl rand -hex 32',
  'ROOT_PASSWORD',
  'CREATION_ATTEMPTED=1',
  'createUser:',
  'SCRAM-SHA-256',
  'readWrite',
  'authSource=',
  'chmod 0600',
  'chmod 0640',
  'MONGODB APPLICATION LOGIN: PASS',
  'mongosh --quiet --file /dev/stdin',
]) assert.ok(mongoUser.includes(required), `Mongo app initializer safety invariant missing: ${required}`);
for (const blocked of [
  'docker compose down',
  'docker rm',
  'docker volume rm',
  'docker restart',
  'mongod --noauth',
  'db.dropUser',
  'db.dropDatabase',
  '--password',
  'chmod 644',
]) assert.ok(!mongoUser.includes(blocked), `Mongo app initializer must not modify existing services: ${blocked}`);
// The MySQL password initializer must never rotate a global MySQL user,
// expose a credential through argv, or overwrite an existing API config.
const mysqlRotate = read('infra/ubuntu-vps/rotate-mysql-app-credentials.sh');
for (const expected of [
  "APP_ACCOUNT='megagoldenclub_app'",
  "APP_DB='megagoldenclub'",
  'mysql.credentials.env',
  'api.env',
  'openssl rand -hex 32',
  'chown root:megagoldenclub',
  'chmod 0640',
  "'127.0.0.1'",
  'mysql --protocol=socket --user=root --password',
  'SELECT CURRENT_USER(), DATABASE();',
  'runuser -u megagoldenclub -- test -r',
  'ROTATED=1',
]) assert.ok(mysqlRotate.includes(expected), `Missing safe MySQL rotation invariant: ${expected}`);
for (const unsafe of [
  'mysqladmin password',
  "ALTER USER 'root'",
  'CREATE USER',
  'GRANT ALL',
  'FLUSH PRIVILEGES',
  'chmod 777',
]) assert.ok(!mysqlRotate.includes(unsafe), `Unsafe MySQL credential operation: ${unsafe}`);
// Source-free runtime deploy is a separate production-only ops procedure.
// Root npm run verify checks safety invariants without touching host PM2.
const releaseWorkflow = read('.github/workflows/publish-reviewed-runtime.yml');
for (const token of [
  'SOURCE_SHA: ba4750b6bf0880ebb8b3a76c6af3bc14acb8e4a4',
  'BACKEND_RUN:',
  'FRONTEND_RUN:',
  'EVIDENCE_RUN:',
  'actions/download-artifact@v4',
  'sha256sum --check --status',
  'gh release create',
  '--prerelease',
]) assert.ok(releaseWorkflow.includes(token),
  'Published binary must prove approved same-SHA CI provenance: ' + token);
const stageRuntime = read('infra/ubuntu-vps/stage-runtime.py');
for (const needle of [
  'megagoldenclub-runtime.tar.gz',
  'SHA256',
  'RELEASE_SHA',
  'tarfile.open',
  'filter="data"',
  'refusing overwrite',
]) {
  // Deliberately static only: full archive extraction is exercised in Backend CI.
  assert.ok(
    stageRuntime.toLowerCase().includes(needle.toLowerCase()),
    'Missing protected runtime staging invariant: ' + needle,
  );
}
const runtimeReconciler = read('infra/ubuntu-vps/reconcile-staged-runtime.py');
for (const needle of [
  'grp.getgrnam',
  'expected_uid',
  'os.walk',
  'followlinks=False',
  'st_nlink',
  'RELEASE_SHA',
  'api/dist/main.js',
]) assert.ok(runtimeReconciler.includes(needle),
  'Dedicated runtime reconciliation must prove isolation and full-tree integrity: ' + needle);
const launchRuntime = read('infra/ubuntu-vps/launch-dedicated-runtime.sh');
for (const needle of [
  'PM2_HOME_DIR=',
  'runuser -u',
  '/health/ready',
  '127.0.0.1:',
  'api.env',
  'DEDICATED SOURCE-FREE DEPLOYMENT: PASS',
]) assert.ok(launchRuntime.includes(needle),
  'Missing isolated runtime launch invariant: ' + needle);
for (const forbidden of ['pm2 kill', 'systemctl restart apache', 'docker compose down', 'docker volume rm']) {
  assert.ok(!launchRuntime.includes(forbidden), 'Unsafe runtime launch operation: ' + forbidden);
}

const api = read('backend/src/main.ts');
assert.match(api, /process\.env\.HOST/);
assert.match(api, /app\.listen\(port, host\)/);
console.log('Shared Ubuntu Apache + isolated PM2 deployment templates: PASS');
