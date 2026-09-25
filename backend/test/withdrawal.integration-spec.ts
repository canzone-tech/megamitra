import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  KycProfileStatus,
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub withdrawal foundation integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl = '';
  let memberId = '';
  let adminId = '';
  let memberToken = '';
  let adminToken = '';
  let memberWalletId = '';
  let seedExpenseAccountId = '';
  let seedTransactionId = '';
  let testPolicyId = '';

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
    const memberPassword = 'Withdrawal-Member-123!';
    const adminPassword = 'Withdrawal-Admin-123!';
    const [memberHash, adminHash] = await Promise.all([
      passwords.hash(memberPassword),
      passwords.hash(adminPassword),
    ]);
    const [member, admin] = await Promise.all([
      prisma.user.create({
        data: {
          username: `withdraw_member_${suffix}`,
          email: `withdraw_member_${suffix}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: memberHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `withdraw_admin_${suffix}`,
          email: `withdraw_admin_${suffix}@example.test`,
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
    await prisma.kycProfile.create({
      data: { userId: memberId, status: KycProfileStatus.NOT_STARTED },
    });

    memberWalletId = randomUUID();
    seedExpenseAccountId = randomUUID();
    seedTransactionId = randomUUID();
    await prisma.ledgerAccount.createMany({
      data: [
        {
          id: memberWalletId,
          code: `TEST:WITHDRAWAL:WALLET:${suffix}`,
          name: 'Withdrawal test wallet',
          kind: LedgerAccountKind.USER_WALLET,
          ownerUserId: memberId,
          currencyCode: 'INR',
        },
        {
          id: seedExpenseAccountId,
          code: `TEST:WITHDRAWAL:EXPENSE:${suffix}`,
          name: 'Withdrawal test seed expense',
          kind: LedgerAccountKind.COMMISSION_EXPENSE,
          currencyCode: 'INR',
        },
      ],
    });
    await prisma.ledgerTransaction.create({
      data: {
        id: seedTransactionId,
        sourceKey: `test:withdrawal:seed:${suffix}`,
        type: LedgerTransactionType.ADJUSTMENT,
        description: 'Seed withdrawal integration wallet',
        occurredAt: new Date(),
        entries: {
          create: [
            {
              id: randomUUID(),
              accountId: seedExpenseAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amount: '1000.00',
              currencyCode: 'INR',
            },
            {
              id: randomUUID(),
              accountId: memberWalletId,
              direction: LedgerEntryDirection.CREDIT,
              amount: '1000.00',
              currencyCode: 'INR',
            },
          ],
        },
      },
    });

    [memberToken, adminToken] = await Promise.all([
      login(member.username, memberPassword),
      login(admin.username, adminPassword),
    ]);
  });

  afterAll(async () => {
    if (prisma) {
      if (memberId) {
        const withdrawalLedgerRows = await prisma.$queryRawUnsafe<Array<{ ledgerTransactionId: string | null }>>(
          `SELECT ledgerTransactionId FROM withdrawal_requests WHERE userId = ? AND ledgerTransactionId IS NOT NULL`,
          memberId,
        );
        const ledgerIds = withdrawalLedgerRows
          .map((row) => row.ledgerTransactionId)
          .filter((value): value is string => Boolean(value));

        await prisma.$executeRawUnsafe(
          `DELETE FROM withdrawal_payout_attempts WHERE requestId IN (SELECT id FROM withdrawal_requests WHERE userId = ?)`,
          memberId,
        );
        await prisma.$executeRawUnsafe(`DELETE FROM withdrawal_requests WHERE userId = ?`, memberId);
        await prisma.$executeRawUnsafe(`DELETE FROM withdrawal_destinations WHERE userId = ?`, memberId);

        if (ledgerIds.length) {
          const placeholders = ledgerIds.map(() => '?').join(',');
          await prisma.$executeRawUnsafe(
            `DELETE FROM ledger_entries WHERE transactionId IN (${placeholders})`,
            ...ledgerIds,
          );
          await prisma.$executeRawUnsafe(
            `DELETE FROM ledger_transactions WHERE id IN (${placeholders})`,
            ...ledgerIds,
          );
        }
        await prisma.kycProfile.deleteMany({ where: { userId: memberId } });
      }
      if (testPolicyId) {
        await prisma.$executeRawUnsafe(`DELETE FROM withdrawal_policy_versions WHERE policyId = ?`, testPolicyId);
        await prisma.$executeRawUnsafe(`DELETE FROM withdrawal_policies WHERE id = ?`, testPolicyId);
      }
      if (seedTransactionId) {
        await prisma.ledgerEntry.deleteMany({ where: { transactionId: seedTransactionId } });
        await prisma.ledgerTransaction.deleteMany({ where: { id: seedTransactionId } });
      }
      if (memberWalletId || seedExpenseAccountId) {
        await prisma.ledgerAccount.deleteMany({
          where: { id: { in: [memberWalletId, seedExpenseAccountId].filter(Boolean) } },
        });
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

  it('gates by KYC, reserves balance, retries payout, and posts ledger only when confirmed', async () => {
    const initial = await request('/withdrawals/me?currencyCode=INR', {}, memberToken);
    expect(initial.status).toBe(200);
    expect(initial.body.kycStatus).toBe('NOT_STARTED');
    expect(String(initial.body.wallet.balance)).toBe('1000');
    expect(initial.body.policy.policyCode).toBe('MEMBER_STANDARD_INR');

    const destination = await request(
      '/withdrawals/me/destinations',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'UPI',
          label: 'Primary UPI',
          reference: `withdrawal-test-${randomUUID()}@upi`,
          isDefault: true,
        }),
      },
      memberToken,
    );
    expect(destination.status).toBe(201);
    const destinationId = String(destination.body.id);

    const sourceKey = `withdrawal:${randomUUID()}`;
    const payload = {
      sourceKey,
      destinationId,
      amount: 300,
      currencyCode: 'INR',
    };
    const blocked = await request(
      '/withdrawals/me/requests',
      { method: 'POST', body: JSON.stringify(payload) },
      memberToken,
    );
    expect(blocked.status).toBe(403);

    await prisma.kycProfile.update({
      where: { userId: memberId },
      data: { status: KycProfileStatus.APPROVED, approvedAt: new Date() },
    });

    const created = await request(
      '/withdrawals/me/requests',
      { method: 'POST', body: JSON.stringify(payload) },
      memberToken,
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('REQUESTED');
    expect(String(created.body.amount)).toBe('300.00');
    const requestId = String(created.body.id);

    const replay = await request(
      '/withdrawals/me/requests',
      { method: 'POST', body: JSON.stringify(payload) },
      memberToken,
    );
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(requestId);

    const overviewReserved = await request('/withdrawals/me?currencyCode=INR', {}, memberToken);
    expect(String(overviewReserved.body.wallet.reservedAmount)).toBe('300');
    expect(String(overviewReserved.body.wallet.availableBalance)).toBe('700');

    const second = await request(
      '/withdrawals/me/requests',
      {
        method: 'POST',
        body: JSON.stringify({ ...payload, sourceKey: `withdrawal:${randomUUID()}`, amount: 100 }),
      },
      memberToken,
    );
    expect(second.status).toBe(409);

    const approved = await request(
      `/admin/withdrawals/requests/${requestId}/approve`,
      { method: 'POST' },
      adminToken,
    );
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');

    const firstAttempt = await request(
      `/admin/withdrawals/requests/${requestId}/payout-attempts`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `withdrawal-payout:${randomUUID()}`,
          provider: 'TEST_PROVIDER',
          providerReference: `test-fail-${randomUUID()}`,
        }),
      },
      adminToken,
    );
    expect(firstAttempt.status).toBe(201);
    const firstAttemptId = String(firstAttempt.body.id);

    const failed = await request(
      `/admin/withdrawals/payout-attempts/${firstAttemptId}/fail`,
      { method: 'PATCH', body: JSON.stringify({ reason: 'Simulated provider failure' }) },
      adminToken,
    );
    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe('FAILED');

    const failedRequest = await request(`/admin/withdrawals/requests/${requestId}`, {}, adminToken);
    expect(failedRequest.body.status).toBe('PAYOUT_FAILED');
    expect(failedRequest.body.ledgerTransactionId).toBeNull();

    const retry = await request(
      `/admin/withdrawals/requests/${requestId}/payout-attempts`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `withdrawal-payout:${randomUUID()}`,
          provider: 'TEST_PROVIDER',
          providerReference: `test-paid-${randomUUID()}`,
        }),
      },
      adminToken,
    );
    expect(retry.status).toBe(201);
    const retryId = String(retry.body.id);

    const confirmed = await request(
      `/admin/withdrawals/payout-attempts/${retryId}/confirm`,
      { method: 'PATCH', body: JSON.stringify({}) },
      adminToken,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');

    const finalRequest = await request(`/admin/withdrawals/requests/${requestId}`, {}, adminToken);
    expect(finalRequest.body.status).toBe('PAID');
    expect(finalRequest.body.ledgerTransactionId).toBeTruthy();

    const finalOverview = await request('/withdrawals/me?currencyCode=INR', {}, memberToken);
    expect(String(finalOverview.body.wallet.balance)).toBe('700');
    expect(String(finalOverview.body.wallet.reservedAmount)).toBe('0');
    expect(String(finalOverview.body.wallet.availableBalance)).toBe('700');

    const ledger = await request(
      `/admin/ledger/transactions/${finalRequest.body.ledgerTransactionId}`,
      {},
      adminToken,
    );
    expect(ledger.status).toBe(200);
    expect(ledger.body.balanced).toBe(true);
    expect(ledger.body.type).toBe('WITHDRAWAL_PAYOUT');
  });

  it('supports versioned configurable withdrawal policies', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const policy = await request(
      '/admin/withdrawals/policies',
      {
        method: 'POST',
        body: JSON.stringify({
          code: `TEST_USD_${suffix}`,
          name: 'Withdrawal policy test USD',
          currencyCode: 'USD',
          isDefault: false,
        }),
      },
      adminToken,
    );
    expect(policy.status).toBe(201);
    testPolicyId = String(policy.body.id);

    const version = await request(
      `/admin/withdrawals/policies/${testPolicyId}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
          minAmount: 10,
          maxAmount: 5000,
          feeMode: 'PERCENTAGE',
          feeValue: 1.25,
          minimumFee: 1,
          maximumFee: 25,
          kycRequired: true,
          maxPendingRequests: 2,
          dailyAmountLimit: 5000,
          monthlyAmountLimit: 25000,
          allowedDestinationTypes: ['UPI', 'OTHER'],
          reviewRules: { manualApprovalRequired: true },
        }),
      },
      adminToken,
    );
    expect(version.status).toBe(201);
    expect(version.body.lifecycle).toBe('DRAFT');

    const published = await request(
      `/admin/withdrawals/policy-versions/${version.body.id}/publish`,
      { method: 'POST' },
      adminToken,
    );
    expect(published.status).toBe(201);
    expect(published.body.lifecycle).toBe('PUBLISHED');

    const retired = await request(
      `/admin/withdrawals/policy-versions/${version.body.id}/retire`,
      { method: 'POST' },
      adminToken,
    );
    expect(retired.status).toBe(201);
    expect(retired.body.lifecycle).toBe('RETIRED');
  });
});
