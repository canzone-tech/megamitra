import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { SuperAdminLifecycleService } from '../src/auth/super-admin-lifecycle.service';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaGoldenClub SUPER_ADMIN lifecycle integration', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let lifecycle: SuperAdminLifecycleService;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    lifecycle = app.get(SuperAdminLifecycleService);
  });

  afterAll(async () => {
    if (prisma && createdUserIds.length) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (app) await app.close();
  });

  it('keeps bootstrap create-only and makes break-glass reset audited and status-preserving', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const username = `sa_${suffix}`;
    const email = `${username}@example.test`;
    const initialPassword = 'Initial-SuperAdmin-2026!';
    const emergencyPassword = 'Emergency-SuperAdmin-2026!';

    const created = await lifecycle.bootstrapCreateOnly({ username, email, password: initialPassword });
    expect(created.status).toBe('created');

    const initialUser = await prisma.user.findUniqueOrThrow({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
    createdUserIds.push(initialUser.id);
    expect(initialUser.roles.some((item) => item.role.name === 'SUPER_ADMIN')).toBe(true);
    expect(await passwords.verify(initialUser.passwordHash, initialPassword)).toBe(true);

    const repeated = await lifecycle.bootstrapCreateOnly({ username, email, password: emergencyPassword });
    expect(repeated.status).toBe('already_exists');

    const afterRepeatedBootstrap = await prisma.user.findUniqueOrThrow({ where: { id: initialUser.id } });
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
    const reset = await lifecycle.breakGlassReset({ username, password: emergencyPassword, reason });
    expect(reset).toMatchObject({ status: 'reset', username, userId: initialUser.id });

    const [resetUser, revokedSession, audit] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: initialUser.id } }),
      prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
      prisma.auditLog.findFirstOrThrow({
        where: { entityId: initialUser.id, description: 'Break-glass SUPER_ADMIN password reset' },
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
    expect(audit.metadata as Record<string, unknown>).toMatchObject({
      operation: 'break_glass_super_admin_password_reset',
      username,
      reason,
    });
  });
});
