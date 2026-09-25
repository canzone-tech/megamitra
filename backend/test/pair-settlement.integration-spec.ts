import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  BinaryCapOverflowMode,
  BinaryPlacementSide,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub explicit binary pair matching and ledger integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;
  const userIds: string[] = [];
  const planIds: string[] = [];
  const versionIds: string[] = [];
  const unitEventIds: string[] = [];
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
            {
              entityId: {
                in: [
                  ...userIds,
                  ...planIds,
                  ...versionIds,
                  ...unitEventIds,
                  ...settlementIds,
                ],
              },
            },
          ],
        },
      });
      await prisma.binaryPairMatch.deleteMany({
        where: { settlementId: { in: settlementIds } },
      });
      await prisma.binaryUnitDisposition.deleteMany({
        where: { settlementId: { in: settlementIds } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { transactionId: { in: ledgerTransactionIds } },
      });
      await prisma.binaryPairSettlement.deleteMany({
        where: { id: { in: settlementIds } },
      });
      await prisma.ledgerTransaction.deleteMany({
        where: { id: { in: ledgerTransactionIds } },
      });
      await prisma.ledgerAccount.deleteMany({
        where: { ownerUserId: { in: userIds } },
      });
      await prisma.binaryUplineQualifyingUnit.deleteMany({
        where: { unitEventId: { in: unitEventIds } },
      });
      await prisma.binaryQualifyingUnitEvent.deleteMany({
        where: { id: { in: unitEventIds }, reversalOfEventId: { not: null } },
      });
      await prisma.binaryQualifyingUnitEvent.deleteMany({
        where: { id: { in: unitEventIds } },
      });
      await prisma.binaryAncestry.deleteMany({
        where: {
          OR: [
            { ancestorUserId: { in: userIds } },
            { descendantUserId: { in: userIds } },
          ],
        },
      });
      await prisma.binaryPlacement.deleteMany({
        where: {
          OR: [{ memberUserId: { in: userIds } }, { parentUserId: { in: userIds } }],
        },
      });
      await prisma.binaryPlanVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.binaryPlan.deleteMany({ where: { id: { in: planIds } } });
      await prisma.systemSequence.deleteMany({
        where: {
          OR: [
            ...versionIds.map((id) => ({ key: { contains: id } })),
            ...userIds.map((id) => ({ key: { contains: id } })),
          ],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('pairs A with C then B with D, applies cap, carries unmatched units, and posts balanced ledger', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const users = await Promise.all(
      ['root', 'left_branch', 'right_branch', 'A', 'B', 'C', 'D'].map((label) =>
        prisma.user.create({
          data: {
            username: `settle_${label}_${suffix}`,
            passwordHash: 'integration-not-used',
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    const [root, leftBranch, rightBranch, a, b, c, d] = users;
    userIds.push(...users.map((user) => user.id));

    for (const placement of [
      {
        memberUserId: leftBranch.id,
        parentUserId: root.id,
        side: BinaryPlacementSide.LEFT,
      },
      {
        memberUserId: rightBranch.id,
        parentUserId: root.id,
        side: BinaryPlacementSide.RIGHT,
      },
      {
        memberUserId: a.id,
        parentUserId: leftBranch.id,
        side: BinaryPlacementSide.LEFT,
      },
      {
        memberUserId: b.id,
        parentUserId: leftBranch.id,
        side: BinaryPlacementSide.RIGHT,
      },
      {
        memberUserId: c.id,
        parentUserId: rightBranch.id,
        side: BinaryPlacementSide.LEFT,
      },
      {
        memberUserId: d.id,
        parentUserId: rightBranch.id,
        side: BinaryPlacementSide.RIGHT,
      },
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
          leftVolumePerPair: '1.0000',
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

    const occurredBase = Date.now();
    const qualifyingInputs = [
      { label: 'A', member: a, offset: 0 },
      { label: 'C', member: c, offset: 1_000 },
      { label: 'B', member: b, offset: 2_000 },
      { label: 'D', member: d, offset: 3_000 },
    ];
    for (const input of qualifyingInputs) {
      const response = await request(
        '/admin/binary-units/events',
        authenticated({
          method: 'POST',
          body: JSON.stringify({
            sourceKey: `unit-${input.label}-${suffix}`,
            sourceMemberUserId: input.member.id,
            planVersionId: versionId,
            occurredAt: new Date(occurredBase + input.offset).toISOString(),
          }),
        }),
      );
      expect(response.status).toBe(201);
      unitEventIds.push(String((response.body.event as { id: string }).id));
    }

    const settledAt = new Date(occurredBase + 10_000).toISOString();
    const sourceKey = `settlement-${suffix}`;
    const first = await request(
      '/admin/binary-settlements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          memberUserId: root.id,
          planVersionId: versionId,
          settledAt,
        }),
      }),
    );
    expect(first.status).toBe(201);
    expect(first.body.idempotent).toBe(false);

    const firstSettlement = first.body.settlement as {
      id: string;
      pairCountCalculated: number;
      pairCountPayable: number;
      capLimitedPairs: number;
      leftUnitsAvailableBefore: number;
      rightUnitsAvailableBefore: number;
      leftUnitsCarryAfter: number;
      rightUnitsCarryAfter: number;
      payoutAmount: string;
      ledgerTransactionId: string;
      ledgerTransaction: { entries: Array<{ direction: string; amount: string }> };
      pairMatches: Array<{
        pairSequence: number;
        payable: boolean;
        leftUnit: { unitEvent: { sourceMember: { username: string } } };
        rightUnit: { unitEvent: { sourceMember: { username: string } } };
      }>;
    };
    settlementIds.push(firstSettlement.id);
    ledgerTransactionIds.push(firstSettlement.ledgerTransactionId);

    expect(firstSettlement.pairCountCalculated).toBe(2);
    expect(firstSettlement.pairCountPayable).toBe(1);
    expect(firstSettlement.capLimitedPairs).toBe(1);
    expect(firstSettlement.leftUnitsAvailableBefore).toBe(2);
    expect(firstSettlement.rightUnitsAvailableBefore).toBe(2);
    expect(firstSettlement.leftUnitsCarryAfter).toBe(1);
    expect(firstSettlement.rightUnitsCarryAfter).toBe(1);
    expect(Number(firstSettlement.payoutAmount)).toBe(25);
    expect(firstSettlement.ledgerTransaction.entries).toHaveLength(2);
    expect(firstSettlement.pairMatches).toHaveLength(1);
    expect(firstSettlement.pairMatches[0]).toMatchObject({
      pairSequence: 1,
      payable: true,
    });
    expect(firstSettlement.pairMatches[0]?.leftUnit.unitEvent.sourceMember.username).toBe(
      a.username,
    );
    expect(firstSettlement.pairMatches[0]?.rightUnit.unitEvent.sourceMember.username).toBe(
      c.username,
    );

    const ledger = await request(
      `/admin/ledger/transactions/${firstSettlement.ledgerTransactionId}`,
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
        body: JSON.stringify({
          sourceKey,
          memberUserId: root.id,
          planVersionId: versionId,
          settledAt,
        }),
      }),
    );
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.idempotent).toBe(true);

    const sameDay = await request(
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
    expect(sameDay.status).toBe(201);
    const sameDaySettlement = sameDay.body.settlement as {
      id: string;
      pairCountCalculated: number;
      pairCountPayable: number;
      leftUnitsCarryAfter: number;
      rightUnitsCarryAfter: number;
      payoutAmount: string;
      pairMatches: unknown[];
    };
    settlementIds.push(sameDaySettlement.id);
    expect(sameDaySettlement.pairCountCalculated).toBe(1);
    expect(sameDaySettlement.pairCountPayable).toBe(0);
    expect(sameDaySettlement.leftUnitsCarryAfter).toBe(1);
    expect(sameDaySettlement.rightUnitsCarryAfter).toBe(1);
    expect(Number(sameDaySettlement.payoutAmount)).toBe(0);
    expect(sameDaySettlement.pairMatches).toHaveLength(0);

    const nextDay = await request(
      '/admin/binary-settlements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `${sourceKey}-next-day`,
          memberUserId: root.id,
          planVersionId: versionId,
          settledAt: new Date(Date.parse(settledAt) + 86_400_000).toISOString(),
        }),
      }),
    );
    expect(nextDay.status).toBe(201);
    const nextDaySettlement = nextDay.body.settlement as {
      id: string;
      pairCountCalculated: number;
      pairCountPayable: number;
      leftUnitsCarryAfter: number;
      rightUnitsCarryAfter: number;
      payoutAmount: string;
      ledgerTransactionId: string;
      pairMatches: Array<{
        pairSequence: number;
        leftUnit: { unitEvent: { sourceMember: { username: string } } };
        rightUnit: { unitEvent: { sourceMember: { username: string } } };
      }>;
    };
    settlementIds.push(nextDaySettlement.id);
    ledgerTransactionIds.push(nextDaySettlement.ledgerTransactionId);
    expect(nextDaySettlement.pairCountCalculated).toBe(1);
    expect(nextDaySettlement.pairCountPayable).toBe(1);
    expect(nextDaySettlement.leftUnitsCarryAfter).toBe(0);
    expect(nextDaySettlement.rightUnitsCarryAfter).toBe(0);
    expect(Number(nextDaySettlement.payoutAmount)).toBe(25);
    expect(nextDaySettlement.pairMatches).toHaveLength(1);
    expect(nextDaySettlement.pairMatches[0]?.pairSequence).toBe(2);
    expect(nextDaySettlement.pairMatches[0]?.leftUnit.unitEvent.sourceMember.username).toBe(
      b.username,
    );
    expect(nextDaySettlement.pairMatches[0]?.rightUnit.unitEvent.sourceMember.username).toBe(
      d.username,
    );

    const walletAfter = await request(
      `/admin/ledger/wallets/users/${root.id}/INR`,
      authenticated(),
    );
    expect(walletAfter.status).toBe(200);
    expect(Number(walletAfter.body.balance)).toBe(50);
  });
});
