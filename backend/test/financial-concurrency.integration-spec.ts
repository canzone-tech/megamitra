import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import {
  KycProfileStatus,
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  UserStatus,
} from '../src/generated/prisma/enums';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';

describe('MegaGoldenClub financial concurrency integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let withdrawals: WithdrawalService;

  let memberId = '';
  let adminId = '';
  let walletId = '';
  let expenseId = '';
  let seedTransactionId = '';
  let destinationId = '';
  let requestId = '';
  let payoutTransactionId = '';

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    withdrawals = app.get(WithdrawalService);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const [member, admin] = await Promise.all([
      prisma.user.create({
        data: {
          username: `concurrency_member_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `concurrency_admin_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    memberId = member.id;
    adminId = admin.id;

    await prisma.kycProfile.create({
      data: {
        userId: memberId,
        status: KycProfileStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    walletId = randomUUID();
    expenseId = randomUUID();
    seedTransactionId = randomUUID();
    await prisma.ledgerAccount.createMany({
      data: [
        {
          id: walletId,
          code: `TEST:CONCURRENCY:WALLET:${suffix}`,
          name: 'Concurrency test wallet',
          kind: LedgerAccountKind.USER_WALLET,
          ownerUserId: memberId,
          currencyCode: 'INR',
        },
        {
          id: expenseId,
          code: `TEST:CONCURRENCY:EXPENSE:${suffix}`,
          name: 'Concurrency test seed expense',
          kind: LedgerAccountKind.COMMISSION_EXPENSE,
          currencyCode: 'INR',
        },
      ],
    });
    await prisma.ledgerTransaction.create({
      data: {
        id: seedTransactionId,
        sourceKey: `test:concurrency:seed:${suffix}`,
        type: LedgerTransactionType.ADJUSTMENT,
        description: 'Seed concurrency wallet',
        occurredAt: new Date(),
        entries: {
          create: [
            {
              id: randomUUID(),
              accountId: expenseId,
              direction: LedgerEntryDirection.DEBIT,
              amount: '1000.00',
              currencyCode: 'INR',
            },
            {
              id: randomUUID(),
              accountId: walletId,
              direction: LedgerEntryDirection.CREDIT,
              amount: '1000.00',
              currencyCode: 'INR',
            },
          ],
        },
      },
    });

    const destination = await withdrawals.createDestination(memberId, {
      type: 'UPI',
      label: 'Concurrency UPI',
      reference: `concurrency-${suffix}@upi`,
      isDefault: true,
    });
    destinationId = String(destination.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: [memberId, adminId].filter(Boolean) } },
            { entityId: { in: [destinationId, requestId].filter(Boolean) } },
          ],
        },
      });

      if (requestId) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM withdrawal_payout_attempts WHERE requestId = ?',
          requestId,
        );
        await prisma.$executeRawUnsafe('DELETE FROM withdrawal_requests WHERE id = ?', requestId);
      }
      if (destinationId) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM withdrawal_destinations WHERE id = ?',
          destinationId,
        );
      }

      const transactionIds = [payoutTransactionId, seedTransactionId].filter(Boolean);
      if (transactionIds.length) {
        await prisma.ledgerEntry.deleteMany({
          where: { transactionId: { in: transactionIds } },
        });
        await prisma.ledgerTransaction.deleteMany({
          where: { id: { in: transactionIds } },
        });
      }

      if (memberId) await prisma.kycProfile.deleteMany({ where: { userId: memberId } });
      await prisma.ledgerAccount.deleteMany({
        where: { id: { in: [walletId, expenseId].filter(Boolean) } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [memberId, adminId].filter(Boolean) } },
      });
      await prisma.authSession.deleteMany({
        where: { userId: { in: [memberId, adminId].filter(Boolean) } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [memberId, adminId].filter(Boolean) } },
      });
    }
    await app?.close();
  });

  it('serializes duplicate withdrawal creation and payout confirmation without double debit', async () => {
    const sourceKey = `withdrawal:concurrency:${randomUUID()}`;
    const payload = {
      sourceKey,
      destinationId,
      amount: 300,
      currencyCode: 'INR',
    };

    const [createdA, createdB] = await Promise.all([
      withdrawals.createRequest(memberId, payload),
      withdrawals.createRequest(memberId, payload),
    ]);
    requestId = String(createdA.id);
    expect(String(createdB.id)).toBe(requestId);

    const requestCount = await prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
      'SELECT COUNT(*) AS total FROM withdrawal_requests WHERE sourceKey = ?',
      sourceKey,
    );
    expect(Number(requestCount[0]?.total ?? 0)).toBe(1);

    const reserved = await withdrawals.getMemberOverview(memberId, { currencyCode: 'INR' });
    expect(String(reserved.wallet.reservedAmount)).toBe('300');
    expect(String(reserved.wallet.availableBalance)).toBe('700');

    await withdrawals.approve(requestId, adminId);
    const attempt = await withdrawals.startPayout(requestId, adminId, {
      sourceKey: `withdrawal-payout:concurrency:${randomUUID()}`,
      provider: 'TEST_PROVIDER',
      providerReference: `concurrency-paid-${randomUUID()}`,
    });
    const attemptId = String(attempt.id);

    const [confirmedA, confirmedB] = await Promise.all([
      withdrawals.confirmPayout(attemptId, adminId, {}),
      withdrawals.confirmPayout(attemptId, adminId, {}),
    ]);
    expect(String(confirmedA.status)).toBe('CONFIRMED');
    expect(String(confirmedB.status)).toBe('CONFIRMED');

    const finalRequest = await withdrawals.getRequest(requestId);
    expect(String(finalRequest.status)).toBe('PAID');
    payoutTransactionId = String(finalRequest.ledgerTransactionId);
    expect(payoutTransactionId).toBeTruthy();

    const payoutCount = await prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
      'SELECT COUNT(*) AS total FROM ledger_transactions WHERE sourceKey = ?',
      `withdrawal:${requestId}:paid`,
    );
    expect(Number(payoutCount[0]?.total ?? 0)).toBe(1);

    const finalOverview = await withdrawals.getMemberOverview(memberId, { currencyCode: 'INR' });
    expect(String(finalOverview.wallet.balance)).toBe('700');
    expect(String(finalOverview.wallet.reservedAmount)).toBe('0');
    expect(String(finalOverview.wallet.availableBalance)).toBe('700');
  });
});
