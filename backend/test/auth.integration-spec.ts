import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  PasswordCreationMode,
  UserStatus,
  UsernameCreationMode,
} from '../src/generated/prisma/enums';

describe('MegaMitra auth integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let baseUrl: string;
  const createdUserIds: string[] = [];

  let originalAuth: Record<string, unknown>;
  let originalSecurity: Record<string, unknown>;
  let originalRegistration: Record<string, unknown>;

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

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);

    const [auth, security, registration] = await Promise.all([
      prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);

    originalAuth = {
      loginWithUsername: auth.loginWithUsername,
      loginWithEmail: auth.loginWithEmail,
      loginWithMobile: auth.loginWithMobile,
      captchaOnLoginEnabled: auth.captchaOnLoginEnabled,
      captchaOnRegistrationEnabled: auth.captchaOnRegistrationEnabled,
      captchaTtlSeconds: auth.captchaTtlSeconds,
      accessTokenTtlSeconds: auth.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: auth.refreshTokenTtlSeconds,
    };
    originalSecurity = {
      idleTimeoutMinutes: security.idleTimeoutMinutes,
      absoluteSessionTimeoutMinutes: security.absoluteSessionTimeoutMinutes,
      maxActiveSessions: security.maxActiveSessions,
      maxFailedLoginAttempts: security.maxFailedLoginAttempts,
      lockoutMinutes: security.lockoutMinutes,
      passwordMinLength: security.passwordMinLength,
      passwordMaxLength: security.passwordMaxLength,
      refreshTokenRotationEnabled: security.refreshTokenRotationEnabled,
    };
    originalRegistration = {
      publicRegistrationEnabled: registration.publicRegistrationEnabled,
      emailRequired: registration.emailRequired,
      mobileRequired: registration.mobileRequired,
      passwordMode: registration.passwordMode,
      usernameMode: registration.usernameMode,
      usernamePrefixEnabled: registration.usernamePrefixEnabled,
      usernamePrefix: registration.usernamePrefix,
      defaultRoleName: registration.defaultRoleName,
      allowMultipleAccountsPerEmail: registration.allowMultipleAccountsPerEmail,
      allowMultipleAccountsPerMobile: registration.allowMultipleAccountsPerMobile,
    };

    await Promise.all([
      prisma.systemAuthConfig.update({
        where: { id: 1 },
        data: {
          loginWithUsername: true,
          loginWithEmail: true,
          loginWithMobile: false,
          captchaOnLoginEnabled: false,
          captchaOnRegistrationEnabled: false,
        },
      }),
      prisma.systemSecurityConfig.update({
        where: { id: 1 },
        data: {
          idleTimeoutMinutes: 30,
          absoluteSessionTimeoutMinutes: 120,
          maxActiveSessions: 5,
          maxFailedLoginAttempts: 3,
          lockoutMinutes: 1,
          passwordMinLength: 10,
          passwordMaxLength: 128,
          refreshTokenRotationEnabled: true,
        },
      }),
      prisma.systemRegistrationConfig.update({
        where: { id: 1 },
        data: {
          publicRegistrationEnabled: true,
          emailRequired: true,
          mobileRequired: false,
          passwordMode: PasswordCreationMode.MANUAL,
          usernameMode: UsernameCreationMode.MANUAL,
          usernamePrefixEnabled: false,
          usernamePrefix: null,
          defaultRoleName: 'MEMBER',
          allowMultipleAccountsPerEmail: false,
          allowMultipleAccountsPerMobile: false,
        },
      }),
    ]);
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
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await Promise.all([
        prisma.systemAuthConfig.update({
          where: { id: 1 },
          data: originalAuth,
        }),
        prisma.systemSecurityConfig.update({
          where: { id: 1 },
          data: originalSecurity,
        }),
        prisma.systemRegistrationConfig.update({
          where: { id: 1 },
          data: originalRegistration,
        }),
      ]);
    }
    await app?.close();
  });

  it('covers registration, role enforcement, forced password change, rotation, replay, logout, and lockout', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const username = `it_${suffix}`;
    const email = `${username}@example.test`;
    let password = 'Integration-Pass-123!';

    const registered = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    expect(registered.status).toBe(201);
    const userId = String(registered.body.user.id);
    createdUserIds.push(userId);

    const memberRole = await prisma.userRole.findFirst({
      where: { userId },
      include: { role: true },
    });
    expect(memberRole?.role.name).toBe('MEMBER');

    await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');
    expect(typeof login.body.refreshToken).toBe('string');

    const memberDenied = await request('/admin/users', {
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    expect(memberDenied.status).toBe(403);
    expect(memberDenied.body.code).toBe('FORBIDDEN');

    await prisma.user.update({
      where: { id: userId },
      data: { mustChangePassword: true },
    });

    const changeRequired = await request('/admin/users', {
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    expect(changeRequired.status).toBe(403);

    const newPassword = 'Integration-New-Pass-456!';
    const changed = await request('/auth/change-password', {
      method: 'POST',
      headers: { authorization: `Bearer ${login.body.accessToken}` },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.success).toBe(true);
    password = newPassword;

    const loginAfterChange = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: email, password }),
    });
    expect(loginAfterChange.status).toBe(200);

    const oldAccess = loginAfterChange.body.accessToken as string;
    const oldRefresh = loginAfterChange.body.refreshToken as string;
    const refreshed = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: oldRefresh }),
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.sessionId).not.toBe(loginAfterChange.body.sessionId);

    const oldSessionDenied = await request('/auth/me', {
      headers: { authorization: `Bearer ${oldAccess}` },
    });
    expect(oldSessionDenied.status).toBe(401);

    const me = await request('/auth/me', {
      headers: { authorization: `Bearer ${refreshed.body.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(username);

    const replay = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: oldRefresh }),
    });
    expect(replay.status).toBe(401);

    const replayRevokedNewSession = await request('/auth/me', {
      headers: { authorization: `Bearer ${refreshed.body.accessToken}` },
    });
    expect(replayRevokedNewSession.status).toBe(401);

    const loginForLogout = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(loginForLogout.status).toBe(200);

    const logout = await request('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${loginForLogout.body.accessToken}` },
    });
    expect(logout.status).toBe(200);

    const loggedOutDenied = await request('/auth/me', {
      headers: { authorization: `Bearer ${loginForLogout.body.accessToken}` },
    });
    expect(loggedOutDenied.status).toBe(401);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const badLogin = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: username, password: 'wrong-password' }),
      });
      expect(badLogin.status).toBe(401);
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const correctButLocked = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(correctButLocked.status).toBe(401);
  });
});
