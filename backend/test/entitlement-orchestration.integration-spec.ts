import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  PolicyLifecycle,
  ProgramBusinessEventType,
  ProgramEnrollmentStatus,
  ProgramIntervalUnit,
  ProgramPaymentAllocationType,
  ProgramPaymentAttemptStatus,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub automatic entitlement orchestration integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl = '';
  let accessToken = '';
  let adminId = '';
  let memberId = '';
  let programId = '';
  let programVersionId = '';
  let enrollmentId = '';
  let paymentAttemptId = '';
  let paymentRecordId = '';
  let businessEventId = '';
  let orchestrationPolicyId = '';

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const password = 'Entitlement-Orchestration-Admin-123!';
    const [admin, member] = await Promise.all([
      prisma.user.create({
        data: {
          username: `ent_orch_admin_${suffix}`,
          email: `ent_orch_admin_${suffix}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: await passwords.hash(password),
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `ent_orch_member_${suffix}`,
          email: `ent_orch_member_${suffix}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    adminId = admin.id;
    memberId = member.id;

    const [superAdminRole, memberRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } }),
      prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } }),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminId, roleId: superAdminRole.id },
        { userId: memberId, roleId: memberRole.id },
      ],
    });

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: admin.username, password }),
    });
    expect(loginResponse.status).toBe(200);
    const loginBody = (await loginResponse.json()) as Record<string, unknown>;
    accessToken = String(loginBody.accessToken);
  });

  afterAll(async () => {
    if (prisma) {
      if (businessEventId) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_entitlement_generation_links WHERE businessEventId = ?`,
          businessEventId,
        );
      }
      if (enrollmentId) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM product_fulfillment_attempts
           WHERE entitlementId IN (SELECT id FROM product_entitlements WHERE enrollmentId = ?)`,
          enrollmentId,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM product_entitlements WHERE enrollmentId = ?`,
          enrollmentId,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM entitlement_generation_runs WHERE enrollmentId = ?`,
          enrollmentId,
        );
      }
      if (orchestrationPolicyId) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_entitlement_orchestration_bindings WHERE programEventPolicyVersionId = ?`,
          orchestrationPolicyId,
        );
      }
      if (businessEventId) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_event_processing_runs WHERE businessEventId = ?`,
          businessEventId,
        );
      }
      if (orchestrationPolicyId) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_event_policy_versions WHERE id = ?`,
          orchestrationPolicyId,
        );
      }
      if (businessEventId) {
        await prisma.programBusinessEvent.deleteMany({ where: { id: businessEventId } });
      }
      if (paymentRecordId) {
        await prisma.programPaymentAllocation.deleteMany({ where: { paymentRecordId } });
        await prisma.programPaymentRecord.deleteMany({ where: { id: paymentRecordId } });
      }
      if (paymentAttemptId) {
        await prisma.programPaymentAttempt.deleteMany({ where: { id: paymentAttemptId } });
      }
      if (enrollmentId) {
        await prisma.programInstallment.deleteMany({ where: { enrollmentId } });
        await prisma.programEnrollment.deleteMany({ where: { id: enrollmentId } });
      }
      if (programVersionId) {
        await prisma.programVersion.deleteMany({ where: { id: programVersionId } });
      }
      if (programId) {
        await prisma.program.deleteMany({ where: { id: programId } });
      }
      if (adminId || memberId) {
        await prisma.auditLog.deleteMany({
          where: { actorUserId: { in: [adminId, memberId].filter(Boolean) } },
        });
        await prisma.authSession.deleteMany({
          where: { userId: { in: [adminId, memberId].filter(Boolean) } },
        });
        await prisma.userRole.deleteMany({
          where: { userId: { in: [adminId, memberId].filter(Boolean) } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [adminId, memberId].filter(Boolean) } },
        });
      }
    }
    if (app) await app.close();
  });

  it('turns a completed 18-installment non-winner event into one idempotent consumer-product entitlement', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const program = await prisma.program.create({
      data: {
        code: `ENTORCH${suffix}`,
        name: `Entitlement orchestration ${suffix}`,
      },
    });
    programId = program.id;

    const programVersion = await prisma.programVersion.create({
      data: {
        programId,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 60_000),
        currencyCode: 'INR',
        registrationFee: '1000.00',
        installmentAmount: '1000.00',
        installmentCount: 18,
        installmentIntervalUnit: ProgramIntervalUnit.MONTH,
        installmentIntervalCount: 1,
        firstInstallmentOffsetDays: 0,
        gracePeriodDays: 0,
        partialPaymentsAllowed: false,
        overpaymentsAllowed: false,
        publishedAt: new Date(),
      },
    });
    programVersionId = programVersion.id;

    const today = new Date().toISOString().slice(0, 10);
    const enrollment = await prisma.programEnrollment.create({
      data: {
        sourceKey: `ENT-ORCH-ENROLL-${suffix}`,
        requestFingerprint: 'a'.repeat(64),
        userId: memberId,
        programVersionId,
        enrolledAt: new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000),
        enrollmentDate: today,
        status: ProgramEnrollmentStatus.COMPLETED,
        eligibilitySnapshot: { eligible: true, test: 'entitlement-orchestration' },
        currencyCode: 'INR',
        registrationFeeSnapshot: '1000.00',
        installmentAmountSnapshot: '1000.00',
        installmentCountSnapshot: 18,
        gracePeriodDaysSnapshot: 0,
        createdByUserId: adminId,
      },
    });
    enrollmentId = enrollment.id;

    const installments = [];
    for (let sequence = 1; sequence <= 18; sequence += 1) {
      const installment = await prisma.programInstallment.create({
        data: {
          enrollmentId,
          sequence,
          dueDate: today,
          amount: '1000.00',
        },
      });
      installments.push(installment);
    }

    const occurredAt = new Date();
    const paymentAttempt = await prisma.programPaymentAttempt.create({
      data: {
        sourceKey: `ENT-ORCH-ATTEMPT-${suffix}`,
        requestFingerprint: 'b'.repeat(64),
        enrollmentId,
        amount: '19000.00',
        currencyCode: 'INR',
        status: ProgramPaymentAttemptStatus.CONFIRMED,
        initiatedAt: occurredAt,
        finalizedAt: occurredAt,
        createdByUserId: adminId,
      },
    });
    paymentAttemptId = paymentAttempt.id;

    const payment = await prisma.programPaymentRecord.create({
      data: {
        sourceKey: `ENT-ORCH-PAYMENT-${suffix}`,
        requestFingerprint: 'c'.repeat(64),
        paymentAttemptId,
        enrollmentId,
        amount: '19000.00',
        currencyCode: 'INR',
        occurredAt,
        createdByUserId: adminId,
      },
    });
    paymentRecordId = payment.id;

    await prisma.programPaymentAllocation.create({
      data: {
        paymentRecordId,
        enrollmentId,
        allocationType: ProgramPaymentAllocationType.REGISTRATION_FEE,
        amount: '1000.00',
      },
    });
    for (const installment of installments) {
      await prisma.programPaymentAllocation.create({
        data: {
          paymentRecordId,
          enrollmentId,
          allocationType: ProgramPaymentAllocationType.INSTALLMENT,
          installmentId: installment.id,
          amount: '1000.00',
        },
      });
    }

    const event = await prisma.programBusinessEvent.create({
      data: {
        sourceKey: `ENT-ORCH-EVENT-${suffix}`,
        type: ProgramBusinessEventType.ENROLLMENT_COMPLETED,
        enrollmentId,
        paymentRecordId,
        occurredAt,
        payload: { reason: 'FULLY_PAID', test: 'automatic-entitlement' },
      },
    });
    businessEventId = event.id;

    const targetRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT v.id
       FROM entitlement_policy_versions v
       INNER JOIN entitlement_policies p ON p.id = v.policyId
       WHERE p.code = 'NON_WINNER_CONSUMER_PRODUCTS'
         AND v.lifecycle = 'PUBLISHED'
       ORDER BY v.version DESC LIMIT 1`,
    );
    const targetPolicyVersionId = targetRows[0]?.id;
    expect(targetPolicyVersionId).toBeTruthy();

    const draft = await request('/admin/program-orchestration/policies', {
      method: 'POST',
      body: JSON.stringify({
        programVersionId,
        triggerType: 'ENROLLMENT_COMPLETED',
        effectiveFrom: new Date(Date.now() - 1_000).toISOString(),
        binaryUnitsPerEvent: 0,
        referralHookEnabled: false,
        drawEligibilityHookEnabled: false,
        eligibilityRules: {},
      }),
    });
    expect(draft.status).toBe(201);
    orchestrationPolicyId = String(draft.body.id);

    const unconfigured = await request(
      `/admin/program-orchestration/policies/${orchestrationPolicyId}/entitlement-hook`,
    );
    expect(unconfigured.status).toBe(200);
    expect(unconfigured.body.configured).toBe(false);

    const configured = await request(
      `/admin/program-orchestration/policies/${orchestrationPolicyId}/entitlement-hook`,
      {
        method: 'PUT',
        body: JSON.stringify({ entitlementPolicyVersionId: targetPolicyVersionId }),
      },
    );
    expect(configured.status).toBe(200);
    expect(configured.body.configured).toBe(true);
    expect(configured.body.binding.entitlementPolicyVersionId).toBe(targetPolicyVersionId);

    const bindingReplay = await request(
      `/admin/program-orchestration/policies/${orchestrationPolicyId}/entitlement-hook`,
      {
        method: 'PUT',
        body: JSON.stringify({ entitlementPolicyVersionId: targetPolicyVersionId }),
      },
    );
    expect(bindingReplay.status).toBe(200);
    expect(bindingReplay.body.idempotent).toBe(true);

    const published = await request(
      `/admin/program-orchestration/policies/${orchestrationPolicyId}/publish`,
      { method: 'POST', body: '{}' },
    );
    expect(published.status).toBe(201);

    const immutable = await request(
      `/admin/program-orchestration/policies/${orchestrationPolicyId}/entitlement-hook`,
      {
        method: 'PUT',
        body: JSON.stringify({ entitlementPolicyVersionId: targetPolicyVersionId }),
      },
    );
    expect(immutable.status).toBe(409);

    const processed = await request(
      `/admin/program-orchestration/events/${businessEventId}/process`,
      { method: 'POST', body: '{}' },
    );
    expect(processed.status).toBe(201);
    expect(processed.body.run.status).toBe('PROCESSED');
    expect(processed.body.run.entitlementLinks).toHaveLength(1);
    expect(processed.body.run.entitlementLinks[0].status).toBe('GENERATED');
    expect(Number(processed.body.run.entitlementLinks[0].generatedCount)).toBe(1);
    expect(processed.body.run.entitlementLinks[0].entitlementPolicyVersionId).toBe(
      targetPolicyVersionId,
    );

    const expectedSourceKey = `PROGRAM_EVENT:${businessEventId}:ENTITLEMENT`;
    expect(processed.body.run.entitlementLinks[0].sourceKey).toBe(expectedSourceKey);

    const entitlementRows = await prisma.$queryRawUnsafe<
      Array<{ id: string; status: string; productCode: string }>
    >(
      `SELECT pe.id, pe.status, cp.code AS productCode
       FROM product_entitlements pe
       INNER JOIN catalog_products cp ON cp.id = pe.productId
       WHERE pe.enrollmentId = ?`,
      enrollmentId,
    );
    expect(entitlementRows).toHaveLength(1);
    expect(entitlementRows[0].status).toBe('GRANTED');
    expect(entitlementRows[0].productCode).toBe('CONSUMER_PRODUCT_BENEFIT');

    const replay = await request(
      `/admin/program-orchestration/events/${businessEventId}/process`,
      { method: 'POST', body: '{}' },
    );
    expect(replay.status).toBe(201);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.run.entitlementLinks).toHaveLength(1);
    expect(replay.body.run.entitlementLinks[0].sourceKey).toBe(expectedSourceKey);

    const generationRows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS count FROM entitlement_generation_runs WHERE sourceKey = ?`,
      expectedSourceKey,
    );
    expect(Number(generationRows[0]?.count ?? 0)).toBe(1);
  });
});
