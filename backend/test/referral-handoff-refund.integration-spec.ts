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
  ReferralRewardMode,
  ReferralRoundingMode,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaMitra referral handoff and refund reconciliation integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;

  const userIds: string[] = [];
  const programIds: string[] = [];
  const programVersionIds: string[] = [];
  const enrollmentIds: string[] = [];
  const attemptIds: string[] = [];
  const paymentIds: string[] = [];
  const refundIds: string[] = [];
  const businessEventIds: string[] = [];
  const referralPolicyIds: string[] = [];
  const referralVersionIds: string[] = [];
  const hookIds: string[] = [];
  const runIds: string[] = [];
  const rewardEventIds: string[] = [];
  const ledgerTransactionIds: string[] = [];

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
    const username = `refund_referral_admin_${suffix}`;
    const password = 'Referral-Refund-Integration-Pass-123!';
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
      if (refundIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_referral_refund_evaluations WHERE refundRecordId IN (${refundIds.map(() => '?').join(',')})`,
          ...refundIds,
        );
      }
      if (hookIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_referral_reward_hooks WHERE id IN (${hookIds.map(() => '?').join(',')})`,
          ...hookIds,
        );
      }
      if (runIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_event_processing_runs WHERE id IN (${runIds.map(() => '?').join(',')})`,
          ...runIds,
        );
      }

      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
      await prisma.referralRewardEvent.deleteMany({ where: { id: { in: rewardEventIds } } });
      await prisma.ledgerEntry.deleteMany({
        where: { transactionId: { in: ledgerTransactionIds } },
      });
      await prisma.ledgerTransaction.deleteMany({
        where: { id: { in: ledgerTransactionIds } },
      });
      await prisma.ledgerAccount.deleteMany({ where: { ownerUserId: { in: userIds } } });

      await prisma.programBusinessEvent.deleteMany({ where: { id: { in: businessEventIds } } });
      await prisma.programRefundAllocation.deleteMany({
        where: { refundRecordId: { in: refundIds } },
      });
      await prisma.programRefundRecord.deleteMany({ where: { id: { in: refundIds } } });
      await prisma.programPaymentAllocation.deleteMany({
        where: { paymentRecordId: { in: paymentIds } },
      });
      await prisma.programPaymentRecord.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.programPaymentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
      await prisma.programInstallment.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
      await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      await prisma.programVersion.deleteMany({ where: { id: { in: programVersionIds } } });
      await prisma.program.deleteMany({ where: { id: { in: programIds } } });

      if (referralVersionIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM referral_reward_refund_rules WHERE referralPolicyVersionId IN (${referralVersionIds.map(() => '?').join(',')})`,
          ...referralVersionIds,
        );
      }
      await prisma.referralRewardPolicyVersion.deleteMany({
        where: { id: { in: referralVersionIds } },
      });
      await prisma.referralRewardPolicy.deleteMany({ where: { id: { in: referralPolicyIds } } });
      await prisma.sponsorRelationship.deleteMany({
        where: {
          OR: [{ memberUserId: { in: userIds } }, { sponsorUserId: { in: userIds } }],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('consumes a READY hook once and reverses referral money pro-rata through immutable ledger transactions', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const [sponsor, member] = await Promise.all([
      prisma.user.create({
        data: {
          username: `refund_sponsor_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `refund_member_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    userIds.push(sponsor.id, member.id);
    await prisma.sponsorRelationship.create({
      data: { memberUserId: member.id, sponsorUserId: sponsor.id },
    });

    const referralPolicy = await prisma.referralRewardPolicy.create({
      data: { code: `RRH${suffix}`, name: `Refund-safe referral ${suffix}` },
    });
    referralPolicyIds.push(referralPolicy.id);
    const referralVersion = await prisma.referralRewardPolicyVersion.create({
      data: {
        policyId: referralPolicy.id,
        version: 1,
        lifecycle: PolicyLifecycle.DRAFT,
        effectiveFrom: new Date(Date.now() - 60_000),
        rewardMode: ReferralRewardMode.PERCENTAGE,
        percentageRate: '10.0000',
        currencyCode: 'INR',
        roundingMode: ReferralRoundingMode.HALF_UP,
      },
    });
    referralVersionIds.push(referralVersion.id);

    const refundRule = await request(
      `/admin/referral-reward-policies/versions/${referralVersion.id}/refund-rule`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ mode: 'PRO_RATA' }),
      }),
    );
    expect(refundRule.status).toBe(201);
    expect(refundRule.body.mode).toBe('PRO_RATA');
    await prisma.referralRewardPolicyVersion.update({
      where: { id: referralVersion.id },
      data: {
        lifecycle: PolicyLifecycle.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    const immutableRefundRule = await request(
      `/admin/referral-reward-policies/versions/${referralVersion.id}/refund-rule`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ mode: 'FULL_BASIS_REVERSAL' }),
      }),
    );
    expect(immutableRefundRule.status).toBe(409);

    const program = await prisma.program.create({
      data: { code: `RPG${suffix}`, name: `Refund referral program ${suffix}` },
    });
    programIds.push(program.id);
    const programVersion = await prisma.programVersion.create({
      data: {
        programId: program.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 60_000),
        currencyCode: 'INR',
        registrationFee: '0.00',
        installmentAmount: '100.00',
        installmentCount: 1,
        installmentIntervalUnit: ProgramIntervalUnit.MONTH,
        installmentIntervalCount: 1,
        firstInstallmentOffsetDays: 0,
        gracePeriodDays: 0,
        partialPaymentsAllowed: true,
        overpaymentsAllowed: false,
        publishedAt: new Date(),
      },
    });
    programVersionIds.push(programVersion.id);
    const enrolledAt = new Date();
    const enrollment = await prisma.programEnrollment.create({
      data: {
        sourceKey: `REFUND-ENROLL-${suffix}`,
        requestFingerprint: 'e'.repeat(64),
        userId: member.id,
        programVersionId: programVersion.id,
        enrolledAt,
        enrollmentDate: '2026-09-23',
        status: ProgramEnrollmentStatus.ACTIVE,
        eligibilitySnapshot: { eligible: true },
        currencyCode: 'INR',
        registrationFeeSnapshot: '0.00',
        installmentAmountSnapshot: '100.00',
        installmentCountSnapshot: 1,
        gracePeriodDaysSnapshot: 0,
      },
    });
    enrollmentIds.push(enrollment.id);
    const installment = await prisma.programInstallment.create({
      data: {
        enrollmentId: enrollment.id,
        sequence: 1,
        dueDate: '2026-09-23',
        amount: '100.00',
      },
    });

    const attempt = await prisma.programPaymentAttempt.create({
      data: {
        sourceKey: `REFUND-ATTEMPT-${suffix}`,
        requestFingerprint: 'a'.repeat(64),
        enrollmentId: enrollment.id,
        amount: '100.00',
        currencyCode: 'INR',
        status: ProgramPaymentAttemptStatus.CONFIRMED,
        initiatedAt: enrolledAt,
        finalizedAt: enrolledAt,
      },
    });
    attemptIds.push(attempt.id);
    const payment = await prisma.programPaymentRecord.create({
      data: {
        sourceKey: `REFUND-PAYMENT-${suffix}`,
        requestFingerprint: 'p'.repeat(64),
        paymentAttemptId: attempt.id,
        enrollmentId: enrollment.id,
        amount: '100.00',
        currencyCode: 'INR',
        occurredAt: enrolledAt,
      },
    });
    paymentIds.push(payment.id);
    await prisma.programPaymentAllocation.create({
      data: {
        paymentRecordId: payment.id,
        enrollmentId: enrollment.id,
        allocationType: ProgramPaymentAllocationType.INSTALLMENT,
        installmentId: installment.id,
        amount: '100.00',
      },
    });
    const paymentEvent = await prisma.programBusinessEvent.create({
      data: {
        sourceKey: `REFUND-PAYMENT-EVENT-${suffix}`,
        type: ProgramBusinessEventType.PAYMENT_CONFIRMED,
        enrollmentId: enrollment.id,
        paymentRecordId: payment.id,
        occurredAt: enrolledAt,
        payload: { amount: '100.00', currencyCode: 'INR' },
      },
    });
    businessEventIds.push(paymentEvent.id);

    const runId = randomUUID();
    runIds.push(runId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_event_processing_runs
         (id, businessEventId, policyVersionId, status, eligible, eligibilitySnapshot,
          attempts, errorMessage, startedAt, completedAt, createdAt, updatedAt)
       VALUES (?, ?, NULL, 'PROCESSED', TRUE, ?, 1, NULL, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      runId,
      paymentEvent.id,
      JSON.stringify({ eligible: true }),
      enrolledAt,
      enrolledAt,
    );

    const hookId = randomUUID();
    hookIds.push(hookId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_referral_reward_hooks
         (id, sourceKey, runId, businessEventId, referredUserId, sponsorUserId,
          referralPolicyVersionId, basisAmount, currencyCode, status, eligibilitySnapshot,
          consumedRewardEventId, occurredAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, '100.00', 'INR', 'READY', ?, NULL, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      hookId,
      `PROGRAM_EVENT:${paymentEvent.id}:REFERRAL`,
      runId,
      paymentEvent.id,
      member.id,
      sponsor.id,
      referralVersion.id,
      JSON.stringify({ basisMode: 'PAYMENT_AMOUNT', basisAmount: '100.00' }),
      enrolledAt,
    );

    const consumed = await request(
      `/admin/program-orchestration/referral-hooks/${hookId}/consume`,
      authenticated({ method: 'POST' }),
    );
    expect(consumed.status).toBe(201);
    expect(consumed.body.hook.status).toBe('CONSUMED');
    expect(consumed.body.event.status).toBe('POSTED');
    expect(Number(consumed.body.event.rewardAmount)).toBe(10);
    const rewardEventId = String(consumed.body.event.id);
    const originalLedgerTransactionId = String(consumed.body.event.ledgerTransactionId);
    rewardEventIds.push(rewardEventId);
    ledgerTransactionIds.push(originalLedgerTransactionId);

    const duplicateConsume = await request(
      `/admin/program-orchestration/referral-hooks/${hookId}/consume`,
      authenticated({ method: 'POST' }),
    );
    expect(duplicateConsume.status).toBe(201);
    expect(duplicateConsume.body.idempotent).toBe(true);
    expect(duplicateConsume.body.event.id).toBe(rewardEventId);

    const walletBeforeRefund = await request(
      `/admin/ledger/wallets/users/${sponsor.id}/INR`,
      authenticated(),
    );
    expect(walletBeforeRefund.status).toBe(200);
    expect(Number(walletBeforeRefund.body.balance)).toBe(10);

    const createRefundAndReconcile = async (label: string, amount: string, offsetMs: number) => {
      const refundResponse = await request(
        '/admin/program-payments/refunds',
        authenticated({
          method: 'POST',
          body: JSON.stringify({
            sourceKey: `REFUND-${label}-${suffix}`,
            paymentRecordId: payment.id,
            amount,
            currencyCode: 'INR',
            occurredAt: new Date(enrolledAt.getTime() + offsetMs).toISOString(),
            reason: `integration ${label}`,
          }),
        }),
      );
      expect(refundResponse.status).toBe(201);
      const refundId = String(refundResponse.body.refund.id);
      refundIds.push(refundId);
      const refundEvent = await prisma.programBusinessEvent.findFirstOrThrow({
        where: {
          refundRecordId: refundId,
          type: ProgramBusinessEventType.REFUND_CONFIRMED,
        },
      });
      businessEventIds.push(refundEvent.id);
      const reconciled = await request(
        `/admin/program-orchestration/refund-events/${refundEvent.id}/reconcile-referral`,
        authenticated({ method: 'POST' }),
      );
      expect(reconciled.status).toBe(201);
      expect(reconciled.body.evaluation.status).toBe('POSTED');
      ledgerTransactionIds.push(String(reconciled.body.evaluation.ledgerTransactionId));
      return { refundId, refundEvent, reconciled };
    };

    const first = await createRefundAndReconcile('PARTIAL', '40.00', 10_000);
    expect(Number(first.reconciled.body.evaluation.refundedBasisAmount)).toBe(40);
    expect(Number(first.reconciled.body.evaluation.reversalAmount)).toBe(4);
    expect(first.reconciled.body.evaluation.reasonCode).toBe('PRO_RATA_BASIS_REFUND');

    const duplicateRefundEvaluation = await request(
      `/admin/program-orchestration/refund-events/${first.refundEvent.id}/reconcile-referral`,
      authenticated({ method: 'POST' }),
    );
    expect(duplicateRefundEvaluation.status).toBe(201);
    expect(duplicateRefundEvaluation.body.idempotent).toBe(true);

    const walletAfterPartial = await request(
      `/admin/ledger/wallets/users/${sponsor.id}/INR`,
      authenticated(),
    );
    expect(Number(walletAfterPartial.body.balance)).toBe(6);

    const second = await createRefundAndReconcile('FINAL', '60.00', 20_000);
    expect(Number(second.reconciled.body.evaluation.refundedBasisAmount)).toBe(60);
    expect(Number(second.reconciled.body.evaluation.cumulativeRefundedBasis)).toBe(100);
    expect(Number(second.reconciled.body.evaluation.reversalAmount)).toBe(6);

    const walletAfterFullRefund = await request(
      `/admin/ledger/wallets/users/${sponsor.id}/INR`,
      authenticated(),
    );
    expect(Number(walletAfterFullRefund.body.balance)).toBe(0);

    const originalReward = await prisma.referralRewardEvent.findUniqueOrThrow({
      where: { id: rewardEventId },
    });
    expect(originalReward.status).toBe(ReferralRewardEventStatus.POSTED);
    expect(Number(originalReward.rewardAmount)).toBe(10);
    expect(originalReward.ledgerTransactionId).toBe(originalLedgerTransactionId);

    const evaluations = await prisma.$queryRawUnsafe<
      Array<{ status: string; reversalAmount: string | number }>
    >(
      `SELECT status, reversalAmount
       FROM program_referral_refund_evaluations
       WHERE rewardEventId = ? ORDER BY occurredAt ASC`,
      rewardEventId,
    );
    expect(evaluations).toHaveLength(2);
    expect(evaluations.every((row) => row.status === 'POSTED')).toBe(true);
    expect(evaluations.reduce((sum, row) => sum + Number(row.reversalAmount), 0)).toBe(10);

    for (const transactionId of ledgerTransactionIds) {
      const ledger = await request(
        `/admin/ledger/transactions/${transactionId}`,
        authenticated(),
      );
      expect(ledger.status).toBe(200);
      expect(ledger.body.balanced).toBe(true);
    }
  });
});
