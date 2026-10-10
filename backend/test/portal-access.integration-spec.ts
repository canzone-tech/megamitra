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
          `DELETE FROM binary_ancestry WHERE ancestorUserId IN (${placeholders}) OR descendantUserId IN (${placeholders})`,
          ...createdUserIds, ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM binary_placements WHERE memberUserId IN (${placeholders}) OR parentUserId IN (${placeholders})`,
          ...createdUserIds, ...createdUserIds,
        );
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

  it('shows only a logged-in member placement subtree and denies unrelated roots', async () => {
    const root = await createUserWithRole('MEMBER', 'genealogy_root');
    const child = await createUserWithRole('MEMBER', 'genealogy_child');
    const outsider = await createUserWithRole('MEMBER', 'genealogy_other');
    const admin = await createUserWithRole('SUPER_ADMIN', 'genealogy_admin');

    await prisma.$executeRawUnsafe(
      `INSERT INTO binary_placements (id,memberUserId,parentUserId,side,slot)
       VALUES (?,?,?,'LEFT','A')`,
      randomUUID(), child.user.id, root.user.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO binary_ancestry (ancestorUserId,descendantUserId,depth,firstLegSide,firstLegSlot)
       VALUES (?,?,1,'LEFT','A')`,
      root.user.id, child.user.id,
    );
    const rootLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: root.user.username, password: root.password }),
    });
    expect(rootLogin.status).toBe(200);
    const memberAuth = { authorization: `Bearer ${rootLogin.body.accessToken}` };

    const own = await request('/member/genealogy', { headers: memberAuth });
    expect(own.status).toBe(200);
    expect(own.body.homeRootUserId).toBe(root.user.id);
    expect(own.body.root).toMatchObject({ id: root.user.id, directChildCount: 1 });
    expect(own.body.members).toEqual([expect.objectContaining({
      id: child.user.id, parentUserId: root.user.id,
      slot: 'A', side: 'LEFT', depth: 1, firstLegSlot: 'A',
    })]);
    expect(own.body.visibleMemberCount).toBe(1);
    expect(JSON.stringify(own.body)).not.toContain(outsider.user.username);

    const drilled = await request(
      `/member/genealogy?rootUserId=${child.user.id}`, { headers: memberAuth },
    );
    expect(drilled.status).toBe(200);
    expect(drilled.body.root.id).toBe(child.user.id);
    expect(drilled.body.visibleMemberCount).toBe(0);
    expect(drilled.body.canGoToParent).toBe(true);

    const outside = await request(
      `/member/genealogy?rootUserId=${outsider.user.id}`, { headers: memberAuth },
    );
    expect(outside.status).toBe(404);
    const invalid = await request(
      '/member/genealogy?rootUserId=not-a-uuid', { headers: memberAuth },
    );
    expect(invalid.status).toBe(400);
    const adminTreeDenied = await request('/admin/owner-portal/core/genealogy', {
      headers: memberAuth,
    });
    expect(adminTreeDenied.status).toBe(403);
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: admin.user.username, password: admin.password }),
    });
    expect(adminLogin.status).toBe(200);
    const memberTreeDenied = await request('/member/genealogy', {
      headers: { authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    expect(memberTreeDenied.status).toBe(403);
    const anonymous = await request('/member/genealogy');
    expect(anonymous.status).toBe(401);
  });
});
