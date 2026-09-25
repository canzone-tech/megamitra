import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaGoldenClub SUPER_ADMIN lifecycle integration', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];

  function runScript(script: string, env: Record<string, string>): string {
    return execFileSync('npm', ['run', script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    if (prisma && createdUserIds.length) {
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (app) await app.close();
  });

  it(
    'keeps bootstrap create-only and makes break-glass reset explicit, audited, and status-preserving',
    async () => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const username = `sa_${suffix}`;
      const email = `${username}@example.test`;
      const initialPassword = 'Initial-SuperAdmin-2026!';
      const emergencyPassword = 'Emergency-SuperAdmin-2026!';

      const created = runScript('super-admin:bootstrap', {
        SUPER_ADMIN_USERNAME: username,
        SUPER_ADMIN_EMAIL: email,
        SUPER_ADMIN_PASSWORD: initialPassword,
      });
      expect(created).toContain(`MegaGoldenClub SUPER_ADMIN ready: ${username}`);

      const initialUser = await prisma.user.findUniqueOrThrow({
        where: { username },
        include: { roles: { include: { role: true } } },
      });
      createdUserIds.push(initialUser.id);
      expect(initialUser.roles.some((item) => item.role.name === 'SUPER_ADMIN')).toBe(true);
      expect(await passwords.verify(initialUser.passwordHash, initialPassword)).toBe(true);

      const repeated = runScript('super-admin:bootstrap', {
        SUPER_ADMIN_USERNAME: username,
        SUPER_ADMIN_EMAIL: email,
        SUPER_ADMIN_PASSWORD: emergencyPassword,
      });
      expect(repeated).toContain('Bootstrap is create-only and did not change credentials.');

      const afterRepeatedBootstrap = await prisma.user.findUniqueOrThrow({
        where: { id: initialUser.id },
      });
      expect(await passwords.verify(afterRepeatedBootstrap.passwordHash, initialPassword)).toBe(true);
      expect(await passwords.verify(afterRepeatedBootstrap.passwordHash, emergencyPassword)).toBe(false);

      const now = new Date();
      const sessionId = randomUUID();
      await prisma.user.update({
        where: { id: initialUser.id },
        data: {
          status: UserStatus.SUSPENDED,
          failedLoginAttempts: 3,
          lockedUntil: new Date(now.getTime() + 60_000),
        },
      });
      await prisma.authSession.create({
        data: {
          id: sessionId,
          userId: initialUser.id,
          refreshTokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(now.getTime() + 3_600_000),
          lastSeenAt: now,
          absoluteExpiresAt: new Date(now.getTime() + 7_200_000),
        },
      });

      const reason = `CI lifecycle verification ${suffix}`;
      const reset = runScript('super-admin:reset-break-glass', {
        BREAK_GLASS_SUPER_ADMIN_USERNAME: username,
        BREAK_GLASS_SUPER_ADMIN_PASSWORD: emergencyPassword,
        BREAK_GLASS_REASON: reason,
        BREAK_GLASS_CONFIRM: 'RESET_SUPER_ADMIN_PASSWORD',
      });
      expect(reset).toContain(`break-glass reset completed for SUPER_ADMIN ${username}`);

      const [resetUser, revokedSession, audit] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: initialUser.id } }),
        prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
        prisma.auditLog.findFirstOrThrow({
          where: {
            entityId: initialUser.id,
            description: 'Break-glass SUPER_ADMIN password reset',
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      expect(resetUser.status).toBe(UserStatus.SUSPENDED);
      expect(resetUser.mustChangePassword).toBe(true);
      expect(resetUser.failedLoginAttempts).toBe(0);
      expect(resetUser.lockedUntil).toBeNull();
      expect(await passwords.verify(resetUser.passwordHash, emergencyPassword)).toBe(true);
      expect(revokedSession.revokedAt).not.toBeNull();
      expect(revokedSession.revocationReason).toBe('break_glass_password_reset');
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata).toMatchObject({
        operation: 'break_glass_super_admin_password_reset',
        username,
        reason,
      });
    },
    60_000,
  );
});
