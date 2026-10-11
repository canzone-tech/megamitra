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
assert.match(caddy, /\{\$ADMIN_DOMAIN\}/);
assert.match(caddy, /\{\$MEMBER_DOMAIN\}/);
assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3101/);
assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3102/);
assert.doesNotMatch(caddy, /:3100|mysql|mongodb|redis/i);
const api = read('backend/src/main.ts');
assert.match(api, /process\.env\.HOST/);
assert.match(api, /app\.listen\(port, host\)/);
console.log('Ubuntu VPS source-free/remote-data service templates: PASS');
