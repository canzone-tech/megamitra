import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  PolicyLifecycle,
  ProgramBusinessEventType,
  ProgramEnrollmentStatus,
  ProgramIntervalUnit,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub operational read models integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;

  const userIds: string[] = [];
  const programIds: string[] = [];
  const programVersionIds: string[] = [];
  const enrollmentIds: string[] = [];
  const businessEventIds: string[] = [];
  const ledgerTransactionIds: string[] = [];
  const ledgerAccountIds: string[] = [];

  async function request(path: string, token?: string, init: RequestInit = {}) {
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
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  async function login(username: string, password: string) {
    const response = await request('/auth/login', undefined, {
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
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.programBusinessEvent.deleteMany({ where: { id: { in: businessEventIds } } });
      await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerTransactionIds } } });
      await prisma.ledgerTransaction.deleteMany({ where: { id: { in: ledgerTransactionIds } } });
      await prisma.ledgerAccount.deleteMany({ where: { id: { in: ledgerAccountIds } } });
      await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      await prisma.programVersion.deleteMany({ where: { id: { in: programVersionIds } } });
      await prisma.program.deleteMany({ where: { id: { in: programIds } } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('keeps member reads self-scoped and protects paginated admin operational queues', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const password = 'Operational-Read-Pass-123!';
    const [admin, memberA, memberB] = await Promise.all(
      ['admin', 'a', 'b'].map((label) =>
        prisma.user.create({
          data: {
            username: `ops_${label}_${suffix}`,
            passwordHash: '',
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    userIds.push(admin.id, memberA.id, memberB.id);
    const passwordHash = await passwords.hash(password);
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { passwordHash },
    });
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdmin.id } });

    const [adminToken, memberAToken, memberBToken] = await Promise.all([
      login(admin.username, password),
      login(memberA.username, password),
      login(memberB.username, password),
    ]);

    const program = await prisma.program.create({
      data: { code: `OPS${suffix}`, name: `Operations ${suffix}` },
    });
    programIds.push(program.id);
    const version = await prisma.programVersion.create({
      data: {
        programId: program.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 86_400_000),
        currencyCode: 'INR',
        registrationFee: '100.00',
        installmentAmount: '50.00',
        installmentCount: 2,
        installmentIntervalUnit: ProgramIntervalUnit.MONTH,
        installmentIntervalCount: 1,
        firstInstallmentOffsetDays: 0,
        gracePeriodDays: 0,
        partialPaymentsAllowed: true,
        overpaymentsAllowed: false,
        publishedAt: new Date(),
      },
    });
    programVersionIds.push(version.id);

    const enrollments = await Promise.all(
      [memberA, memberB].map((member, index) =>
        prisma.programEnrollment.create({
          data: {
            sourceKey: `OPS-ENROLL-${index}-${suffix}`,
            requestFingerprint: String(index + 1).repeat(64),
            userId: member.id,
            programVersionId: version.id,
            enrolledAt: new Date(Date.now() - 10_000 + index),
            enrollmentDate: '2026-09-23',
            status: ProgramEnrollmentStatus.ACTIVE,
            eligibilitySnapshot: { eligible: true },
            currencyCode: 'INR',
            registrationFeeSnapshot: '100.00',
            installmentAmountSnapshot: '50.00',
            installmentCountSnapshot: 2,
            gracePeriodDaysSnapshot: 0,
          },
        }),
      ),
    );
    enrollmentIds.push(...enrollments.map((row) => row.id));

    const expense = await prisma.ledgerAccount.create({
      data: {
        code: `OPS-EXPENSE-${suffix}`,
        name: `Operations fixture expense ${suffix}`,
        kind: LedgerAccountKind.COMMISSION_EXPENSE,
        currencyCode: 'INR',
      },
    });
    const walletA = await prisma.ledgerAccount.create({
      data: {
        code: `USER_WALLET:${memberA.id}:INR`,
        name: `Wallet ${memberA.username}`,
        kind: LedgerAccountKind.USER_WALLET,
        ownerUserId: memberA.id,
        currencyCode: 'INR',
      },
    });
    const walletB = await prisma.ledgerAccount.create({
      data: {
        code: `USER_WALLET:${memberB.id}:INR`,
        name: `Wallet ${memberB.username}`,
        kind: LedgerAccountKind.USER_WALLET,
        ownerUserId: memberB.id,
        currencyCode: 'INR',
      },
    });
    ledgerAccountIds.push(expense.id, walletA.id, walletB.id);

    const transactionA = await prisma.ledgerTransaction.create({
      data: {
        sourceKey: `OPS-WALLET-A-${suffix}`,
        type: LedgerTransactionType.ADJUSTMENT,
        occurredAt: new Date(),
        entries: {
          create: [
            {
              accountId: expense.id,
              direction: LedgerEntryDirection.DEBIT,
              amount: '25.00',
              currencyCode: 'INR',
            },
            {
              accountId: walletA.id,
              direction: LedgerEntryDirection.CREDIT,
              amount: '25.00',
              currencyCode: 'INR',
            },
          ],
        },
      },
    });
    const transactionB = await prisma.ledgerTransaction.create({
      data: {
        sourceKey: `OPS-WALLET-B-${suffix}`,
        type: LedgerTransactionType.ADJUSTMENT,
        occurredAt: new Date(),
        entries: {
          create: [
            {
              accountId: expense.id,
              direction: LedgerEntryDirection.DEBIT,
              amount: '40.00',
              currencyCode: 'INR',
            },
            {
              accountId: walletB.id,
              direction: LedgerEntryDirection.CREDIT,
              amount: '40.00',
              currencyCode: 'INR',
            },
          ],
        },
      },
    });
    ledgerTransactionIds.push(transactionA.id, transactionB.id);

    const businessEvent = await prisma.programBusinessEvent.create({
      data: {
        sourceKey: `OPS-EVENT-${suffix}`,
        type: ProgramBusinessEventType.ENROLLMENT_CREATED,
        enrollmentId: enrollments[0].id,
        occurredAt: new Date(),
        payload: { fixture: true },
      },
    });
    businessEventIds.push(businessEvent.id);

    const dashboard = await request('/member/dashboard', memberAToken);
    expect(dashboard.status).toBe(200);
    expect((dashboard.body.user as Record<string, unknown>).id).toBe(memberA.id);
    const wallets = dashboard.body.wallets as Array<Record<string, unknown>>;
    expect(wallets).toHaveLength(1);
    expect(Number(wallets[0].balance)).toBe(25);

    const enrollmentPage = await request('/member/enrollments?limit=1&page=1', memberAToken);
    expect(enrollmentPage.status).toBe(200);
    expect(enrollmentPage.body.total).toBe(1);
    const enrollmentItems = enrollmentPage.body.items as Array<Record<string, unknown>>;
    expect(enrollmentItems[0].id).toBe(enrollments[0].id);
    expect(enrollmentItems[0].id).not.toBe(enrollments[1].id);

    const walletHistory = await request('/member/wallet-history?currencyCode=INR', memberAToken);
    expect(walletHistory.status).toBe(200);
    expect(walletHistory.body.total).toBe(1);
    const walletItems = walletHistory.body.items as Array<Record<string, unknown>>;
    expect(walletItems[0].sourceKey).toBe(`OPS-WALLET-A-${suffix}`);

    const otherWalletHistory = await request('/member/wallet-history?currencyCode=INR', memberBToken);
    expect(otherWalletHistory.status).toBe(200);
    const otherWalletItems = otherWalletHistory.body.items as Array<Record<string, unknown>>;
    expect(otherWalletItems[0].sourceKey).toBe(`OPS-WALLET-B-${suffix}`);

    expect((await request('/member/referral-rewards', memberAToken)).status).toBe(200);
    expect((await request('/member/binary', memberAToken)).status).toBe(200);
    expect((await request('/member/rewards', memberAToken)).status).toBe(200);

    const forbiddenAdmin = await request('/admin/operations/summary', memberAToken);
    expect(forbiddenAdmin.status).toBe(403);

    const summary = await request('/admin/operations/summary', adminToken);
    expect(summary.status).toBe(200);
    expect(Number(summary.body.unprocessedBusinessEvents)).toBeGreaterThanOrEqual(1);

    const queue = await request('/admin/operations/orchestration?status=UNPROCESSED&limit=100', adminToken);
    expect(queue.status).toBe(200);
    const queueItems = queue.body.items as Array<Record<string, unknown>>;
    expect(queueItems.some((row) => row.businessEventId === businessEvent.id)).toBe(true);

    expect((await request('/admin/operations/referral-handoffs', adminToken)).status).toBe(200);
    expect((await request('/admin/operations/draws', adminToken)).status).toBe(200);
    expect((await request('/admin/operations/prize-claims', adminToken)).status).toBe(200);

    const invalidLimit = await request('/admin/operations/orchestration?limit=101', adminToken);
    expect(invalidLimit.status).toBe(400);
  });
});
