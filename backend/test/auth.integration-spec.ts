import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { createHmac, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  PasswordCreationMode,
  UserStatus,
  UsernameCreationMode,
} from '../src/generated/prisma/enums';
import {
  createPaidRegistrationFixture,
  type PaidRegistrationFixture,
} from './paid-registration.fixture';

type AuthConfigSnapshot = {
  loginWithUsername: boolean;
  loginWithEmail: boolean;
  loginWithMobile: boolean;
  captchaOnLoginEnabled: boolean;
  captchaOnRegistrationEnabled: boolean;
  captchaTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

type SecurityConfigSnapshot = {
  idleTimeoutMinutes: number;
  absoluteSessionTimeoutMinutes: number;
  maxActiveSessions: number;
  maxFailedLoginAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  passwordMaxLength: number;
  refreshTokenRotationEnabled: boolean;
};

type RegistrationConfigSnapshot = {
  publicRegistrationEnabled: boolean;
  emailRequired: boolean;
  mobileRequired: boolean;
  passwordMode: PasswordCreationMode;
  usernameMode: UsernameCreationMode;
  usernamePrefixEnabled: boolean;
  usernamePrefix: string | null;
  defaultRoleName: string;
  allowMultipleAccountsPerEmail: boolean;
  allowMultipleAccountsPerMobile: boolean;
};

describe('MegaGoldenClub auth integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let passwords: PasswordService;
  let baseUrl: string;
  let paidRegistration: PaidRegistrationFixture;
  const createdUserIds: string[] = [];
  const epinIds: string[] = [];

  let originalAuth: AuthConfigSnapshot;
  let originalSecurity: SecurityConfigSnapshot;
  let originalRegistration: RegistrationConfigSnapshot;

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

  async function createEpin(raw: string) {
    const id = await paidRegistration.createEpin(raw);
    epinIds.push(id);
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    passwords = app.get(PasswordService);

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

    paidRegistration = await createPaidRegistrationFixture(prisma, config, 'auth');
    createdUserIds.push(paidRegistration.sponsorUserId);
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
      if (paidRegistration) {
        await paidRegistration.cleanupUserEnrollments(createdUserIds);
      }
      if (epinIds.length) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM owner_epins WHERE id IN (${epinIds.map(() => '?').join(',')})`,
          ...epinIds,
        );
      }
      if (createdUserIds.length) {
        const placeholders = createdUserIds.map(() => '?').join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM binary_ancestry
           WHERE ancestorUserId IN (${placeholders}) OR descendantUserId IN (${placeholders})`,
          ...createdUserIds,
          ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM binary_placements
           WHERE memberUserId IN (${placeholders}) OR parentUserId IN (${placeholders})`,
          ...createdUserIds,
          ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM sponsor_relationships
           WHERE memberUserId IN (${placeholders}) OR sponsorUserId IN (${placeholders})`,
          ...createdUserIds,
          ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM member_profiles WHERE userId IN (${placeholders})`,
          ...createdUserIds,
        );
      }
      if (paidRegistration) {
        await paidRegistration.cleanupDomain();
      }
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
    if (app) await app.close();
  });

  it('covers registration, role enforcement, forced password change, rotation, replay, logout, and lockout', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const username = `it_${suffix}`;
    const email = `${username}@example.test`;
    const epin = `IT-${suffix}`;
    let password = 'Integration-Pass-123!';
    await createEpin(epin);

    const registered = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        email,
        password,
        fullName: 'Integration Member',
        sponsorReference: paidRegistration.sponsorUsername,
        epin,
      }),
    });
    expect(registered.status).toBe(201);
    const userId = String(registered.body.user.id);
    createdUserIds.push(userId);

    expect(registered.body.enrollment).toMatchObject({
      seasonId: paidRegistration.seasonId,
      seasonStartDate: paidRegistration.seasonStartDate,
      registrationFeePaid: true,
      firstInstallmentPaid: true,
    });
    expect(registered.body.enrollment.drawTokens).toEqual([
      expect.objectContaining({
        token: expect.stringMatching(/^\d{5}$/),
        installmentSequence: 1,
        status: 'AVAILABLE',
      }),
    ]);

    const enrollmentId = String(registered.body.enrollment.id);
    const firstInstallment = await prisma.programInstallment.findFirstOrThrow({
      where: { enrollmentId, sequence: 1 },
      select: { dueDate: true },
    });
    expect(String(firstInstallment.dueDate).slice(0, 10)).toBe(
      paidRegistration.seasonStartDate,
    );

    const drawTokenRows = await prisma.$queryRawUnsafe<
      Array<{ token: string; installmentSequence: number; status: string }>
    >(
      `SELECT token, installmentSequence, status
       FROM lucky_draw_tokens
       WHERE enrollmentId=? AND installmentSequence=1`,
      enrollmentId,
    );
    expect(drawTokenRows).toHaveLength(1);
    expect(drawTokenRows[0]).toMatchObject({
      installmentSequence: 1,
      status: 'AVAILABLE',
    });
    expect(drawTokenRows[0]?.token).toMatch(/^\d{5}$/);

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

  it('uses MEMBER-only registration, safe sponsor lookup, E-PIN replay protection, and seeds AGENT', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const [memberRole, agentRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } }),
      prisma.role.findUniqueOrThrow({ where: { name: 'AGENT' } }),
    ]);
    expect(memberRole.status).toBe('ACTIVE');
    expect(agentRole.status).toBe('ACTIVE');

    const sponsor = await prisma.user.create({
      data: {
        username: `sponsor_${suffix}`,
        email: `sponsor_${suffix}@example.test`,
        phone: `+9198${suffix.slice(0, 8)}`,
        passwordHash: 'lookup-only',
        firstName: 'Sponsor',
        lastName: 'Member',
        status: UserStatus.ACTIVE,
      },
    });
    createdUserIds.push(sponsor.id);
    await prisma.userRole.create({ data: { userId: sponsor.id, roleId: memberRole.id } });
    await prisma.$executeRawUnsafe(
      `INSERT INTO member_profiles (userId, memberType) VALUES (?, 'MEMBER')`,
      sponsor.id,
    );

    const registrationConfig = await request('/auth/registration-config');
    expect(registrationConfig.status).toBe(200);
    expect(registrationConfig.body.epinRequired).toBe(true);
    expect(registrationConfig.body.sponsorLookupEnabled).toBe(true);
    expect(registrationConfig.body.accountRole).toBe('MEMBER');

    const sponsorLookup = await request(
      `/auth/sponsor?reference=${encodeURIComponent(sponsor.email ?? '')}`,
    );
    expect(sponsorLookup.status).toBe(200);
    expect(sponsorLookup.body).toMatchObject({
      id: sponsor.id,
      username: sponsor.username,
      fullName: 'Sponsor Member',
      role: 'MEMBER',
      status: 'ACTIVE',
    });
    expect(sponsorLookup.body.memberType).toBeUndefined();
    expect(sponsorLookup.body.email).toBeUndefined();
    expect(sponsorLookup.body.phone).toBeUndefined();

    const missingEpin = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `missing_epin_${suffix}`,
        email: `missing_epin_${suffix}@example.test`,
        password: 'Integration-Pass-123!',
        fullName: 'Missing Epin',
        sponsorReference: sponsor.username,
      }),
    });
    expect(missingEpin.status).toBe(400);

    const deprecatedEpin = `OLD-${suffix}`;
    await createEpin(deprecatedEpin);
    const deprecatedMemberType = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `deprecated_${suffix}`,
        email: `deprecated_${suffix}@example.test`,
        password: 'Integration-Pass-123!',
        fullName: 'Deprecated Member Type',
        sponsorReference: sponsor.username,
        memberType: 'PARTNER',
        epin: deprecatedEpin,
      }),
    });
    expect(deprecatedMemberType.status).toBe(400);
    const deprecatedUser = await prisma.user.findUnique({ where: { username: `deprecated_${suffix}` } });
    expect(deprecatedUser).toBeNull();

    const epin = `PUB-${suffix}`;
    await createEpin(epin);
    const registered = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `public_${suffix}`,
        email: `public_${suffix}@example.test`,
        phone: `+9177${suffix.slice(0, 8)}`,
        password: 'Integration-Pass-123!',
        fullName: 'Public Member',
        sponsorReference: sponsor.username,
        epin,
      }),
    });
    expect(registered.status).toBe(201);
    const memberUserId = String(registered.body.user.id);
    createdUserIds.push(memberUserId);
    expect(registered.body.sponsor).toMatchObject({ id: sponsor.id, username: sponsor.username });
    expect(['A', 'B', 'C', 'D']).toContain(String(registered.body.placement?.slot));

    const createdMemberRole = await prisma.userRole.findFirst({
      where: { userId: memberUserId },
      include: { role: true },
    });
    expect(createdMemberRole?.role.name).toBe('MEMBER');
    const profiles = await prisma.$queryRawUnsafe<Array<{ memberType: string }>>(
      'SELECT memberType FROM member_profiles WHERE userId=? LIMIT 1',
      memberUserId,
    );
    expect(profiles[0]?.memberType).toBe('MEMBER');

    const relationship = await prisma.sponsorRelationship.findUnique({
      where: { memberUserId },
    });
    expect(relationship?.sponsorUserId).toBe(sponsor.id);

    const placements = await prisma.$queryRawUnsafe<Array<{ parentUserId: string; slot: string; side: string }>>(
      'SELECT parentUserId, slot, side FROM binary_placements WHERE memberUserId=? LIMIT 1',
      memberUserId,
    );
    expect(placements[0]?.parentUserId).toBe(sponsor.id);
    expect(['A', 'B', 'C', 'D']).toContain(placements[0]?.slot);

    const epinRows = await prisma.$queryRawUnsafe<Array<{ status: string; usedByUserId: string | null }>>(
      'SELECT status, usedByUserId FROM owner_epins WHERE pinHash=? LIMIT 1',
      createHmac('sha256', config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
        .update(`owner-portal:epin:${epin}`)
        .digest('hex'),
    );
    expect(epinRows[0]).toMatchObject({ status: 'USED', usedByUserId: memberUserId });

    const replay = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `replay_${suffix}`,
        email: `replay_${suffix}@example.test`,
        password: 'Integration-Pass-123!',
        fullName: 'Replay Member',
        sponsorReference: sponsor.username,
        epin,
      }),
    });
    expect(replay.status).toBe(400);
    const replayUser = await prisma.user.findUnique({ where: { username: `replay_${suffix}` } });
    expect(replayUser).toBeNull();

    const adminPassword = 'Admin-Epin-Test-123!';
    const admin = await prisma.user.create({
      data: {
        username: `admin_epin_${suffix}`,
        passwordHash: await passwords.hash(adminPassword),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(admin.id);
    const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdminRole.id } });
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: admin.username, password: adminPassword }),
    });
    expect(adminLogin.status).toBe(200);

    const adminMissingEpin = await request('/admin/owner-portal/core/members', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminLogin.body.accessToken}` },
      body: JSON.stringify({
        username: `admin_created_${suffix}`,
        fullName: 'Admin Created Member',
        password: 'Integration-Pass-123!',
        sponsorReference: sponsor.username,
        placement: 'AUTO',
      }),
    });
    expect(adminMissingEpin.status).toBe(400);
  });
});
