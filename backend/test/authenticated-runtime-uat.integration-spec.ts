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
    expect(registered.status).toBe(201);
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
        body: JSON.stringify({ permissions: ['users.read', 'users.manage'] }),
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
      const adminAddedEpin = await prisma.$queryRawUnsafe<
        Array<{ status: string; usedByUserId: string | null }>
      >('SELECT status, usedByUserId FROM owner_epins WHERE id=? LIMIT 1', epins[5].id);
      expect(adminAddedEpin[0]).toMatchObject({
        status: 'USED',
        usedByUserId: adminAddedMemberId,
      });

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
    },
    60_000,
  );
});
