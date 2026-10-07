import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { RankAchievementService } from '../src/rank-achievement/rank-achievement.service';
import {
  PolicyLifecycle, ProgramIntervalUnit, ProgramPaymentAttemptStatus, UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub Lightning/level cash rank ledger integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  let prisma: PrismaService;
  let ranks: RankAchievementService;
  let ledger: LedgerService;
  const userIds: string[] = [];
  const enrollmentIds: string[] = [];
  const attemptIds: string[] = [];
  const recordIds: string[] = [];
  let programId = '';
  let programVersionId = '';

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    ranks = app.get(RankAchievementService);
    ledger = app.get(LedgerService);
  });

  afterAll(async () => {
    if (prisma) {
      const awards = await prisma.rankAchievement.findMany({
        where: { enrollmentId: { in: enrollmentIds } },
        select: { id: true, ledgerTransactionId: true, monthlyPayouts: {
          select: { ledgerTransactionId: true },
        } },
      });
      const awardIds = awards.map((item) => item.id);
      const ledgerIds = awards.flatMap((item) => [
        item.ledgerTransactionId, ...item.monthlyPayouts.map((p) => p.ledgerTransactionId),
      ]).filter((id): id is string => Boolean(id));
      await prisma.auditLog.deleteMany({
        where: { OR: [
          { actorUserId: { in: userIds } },
          { entityType: 'RankAchievement', entityId: { in: awardIds } },
        ] },
      });
      await prisma.rankMonthlyPayout.deleteMany({ where: { achievementId: { in: awardIds } } });
      await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerIds } } });
      await prisma.rankAchievement.deleteMany({ where: { id: { in: awardIds } } });
      await prisma.ledgerTransaction.deleteMany({ where: { id: { in: ledgerIds } } });
      await prisma.ledgerAccount.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.programPaymentRecord.deleteMany({ where: { id: { in: recordIds } } });
      await prisma.programPaymentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
      await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      await prisma.sponsorRelationship.deleteMany({ where: { memberUserId: { in: userIds } } });
      if (programVersionId) {
        await prisma.rankRewardPolicyVersion.deleteMany({ where: { programVersionId } });
        await prisma.programVersion.delete({ where: { id: programVersionId } });
      }
      if (programId) await prisma.program.delete({ where: { id: programId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it('credits Lightning once and never overlaps Gold/Diamond recurring rank income', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const joiningAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const referralAt = new Date(joiningAt.getTime() + 60 * 60 * 1000);

    const program = await prisma.program.create({ data: {
      code: 'RANK_' + suffix, name: 'Rank test ' + suffix,
    } });
    programId = program.id;

    const version = await prisma.programVersion.create({ data: {
      programId, version: 1, lifecycle: PolicyLifecycle.PUBLISHED, effectiveFrom: joiningAt,
      publishedAt: joiningAt, currencyCode: 'INR', registrationFee: '1000.00',
      installmentAmount: '1000.00', installmentCount: 18,
      installmentIntervalUnit: ProgramIntervalUnit.MONTH,
      installmentIntervalCount: 1, firstInstallmentOffsetDays: 0,
      gracePeriodDays: 0, partialPaymentsAllowed: false, overpaymentsAllowed: false,
    } });
    programVersionId = version.id;

    const users = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      prisma.user.create({ data: {
        username: 'rank_eligible_' + index + '_' + suffix,
        passwordHash: 'rank-uat-not-for-login', status: UserStatus.ACTIVE,
      } }),
    ));
    userIds.push(...users.map((user) => user.id));
    const sponsor = users[0]!;
    const children = users.slice(1);

    for (const [index, user] of users.entries()) {
      const paidAt = index === 0 ? joiningAt : referralAt;
      const enrollment = await prisma.programEnrollment.create({ data: {
        sourceKey: 'rank:enroll:' + user.id, requestFingerprint: 'a'.repeat(64),
        userId: user.id, programVersionId, enrolledAt: paidAt,
        enrollmentDate: paidAt.toISOString().slice(0, 10),
        status: 'ACTIVE', eligibilitySnapshot: { eligible: true },
        currencyCode: 'INR', registrationFeeSnapshot: '1000.00',
        installmentAmountSnapshot: '1000.00', installmentCountSnapshot: 18,
        gracePeriodDaysSnapshot: 0,
      } });
      enrollmentIds.push(enrollment.id);
      const attempt = await prisma.programPaymentAttempt.create({ data: {
        sourceKey: 'rank:attempt:' + user.id, requestFingerprint: 'b'.repeat(64),
        enrollmentId: enrollment.id, amount: '2000.00', currencyCode: 'INR',
        status: ProgramPaymentAttemptStatus.CONFIRMED, initiatedAt: paidAt, finalizedAt: paidAt,
      } });
      attemptIds.push(attempt.id);
      const payment = await prisma.programPaymentRecord.create({ data: {
        sourceKey: 'rank:payment:' + user.id, requestFingerprint: 'c'.repeat(64),
        enrollmentId: enrollment.id, paymentAttemptId: attempt.id,
        amount: '2000.00', currencyCode: 'INR', occurredAt: paidAt,
      } });
      recordIds.push(payment.id);
    }

    for (const child of children) {
      await prisma.sponsorRelationship.create({ data: {
        memberUserId: child.id, sponsorUserId: sponsor.id,
      } });
    }

    const draft = await ranks.createDraft(programVersionId, ranks.initialFlyerTiers(), sponsor.id);
    await ranks.publish(draft.id, sponsor.id);
    const first = await ranks.runCycle();
    expect(first.failed).toBe(0);
    expect(first.awarded).toBe(1);
    const wallet = await ledger.getUserWallet(sponsor.id, 'INR');
    expect(Number(wallet.balance)).toBe(1000);

    const achievements = await prisma.rankAchievement.findMany({
      where: { userId: sponsor.id },
    });
    expect(achievements).toHaveLength(1);
    expect(achievements[0]?.tierCode).toBe('LIGHTNING');
    expect(Number(achievements[0]?.cashAmount)).toBe(1000);
    expect(achievements[0]?.achievedAt).toEqual(referralAt);
    expect(achievements[0]?.ledgerTransactionId).toBeTruthy();

    const transaction = await ledger.getTransaction(String(achievements[0]?.ledgerTransactionId));
    expect(transaction.balanced).toBe(true);
    expect(Number(transaction.creditTotal)).toBe(1000);
    expect(Number(transaction.debitTotal)).toBe(1000);

    const second = await ranks.runCycle();
    expect(second.awarded).toBe(0);
    const replayWallet = await ledger.getUserWallet(sponsor.id, 'INR');
    expect(Number(replayWallet.balance)).toBe(1000);

    // Fixture prior ranks solely to exercise the income scheduler, not achievement
    // qualification. Diamond begins at the exact instant Gold month #4 is due:
    // Gold #1–#3 remain payable, Gold #4–#18 MUST never be credited.
    const sponsorEnrollment = await prisma.programEnrollment.findFirstOrThrow({
      where: { userId: sponsor.id, programVersionId },
    });
    const year = new Date().getUTCFullYear() + 2;
    const goldAt = new Date(Date.UTC(year, 0, 5, 12));
    const diamondAt = new Date(Date.UTC(year, 4, 5, 12));
    const asOf = new Date(Date.UTC(year, 7, 20, 12));
    await prisma.rankAchievement.createMany({ data: [
      {
        id: randomUUID(), enrollmentId: sponsorEnrollment.id, userId: sponsor.id,
        policyVersionId: draft.id, tierCode: 'GOLD', tierName: 'Gold Leader',
        directCount: 50, teamCount: 250, deadlineAt: goldAt, achievedAt: goldAt,
        cashAmount: '0.00', monthlyAmount: '2000.00', monthlyMonths: 18,
      },
      {
        id: randomUUID(), enrollmentId: sponsorEnrollment.id, userId: sponsor.id,
        policyVersionId: draft.id, tierCode: 'DIAMOND', tierName: 'Diamond Director',
        directCount: 100, teamCount: 500, deadlineAt: diamondAt, achievedAt: diamondAt,
        cashAmount: '0.00', monthlyAmount: '5000.00', monthlyMonths: 18,
      },
    ] });

    const afterPromotion = await ranks.runCycle(asOf);
    expect(afterPromotion.failed).toBe(0);
    expect(afterPromotion.monthlyPaid).toBe(6);
    const recurring = await prisma.rankAchievement.findMany({
      where: { enrollmentId: sponsorEnrollment.id, tierCode: { in: ['GOLD', 'DIAMOND'] } },
      include: { monthlyPayouts: { orderBy: { sequence: 'asc' } } },
    });
    const gold = recurring.find((a) => a.tierCode === 'GOLD');
    const diamond = recurring.find((a) => a.tierCode === 'DIAMOND');
    expect(gold?.monthlyPayouts.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(diamond?.monthlyPayouts.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(gold?.monthlyPayouts.every((p) => p.dueAt < diamondAt)).toBe(true);
    expect(diamond?.monthlyPayouts.every((p) => p.dueAt > diamondAt)).toBe(true);
    const promotedWallet = await ledger.getUserWallet(sponsor.id, 'INR');
    expect(Number(promotedWallet.balance)).toBe(22000); // 1k fast-start + 6k Gold + 15k Diamond

    const rerun = await ranks.runCycle(asOf);
    expect(rerun.monthlyPaid).toBe(0);
    const stableWallet = await ledger.getUserWallet(sponsor.id, 'INR');
    expect(Number(stableWallet.balance)).toBe(22000);
  });
});
