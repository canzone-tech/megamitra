#!/usr/bin/env node
// Static release gate: the production VPS must have only compiled app processes
// bound to loopback. MySQL, MongoDB, Redis and migrations live elsewhere.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const unit = (name) => read(`infra/ubuntu-vps/megagoldenclub-${name}.service`);
for (const [app, entrypoint, port] of [
  ['api', 'dist/main.js', '3100'],
  ['admin', 'server.js', '3101'],
  ['member', 'server.js', '3102'],
]) {
  const config = unit(app);
  assert.match(config, /^User=megagoldenclub$/m);
  assert.match(config, /^Group=megagoldenclub$/m);
  assert.match(config, new RegExp(`^WorkingDirectory=/opt/megagoldenclub/current/${app}$`, 'm'));
  assert.match(config, new RegExp(`^ExecStart=/usr/bin/node ${entrypoint.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(config, new RegExp(`^Environment=PORT=${port}$`, 'm'));
  assert.match(config, /^Environment=NODE_ENV=production$/m);
  assert.match(config, /^NoNewPrivileges=true$/m);
  assert.match(config, /^ProtectHome=true$/m);
  assert.doesNotMatch(config, /docker|mysql.*server|redis-server|mongod|git pull|npm (run|ci)|prisma migrate/i);
}
assert.match(unit('api'), /^Environment=HOST=127\.0\.0\.1$/m);
for (const app of ['admin', 'member']) {
  assert.match(unit(app), /^Environment=HOSTNAME=127\.0\.0\.1$/m);
  assert.match(unit(app), /^Environment=MEGAGOLDENCLUB_API_URL=http:\/\/127\.0\.0\.1:3100$/m);
}
assert.match(unit('api'), /^EnvironmentFile=\/etc\/megagoldenclub\/api\.env$/m);
const caddy = read('infra/ubuntu-vps/Caddyfile.template');
const site = (domain) => {
  const escaped = domain.replaceAll('.', '\\.');
  const regex = new RegExp(`^${escaped} \\{([\\s\\S]*?)^\\}`, 'm');
  const match = caddy.match(regex);
  assert.ok(match, `Missing canonical Caddy host: ${domain}`);
  return match[1];
};
const apex = site('megagoldenclub.com');
const member = site('www.megagoldenclub.com');
const admin = site('admin.megagoldenclub.com');
const apiSite = site('api.megagoldenclub.com');
assert.match(apex, /redir https:\/\/www\.megagoldenclub\.com\{uri\} permanent/);
assert.match(member, /reverse_proxy 127\.0\.0\.1:3102/);
assert.match(admin, /reverse_proxy 127\.0\.0\.1:3101/);
assert.match(apiSite, /reverse_proxy 127\.0\.0\.1:3100/);
assert.match(apiSite, /@internalHealth path \/health \/health\/\*/);
assert.match(apiSite, /respond @internalHealth 404/);
assert.doesNotMatch(member + admin + apex, /reverse_proxy 127\.0\.0\.1:3100/);
assert.doesNotMatch(caddy, /reverse_proxy (mysql|mongodb|redis)|0\.0\.0\.0:310[012]/i);
const api = read('backend/src/main.ts');
assert.match(api, /process\.env\.HOST/);
assert.match(api, /app\.listen\(port, host\)/);
console.log('Ubuntu VPS source-free/remote-data service templates: PASS');
