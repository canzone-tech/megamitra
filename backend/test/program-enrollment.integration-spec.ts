import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { ProgramIntervalUnit, UserStatus } from '../src/generated/prisma/enums';

describe('MegaMitra program enrollment and payment integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;
  const userIds: string[] = [];
  const programIds: string[] = [];
  const versionIds: string[] = [];
  const enrollmentIds: string[] = [];
  const attemptIds: string[] = [];
  const paymentIds: string[] = [];
  const refundIds: string[] = [];

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }

  function authenticated(init: RequestInit = {}): RequestInit {
    return {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
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
    const username = `program_admin_${suffix}`;
    const password = 'Program-Integration-Pass-123!';
    const admin = await prisma.user.create({
      data: {
        username,
        passwordHash: await passwords.hash(password),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(admin.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(login.status).toBe(200);
    accessToken = String(login.body.accessToken);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: userIds } },
            {
              entityId: {
                in: [
                  ...programIds,
                  ...versionIds,
                  ...enrollmentIds,
                  ...attemptIds,
                  ...paymentIds,
                  ...refundIds,
                ],
              },
            },
          ],
        },
      });
      await prisma.programBusinessEvent.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
      await prisma.programRefundAllocation.deleteMany({ where: { refundRecordId: { in: refundIds } } });
      await prisma.programRefundRecord.deleteMany({ where: { id: { in: refundIds } } });
      await prisma.programPaymentAllocation.deleteMany({ where: { paymentRecordId: { in: paymentIds } } });
      await prisma.programPaymentRecord.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.programPaymentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
      await prisma.programInstallment.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
      await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      await prisma.programVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.program.deleteMany({ where: { id: { in: programIds } } });
      await prisma.systemSequence.deleteMany({
        where: {
          OR: [
            ...attemptIds.map((id) => ({ key: `PROGRAM_PAYMENT:${id}` })),
            ...paymentIds.map((id) => ({ key: `PROGRAM_REFUND:${id}` })),
          ],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('versions commercial terms and keeps enrollment payment/refund history reproducible', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const member = await prisma.user.create({
      data: {
        username: `program_member_${suffix}`,
        passwordHash: 'integration-not-used',
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(member.id);

    const createdProgram = await request(
      '/admin/programs',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ code: `PG${suffix}`, name: `Program ${suffix}` }),
      }),
    );
    expect(createdProgram.status).toBe(201);
    const programId = String(createdProgram.body.id);
    programIds.push(programId);

    const draft = await request(
      `/admin/programs/${programId}/versions`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          currencyCode: 'INR',
          registrationFee: '100.00',
          installmentAmount: '250.00',
          installmentCount: 2,
          installmentIntervalUnit: ProgramIntervalUnit.MONTH,
          installmentIntervalCount: 1,
          firstInstallmentOffsetDays: 0,
          gracePeriodDays: 5,
          maxActiveEnrollmentsPerUser: 1,
          partialPaymentsAllowed: false,
          overpaymentsAllowed: false,
          eligibilityRules: { allowedUserStatuses: [UserStatus.ACTIVE] },
        }),
      }),
    );
    expect(draft.status).toBe(201);
    const versionId = String(draft.body.id);
    versionIds.push(versionId);

    const published = await request(
      `/admin/programs/versions/${versionId}/publish`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(published.status).toBe(201);

    const immutable = await request(
      `/admin/programs/versions/${versionId}`,
      authenticated({ method: 'PATCH', body: JSON.stringify({ registrationFee: '999.00' }) }),
    );
    expect(immutable.status).toBe(409);

    const enrollmentSource = `ENROLL-${suffix}`;
    const enrolledAt = new Date().toISOString();
    const enrollmentPayload = {
      sourceKey: enrollmentSource,
      userId: member.id,
      programVersionId: versionId,
      enrolledAt,
      enrollmentDate: '2026-01-31',
    };
    const enrollmentResult = await request(
      '/admin/program-enrollments',
      authenticated({ method: 'POST', body: JSON.stringify(enrollmentPayload) }),
    );
    expect(enrollmentResult.status).toBe(201);
    expect(enrollmentResult.body.idempotent).toBe(false);
    const enrollmentId = String(enrollmentResult.body.enrollment.id);
    enrollmentIds.push(enrollmentId);
    expect(enrollmentResult.body.enrollment.installments).toHaveLength(2);
    expect(enrollmentResult.body.enrollment.installments[0].dueDate).toBe('2026-01-31');
    expect(enrollmentResult.body.enrollment.installments[1].dueDate).toBe('2026-02-28');

    const duplicateEnrollment = await request(
      '/admin/program-enrollments',
      authenticated({ method: 'POST', body: JSON.stringify(enrollmentPayload) }),
    );
    expect(duplicateEnrollment.status).toBe(201);
    expect(duplicateEnrollment.body.idempotent).toBe(true);

    const attempt1 = await request(
      '/admin/program-payments/attempts',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `ATTEMPT-1-${suffix}`,
          enrollmentId,
          amount: '350.00',
          currencyCode: 'INR',
          initiatedAt: new Date().toISOString(),
          provider: 'TEST',
          providerReference: `TXN-1-${suffix}`,
        }),
      }),
    );
    expect(attempt1.status).toBe(201);
    const attempt1Id = String(attempt1.body.attempt.id);
    attemptIds.push(attempt1Id);

    const confirm1Payload = {
      sourceKey: `PAYMENT-1-${suffix}`,
      occurredAt: new Date().toISOString(),
    };
    const payment1 = await request(
      `/admin/program-payments/attempts/${attempt1Id}/confirm`,
      authenticated({ method: 'POST', body: JSON.stringify(confirm1Payload) }),
    );
    expect(payment1.status).toBe(201);
    expect(payment1.body.idempotent).toBe(false);
    const payment1Id = String(payment1.body.payment.id);
    paymentIds.push(payment1Id);
    const payment1Allocations = payment1.body.payment.allocations as Array<{
      allocationType: string;
      amount: string | number;
    }>;
    expect(payment1Allocations).toHaveLength(2);
    const registrationAllocation = payment1Allocations.find(
      (allocation) => allocation.allocationType === 'REGISTRATION_FEE',
    );
    const installmentAllocation = payment1Allocations.find(
      (allocation) => allocation.allocationType === 'INSTALLMENT',
    );
    expect(registrationAllocation).toBeDefined();
    expect(installmentAllocation).toBeDefined();
    expect(String(registrationAllocation?.amount)).toBe('100');
    expect(String(installmentAllocation?.amount)).toBe('250');

    const duplicatePayment = await request(
      `/admin/program-payments/attempts/${attempt1Id}/confirm`,
      authenticated({ method: 'POST', body: JSON.stringify(confirm1Payload) }),
    );
    expect(duplicatePayment.status).toBe(201);
    expect(duplicatePayment.body.idempotent).toBe(true);

    const afterFirst = await request(
      `/admin/program-enrollments/${enrollmentId}`,
      authenticated(),
    );
    expect(afterFirst.status).toBe(200);
    expect(afterFirst.body.status).toBe('ACTIVE');
    expect(String(afterFirst.body.financials.outstanding)).toBe('250');

    const attempt2 = await request(
      '/admin/program-payments/attempts',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `ATTEMPT-2-${suffix}`,
          enrollmentId,
          amount: '250.00',
          currencyCode: 'INR',
          initiatedAt: new Date().toISOString(),
        }),
      }),
    );
    expect(attempt2.status).toBe(201);
    const attempt2Id = String(attempt2.body.attempt.id);
    attemptIds.push(attempt2Id);

    const payment2 = await request(
      `/admin/program-payments/attempts/${attempt2Id}/confirm`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `PAYMENT-2-${suffix}`,
          occurredAt: new Date().toISOString(),
        }),
      }),
    );
    expect(payment2.status).toBe(201);
    const payment2Id = String(payment2.body.payment.id);
    paymentIds.push(payment2Id);

    const completed = await request(
      `/admin/program-enrollments/${enrollmentId}`,
      authenticated(),
    );
    expect(completed.body.status).toBe('COMPLETED');
    expect(String(completed.body.financials.outstanding)).toBe('0');

    const refundPayload = {
      sourceKey: `REFUND-1-${suffix}`,
      paymentRecordId: payment2Id,
      amount: '50.00',
      currencyCode: 'INR',
      occurredAt: new Date().toISOString(),
      reason: 'Integration refund',
    };
    const refund = await request(
      '/admin/program-payments/refunds',
      authenticated({ method: 'POST', body: JSON.stringify(refundPayload) }),
    );
    expect(refund.status).toBe(201);
    expect(refund.body.idempotent).toBe(false);
    const refundId = String(refund.body.refund.id);
    refundIds.push(refundId);

    const duplicateRefund = await request(
      '/admin/program-payments/refunds',
      authenticated({ method: 'POST', body: JSON.stringify(refundPayload) }),
    );
    expect(duplicateRefund.status).toBe(201);
    expect(duplicateRefund.body.idempotent).toBe(true);

    const reopened = await request(
      `/admin/program-enrollments/${enrollmentId}`,
      authenticated(),
    );
    expect(reopened.body.status).toBe('ACTIVE');
    expect(String(reopened.body.financials.outstanding)).toBe('50');

    const events = reopened.body.businessEvents as Array<{ type: string }>;
    expect(events.some((event) => event.type === 'ENROLLMENT_CREATED')).toBe(true);
    expect(events.some((event) => event.type === 'PAYMENT_CONFIRMED')).toBe(true);
    expect(events.some((event) => event.type === 'ENROLLMENT_COMPLETED')).toBe(true);
    expect(events.some((event) => event.type === 'REFUND_CONFIRMED')).toBe(true);
    expect(events.some((event) => event.type === 'ENROLLMENT_REOPENED')).toBe(true);
  });
});
