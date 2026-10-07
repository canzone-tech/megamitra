import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  BinaryPlacementSide,
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

async function deleteProgramEventQualifyingArtifacts(
  prisma: PrismaService,
  qualifyingEventIds: string[],
) {
  if (qualifyingEventIds.length === 0) return;

  // A stale local verify may have already auto-settled these units. Pair matches and
  // dispositions use RESTRICT FKs to qualifying units, so remove the settlement
  // graph first instead of assuming PROGRAM_EVENT units are always unmatched.
  const units = await prisma.binaryUplineQualifyingUnit.findMany({
    where: { unitEventId: { in: qualifyingEventIds } },
    select: { id: true },
  });
  const unitIds = units.map((row) => row.id);

  if (unitIds.length > 0) {
    const [matches, dispositions] = await Promise.all([
      prisma.binaryPairMatch.findMany({
        where: {
          OR: [
            { leftUnitId: { in: unitIds } },
            { rightUnitId: { in: unitIds } },
          ],
        },
        select: { settlementId: true },
      }),
      prisma.binaryUnitDisposition.findMany({
        where: { uplineUnitId: { in: unitIds } },
        select: { settlementId: true },
      }),
    ]);
    const settlementIds = [
      ...new Set([
        ...matches.map((row) => row.settlementId),
        ...dispositions.map((row) => row.settlementId),
      ]),
    ];

    if (settlementIds.length > 0) {
      const settlements = await prisma.binaryPairSettlement.findMany({
        where: { id: { in: settlementIds } },
        select: { ledgerTransactionId: true },
      });
      const ledgerTransactionIds = settlements
        .map((row) => row.ledgerTransactionId)
        .filter((id): id is string => Boolean(id));

      await prisma.binaryPairMatch.deleteMany({
        where: { settlementId: { in: settlementIds } },
      });
      await prisma.binaryUnitDisposition.deleteMany({
        where: { settlementId: { in: settlementIds } },
      });
      if (ledgerTransactionIds.length > 0) {
        await prisma.ledgerEntry.deleteMany({
          where: { transactionId: { in: ledgerTransactionIds } },
        });
      }
      await prisma.binaryPairSettlement.deleteMany({
        where: { id: { in: settlementIds } },
      });
      if (ledgerTransactionIds.length > 0) {
        await prisma.ledgerTransaction.deleteMany({
          where: { id: { in: ledgerTransactionIds } },
        });
      }
    }
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM program_binary_qualification_links
     WHERE qualifyingUnitEventId IN (${qualifyingEventIds.map(() => '?').join(',')})`,
    ...qualifyingEventIds,
  );
  await prisma.binaryUplineQualifyingUnit.deleteMany({
    where: { unitEventId: { in: qualifyingEventIds } },
  });
  await prisma.binaryQualifyingUnitEvent.deleteMany({
    where: { id: { in: qualifyingEventIds }, reversalOfEventId: { not: null } },
  });
  await prisma.binaryQualifyingUnitEvent.deleteMany({
    where: { id: { in: qualifyingEventIds } },
  });
}

describe('MegaGoldenClub program event orchestration integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;
  const userIds: string[] = [];
  const eventIds: string[] = [];
  const cleanupQualifyingEventIds: string[] = [];
  let externalSentinelQualifyingEventId: string | null = null;
  const paymentIds: string[] = [];
  const attemptIds: string[] = [];
  const enrollmentIds: string[] = [];
  const programVersionIds: string[] = [];
  const programIds: string[] = [];
  const binaryPlanVersionIds: string[] = [];
  const binaryPlanIds: string[] = [];
  const referralVersionIds: string[] = [];
  const referralPolicyIds: string[] = [];
  const policyIds: string[] = [];

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
    const username = `orchestration_admin_${suffix}`;
    const password = 'Orchestration-Integration-Pass-123!';
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
      const linkedQualifyingEvents =
        eventIds.length > 0
          ? await prisma.$queryRawUnsafe<Array<{ qualifyingUnitEventId: string }>>(
              `SELECT qualifyingUnitEventId
               FROM program_binary_qualification_links
               WHERE businessEventId IN (${eventIds.map(() => '?').join(',')})`,
              ...eventIds,
            )
          : [];
      const qualifyingEventIds = [
        ...new Set([
          ...linkedQualifyingEvents.map((row) => row.qualifyingUnitEventId),
          ...cleanupQualifyingEventIds,
        ]),
      ];
      await deleteProgramEventQualifyingArtifacts(prisma, qualifyingEventIds);

      if (externalSentinelQualifyingEventId) {
        const preservedSentinel = await prisma.binaryQualifyingUnitEvent.findUnique({
          where: { id: externalSentinelQualifyingEventId },
          select: { id: true },
        });
        expect(preservedSentinel?.id).toBe(externalSentinelQualifyingEventId);
        await prisma.binaryQualifyingUnitEvent.delete({
          where: { id: externalSentinelQualifyingEventId },
        });
        externalSentinelQualifyingEventId = null;
      }

      const referralRewardEvents =
        referralVersionIds.length > 0
          ? await prisma.referralRewardEvent.findMany({
              where: { policyVersionId: { in: referralVersionIds } },
              select: { id: true, ledgerTransactionId: true },
            })
          : [];
      const referralLedgerTransactionIds = referralRewardEvents
        .map((row) => row.ledgerTransactionId)
        .filter((id): id is string => Boolean(id));
      if (referralLedgerTransactionIds.length > 0) {
        await prisma.ledgerEntry.deleteMany({
          where: { transactionId: { in: referralLedgerTransactionIds } },
        });
      }
      if (referralRewardEvents.length > 0) {
        await prisma.referralRewardEvent.deleteMany({
          where: { id: { in: referralRewardEvents.map((row) => row.id) } },
        });
      }
      if (referralLedgerTransactionIds.length > 0) {
        await prisma.ledgerTransaction.deleteMany({
          where: { id: { in: referralLedgerTransactionIds } },
        });
      }

      await prisma.$executeRawUnsafe(
        `DELETE FROM program_draw_eligibility_hooks WHERE businessEventId IN (${eventIds.map(() => '?').join(',') || "''"})`,
        ...eventIds,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM program_referral_reward_hooks WHERE businessEventId IN (${eventIds.map(() => '?').join(',') || "''"})`,
        ...eventIds,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM program_binary_qualification_links WHERE businessEventId IN (${eventIds.map(() => '?').join(',') || "''"})`,
        ...eventIds,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM program_event_processing_runs WHERE businessEventId IN (${eventIds.map(() => '?').join(',') || "''"})`,
        ...eventIds,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM program_event_policy_versions WHERE id IN (${policyIds.map(() => '?').join(',') || "''"})`,
        ...policyIds,
      );

      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: userIds } },
            { entityId: { in: [...policyIds, ...userIds] } },
          ],
        },
      });
      await prisma.programBusinessEvent.deleteMany({ where: { id: { in: eventIds } } });
      await prisma.programPaymentAllocation.deleteMany({ where: { paymentRecordId: { in: paymentIds } } });
      await prisma.programPaymentRecord.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.programPaymentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
      await prisma.programInstallment.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
      await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      await prisma.programVersion.deleteMany({ where: { id: { in: programVersionIds } } });
      await prisma.program.deleteMany({ where: { id: { in: programIds } } });
      await prisma.binaryAncestry.deleteMany({
        where: {
          OR: [
            { ancestorUserId: { in: userIds } },
            { descendantUserId: { in: userIds } },
          ],
        },
      });
      await prisma.binaryPlacement.deleteMany({ where: { memberUserId: { in: userIds } } });
      await prisma.sponsorRelationship.deleteMany({ where: { memberUserId: { in: userIds } } });
      await prisma.binaryPlanVersion.deleteMany({ where: { id: { in: binaryPlanVersionIds } } });
      await prisma.binaryPlan.deleteMany({ where: { id: { in: binaryPlanIds } } });
      await prisma.referralRewardPolicyVersion.deleteMany({ where: { id: { in: referralVersionIds } } });
      await prisma.referralRewardPolicy.deleteMany({ where: { id: { in: referralPolicyIds } } });
      const binarySequenceKeys = userIds.flatMap((userId) =>
        binaryPlanVersionIds.flatMap((planVersionId) =>
          ['A', 'B', 'C', 'D'].map(
            (slot) => `BU:${userId}:${planVersionId}:${slot}`,
          ),
        ),
      );
      if (binarySequenceKeys.length > 0) {
        await prisma.systemSequence.deleteMany({
          where: { key: { in: binarySequenceKeys } },
        });
      }
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('turns immutable payment events into idempotent binary, referral and draw eligibility outputs', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const [ancestor, member] = await Promise.all([
      prisma.user.create({
        data: {
          username: `orch_ancestor_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `orch_member_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    userIds.push(ancestor.id, member.id);
    await prisma.sponsorRelationship.create({
      data: { memberUserId: member.id, sponsorUserId: ancestor.id },
    });
    await prisma.binaryPlacement.create({
      data: {
        memberUserId: member.id,
        parentUserId: ancestor.id,
        side: BinaryPlacementSide.LEFT,
        slot: 'A',
      },
    });
    await prisma.binaryAncestry.create({
      data: {
        ancestorUserId: ancestor.id,
        descendantUserId: member.id,
        depth: 1,
        firstLegSide: BinaryPlacementSide.LEFT,
        firstLegSlot: 'A',
      },
    });

    const binaryPlan = await prisma.binaryPlan.create({
      data: { code: `OBP${suffix}`, name: `Orchestration binary ${suffix}` },
    });
    binaryPlanIds.push(binaryPlan.id);
    const binaryVersion = await prisma.binaryPlanVersion.create({
      data: {
        planId: binaryPlan.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 60_000),
        qualifyingUnit: '1.0000',
        leftVolumePerPair: '1.0000',
        rightVolumePerPair: '1.0000',
        pairPayoutAmount: '10.00',
        currencyCode: 'INR',
        settlementTimezone: 'UTC',
        carryForwardEnabled: true,
        publishedAt: new Date(),
      },
    });
    binaryPlanVersionIds.push(binaryVersion.id);

    const referralPolicy = await prisma.referralRewardPolicy.create({
      data: { code: `ORP${suffix}`, name: `Orchestration referral ${suffix}` },
    });
    referralPolicyIds.push(referralPolicy.id);
    const referralVersion = await prisma.referralRewardPolicyVersion.create({
      data: {
        policyId: referralPolicy.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 60_000),
        rewardMode: ReferralRewardMode.PERCENTAGE,
        percentageRate: '5.0000',
        currencyCode: 'INR',
        roundingMode: ReferralRoundingMode.HALF_UP,
        publishedAt: new Date(),
      },
    });
    referralVersionIds.push(referralVersion.id);

    const program = await prisma.program.create({
      data: { code: `OPG${suffix}`, name: `Orchestration program ${suffix}` },
    });
    programIds.push(program.id);
    const programVersion = await prisma.programVersion.create({
      data: {
        programId: program.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 60_000),
        currencyCode: 'INR',
        registrationFee: '100.00',
        installmentAmount: '250.00',
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

    const enrollment = await prisma.programEnrollment.create({
      data: {
        sourceKey: `ORCH-ENROLL-${suffix}`,
        requestFingerprint: 'a'.repeat(64),
        userId: member.id,
        programVersionId: programVersion.id,
        enrolledAt: new Date(),
        enrollmentDate: '2026-09-23',
        status: ProgramEnrollmentStatus.ACTIVE,
        eligibilitySnapshot: { eligible: true },
        currencyCode: 'INR',
        registrationFeeSnapshot: '100.00',
        installmentAmountSnapshot: '250.00',
        installmentCountSnapshot: 1,
        gracePeriodDaysSnapshot: 0,
      },
    });
    enrollmentIds.push(enrollment.id);
    const installment = await prisma.programInstallment.create({
      data: { enrollmentId: enrollment.id, sequence: 1, dueDate: '2026-09-23', amount: '250.00' },
    });

    const createPaymentEvent = async (label: string, amount: string, registration: string, installmentAmount: string) => {
      const attempt = await prisma.programPaymentAttempt.create({
        data: {
          sourceKey: `ORCH-ATTEMPT-${label}-${suffix}`,
          requestFingerprint: label.padEnd(64, label).slice(0, 64),
          enrollmentId: enrollment.id,
          amount,
          currencyCode: 'INR',
          status: ProgramPaymentAttemptStatus.CONFIRMED,
          initiatedAt: new Date(),
          finalizedAt: new Date(),
        },
      });
      attemptIds.push(attempt.id);
      const payment = await prisma.programPaymentRecord.create({
        data: {
          sourceKey: `ORCH-PAYMENT-${label}-${suffix}`,
          requestFingerprint: `${label}p`.padEnd(64, label).slice(0, 64),
          paymentAttemptId: attempt.id,
          enrollmentId: enrollment.id,
          amount,
          currencyCode: 'INR',
          occurredAt: new Date(),
        },
      });
      paymentIds.push(payment.id);
      if (Number(registration) > 0) {
        await prisma.programPaymentAllocation.create({
          data: {
            paymentRecordId: payment.id,
            enrollmentId: enrollment.id,
            allocationType: ProgramPaymentAllocationType.REGISTRATION_FEE,
            amount: registration,
          },
        });
      }
      if (Number(installmentAmount) > 0) {
        await prisma.programPaymentAllocation.create({
          data: {
            paymentRecordId: payment.id,
            enrollmentId: enrollment.id,
            allocationType: ProgramPaymentAllocationType.INSTALLMENT,
            installmentId: installment.id,
            amount: installmentAmount,
          },
        });
      }
      const event = await prisma.programBusinessEvent.create({
        data: {
          sourceKey: `ORCH-EVENT-${label}-${suffix}`,
          type: ProgramBusinessEventType.PAYMENT_CONFIRMED,
          enrollmentId: enrollment.id,
          paymentRecordId: payment.id,
          occurredAt: payment.occurredAt,
          payload: { amount, currencyCode: 'INR' },
        },
      });
      eventIds.push(event.id);
      return event;
    };

    const eligibleEvent = await createPaymentEvent('ELIGIBLE', '350.00', '100.00', '250.00');
    const ineligibleEvent = await createPaymentEvent('LOW', '50.00', '50.00', '0.00');

    const draft = await request(
      '/admin/program-orchestration/policies',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          programVersionId: programVersion.id,
          triggerType: 'PAYMENT_CONFIRMED',
          effectiveFrom: new Date(Date.now() - 120_000).toISOString(),
          binaryPlanVersionId: binaryVersion.id,
          binaryUnitsPerEvent: 1,
          referralHookEnabled: true,
          referralPolicyVersionId: referralVersion.id,
          referralBasisMode: 'TOTAL_APPLIED_AMOUNT',
          drawEligibilityHookEnabled: true,
          eligibilityRules: {
            minimumPaymentAmount: '300.00',
            requiredAllocationTypes: ['REGISTRATION_FEE', 'INSTALLMENT'],
          },
        }),
      }),
    );
    expect(draft.status).toBe(201);
    const policyId = String(draft.body.id);
    policyIds.push(policyId);

    const published = await request(
      `/admin/program-orchestration/policies/${policyId}/publish`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(published.status).toBe(201);

    const processed = await request(
      `/admin/program-orchestration/events/${eligibleEvent.id}/process`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(processed.status).toBe(201);
    expect(processed.body.run.status).toBe('PROCESSED');
    expect(processed.body.run.eligible).toBeTruthy();
    expect(processed.body.run.binaryLinks).toHaveLength(1);
    expect(processed.body.run.referralHooks).toHaveLength(1);
    expect(processed.body.run.referralHooks[0].status).toBe('READY');
    expect(Number(processed.body.run.referralHooks[0].basisAmount)).toBe(350);
    expect(processed.body.run.drawHooks).toHaveLength(1);
    expect(processed.body.run.drawHooks[0].status).toBe('ELIGIBLE');

    const unitEventId = String(processed.body.run.binaryLinks[0].qualifyingUnitEventId);
    const unitEvent = await prisma.binaryQualifyingUnitEvent.findUniqueOrThrow({
      where: { id: unitEventId },
      include: { uplineUnits: true },
    });
    expect(unitEvent.sourceMemberUserId).toBe(member.id);
    expect(unitEvent.planVersionId).toBe(binaryVersion.id);
    expect(unitEvent.uplineUnits).toHaveLength(1);
    expect(unitEvent.uplineUnits[0].ancestorUserId).toBe(ancestor.id);
    expect(unitEvent.uplineUnits[0].side).toBe(BinaryPlacementSide.LEFT);

    const duplicate = await request(
      `/admin/program-orchestration/events/${eligibleEvent.id}/process`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.idempotent).toBe(true);
    expect(duplicate.body.run.binaryLinks).toHaveLength(1);

    const skipped = await request(
      `/admin/program-orchestration/events/${ineligibleEvent.id}/process`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(skipped.status).toBe(201);
    expect(skipped.body.run.status).toBe('SKIPPED');
    expect(skipped.body.run.eligible).toBeFalsy();
    expect(skipped.body.run.binaryLinks).toHaveLength(0);
    expect(skipped.body.run.referralHooks).toHaveLength(1);
    expect(skipped.body.run.referralHooks[0].status).toBe('INELIGIBLE');
    expect(skipped.body.run.drawHooks).toHaveLength(1);
    expect(skipped.body.run.drawHooks[0].status).toBe('INELIGIBLE');

    // Regression fixture for persistent local databases: simulate a PROGRAM_EVENT
    // qualifying unit that was already consumed by a pair settlement. afterAll must
    // remove pair/disposition dependencies before deleting the qualifying unit.
    const cleanupSibling = await prisma.user.create({
      data: {
        username: `orch_cleanup_sibling_${suffix}`,
        passwordHash: 'integration-not-used',
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(cleanupSibling.id);
    await prisma.binaryPlacement.create({
      data: {
        memberUserId: cleanupSibling.id,
        parentUserId: ancestor.id,
        side: BinaryPlacementSide.RIGHT,
        slot: 'C',
      },
    });
    await prisma.binaryAncestry.create({
      data: {
        ancestorUserId: ancestor.id,
        descendantUserId: cleanupSibling.id,
        depth: 1,
        firstLegSide: BinaryPlacementSide.RIGHT,
        firstLegSlot: 'C',
      },
    });
    const cleanupRightEvent = await prisma.binaryQualifyingUnitEvent.create({
      data: {
        sourceKey: `PROGRAM_EVENT:CLEANUP:${suffix}`,
        requestFingerprint: 'c'.repeat(64),
        sourceMemberUserId: cleanupSibling.id,
        planVersionId: binaryVersion.id,
        eventType: 'QUALIFY',
        occurredAt: new Date(),
      },
    });
    cleanupQualifyingEventIds.push(cleanupRightEvent.id);
    const cleanupRightUnit = await prisma.binaryUplineQualifyingUnit.create({
      data: {
        unitEventId: cleanupRightEvent.id,
        ancestorUserId: ancestor.id,
        planVersionId: binaryVersion.id,
        side: BinaryPlacementSide.RIGHT,
        slot: 'C',
        depth: 1,
        sequence: 1,
      },
    });
    const cleanupSettlement = await prisma.binaryPairSettlement.create({
      data: {
        sourceKey: `PROGRAM_EVENT:CLEANUP:SETTLEMENT:${suffix}`,
        memberUserId: ancestor.id,
        planVersionId: binaryVersion.id,
        settledAt: new Date(),
        settlementLocalDate: '2026-10-07',
        settlementLocalMonth: '2026-10',
        leftAvailableBefore: '1.0000',
        rightAvailableBefore: '1.0000',
        pairCountCalculated: 1,
        pairCountPayable: 1,
        capLimitedPairs: 0,
        leftVolumeConsumed: '1.0000',
        rightVolumeConsumed: '1.0000',
        leftCarryAfter: '0.0000',
        rightCarryAfter: '0.0000',
        leftUnitsAvailableBefore: 1,
        rightUnitsAvailableBefore: 1,
        leftUnitsConsumed: 1,
        rightUnitsConsumed: 1,
        leftUnitsCarryAfter: 0,
        rightUnitsCarryAfter: 0,
        payoutAmount: '10.00',
        currencyCode: 'INR',
      },
    });
    await prisma.binaryPairMatch.create({
      data: {
        settlementId: cleanupSettlement.id,
        memberUserId: ancestor.id,
        planVersionId: binaryVersion.id,
        pairSequence: 1,
        leftUnitId: unitEvent.uplineUnits[0]!.id,
        rightUnitId: cleanupRightUnit.id,
        payable: true,
        payoutAmount: '10.00',
      },
    });

    // This represents unrelated persisted UAT/business data. Test teardown must
    // never discover it through a global PROGRAM_EVENT prefix sweep.
    const externalSentinel = await prisma.binaryQualifyingUnitEvent.create({
      data: {
        sourceKey: `PROGRAM_EVENT:UAT-SENTINEL:${suffix}`,
        requestFingerprint: 'd'.repeat(64),
        sourceMemberUserId: cleanupSibling.id,
        planVersionId: binaryVersion.id,
        eventType: 'QUALIFY',
        occurredAt: new Date(),
      },
    });
    externalSentinelQualifyingEventId = externalSentinel.id;
  });
});
