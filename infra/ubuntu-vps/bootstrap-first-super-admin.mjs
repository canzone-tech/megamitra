#!/usr/bin/env node
// One-time source-free bootstrap: call existing compiled lifecycle service.
// Password comes from a private stdin pipe, never argv/env/disk.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RELEASE_SHA = 'ba4750b6bf0880ebb8b3a76c6af3bc14acb8e4a4';
const release = '/opt/megagoldenclub/releases/' + RELEASE_SHA;
const username = 'superadmin';

async function run() {
  if (process.getuid?.() === 0) throw new Error('Refuse root execution');
  if (process.env.NODE_ENV !== 'production' ||
      process.env.MEGAGOLDENCLUB_DATA_TOPOLOGY !== 'local-isolated' ||
      process.env.MYSQL_DATABASE !== 'megagoldenclub' ||
      process.env.MYSQL_USER !== 'megagoldenclub_app' ||
      process.env.MYSQL_HOST !== '127.0.0.1') {
    throw new Error('Wrong isolated production database');
  }
  if (readFileSync(path.join(release, 'RELEASE_SHA'), 'utf8').trim() !== RELEASE_SHA) {
    throw new Error('Compiled production release identity mismatch');
  }
  const requireApp = createRequire(path.join(release, 'api', 'package.json'));
  const { NestFactory } = requireApp('@nestjs/core');
  const { AppModule } = requireApp('./dist/app.module.js');
  const { PrismaService } = requireApp('./dist/database/prisma.service.js');
  const { SuperAdminLifecycleService } =
    requireApp('./dist/auth/super-admin-lifecycle.service.js');

  let app;
  try {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const prisma = app.get(PrismaService);
    const existingAdmins = await prisma.userRole.count({
      where: { role: { name: 'SUPER_ADMIN' } },
    });
    if (existingAdmins !== 0) {
      console.log('SUPER_ADMIN already exists; bootstrap refused (no changes).');
      return;
    }
    let password = '';
    for await (const chunk of process.stdin) {
      password += chunk.toString('utf8');
      if (password.length > 2048) throw new Error('Password exceeds limit');
    }
    password = password.replace(/\r?\n$/, '');
    if (!password) throw new Error('Password missing');
    const result = await app.get(SuperAdminLifecycleService).bootstrapCreateOnly({
      username, email: null, password,
    });
    password = '';
    if (result.status !== 'created') throw new Error('Username already exists');
    console.log('SUPER_ADMIN CREATED: superadmin');
    console.log('First login requires password change.');
  } finally {
    if (app) await app.close();
  }
}
try {
  await run();
} catch {
  console.error('SUPER_ADMIN bootstrap failed safely; no credentials disclosed.');
  process.exitCode = 1;
}
