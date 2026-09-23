import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  BinaryCapOverflowMode,
  BinaryPlacementSide,
  BinaryVolumeEventType,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaMitra pair settlement and ledger integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;
  const userIds: string[] = [];
  const planIds: string[] = [];
  const versionIds: string[] = [];
  const eventIds: string[] = [];
  const settlementIds: string[] = [];
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
      body: (await response.json()) as Record<string, unknown>,
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
    const username = `settlement_admin_${suffix}`;
    const password = 'Settlement-Integration-Pass-123!';
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
            { entityId: { in: [...userIds, ...planIds, ...versionIds, ...eventIds, ...settlementIds] } },
          ],
        },
      });
      await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerTransactionIds } } });
      await prisma.binaryPairSettlement.deleteMany({ where: { id: { in: settlementIds } } });
      await prisma.ledgerTransaction.deleteMany({ where: { id: { in: ledgerTransactionIds } } });
      await prisma.ledgerAccount.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.binaryUplineVolumeCredit.deleteMany({ where: { volumeEventId: { in: eventIds } } });
      await prisma.binaryVolumeEvent.deleteMany({ where: { id: { in: eventIds } } });
      await prisma.binaryAncestry.deleteMany({
        where: {
          OR: [
            { ancestorUserId: { in: userIds } },
            { descendantUserId: { in: userIds } },
          ],
        },
      });
      await prisma.binaryPlacement.deleteMany({
        where: { OR: [{ memberUserId: { in: userIds } }, { parentUserId: { in: userIds } }] },
      });
      await prisma.binaryPlanVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.binaryPlan.deleteMany({ where: { id: { in: planIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('matches configured pair ratio, applies cap, posts balanced ledger and derives wallet', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const [root, left, right] = await Promise.all(
      ['root', 'left', 'right'].map((label) =>
        prisma.user.create({
          data: {
            username: `settle_${label}_${suffix}`,
            passwordHash: 'integration-not-used',
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    userIds.push(root.id, left.id, right.id);

    for (const placement of [
      { memberUserId: left.id, parentUserId: root.id, side: BinaryPlacementSide.LEFT },
      { memberUserId: right.id, parentUserId: root.id, side: BinaryPlacementSide.RIGHT },
    ]) {
      const response = await request(
        '/admin/genealogy/placements',
        authenticated({ method: 'POST', body: JSON.stringify(placement) }),
      );
      expect(response.status).toBe(201);
    }

    const plan = await request(
      '/admin/binary-plans',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ code: `SET${suffix}`, name: `Settlement ${suffix}` }),
      }),
    );
    expect(plan.status).toBe(201);
    const planId = String(plan.body.id);
    planIds.push(planId);

    const draft = await request(
      `/admin/binary-plans/${planId}/versions`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          qualifyingUnit: '1.0000',
          leftVolumePerPair: '2.0000',
          rightVolumePerPair: '1.0000',
          pairPayoutAmount: '25.00',
          currencyCode: 'INR',
          settlementTimezone: 'Asia/Kolkata',
          capOverflowMode: BinaryCapOverflowMode.CARRY,
          dailyPairCap: 1,
          carryForwardEnabled: true,
        }),
      }),
    );
    expect(draft.status).toBe(201);
    const versionId = String(draft.body.id);
    versionIds.push(versionId);

    const publish = await request(
      `/admin/binary-plans/versions/${versionId}/publish`,
      authenticated({ method: 'POST' }),
    );
    expect(publish.status).toBe(201);

    const occurredAt = new Date().toISOString();
    for (const input of [
      { sourceKey: `left-${suffix}`, sourceMemberUserId: left.id, volume: '6.0000' },
      { sourceKey: `right-${suffix}`, sourceMemberUserId: right.id, volume: '3.0000' },
    ]) {
      const response = await request(
        '/admin/binary-volume/events',
        authenticated({
          method: 'POST',
          body: JSON.stringify({
            ...input,
            planVersionId: versionId,
            eventType: BinaryVolumeEventType.CREDIT,
            occurredAt,
          }),
        }),
      );
      expect(response.status).toBe(201);
      eventIds.push(String((response.body.event as { id: string }).id));
    }

    const settledAt = new Date(Date.now() + 1_000).toISOString();
    const sourceKey = `settlement-${suffix}`;
    const settlementResponse = await request(
      '/admin/binary-settlements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ sourceKey, memberUserId: root.id, planVersionId: versionId, settledAt }),
      }),
    );
    expect(settlementResponse.status).toBe(201);
    expect(settlementResponse.body.idempotent).toBe(false);

    const settlement = settlementResponse.body.settlement as {
      id: string;
      pairCountCalculated: number;
      pairCountPayable: number;
      capLimitedPairs: number;
      leftCarryAfter: string;
      rightCarryAfter: string;
      payoutAmount: string;
      ledgerTransactionId: string;
      ledgerTransaction: { entries: Array<{ direction: string; amount: string }> };
    };
    settlementIds.push(settlement.id);
    ledgerTransactionIds.push(settlement.ledgerTransactionId);
    expect(settlement.pairCountCalculated).toBe(3);
    expect(settlement.pairCountPayable).toBe(1);
    expect(settlement.capLimitedPairs).toBe(2);
    expect(Number(settlement.leftCarryAfter)).toBe(4);
    expect(Number(settlement.rightCarryAfter)).toBe(2);
    expect(Number(settlement.payoutAmount)).toBe(25);
    expect(settlement.ledgerTransaction.entries).toHaveLength(2);

    const ledger = await request(
      `/admin/ledger/transactions/${settlement.ledgerTransactionId}`,
      authenticated(),
    );
    expect(ledger.status).toBe(200);
    expect(ledger.body.balanced).toBe(true);
    expect(Number(ledger.body.debitTotal)).toBe(25);
    expect(Number(ledger.body.creditTotal)).toBe(25);

    const wallet = await request(
      `/admin/ledger/wallets/users/${root.id}/INR`,
      authenticated(),
    );
    expect(wallet.status).toBe(200);
    expect(Number(wallet.body.balance)).toBe(25);

    const duplicate = await request(
      '/admin/binary-settlements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ sourceKey, memberUserId: root.id, planVersionId: versionId, settledAt }),
      }),
    );
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.idempotent).toBe(true);

    const second = await request(
      '/admin/binary-settlements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `${sourceKey}-same-day`,
          memberUserId: root.id,
          planVersionId: versionId,
          settledAt: new Date(Date.parse(settledAt) + 1_000).toISOString(),
        }),
      }),
    );
    expect(second.status).toBe(201);
    const secondSettlement = second.body.settlement as {
      id: string;
      pairCountPayable: number;
      payoutAmount: string;
      leftCarryAfter: string;
      rightCarryAfter: string;
    };
    settlementIds.push(secondSettlement.id);
    expect(secondSettlement.pairCountPayable).toBe(0);
    expect(Number(secondSettlement.payoutAmount)).toBe(0);
    expect(Number(secondSettlement.leftCarryAfter)).toBe(4);
    expect(Number(secondSettlement.rightCarryAfter)).toBe(2);

    const walletAfter = await request(
      `/admin/ledger/wallets/users/${root.id}/INR`,
      authenticated(),
    );
    expect(Number(walletAfter.body.balance)).toBe(25);
  });
});
