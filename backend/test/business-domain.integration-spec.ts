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

describe('MegaGoldenClub binary business-domain integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;
  const userIds: string[] = [];
  const planIds: string[] = [];
  const versionIds: string[] = [];
  const eventIds: string[] = [];

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
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
    const username = `domain_admin_${suffix}`;
    const password = 'Domain-Integration-Pass-123!';
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await passwords.hash(password),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

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
            { entityId: { in: [...userIds, ...planIds, ...versionIds, ...eventIds] } },
          ],
        },
      });
      await prisma.binaryUplineVolumeCredit.deleteMany({
        where: { volumeEventId: { in: eventIds } },
      });
      await prisma.binaryVolumeEvent.deleteMany({
        where: { id: { in: eventIds }, reversalOfEventId: { not: null } },
      });
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
        where: {
          OR: [{ memberUserId: { in: userIds } }, { parentUserId: { in: userIds } }],
        },
      });
      await prisma.sponsorRelationship.deleteMany({
        where: {
          OR: [{ memberUserId: { in: userIds } }, { sponsorUserId: { in: userIds } }],
        },
      });
      await prisma.binaryPlanVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.binaryPlan.deleteMany({ where: { id: { in: planIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('enforces 1:4 slots, keeps sponsor and placement graphs separate, and propagates reversible lane volume', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const users = await Promise.all(
      ['root', 'slot_a', 'slot_b', 'slot_c', 'slot_d', 'grand', 'overflow'].map((label) =>
        prisma.user.create({
          data: {
            username: `${label}_${suffix}`,
            passwordHash: 'integration-not-used',
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    const [root, slotA, slotB, slotC, slotD, grand, overflow] = users;

    for (const [memberUserId, sponsorUserId] of [
      [slotA.id, root.id],
      [slotC.id, root.id],
      [grand.id, slotA.id],
    ]) {
      const response = await request(
        '/admin/genealogy/sponsors',
        authenticated({ method: 'POST', body: JSON.stringify({ memberUserId, sponsorUserId }) }),
      );
      expect(response.status).toBe(201);
    }

    const placements = [
      { memberUserId: slotA.id, parentUserId: root.id, slot: 'A' },
      { memberUserId: slotB.id, parentUserId: root.id, slot: 'B' },
      { memberUserId: slotC.id, parentUserId: root.id, slot: 'C' },
      { memberUserId: slotD.id, parentUserId: root.id, slot: 'D' },
      { memberUserId: grand.id, parentUserId: slotA.id, slot: 'D' },
    ];
    for (const placement of placements) {
      const response = await request(
        '/admin/genealogy/placements',
        authenticated({ method: 'POST', body: JSON.stringify(placement) }),
      );
      expect(response.status).toBe(201);
    }

    const rootGenealogy = await request(`/admin/genealogy/members/${root.id}`, authenticated());
    expect(rootGenealogy.status).toBe(200);
    const rootChildren = rootGenealogy.body.binaryChildren as Array<{
      slot: 'A' | 'B' | 'C' | 'D';
      side: BinaryPlacementSide;
    }>;
    expect(rootChildren.map((child) => child.slot)).toEqual(['A', 'B', 'C', 'D']);
    expect(rootChildren.map((child) => child.side)).toEqual([
      BinaryPlacementSide.LEFT,
      BinaryPlacementSide.LEFT,
      BinaryPlacementSide.RIGHT,
      BinaryPlacementSide.RIGHT,
    ]);

    const occupied = await request(
      '/admin/genealogy/placements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          memberUserId: overflow.id,
          parentUserId: root.id,
          slot: 'A',
        }),
      }),
    );
    expect(occupied.status).toBe(409);

    const cycle = await request(
      '/admin/genealogy/placements',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          memberUserId: root.id,
          parentUserId: grand.id,
          slot: 'A',
        }),
      }),
    );
    expect(cycle.status).toBe(400);

    const genealogy = await request(`/admin/genealogy/members/${grand.id}`, authenticated());
    expect(genealogy.status).toBe(200);
    const ancestors = genealogy.body.binaryDescendantLinks as Array<{
      depth: number;
      firstLegSide: BinaryPlacementSide;
      firstLegSlot: 'A' | 'B' | 'C' | 'D';
    }>;
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]).toMatchObject({
      depth: 1,
      firstLegSide: BinaryPlacementSide.RIGHT,
      firstLegSlot: 'D',
    });
    expect(ancestors[1]).toMatchObject({
      depth: 2,
      firstLegSide: BinaryPlacementSide.LEFT,
      firstLegSlot: 'A',
    });

    const plan = await request(
      '/admin/binary-plans',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ code: `IT${suffix}`, name: `Integration ${suffix}` }),
      }),
    );
    expect(plan.status).toBe(201);
    const planId = String(plan.body.id);
    planIds.push(planId);

    const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
    const draft = await request(
      `/admin/binary-plans/${planId}/versions`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom,
          qualifyingUnit: '1.0000',
          leftVolumePerPair: '1.0000',
          rightVolumePerPair: '1.0000',
          pairPayoutAmount: '0.00',
          currencyCode: 'INR',
          settlementTimezone: 'Asia/Kolkata',
          capOverflowMode: BinaryCapOverflowMode.CARRY,
          carryForwardEnabled: true,
          qualificationRules: {
            model: '1:4',
            placementSlots: { A: 'LEFT', B: 'LEFT', C: 'RIGHT', D: 'RIGHT' },
            pairLanes: [
              ['A', 'C'],
              ['B', 'D'],
            ],
          },
          settlementRules: { test: true },
        }),
      }),
    );
    expect(draft.status).toBe(201);
    const versionId = String(draft.body.id);
    versionIds.push(versionId);

    const updated = await request(
      `/admin/binary-plans/versions/${versionId}`,
      authenticated({ method: 'PATCH', body: JSON.stringify({ pairPayoutAmount: '12.50' }) }),
    );
    expect(updated.status).toBe(200);

    const published = await request(
      `/admin/binary-plans/versions/${versionId}/publish`,
      authenticated({ method: 'POST' }),
    );
    expect(published.status).toBe(201);
    expect(published.body.lifecycle).toBe('PUBLISHED');

    const immutable = await request(
      `/admin/binary-plans/versions/${versionId}`,
      authenticated({ method: 'PATCH', body: JSON.stringify({ pairPayoutAmount: '99.00' }) }),
    );
    expect(immutable.status).toBe(409);

    const sourceKey = `integration-volume-${suffix}`;
    const volume = await request(
      '/admin/binary-volume/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          sourceMemberUserId: grand.id,
          planVersionId: versionId,
          eventType: BinaryVolumeEventType.CREDIT,
          volume: '2.5000',
          occurredAt: new Date().toISOString(),
        }),
      }),
    );
    expect(volume.status).toBe(201);
    const volumeEvent = volume.body.event as {
      id: string;
      uplineCredits: Array<{
        ancestorUserId: string;
        depth: number;
        side: BinaryPlacementSide;
        volume: string;
      }>;
    };
    eventIds.push(volumeEvent.id);
    expect(volumeEvent.uplineCredits).toHaveLength(2);
    expect(volumeEvent.uplineCredits[0]).toMatchObject({
      ancestorUserId: slotA.id,
      depth: 1,
      side: BinaryPlacementSide.RIGHT,
    });
    expect(volumeEvent.uplineCredits[1]).toMatchObject({
      ancestorUserId: root.id,
      depth: 2,
      side: BinaryPlacementSide.LEFT,
    });

    const duplicate = await request(
      '/admin/binary-volume/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          sourceMemberUserId: grand.id,
          planVersionId: versionId,
          eventType: BinaryVolumeEventType.CREDIT,
          volume: '2.5000',
          occurredAt: (volume.body.event as { occurredAt: string }).occurredAt,
        }),
      }),
    );
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.idempotent).toBe(true);

    const reversal = await request(
      `/admin/binary-volume/events/${volumeEvent.id}/reversal`,
      authenticated({ method: 'POST', body: JSON.stringify({ sourceKey: `${sourceKey}-reversal` }) }),
    );
    expect(reversal.status).toBe(201);
    const reversalEvent = reversal.body.event as {
      id: string;
      uplineCredits: Array<{ volume: string }>;
    };
    eventIds.push(reversalEvent.id);
    expect(reversalEvent.uplineCredits).toHaveLength(2);
    expect(Number(reversalEvent.uplineCredits[0].volume)).toBeLessThan(0);

    const secondReversal = await request(
      `/admin/binary-volume/events/${volumeEvent.id}/reversal`,
      authenticated({ method: 'POST', body: JSON.stringify({ sourceKey: `${sourceKey}-reversal-2` }) }),
    );
    expect(secondReversal.status).toBe(409);

    const retired = await request(
      `/admin/binary-plans/versions/${versionId}/retire`,
      authenticated({ method: 'POST' }),
    );
    expect(retired.status).toBe(201);
    expect(retired.body.lifecycle).toBe('RETIRED');

    const afterRetirement = await request(
      '/admin/binary-volume/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `${sourceKey}-after-retire`,
          sourceMemberUserId: grand.id,
          planVersionId: versionId,
          eventType: BinaryVolumeEventType.CREDIT,
          volume: '1.0000',
          occurredAt: new Date().toISOString(),
        }),
      }),
    );
    expect(afterRetirement.status).toBe(409);
  });
});
