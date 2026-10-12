#!/usr/bin/env node
// CI/local static gate for the ACTUAL shared Ubuntu host: Apache + isolated PM2.
// Never touches running Apache, PM2, or other applications.
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
const api = read('backend/src/main.ts');
assert.match(api, /process\.env\.HOST/);
assert.match(api, /app\.listen\(port, host\)/);
console.log('Shared Ubuntu Apache + isolated PM2 deployment templates: PASS');
