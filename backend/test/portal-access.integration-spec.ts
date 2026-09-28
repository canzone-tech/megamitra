import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaGoldenClub portal access integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let originalLoginWithUsername: boolean;
  let originalCaptchaOnLoginEnabled: boolean;
  const createdUserIds: string[] = [];

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json()) as Record<string, any>;
    return { status: response.status, body };
  }

  async function createUserWithRole(roleName: 'MEMBER' | 'SUPER_ADMIN', prefix: string) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const password = 'Portal-Access-Test-123!';
    const user = await prisma.user.create({
      data: {
        username: `${prefix}_${suffix}`,
        passwordHash: await passwords.hash(password),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    if (roleName === 'MEMBER') {
      await prisma.$executeRawUnsafe(
        `INSERT INTO member_profiles (userId, memberType) VALUES (?, 'PARTNER')`,
        user.id,
      );
    }
    return { user, password };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

    const authConfig = await prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } });
    originalLoginWithUsername = authConfig.loginWithUsername;
    originalCaptchaOnLoginEnabled = authConfig.captchaOnLoginEnabled;
    await prisma.systemAuthConfig.update({
      where: { id: 1 },
      data: { loginWithUsername: true, captchaOnLoginEnabled: false },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: createdUserIds } },
            { entityId: { in: createdUserIds } },
          ],
        },
      });
      await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      if (createdUserIds.length) {
        const placeholders = createdUserIds.map(() => '?').join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM member_profiles WHERE userId IN (${placeholders})`,
          ...createdUserIds,
        );
      }
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.systemAuthConfig.update({
        where: { id: 1 },
        data: {
          loginWithUsername: originalLoginWithUsername,
          captchaOnLoginEnabled: originalCaptchaOnLoginEnabled,
        },
      });
    }
    if (app) await app.close();
  });

  it('keeps member and administration portals separated by backend RBAC', async () => {
    const member = await createUserWithRole('MEMBER', 'portal_member');
    const admin = await createUserWithRole('SUPER_ADMIN', 'portal_admin');

    const memberLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: member.user.username, password: member.password }),
    });
    expect(memberLogin.status).toBe(200);

    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: admin.user.username, password: admin.password }),
    });
    expect(adminLogin.status).toBe(200);

    const memberPortal = await request('/member/portal-overview', {
      headers: { authorization: `Bearer ${memberLogin.body.accessToken}` },
    });
    expect(memberPortal.status).toBe(200);

    const memberAdminDenied = await request('/admin/users', {
      headers: { authorization: `Bearer ${memberLogin.body.accessToken}` },
    });
    expect(memberAdminDenied.status).toBe(403);
    expect(memberAdminDenied.body.code).toBe('FORBIDDEN');

    const adminConsole = await request('/admin/users', {
      headers: { authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    expect(adminConsole.status).toBe(200);

    const adminMemberDenied = await request('/member/portal-overview', {
      headers: { authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    expect(adminMemberDenied.status).toBe(403);
    expect(adminMemberDenied.body.code).toBe('FORBIDDEN');
  });
});
