import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
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

type HttpResult = {
  status: number;
  body: Record<string, any>;
};

type GeneratedEpin = {
  id: string;
  pin: string;
  expiresAt: string;
};

type PlacementRow = {
  memberUserId: string;
  parentUserId: string;
  slot: string;
  side: string;
};

describe('MegaGoldenClub authenticated runtime UAT', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let passwords: PasswordService;
  let baseUrl: string;
  let paidRegistration: PaidRegistrationFixture;
  let originalLoginWithUsername: boolean;
  let originalCaptchaOnLoginEnabled: boolean;
  let originalCaptchaOnRegistrationEnabled: boolean;
  let originalRegistration: RegistrationConfigSnapshot;
  let originalAdminPermissions: string[] = [];
  let originalAgentPermissions: string[] = [];

  const createdUserIds: string[] = [];
  const generatedEpinIds: string[] = [];

  async function request(path: string, init: RequestInit = {}): Promise<HttpResult> {
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

  function bearer(accessToken: unknown) {
    return { authorization: `Bearer ${String(accessToken)}` };
  }

  async function login(identifier: string, password: string) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
  }

  async function rolePermissionCodes(roleName: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: roleName },
      include: { permissions: { include: { permission: true } } },
    });
    return role.permissions.map((item) => item.permission.code).sort();
  }

  async function restoreRolePermissions(roleName: string, codes: string[]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const permissions = codes.length
      ? await prisma.permission.findMany({
          where: { code: { in: codes } },
          select: { id: true },
        })
      : [];
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
        });
      }
    });
  }

  async function createSuperAdminFixture(prefix: string) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const password = 'Uat-Super-Admin-123!';
    const user = await prisma.user.create({
      data: {
        username: `${prefix}_${suffix}`,
        email: `${prefix}_${suffix}@example.test`,
        passwordHash: await passwords.hash(password),
        firstName: 'Runtime',
        lastName: 'Owner',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return { user, password };
  }

  async function changeInitialPassword(
    identifier: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const initialLogin = await login(identifier, currentPassword);
    expect(initialLogin.status).toBe(200);

    const protectedBeforeChange = await request('/admin/users', {
      headers: bearer(initialLogin.body.accessToken),
    });
    expect(protectedBeforeChange.status).toBe(403);

    const changed = await request('/auth/change-password', {
      method: 'POST',
      headers: bearer(initialLogin.body.accessToken),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.success).toBe(true);

    const relogin = await login(identifier, newPassword);
    expect(relogin.status).toBe(200);
    return relogin;
  }

  async function registerPublicMember(args: {
    username: string;
    email: string;
    password: string;
    epin: string;
    fullName: string;
    sponsorReference?: string;
  }) {
    const registered = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    expect(registered).toMatchObject({ status: 201 });
    const userId = String(registered.body.user.id);
    createdUserIds.push(userId);
    return registered;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    passwords = app.get(PasswordService);

    const [authConfig, registration] = await Promise.all([
      prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    originalLoginWithUsername = authConfig.loginWithUsername;
    originalCaptchaOnLoginEnabled = authConfig.captchaOnLoginEnabled;
    originalCaptchaOnRegistrationEnabled = authConfig.captchaOnRegistrationEnabled;
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
    [originalAdminPermissions, originalAgentPermissions] = await Promise.all([
      rolePermissionCodes('ADMIN'),
      rolePermissionCodes('AGENT'),
    ]);

    await Promise.all([
      prisma.systemAuthConfig.update({
        where: { id: 1 },
        data: {
          loginWithUsername: true,
          captchaOnLoginEnabled: false,
          captchaOnRegistrationEnabled: false,
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

    paidRegistration = await createPaidRegistrationFixture(prisma, config, 'uat');
    createdUserIds.push(paidRegistration.sponsorUserId);
  });

  afterAll(async () => {
    if (prisma) {
      await Promise.all([
        restoreRolePermissions('ADMIN', originalAdminPermissions),
        restoreRolePermissions('AGENT', originalAgentPermissions),
      ]);

      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: createdUserIds } },
            { entityId: { in: createdUserIds } },
          ],
        },
      });
      await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      if (paidRegistration) {
        await paidRegistration.cleanupUserEnrollments(createdUserIds);
      }

      if (generatedEpinIds.length) {
        const epinPlaceholders = generatedEpinIds.map(() => '?').join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM owner_epins WHERE id IN (${epinPlaceholders})`,
          ...generatedEpinIds,
        );
      }

      if (createdUserIds.length) {
        const placeholders = createdUserIds.map(() => '?').join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM owner_auth_codes WHERE operatorUserId IN (${placeholders})`,
          ...createdUserIds,
        );
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
          data: {
            loginWithUsername: originalLoginWithUsername,
            captchaOnLoginEnabled: originalCaptchaOnLoginEnabled,
            captchaOnRegistrationEnabled: originalCaptchaOnRegistrationEnabled,
          },
        }),
        prisma.systemRegistrationConfig.update({
          where: { id: 1 },
          data: originalRegistration,
        }),
      ]);
    }
    if (app) await app.close();
  });

  it(
    'covers SUPER_ADMIN staff creation, live RBAC, public 1:4 registration, admin Add Member, and portal boundaries',
    async () => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
      const superAdmin = await createSuperAdminFixture('uat_owner');
      const ownerLogin = await login(superAdmin.user.username, superAdmin.password);
      expect(ownerLogin.status).toBe(200);
      const ownerHeaders = bearer(ownerLogin.body.accessToken);

      const retiredDeploymentExport = await request(
        '/admin/owner-portal/seasons/retired-deployment-contract/deployment-package',
        { headers: ownerHeaders },
      );
      expect(retiredDeploymentExport.status).toBe(404);
      const retiredDeploymentImport = await request(
        '/admin/owner-portal/season-deployment/import',
        {
          method: 'POST',
          headers: ownerHeaders,
        },
      );
      expect(retiredDeploymentImport.status).toBe(404);

      const dashboardBeforeStaff = await request(
        '/admin/owner-portal/dashboard',
        { headers: ownerHeaders },
      );
      expect(dashboardBeforeStaff.status).toBe(200);
      expect(dashboardBeforeStaff.body.activeSeason).toMatchObject({
        id: paidRegistration.seasonId,
        registrationFee: '1000.00',
        installmentAmount: '1000.00',
        monthlyEmi: '1000.00',
        installmentCount: 18,
        totalMonths: 18,
        currencyCode: 'INR',
      });

      const adminUsername = `uat_admin_${suffix}`;
      const agentUsername = `uat_agent_${suffix}`;
      const adminInitialPassword = 'Uat-Admin-Initial-123!';
      const agentInitialPassword = 'Uat-Agent-Initial-123!';

      const adminCreated = await request('/admin/users/staff', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          username: adminUsername,
          email: `${adminUsername}@example.test`,
          password: adminInitialPassword,
          firstName: 'Runtime',
          lastName: 'Admin',
          role: 'ADMIN',
        }),
      });
      expect(adminCreated.status).toBe(201);
      const adminUserId = String(adminCreated.body.id);
      createdUserIds.push(adminUserId);

      const agentCreated = await request('/admin/users/staff', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          username: agentUsername,
          email: `${agentUsername}@example.test`,
          password: agentInitialPassword,
          firstName: 'Runtime',
          lastName: 'Agent',
          role: 'AGENT',
        }),
      });
      expect(agentCreated.status).toBe(201);
      const agentUserId = String(agentCreated.body.id);
      createdUserIds.push(agentUserId);

      await prisma.user.updateMany({
        where: { id: { in: [adminUserId, agentUserId] } },
        data: { emailVerifiedAt: new Date() },
      });

      const staffRoles = await prisma.userRole.findMany({
        where: { userId: { in: [adminUserId, agentUserId] } },
        include: { role: true },
      });
      expect(staffRoles.find((item) => item.userId === adminUserId)?.role.name).toBe('ADMIN');
      expect(staffRoles.find((item) => item.userId === agentUserId)?.role.name).toBe('AGENT');

      const dashboardAfterStaff = await request(
        '/admin/owner-portal/dashboard',
        { headers: ownerHeaders },
      );
      expect(dashboardAfterStaff.status).toBe(200);
      expect(dashboardAfterStaff.body.memberCount).toBe(
        dashboardBeforeStaff.body.memberCount,
      );
      expect(dashboardAfterStaff.body).toEqual(
        expect.objectContaining({
          activeMemberCount: expect.any(Number),
          placedMemberCount: expect.any(Number),
          activeEnrollmentCount: expect.any(Number),
          qualifiedPairs: expect.any(Number),
          grossCollections: expect.any(Number),
          totalRefunds: expect.any(Number),
          netCollections: expect.any(Number),
          walletCredits: expect.any(Number),
          walletDebits: expect.any(Number),
          walletBalance: expect.any(Number),
          pendingKyc: expect.any(Number),
          approvedKyc: expect.any(Number),
          activeEpins: expect.any(Number),
          unusedEpins: expect.any(Number),
          usedEpins: expect.any(Number),
          activeAuthCodes: expect.any(Number),
          openDraws: expect.any(Number),
          totalWinners: expect.any(Number),
          openPrizeClaims: expect.any(Number),
          rankAchievementCount: expect.any(Number),
          recentMembers: expect.any(Array),
          recentPayments: expect.any(Array),
        }),
      );

      const adminPassword = 'Uat-Admin-Changed-456!';
      const agentPassword = 'Uat-Agent-Changed-456!';
      const adminLogin = await changeInitialPassword(
        adminUsername,
        adminInitialPassword,
        adminPassword,
      );
      const agentLogin = await changeInitialPassword(
        agentUsername,
        agentInitialPassword,
        agentPassword,
      );
      const adminHeaders = bearer(adminLogin.body.accessToken);
      const agentHeaders = bearer(agentLogin.body.accessToken);

      const setAdminAuthCodePermissions = await request(
        '/admin/rbac/roles/ADMIN/permissions',
        {
          method: 'PUT',
          headers: ownerHeaders,
          body: JSON.stringify({
            permissions: ['platform.config.read', 'platform.config.manage'],
          }),
        },
      );
      expect(setAdminAuthCodePermissions.status).toBe(200);
      const setAgentAuthCodePermissions = await request(
        '/admin/rbac/roles/AGENT/permissions',
        {
          method: 'PUT',
          headers: ownerHeaders,
          body: JSON.stringify({
            permissions: ['platform.config.read', 'platform.config.manage'],
          }),
        },
      );
      expect(setAgentAuthCodePermissions.status).toBe(200);

      const authCodeOperators = await request(
        '/admin/owner-portal/auth-code-operators',
        { headers: ownerHeaders },
      );
      expect(authCodeOperators.status).toBe(200);
      const operatorRows = authCodeOperators.body as unknown as Array<{
        id: string;
        username: string;
        roleScope: string;
      }>;
      expect(operatorRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: adminUserId,
            username: adminUsername,
            roleScope: 'ADMIN',
          }),
          expect.objectContaining({
            id: agentUserId,
            username: agentUsername,
            roleScope: 'AGENT',
          }),
        ]),
      );
      expect(
        operatorRows.some((item) => item.id === superAdmin.user.id),
      ).toBe(false);

      const wrongRoleOperator = await request('/admin/owner-portal/auth-codes', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          roleScope: 'AGENT',
          operatorUserId: adminUserId,
          purpose: 'PAYMENT_AUTHORIZATION',
          validityMinutes: 30,
        }),
      });
      expect(wrongRoleOperator.status).toBe(400);

      const generatedAuthCode = await request('/admin/owner-portal/auth-codes', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          roleScope: 'ADMIN',
          operatorUserId: adminUserId,
          purpose: 'PAYMENT_AUTHORIZATION',
          validityMinutes: 30,
        }),
      });
      expect(generatedAuthCode.status).toBe(201);
      expect(String(generatedAuthCode.body.code)).toMatch(/^MGC-AUTH-/);
      expect(generatedAuthCode.body.operatorUserId).toBe(adminUserId);
      expect(generatedAuthCode.body.operatorUsername).toBe(adminUsername);

      const code = String(generatedAuthCode.body.code);

      const adminMyAuthCodes = await request(
        '/admin/owner-portal/auth-codes/mine',
        { headers: adminHeaders },
      );
      expect(adminMyAuthCodes.status).toBe(200);
      expect(
        (adminMyAuthCodes.body as unknown as Array<{ id: string; code: string }>).find(
          (item) => item.id === String(generatedAuthCode.body.id),
        ),
      ).toMatchObject({ code });

      const agentMyAuthCodes = await request(
        '/admin/owner-portal/auth-codes/mine',
        { headers: agentHeaders },
      );
      expect(agentMyAuthCodes.status).toBe(200);
      expect(
        (agentMyAuthCodes.body as unknown as Array<{ id: string }>).some(
          (item) => item.id === String(generatedAuthCode.body.id),
        ),
      ).toBe(false);

      const superAdminMineDenied = await request(
        '/admin/owner-portal/auth-codes/mine',
        { headers: ownerHeaders },
      );
      expect(superAdminMineDenied.status).toBe(403);

      const duplicateActiveAuthCode = await request(
        '/admin/owner-portal/auth-codes',
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            roleScope: 'ADMIN',
            operatorUserId: adminUserId,
            purpose: 'PAYMENT_AUTHORIZATION',
            validityMinutes: 60,
          }),
        },
      );
      expect(duplicateActiveAuthCode.status).toBe(409);
      expect(String(duplicateActiveAuthCode.body.message)).toContain(
        'active authorization code already exists',
      );

      const authCodeRegister = await request('/admin/owner-portal/auth-codes', {
        headers: ownerHeaders,
      });
      expect(authCodeRegister.status).toBe(200);
      const authCodeRows = authCodeRegister.body as unknown as Array<{
        id: string;
        code: string | null;
        displaySuffix: string;
        operatorUsername: string;
        status: string;
      }>;
      const generatedRegisterRow = authCodeRows.find(
        (item) => item.id === String(generatedAuthCode.body.id),
      );
      expect(generatedRegisterRow).toMatchObject({
        code,
        displaySuffix: code.slice(-6),
        operatorUsername: adminUsername,
        status: 'ACTIVE',
      });

      const storedCiphertext = await prisma.$queryRawUnsafe<
        Array<{ codeCiphertext: string | null }>
      >(
        'SELECT codeCiphertext FROM owner_auth_codes WHERE id=? LIMIT 1',
        String(generatedAuthCode.body.id),
      );
      expect(storedCiphertext[0]?.codeCiphertext).toBeTruthy();
      expect(storedCiphertext[0]?.codeCiphertext).not.toContain(code);

      const wrongOperatorConsume = await request(
        '/admin/owner-portal/auth-codes/consume',
        {
          method: 'POST',
          headers: agentHeaders,
          body: JSON.stringify({
            code,
            purpose: 'PAYMENT_AUTHORIZATION',
          }),
        },
      );
      expect(wrongOperatorConsume.status).toBe(400);

      const assignedOperatorUse = await request(
        '/admin/owner-portal/auth-codes/consume',
        {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({
            code,
            purpose: 'PAYMENT_AUTHORIZATION',
          }),
        },
      );
      expect(assignedOperatorUse.status).toBe(201);
      expect(assignedOperatorUse.body.ok).toBe(true);

      const repeatedOperatorUse = await request(
        '/admin/owner-portal/auth-codes/consume',
        {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({
            code,
            purpose: 'PAYMENT_AUTHORIZATION',
          }),
        },
      );
      expect(repeatedOperatorUse.status).toBe(201);
      expect(repeatedOperatorUse.body.ok).toBe(true);

      const adminMyAuthCodesAfterUse = await request(
        '/admin/owner-portal/auth-codes/mine',
        { headers: adminHeaders },
      );
      expect(adminMyAuthCodesAfterUse.status).toBe(200);
      expect(
        (adminMyAuthCodesAfterUse.body as unknown as Array<{
          id: string;
          code: string;
          status: string;
        }>).find(
          (item) => item.id === String(generatedAuthCode.body.id),
        ),
      ).toMatchObject({ code, status: 'ACTIVE' });

      const activeAuthCodeRegister = await request('/admin/owner-portal/auth-codes', {
        headers: ownerHeaders,
      });
      expect(activeAuthCodeRegister.status).toBe(200);
      const activeAuthCodeRows = activeAuthCodeRegister.body as unknown as Array<{
        id: string;
        code: string | null;
        status: string;
        usedAt: string | null;
      }>;
      const activeAfterUse = activeAuthCodeRows.find(
        (item) => item.id === String(generatedAuthCode.body.id),
      );
      expect(activeAfterUse).toMatchObject({ code, status: 'ACTIVE' });
      expect(activeAfterUse?.usedAt).toBeTruthy();

      const duplicateAfterUse = await request('/admin/owner-portal/auth-codes', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          roleScope: 'ADMIN',
          operatorUserId: adminUserId,
          purpose: 'PAYMENT_AUTHORIZATION',
          validityMinutes: 30,
        }),
      });
      expect(duplicateAfterUse.status).toBe(409);

      const expiredAt = new Date(Date.now() - 60_000);
      await prisma.$executeRawUnsafe(
        'UPDATE owner_auth_codes SET expiresAt=? WHERE id=?',
        expiredAt,
        String(generatedAuthCode.body.id),
      );

      const adminMyAuthCodesAfterExpiry = await request(
        '/admin/owner-portal/auth-codes/mine',
        { headers: adminHeaders },
      );
      expect(adminMyAuthCodesAfterExpiry.status).toBe(200);
      expect(
        (adminMyAuthCodesAfterExpiry.body as unknown as Array<{ id: string }>).some(
          (item) => item.id === String(generatedAuthCode.body.id),
        ),
      ).toBe(false);

      const expiredUse = await request('/admin/owner-portal/auth-codes/consume', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          code,
          purpose: 'PAYMENT_AUTHORIZATION',
        }),
      });
      expect(expiredUse.status).toBe(400);

      const expiredAuthCodeRegister = await request('/admin/owner-portal/auth-codes', {
        headers: ownerHeaders,
      });
      expect(expiredAuthCodeRegister.status).toBe(200);
      expect(
        (expiredAuthCodeRegister.body as unknown as Array<{
          id: string;
          status: string;
        }>).find(
          (item) => item.id === String(generatedAuthCode.body.id),
        ),
      ).toMatchObject({ status: 'EXPIRED' });

      const replacementRequest = () =>
        request('/admin/owner-portal/auth-codes', {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            roleScope: 'ADMIN',
            operatorUserId: adminUserId,
            purpose: 'PAYMENT_AUTHORIZATION',
            validityMinutes: 30,
          }),
        });
      const replacementResults = await Promise.all([
        replacementRequest(),
        replacementRequest(),
      ]);
      expect(replacementResults.map((result) => result.status).sort()).toEqual([
        201,
        409,
      ]);
      const replacement = replacementResults.find(
        (result) => result.status === 201,
      );
      expect(String(replacement?.body.code)).toMatch(/^MGC-AUTH-/);

      const setAdminReadOnly = await request('/admin/rbac/roles/ADMIN/permissions', {
        method: 'PUT',
        headers: ownerHeaders,
        body: JSON.stringify({ permissions: ['users.read'] }),
      });
      expect(setAdminReadOnly.status).toBe(200);
      const setAgentReadOnly = await request('/admin/rbac/roles/AGENT/permissions', {
        method: 'PUT',
        headers: ownerHeaders,
        body: JSON.stringify({ permissions: ['users.read'] }),
      });
      expect(setAgentReadOnly.status).toBe(200);

      const adminCanRead = await request('/admin/users', { headers: adminHeaders });
      expect(adminCanRead.status).toBe(200);
      const agentCanRead = await request('/admin/users', { headers: agentHeaders });
      expect(agentCanRead.status).toBe(200);

      const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const adminManageDenied = await request('/admin/owner-portal/epins', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ quantity: 1, expiresAt: expiry }),
      });
      expect(adminManageDenied.status).toBe(403);
      const agentManageDenied = await request('/admin/owner-portal/epins', {
        method: 'POST',
        headers: agentHeaders,
        body: JSON.stringify({ quantity: 1, expiresAt: expiry }),
      });
      expect(agentManageDenied.status).toBe(403);

      const elevateAdmin = await request('/admin/rbac/roles/ADMIN/permissions', {
        method: 'PUT',
        headers: ownerHeaders,
        body: JSON.stringify({ permissions: ['users.read', 'users.manage', 'genealogy.read'] }),
      });
      expect(elevateAdmin.status).toBe(200);

      const epinBatch = await request('/admin/owner-portal/epins', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          seasonId: paidRegistration.seasonId,
          pinType: 'ACTIVATION',
          quantity: 7,
          expiresAt: expiry,
        }),
      });
      expect(epinBatch.status).toBe(201);
      const epins = epinBatch.body.generated as GeneratedEpin[];
      expect(epins).toHaveLength(7);
      generatedEpinIds.push(...epins.map((epin) => epin.id));

      const defaultInventory = await request(
        `/admin/owner-portal/epins?seasonId=${encodeURIComponent(paidRegistration.seasonId)}&pinType=ACTIVATION&page=1&pageSize=25`,
        { headers: adminHeaders },
      );
      expect(defaultInventory.status).toBe(200);
      expect(defaultInventory.body.total).toBe(7);
      expect(
        (defaultInventory.body.items as Array<Record<string, any>>).every(
          (item) => item.status === 'ACTIVE',
        ),
      ).toBe(true);

      const inventoryPage1 = await request(
        `/admin/owner-portal/epins?status=UNUSED&seasonId=${encodeURIComponent(paidRegistration.seasonId)}&pinType=ACTIVATION&page=1&pageSize=5`,
        { headers: adminHeaders },
      );
      expect(inventoryPage1.status).toBe(200);
      expect(inventoryPage1.body).toMatchObject({ total: 7, page: 1, pageSize: 5, totalPages: 2 });
      const inventoryItems1 = inventoryPage1.body.items as Array<Record<string, any>>;
      expect(inventoryItems1).toHaveLength(5);
      expect(
        inventoryItems1.every(
          (item) =>
            typeof item.pin === 'string' &&
            epins.some((epin) => epin.pin === item.pin) &&
            item.pinCiphertext === undefined,
        ),
      ).toBe(true);

      const inventoryPage2 = await request(
        `/admin/owner-portal/epins?status=UNUSED&seasonId=${encodeURIComponent(paidRegistration.seasonId)}&pinType=ACTIVATION&page=2&pageSize=5`,
        { headers: adminHeaders },
      );
      expect(inventoryPage2.status).toBe(200);
      expect((inventoryPage2.body.items as Array<Record<string, any>>)).toHaveLength(2);

      const revoked = await request(`/admin/owner-portal/epins/${encodeURIComponent(epins[6].id)}/revoke`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'Runtime UAT status filter coverage' }),
      });
      expect(revoked.status).toBe(201);
      expect(revoked.body.ok).toBe(true);

      const activeAfterRevoke = await request(
        `/admin/owner-portal/epins?seasonId=${encodeURIComponent(paidRegistration.seasonId)}&pinType=ACTIVATION&page=1&pageSize=25`,
        { headers: adminHeaders },
      );
      expect(activeAfterRevoke.status).toBe(200);
      expect(activeAfterRevoke.body.total).toBe(6);

      const revokedInventory = await request(
        `/admin/owner-portal/epins?status=REVOKED&seasonId=${encodeURIComponent(paidRegistration.seasonId)}&pinType=ACTIVATION&page=1&pageSize=25`,
        { headers: adminHeaders },
      );
      expect(revokedInventory.status).toBe(200);
      expect(revokedInventory.body.total).toBe(1);
      expect(revokedInventory.body.items).toEqual([
        expect.objectContaining({ id: epins[6].id, status: 'REVOKED' }),
      ]);

      const publicEpins = await Promise.all(
        Array.from({ length: 5 }, async (_, index) => {
          const pin = `UAT-PUB-${suffix}-${index + 1}`;
          const id = await paidRegistration.createEpin(pin);
          generatedEpinIds.push(id);
          return { id, pin };
        }),
      );

      const sponsorUsername = `uat_sponsor_${suffix}`;
      const sponsorPassword = 'Uat-Sponsor-Pass-123!';
      const sponsorRegistration = await registerPublicMember({
        username: sponsorUsername,
        email: `${sponsorUsername}@example.test`,
        password: sponsorPassword,
        epin: publicEpins[0].pin,
        fullName: 'Runtime Sponsor',
        sponsorReference: paidRegistration.sponsorUsername,
      });
      const sponsorUserId = String(sponsorRegistration.body.user.id);
      expect(sponsorRegistration.body.sponsor).toMatchObject({
        id: paidRegistration.sponsorUserId,
        username: paidRegistration.sponsorUsername,
      });
      expect(sponsorRegistration.body.placement).toEqual({ slot: 'A', side: 'LEFT' });

      await prisma.user.update({
        where: { id: sponsorUserId },
        data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });

      const sponsorLookup = await request(
        `/auth/sponsor?reference=${encodeURIComponent(sponsorUsername)}`,
      );
      expect(sponsorLookup.status).toBe(200);
      expect(sponsorLookup.body).toMatchObject({
        id: sponsorUserId,
        username: sponsorUsername,
        role: 'MEMBER',
        status: 'ACTIVE',
      });
      expect(sponsorLookup.body.email).toBeUndefined();
      expect(sponsorLookup.body.phone).toBeUndefined();

      const childIds: string[] = [];
      const childUsernames: string[] = [];
      const expectedSlots = ['A', 'B', 'C', 'D'];
      const expectedSides = ['LEFT', 'LEFT', 'RIGHT', 'RIGHT'];
      for (let index = 0; index < 4; index += 1) {
        const username = `uat_child_${index + 1}_${suffix}`;
        childUsernames.push(username);
        const registered = await registerPublicMember({
          username,
          email: `${username}@example.test`,
          password: `Uat-Child-${index + 1}-Pass-123!`,
          epin: publicEpins[index + 1].pin,
          fullName: `Runtime Child ${index + 1}`,
          sponsorReference: sponsorUsername,
        });
        childIds.push(String(registered.body.user.id));
        expect(registered.body.sponsor).toMatchObject({
          id: sponsorUserId,
          username: sponsorUsername,
        });
        expect(registered.body.placement).toEqual({
          slot: expectedSlots[index],
          side: expectedSides[index],
        });
      }

      const placements = await prisma.$queryRawUnsafe<PlacementRow[]>(
        `SELECT memberUserId, parentUserId, slot, side
         FROM binary_placements
         WHERE parentUserId=?
         ORDER BY FIELD(slot, 'A','B','C','D')`,
        sponsorUserId,
      );
      expect(placements).toHaveLength(4);
      expect(placements.map((placement) => placement.slot)).toEqual(expectedSlots);
      expect(placements.map((placement) => placement.side)).toEqual(expectedSides);
      expect(placements.every((placement) => placement.parentUserId === sponsorUserId)).toBe(true);

      const publicMemberRoles = await prisma.userRole.findMany({
        where: { userId: { in: [sponsorUserId, ...childIds] } },
        include: { role: true },
      });
      expect(publicMemberRoles).toHaveLength(5);
      expect(publicMemberRoles.every((item) => item.role.name === 'MEMBER')).toBe(true);

      const usedPublicEpins = await prisma.$queryRawUnsafe<
        Array<{ id: string; status: string; usedByUserId: string | null }>
      >(
        `SELECT id, status, usedByUserId
         FROM owner_epins
         WHERE id IN (${publicEpins.map(() => '?').join(',')})`,
        ...publicEpins.map((epin) => epin.id),
      );
      expect(usedPublicEpins).toHaveLength(5);
      expect(usedPublicEpins.every((epin) => epin.status === 'USED' && epin.usedByUserId)).toBe(
        true,
      );

      const firstChildId = childIds[0];
      await prisma.user.update({
        where: { id: firstChildId },
        data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });
      const memberLogin = await login(childUsernames[0], 'Uat-Child-1-Pass-123!');
      expect(memberLogin.status).toBe(200);
      const memberHeaders = bearer(memberLogin.body.accessToken);

      const memberPortal = await request('/member/portal-overview', { headers: memberHeaders });
      expect(memberPortal.status).toBe(200);
      const memberAdminDenied = await request('/admin/users', { headers: memberHeaders });
      expect(memberAdminDenied.status).toBe(403);

      const adminMemberUsername = `uat_added_member_${suffix}`;
      const adminMemberEmail = `${adminMemberUsername}@example.test`;
      const adminMemberPhone = `+91${String(parseInt(suffix.slice(0, 8), 16)).padStart(10, '0').slice(-10)}`;
      const adminAddMember = await request('/admin/owner-portal/core/members', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: adminMemberUsername,
          email: adminMemberEmail,
          phone: adminMemberPhone,
          password: 'Uat-Added-Member-123!',
          fullName: 'Runtime Admin Added Member',
          sponsorReference: sponsorUsername,
          placement: 'A',
          placementReference: childUsernames[0],
          epin: epins[5].pin,
        }),
      });
      expect(adminAddMember.status).toBe(201);
      const adminAddedMemberId = String(adminAddMember.body.id);
      createdUserIds.push(adminAddedMemberId);

      const adminAddedRole = await prisma.userRole.findFirstOrThrow({
        where: { userId: adminAddedMemberId },
        include: { role: true },
      });
      expect(adminAddedRole.role.name).toBe('MEMBER');
      const adminAddedProfile = await prisma.$queryRawUnsafe<Array<{ memberType: string }>>(
        'SELECT memberType FROM member_profiles WHERE userId=? LIMIT 1',
        adminAddedMemberId,
      );
      expect(adminAddedProfile[0]?.memberType).toBe('MEMBER');
      const adminAddedSponsor = await prisma.sponsorRelationship.findUniqueOrThrow({
        where: { memberUserId: adminAddedMemberId },
      });
      expect(adminAddedSponsor.sponsorUserId).toBe(sponsorUserId);
      const adminAddedPlacement = await prisma.$queryRawUnsafe<PlacementRow[]>(
        `SELECT memberUserId, parentUserId, slot, side
         FROM binary_placements WHERE memberUserId=? LIMIT 1`,
        adminAddedMemberId,
      );
      expect(adminAddedPlacement[0]).toMatchObject({
        memberUserId: adminAddedMemberId,
        parentUserId: firstChildId,
        slot: 'A',
        side: 'LEFT',
      });

      const nestedGenealogy = await request(
        `/admin/owner-portal/core/genealogy?reference=${encodeURIComponent(adminMemberUsername)}`,
        { headers: adminHeaders },
      );
      expect(nestedGenealogy.status).toBe(200);
      expect(nestedGenealogy.body.root).toMatchObject({
        id: adminAddedMemberId,
        username: adminMemberUsername,
        sponsorUserId,
        sponsorUsername,
        placementParentUserId: firstChildId,
        placementParentUsername: childUsernames[0],
        directChildCount: 0,
      });
      expect(nestedGenealogy.body.visibleMemberCount).toBe(0);
      expect(nestedGenealogy.body.members).toEqual([]);
      expect(
        (nestedGenealogy.body.roots as Array<Record<string, unknown>>).some(
          (member) => member.id === adminAddedMemberId && member.username === adminMemberUsername,
        ),
      ).toBe(true);

      const sponsorGenealogy = await request(
        `/admin/owner-portal/core/genealogy?reference=${encodeURIComponent(sponsorUsername)}`,
        { headers: adminHeaders },
      );
      expect(sponsorGenealogy.status).toBe(200);
      const nestedAdminMember = (sponsorGenealogy.body.members as Array<Record<string, unknown>>)
        .find((member) => member.id === adminAddedMemberId);
      expect(nestedAdminMember).toMatchObject({
        username: adminMemberUsername,
        sponsorUserId,
        sponsorUsername,
        parentUserId: firstChildId,
        parentUsername: childUsernames[0],
        depth: 2,
        slot: 'A',
        side: 'LEFT',
      });
      const adminAddedEpin = await prisma.$queryRawUnsafe<
        Array<{ status: string; usedByUserId: string | null }>
      >('SELECT status, usedByUserId FROM owner_epins WHERE id=? LIMIT 1', epins[5].id);
      expect(adminAddedEpin[0]).toMatchObject({
        status: 'USED',
        usedByUserId: adminAddedMemberId,
      });

      const usedInventory = await request(
        `/admin/owner-portal/epins?status=USED&memberUserId=${encodeURIComponent(adminAddedMemberId)}&seasonId=${encodeURIComponent(paidRegistration.seasonId)}&pinType=ACTIVATION&page=1&pageSize=25`,
        { headers: adminHeaders },
      );
      expect(usedInventory.status).toBe(200);
      expect(usedInventory.body.total).toBe(1);
      expect(usedInventory.body.items).toEqual([
        expect.objectContaining({ status: 'USED', assignedToUsername: adminMemberUsername }),
      ]);

      const searchQueries = [
        adminMemberUsername,
        adminAddedMemberId,
        'Runtime Admin Added',
        adminMemberPhone,
        adminMemberEmail,
      ];
      for (const query of searchQueries) {
        const memberSearch = await request(
          `/admin/owner-portal/core/members?q=${encodeURIComponent(query)}`,
          { headers: adminHeaders },
        );
        expect(memberSearch.status).toBe(200);
        expect(memberSearch.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: adminAddedMemberId,
              username: adminMemberUsername,
              email: adminMemberEmail,
              phone: adminMemberPhone,
              accountRole: 'MEMBER',
            }),
          ]),
        );
      }

      const ownerAdminConsole = await request('/admin/users', { headers: ownerHeaders });
      expect(ownerAdminConsole.status).toBe(200);
      const ownerMemberPortalDenied = await request('/member/portal-overview', {
        headers: ownerHeaders,
      });
      expect(ownerMemberPortalDenied.status).toBe(403);

      const adminConsole = await request('/admin/users', { headers: adminHeaders });
      expect(adminConsole.status).toBe(200);
      const adminMemberPortalDenied = await request('/member/portal-overview', {
        headers: adminHeaders,
      });
      expect(adminMemberPortalDenied.status).toBe(403);

      const agentConsole = await request('/admin/users', { headers: agentHeaders });
      expect(agentConsole.status).toBe(200);
      const agentMemberPortalDenied = await request('/member/portal-overview', {
        headers: agentHeaders,
      });
      expect(agentMemberPortalDenied.status).toBe(403);
      const agentStillCannotManage = await request('/admin/owner-portal/epins', {
        method: 'POST',
        headers: agentHeaders,
        body: JSON.stringify({ quantity: 1, expiresAt: expiry }),
      });
      expect(agentStillCannotManage.status).toBe(403);
      const agentCannotReadFullInventory = await request('/admin/owner-portal/epins?page=1&pageSize=25', {
        headers: agentHeaders,
      });
      expect(agentCannotReadFullInventory.status).toBe(403);
    },
    60_000,
  );
});
