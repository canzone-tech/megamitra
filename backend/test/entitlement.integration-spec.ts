import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaGoldenClub product entitlement foundation integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl = '';
  let memberId = '';
  let adminId = '';
  let memberToken = '';
  let adminToken = '';
  let programId = '';
  let programVersionId = '';
  let enrollmentId = '';
  let productId = '';
  let policyId = '';

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
    const memberPassword = 'Entitlement-Member-123!';
    const adminPassword = 'Entitlement-Admin-123!';
    const [memberHash, adminHash] = await Promise.all([
      passwords.hash(memberPassword),
      passwords.hash(adminPassword),
    ]);
    const [member, admin] = await Promise.all([
      prisma.user.create({
        data: {
          username: `entitlement_member_${suffix}`,
          email: `entitlement_member_${suffix}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: memberHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `entitlement_admin_${suffix}`,
          email: `entitlement_admin_${suffix}@example.test`,
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

    programId = randomUUID();
    programVersionId = randomUUID();
    enrollmentId = randomUUID();
    const enrollmentSource = `test:entitlement:enrollment:${suffix}`;
    const enrollmentFingerprint = createHash('sha256').update(enrollmentSource).digest('hex');
    const today = new Date().toISOString().slice(0, 10);

    await prisma.$executeRawUnsafe(
      `INSERT INTO programs (id, code, name, description, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      programId,
      `ENT_TEST_${suffix}`,
      'Entitlement integration program',
      'Isolated test program for product entitlements',
      adminId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_versions (
         id, programId, version, lifecycle, effectiveFrom, effectiveTo, currencyCode,
         registrationFee, installmentAmount, installmentCount, installmentIntervalUnit,
         installmentIntervalCount, firstInstallmentOffsetDays, gracePeriodDays,
         maxActiveEnrollmentsPerUser, partialPaymentsAllowed, overpaymentsAllowed,
         eligibilityRules, createdByUserId, publishedByUserId, publishedAt, createdAt, updatedAt
       ) VALUES (
         ?, ?, 1, 'PUBLISHED', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY), NULL, 'INR',
         1000.00, 1000.00, 18, 'MONTH', 1, 0, 5, 1, FALSE, FALSE,
         JSON_OBJECT(), ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
       )`,
      programVersionId,
      programId,
      adminId,
      adminId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_enrollments (
         id, sourceKey, requestFingerprint, userId, programVersionId, enrolledAt, enrollmentDate,
         status, eligibilitySnapshot, currencyCode, registrationFeeSnapshot,
         installmentAmountSnapshot, installmentCountSnapshot, gracePeriodDaysSnapshot,
         metadata, createdByUserId, createdAt, updatedAt
       ) VALUES (
         ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, 'ACTIVE', JSON_OBJECT('eligible', TRUE), 'INR',
         1000.00, 1000.00, 18, 5, JSON_OBJECT('test', TRUE), ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
       )`,
      enrollmentId,
      enrollmentSource,
      enrollmentFingerprint,
      memberId,
      programVersionId,
      today,
      adminId,
    );

    [memberToken, adminToken] = await Promise.all([
      login(member.username, memberPassword),
      login(admin.username, adminPassword),
    ]);
  });

  afterAll(async () => {
    if (prisma) {
      if (memberId) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM product_fulfillment_attempts
           WHERE entitlementId IN (SELECT id FROM product_entitlements WHERE userId = ?)`,
          memberId,
        );
        await prisma.$executeRawUnsafe(`DELETE FROM product_entitlements WHERE userId = ?`, memberId);
        await prisma.$executeRawUnsafe(`DELETE FROM entitlement_generation_runs WHERE userId = ?`, memberId);
      }
      if (policyId) {
        await prisma.$executeRawUnsafe(`DELETE FROM entitlement_policy_versions WHERE policyId = ?`, policyId);
        await prisma.$executeRawUnsafe(`DELETE FROM entitlement_policies WHERE id = ?`, policyId);
      }
      if (productId) {
        await prisma.$executeRawUnsafe(`DELETE FROM catalog_products WHERE id = ?`, productId);
      }
      if (enrollmentId) {
        await prisma.$executeRawUnsafe(`DELETE FROM program_enrollments WHERE id = ?`, enrollmentId);
      }
      if (programVersionId) {
        await prisma.$executeRawUnsafe(`DELETE FROM program_versions WHERE id = ?`, programVersionId);
      }
      if (programId) {
        await prisma.$executeRawUnsafe(`DELETE FROM programs WHERE id = ?`, programId);
      }
      if (memberId || adminId) {
        await prisma.auditLog.deleteMany({
          where: { actorUserId: { in: [memberId, adminId].filter(Boolean) } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [memberId, adminId].filter(Boolean) } },
        });
      }
    }
    if (app) await app.close();
  });

  it('evaluates program state, grants idempotently, claims, retries fulfillment, and completes', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const productCode = `ENT_PRODUCT_${suffix}`;
    const product = await request(
      '/admin/entitlements/products',
      {
        method: 'POST',
        body: JSON.stringify({
          code: productCode,
          name: 'Entitlement integration benefit',
          kind: 'BENEFIT',
          nominalValue: 21000,
          currencyCode: 'INR',
          metadata: { test: true },
        }),
      },
      adminToken,
    );
    expect(product.status).toBe(201);
    productId = String(product.body.id);

    const policy = await request(
      '/admin/entitlements/policies',
      {
        method: 'POST',
        body: JSON.stringify({
          code: `ENT_POLICY_${suffix}`,
          name: 'Entitlement integration policy',
          programId,
          isDefault: true,
        }),
      },
      adminToken,
    );
    expect(policy.status).toBe(201);
    policyId = String(policy.body.id);

    const version = await request(
      `/admin/entitlements/policies/${policyId}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          minimumPaidInstallments: 0,
          requireEnrollmentCompleted: true,
          excludeAnyLuckyDrawWinner: false,
          claimWindowDays: 30,
          grantItems: [{ productCode, quantity: 1 }],
          rules: { test: true },
        }),
      },
      adminToken,
    );
    expect(version.status).toBe(201);
    expect(version.body.lifecycle).toBe('DRAFT');
    const versionId = String(version.body.id);

    const published = await request(
      `/admin/entitlements/policy-versions/${versionId}/publish`,
      { method: 'POST' },
      adminToken,
    );
    expect(published.status).toBe(201);
    expect(published.body.lifecycle).toBe('PUBLISHED');

    const blocked = await request(
      '/admin/entitlements/generate',
      {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `entitlement-generation:${randomUUID()}`,
          enrollmentId,
        }),
      },
      adminToken,
    );
    expect(blocked.status).toBe(201);
    expect(blocked.body.status).toBe('INELIGIBLE');
    expect(blocked.body.generatedCount).toBe(0);

    await prisma.$executeRawUnsafe(
      `UPDATE program_enrollments SET status = 'COMPLETED', updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      enrollmentId,
    );

    const sourceKey = `entitlement-generation:${randomUUID()}`;
    const generated = await request(
      '/admin/entitlements/generate',
      {
        method: 'POST',
        body: JSON.stringify({ sourceKey, enrollmentId }),
      },
      adminToken,
    );
    expect(generated.status).toBe(201);
    expect(generated.body.status).toBe('GENERATED');
    expect(generated.body.generatedCount).toBe(1);
    expect(generated.body.entitlements).toHaveLength(1);
    expect(generated.body.entitlements[0].status).toBe('GRANTED');
    const runId = String(generated.body.id);
    const entitlementId = String(generated.body.entitlements[0].id);

    const replay = await request(
      '/admin/entitlements/generate',
      {
        method: 'POST',
        body: JSON.stringify({ sourceKey, enrollmentId }),
      },
      adminToken,
    );
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(runId);
    expect(replay.body.entitlements).toHaveLength(1);

    const mine = await request('/entitlements/me', {}, memberToken);
    expect(mine.status).toBe(200);
    expect(mine.body.items.some((item: Record<string, unknown>) => item.id === entitlementId)).toBe(true);

    const claimed = await request(
      `/entitlements/me/${entitlementId}/claim`,
      { method: 'POST', body: JSON.stringify({ metadata: { deliveryPreference: 'contact-me' } }) },
      memberToken,
    );
    expect(claimed.status).toBe(201);
    expect(claimed.body.status).toBe('CLAIMED');

    const firstAttempt = await request(
      `/admin/entitlements/items/${entitlementId}/fulfillment-attempts`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `entitlement-fulfillment:${randomUUID()}`,
          provider: 'TEST_PROVIDER',
          providerReference: `test-fail-${randomUUID()}`,
        }),
      },
      adminToken,
    );
    expect(firstAttempt.status).toBe(201);
    const firstAttemptId = String(firstAttempt.body.id);

    const failed = await request(
      `/admin/entitlements/fulfillment-attempts/${firstAttemptId}/fail`,
      { method: 'PATCH', body: JSON.stringify({ reason: 'Simulated delivery failure' }) },
      adminToken,
    );
    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe('FAILED');

    const retry = await request(
      `/admin/entitlements/items/${entitlementId}/fulfillment-attempts`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `entitlement-fulfillment:${randomUUID()}`,
          provider: 'TEST_PROVIDER',
          providerReference: `test-success-${randomUUID()}`,
        }),
      },
      adminToken,
    );
    expect(retry.status).toBe(201);
    const retryId = String(retry.body.id);

    const completed = await request(
      `/admin/entitlements/fulfillment-attempts/${retryId}/complete`,
      { method: 'PATCH', body: JSON.stringify({ metadata: { delivered: true } }) },
      adminToken,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('FULFILLED');

    const finalMine = await request('/entitlements/me', {}, memberToken);
    const finalItem = (finalMine.body.items as Array<Record<string, unknown>>).find(
      (item) => item.id === entitlementId,
    );
    expect(finalItem?.status).toBe('FULFILLED');

    const immutable = await request(
      `/admin/entitlements/policy-versions/${versionId}`,
      { method: 'PATCH', body: JSON.stringify({ claimWindowDays: 60 }) },
      adminToken,
    );
    expect(immutable.status).toBe(409);
  });
});
