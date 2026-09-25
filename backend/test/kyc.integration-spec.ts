import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaGoldenClub KYC foundation integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl = '';
  let memberId = '';
  let adminId = '';
  let memberToken = '';
  let adminToken = '';

  async function request(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }

  async function login(username: string, password: string): Promise<string> {
    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(response.status).toBe(200);
    expect(typeof response.body.accessToken).toBe('string');
    return String(response.body.accessToken);
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const memberPassword = 'Kyc-Member-123!';
    const adminPassword = 'Kyc-Admin-123!';
    const [memberHash, adminHash] = await Promise.all([
      passwords.hash(memberPassword),
      passwords.hash(adminPassword),
    ]);
    const [member, admin] = await Promise.all([
      prisma.user.create({
        data: {
          username: `kyc_member_${suffix}`,
          email: `kyc_member_${suffix}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: memberHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `kyc_admin_${suffix}`,
          email: `kyc_admin_${suffix}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: adminHash,
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    memberId = member.id;
    adminId = admin.id;

    const [memberRole, superAdminRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } }),
      prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } }),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: memberId, roleId: memberRole.id },
        { userId: adminId, roleId: superAdminRole.id },
      ],
    });

    [memberToken, adminToken] = await Promise.all([
      login(member.username, memberPassword),
      login(admin.username, adminPassword),
    ]);
  });

  afterAll(async () => {
    if (prisma) {
      if (memberId) {
        await prisma.kycSubmission.deleteMany({ where: { userId: memberId } });
        await prisma.kycProfile.deleteMany({ where: { userId: memberId } });
      }
      if (memberId || adminId) {
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              ...(memberId
                ? [{ actorUserId: memberId }, { entityId: memberId }]
                : []),
              ...(adminId
                ? [{ actorUserId: adminId }, { entityId: adminId }]
                : []),
            ],
          },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [memberId, adminId].filter(Boolean) } },
        });
      }
    }
    if (app) await app.close();
  });

  it('submits idempotently, validates requirements, and completes manual review', async () => {
    const initial = await request('/kyc/me', {}, memberToken);
    expect(initial.status).toBe(200);
    expect(initial.body.profile.status).toBe('NOT_STARTED');
    expect(initial.body.currentPolicy.policy.code).toBe('MEMBER_STANDARD');

    const sourceKey = `kyc:${randomUUID()}`;
    const incomplete = await request(
      '/kyc/me/submissions',
      {
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          data: { legalName: 'Mega Mitra Member' },
          documents: [],
        }),
      },
      memberToken,
    );
    expect(incomplete.status).toBe(400);

    const payload = {
      sourceKey,
      data: {
        legalName: 'Mega Mitra Member',
        dateOfBirth: '1990-01-01',
        address: 'Bengaluru, Karnataka',
      },
      documents: [
        { type: 'identity', reference: 'test://identity/document' },
        { type: 'address', reference: 'test://address/document' },
      ],
    };
    const submitted = await request(
      '/kyc/me/submissions',
      { method: 'POST', body: JSON.stringify(payload) },
      memberToken,
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe('SUBMITTED');
    const submissionId = String(submitted.body.id);

    const replay = await request(
      '/kyc/me/submissions',
      { method: 'POST', body: JSON.stringify(payload) },
      memberToken,
    );
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(submissionId);

    const conflict = await request(
      '/kyc/me/submissions',
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          data: { ...payload.data, address: 'Changed address' },
        }),
      },
      memberToken,
    );
    expect(conflict.status).toBe(409);

    const queue = await request(
      '/admin/kyc/submissions?status=SUBMITTED&page=1&limit=25',
      {},
      adminToken,
    );
    expect(queue.status).toBe(200);
    expect(
      (queue.body.items as Array<Record<string, unknown>>).some(
        (item) => item.id === submissionId,
      ),
    ).toBe(true);

    const started = await request(
      `/admin/kyc/submissions/${submissionId}/start-review`,
      { method: 'POST' },
      adminToken,
    );
    expect(started.status).toBe(201);
    expect(started.body.status).toBe('UNDER_REVIEW');

    const approved = await request(
      `/admin/kyc/submissions/${submissionId}/review`,
      {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'APPROVED' }),
      },
      adminToken,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');

    const final = await request('/kyc/me', {}, memberToken);
    expect(final.status).toBe(200);
    expect(final.body.profile.status).toBe('APPROVED');
    expect(final.body.profile.approvedAt).toBeTruthy();

    const blockedResubmission = await request(
      '/kyc/me/submissions',
      {
        method: 'POST',
        body: JSON.stringify({ ...payload, sourceKey: `kyc:${randomUUID()}` }),
      },
      memberToken,
    );
    expect(blockedResubmission.status).toBe(409);
  });

  it('exposes versioned KYC policy state and keeps published versions immutable', async () => {
    const policies = await request('/admin/kyc/policies', {}, adminToken);
    expect(policies.status).toBe(200);
    const defaultPolicy = (policies.body as unknown as Array<Record<string, any>>).find(
      (policy) => policy.code === 'MEMBER_STANDARD',
    );
    expect(defaultPolicy).toBeTruthy();
    expect(defaultPolicy.isDefault).toBe(true);
    const published = defaultPolicy.versions.find(
      (version: Record<string, unknown>) => version.lifecycle === 'PUBLISHED',
    );
    expect(published).toBeTruthy();

    const immutable = await request(
      `/admin/kyc/policy-versions/${published.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          requirements: {
            fields: ['legalName'],
            documents: ['identity'],
          },
        }),
      },
      adminToken,
    );
    expect(immutable.status).toBe(409);
  });
});
