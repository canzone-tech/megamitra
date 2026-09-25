import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  PolicyLifecycle,
  ProgramBusinessEventType,
  ProgramEnrollmentStatus,
  ProgramIntervalUnit,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub lucky draw integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;

  const userIds: string[] = [];
  const programIds: string[] = [];
  const programVersionIds: string[] = [];
  const enrollmentIds: string[] = [];
  const businessEventIds: string[] = [];
  const runIds: string[] = [];
  const hookIds: string[] = [];
  const drawPolicyIds: string[] = [];
  const drawVersionIds: string[] = [];
  const drawIds: string[] = [];

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
    const username = `draw_admin_${suffix}`;
    const password = 'Lucky-Draw-Integration-Pass-123!';
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
      if (drawIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_winners WHERE drawId IN (${drawIds.map(() => '?').join(',')})`,
          ...drawIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_entries WHERE drawId IN (${drawIds.map(() => '?').join(',')})`,
          ...drawIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_instances WHERE id IN (${drawIds.map(() => '?').join(',')})`,
          ...drawIds,
        );
      }
      if (drawVersionIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_prize_tiers WHERE policyVersionId IN (${drawVersionIds.map(() => '?').join(',')})`,
          ...drawVersionIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_policy_versions WHERE id IN (${drawVersionIds.map(() => '?').join(',')})`,
          ...drawVersionIds,
        );
      }
      if (drawPolicyIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_policies WHERE id IN (${drawPolicyIds.map(() => '?').join(',')})`,
          ...drawPolicyIds,
        );
      }

      if (hookIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM program_draw_eligibility_hooks WHERE id IN (${hookIds.map(() => '?').join(',')})`,
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
      await prisma.programBusinessEvent.deleteMany({ where: { id: { in: businessEventIds } } });
      await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      await prisma.programVersion.deleteMany({ where: { id: { in: programVersionIds } } });
      await prisma.program.deleteMany({ where: { id: { in: programIds } } });
      await prisma.systemSequence.deleteMany({ where: { key: { startsWith: 'DRAW:' } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('freezes eligible hooks and produces deterministic immutable winners with configurable duplicate restrictions', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const entrants = await Promise.all(
      ['A', 'B', 'C'].map((label) =>
        prisma.user.create({
          data: {
            username: `draw_${label.toLowerCase()}_${suffix}`,
            passwordHash: 'integration-not-used',
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    userIds.push(...entrants.map((user) => user.id));

    const program = await prisma.program.create({
      data: { code: `DPG${suffix}`, name: `Draw program ${suffix}` },
    });
    programIds.push(program.id);
    const programVersion = await prisma.programVersion.create({
      data: {
        programId: program.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date(Date.now() - 86_400_000),
        currencyCode: 'INR',
        registrationFee: '0.00',
        installmentAmount: '0.00',
        installmentCount: 0,
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

    const enrollments = await Promise.all(
      entrants.map((user, index) =>
        prisma.programEnrollment.create({
          data: {
            sourceKey: `DRAW-ENROLL-${index}-${suffix}`,
            requestFingerprint: String(index + 1).repeat(64).slice(0, 64),
            userId: user.id,
            programVersionId: programVersion.id,
            enrolledAt: new Date(Date.now() - 180_000),
            enrollmentDate: '2026-09-23',
            status: ProgramEnrollmentStatus.ACTIVE,
            eligibilitySnapshot: { eligible: true },
            currencyCode: 'INR',
            registrationFeeSnapshot: '0.00',
            installmentAmountSnapshot: '0.00',
            installmentCountSnapshot: 0,
            gracePeriodDaysSnapshot: 0,
          },
        }),
      ),
    );
    enrollmentIds.push(...enrollments.map((row) => row.id));

    const createHook = async (userIndex: number, occurredAt: Date, label: string) => {
      const event = await prisma.programBusinessEvent.create({
        data: {
          sourceKey: `DRAW-EVENT-${label}-${suffix}`,
          type: ProgramBusinessEventType.ENROLLMENT_CREATED,
          enrollmentId: enrollments[userIndex].id,
          occurredAt,
          payload: { label },
        },
      });
      businessEventIds.push(event.id);
      const runId = randomUUID();
      runIds.push(runId);
      await prisma.$executeRawUnsafe(
        `INSERT INTO program_event_processing_runs
           (id, businessEventId, policyVersionId, status, eligible, eligibilitySnapshot,
            attempts, errorMessage, startedAt, completedAt, createdAt, updatedAt)
         VALUES (?, ?, NULL, 'PROCESSED', TRUE, ?, 1, NULL, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        runId,
        event.id,
        JSON.stringify({ eligible: true, label }),
        occurredAt,
        occurredAt,
      );
      const hookId = randomUUID();
      hookIds.push(hookId);
      await prisma.$executeRawUnsafe(
        `INSERT INTO program_draw_eligibility_hooks
           (id, sourceKey, runId, businessEventId, userId, programVersionId, status,
            eligibilitySnapshot, occurredAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'ELIGIBLE', ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        hookId,
        `DRAW-HOOK-${label}-${suffix}`,
        runId,
        event.id,
        entrants[userIndex].id,
        programVersion.id,
        JSON.stringify({ eligible: true, label, source: 'integration' }),
        occurredAt,
      );
      return hookId;
    };

    const now = Date.now();
    const firstStart = new Date(now - 180_000);
    const firstEnd = new Date(now - 120_000);
    const firstDrawAt = new Date(now - 90_000);
    await createHook(0, new Date(now - 170_000), 'FIRST-A1');
    await createHook(0, new Date(now - 165_000), 'FIRST-A2');
    await createHook(1, new Date(now - 160_000), 'FIRST-B');
    await createHook(2, new Date(now - 155_000), 'FIRST-C');

    const policy = await request(
      '/admin/lucky-draw-policies',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          code: `LD${suffix}`,
          name: `Lucky draw ${suffix}`,
        }),
      }),
    );
    expect(policy.status).toBe(201);
    const policyId = String(policy.body.id);
    drawPolicyIds.push(policyId);

    const version = await request(
      `/admin/lucky-draw-policies/${policyId}/versions`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          programVersionId: programVersion.id,
          effectiveFrom: new Date(now - 86_400_000).toISOString(),
          entryMode: 'ONE_PER_USER',
          priorWinnerMode: 'DISALLOW_WITHIN_POLICY',
          allowMultipleWinsPerDraw: false,
          insufficientEntrantsMode: 'DRAW_AVAILABLE',
          prizeTiers: [
            {
              code: 'FIRST',
              name: 'First prize',
              winnerCount: 1,
              prizeKind: 'ITEM',
              prizeDefinition: { testFixture: 'ITEM-A' },
            },
            {
              code: 'SECOND',
              name: 'Second prize',
              winnerCount: 1,
              prizeKind: 'CASH',
              cashAmount: '50.00',
              currencyCode: 'INR',
            },
          ],
        }),
      }),
    );
    expect(version.status).toBe(201);
    const versionId = String(version.body.id);
    drawVersionIds.push(versionId);
    expect(version.body.prizeTiers).toHaveLength(2);

    const published = await request(
      `/admin/lucky-draw-policies/versions/${versionId}/publish`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(published.status).toBe(201);
    expect(published.body.lifecycle).toBe('PUBLISHED');

    const immutable = await request(
      `/admin/lucky-draw-policies/versions/${versionId}`,
      authenticated({
        method: 'PATCH',
        body: JSON.stringify({ allowMultipleWinsPerDraw: true }),
      }),
    );
    expect(immutable.status).toBe(409);

    const firstSeed = `first-draw-seed-${suffix}`;
    const firstCommitment = createHash('sha256').update(firstSeed).digest('hex');
    const firstCreated = await request(
      '/admin/lucky-draws',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `DRAW-FIRST-${suffix}`,
          policyVersionId: versionId,
          entryWindowStart: firstStart.toISOString(),
          entryWindowEnd: firstEnd.toISOString(),
          drawAt: firstDrawAt.toISOString(),
          seedCommitment: firstCommitment,
        }),
      }),
    );
    expect(firstCreated.status).toBe(201);
    expect(firstCreated.body.idempotent).toBe(false);
    const firstDrawId = String(firstCreated.body.draw.id);
    drawIds.push(firstDrawId);

    const duplicateCreate = await request(
      '/admin/lucky-draws',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `DRAW-FIRST-${suffix}`,
          policyVersionId: versionId,
          entryWindowStart: firstStart.toISOString(),
          entryWindowEnd: firstEnd.toISOString(),
          drawAt: firstDrawAt.toISOString(),
          seedCommitment: firstCommitment,
        }),
      }),
    );
    expect(duplicateCreate.status).toBe(201);
    expect(duplicateCreate.body.idempotent).toBe(true);
    expect(duplicateCreate.body.draw.id).toBe(firstDrawId);

    const snapshot = await request(
      `/admin/lucky-draws/${firstDrawId}/snapshot`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(snapshot.status).toBe(201);
    expect(snapshot.body.idempotent).toBe(false);
    expect(snapshot.body.draw.status).toBe('SNAPSHOTTED');
    expect(Number(snapshot.body.draw.candidateCount)).toBe(4);
    expect(Number(snapshot.body.draw.eligibleEntryCount)).toBe(3);
    expect(Number(snapshot.body.draw.excludedEntryCount)).toBe(1);
    expect(snapshot.body.draw.entries.filter((row: any) => row.disposition === 'DUPLICATE_USER')).toHaveLength(1);
    expect(String(snapshot.body.draw.snapshotHash)).toHaveLength(64);

    const duplicateSnapshot = await request(
      `/admin/lucky-draws/${firstDrawId}/snapshot`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(duplicateSnapshot.status).toBe(201);
    expect(duplicateSnapshot.body.idempotent).toBe(true);

    const wrongSeed = await request(
      `/admin/lucky-draws/${firstDrawId}/execute`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ selectionSeed: `wrong-seed-${suffix}` }),
      }),
    );
    expect(wrongSeed.status).toBe(409);

    const executed = await request(
      `/admin/lucky-draws/${firstDrawId}/execute`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ selectionSeed: firstSeed }),
      }),
    );
    expect(executed.status).toBe(201);
    expect(executed.body.idempotent).toBe(false);
    expect(executed.body.draw.status).toBe('DRAWN');
    expect(executed.body.draw.selectionAlgorithm).toBe('SHA256_V1');
    expect(executed.body.draw.revealedSeed).toBe(firstSeed);
    expect(executed.body.draw.winners).toHaveLength(2);

    const eligibleEntries = executed.body.draw.entries.filter(
      (row: any) => row.disposition === 'ELIGIBLE',
    );
    const expectedOrder = eligibleEntries
      .map((entry: any) => ({
        userId: String(entry.userId),
        entrySequence: Number(entry.entrySequence),
        score: createHash('sha256')
          .update(
            [
              firstSeed,
              firstDrawId,
              String(executed.body.draw.snapshotHash),
              String(entry.entrySequence),
              String(entry.sourceHookId),
              String(entry.userId),
            ].join('|'),
          )
          .digest('hex'),
      }))
      .sort((left: any, right: any) =>
        left.score === right.score
          ? String(left.entrySequence).localeCompare(String(right.entrySequence))
          : left.score.localeCompare(right.score),
      )
      .slice(0, 2);
    expect(executed.body.draw.winners.map((winner: any) => winner.userId)).toEqual(
      expectedOrder.map((entry: any) => entry.userId),
    );
    expect(executed.body.draw.winners.map((winner: any) => winner.selectionScore)).toEqual(
      expectedOrder.map((entry: any) => entry.score),
    );

    const firstWinnerIds = executed.body.draw.winners.map((winner: any) => String(winner.userId));
    const duplicateExecution = await request(
      `/admin/lucky-draws/${firstDrawId}/execute`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ selectionSeed: firstSeed }),
      }),
    );
    expect(duplicateExecution.status).toBe(201);
    expect(duplicateExecution.body.idempotent).toBe(true);
    expect(duplicateExecution.body.draw.winners.map((winner: any) => winner.userId)).toEqual(
      firstWinnerIds,
    );

    const cannotVoidOutcome = await request(
      `/admin/lucky-draws/${firstDrawId}/void`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(cannotVoidOutcome.status).toBe(409);

    const secondStart = new Date(now - 80_000);
    const secondEnd = new Date(now - 45_000);
    const secondDrawAt = new Date(now - 20_000);
    await createHook(0, new Date(now - 70_000), 'SECOND-A');
    await createHook(1, new Date(now - 65_000), 'SECOND-B');
    await createHook(2, new Date(now - 60_000), 'SECOND-C');

    const secondSeed = `second-draw-seed-${suffix}`;
    const secondCommitment = createHash('sha256').update(secondSeed).digest('hex');
    const secondCreated = await request(
      '/admin/lucky-draws',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `DRAW-SECOND-${suffix}`,
          policyVersionId: versionId,
          entryWindowStart: secondStart.toISOString(),
          entryWindowEnd: secondEnd.toISOString(),
          drawAt: secondDrawAt.toISOString(),
          seedCommitment: secondCommitment,
        }),
      }),
    );
    expect(secondCreated.status).toBe(201);
    const secondDrawId = String(secondCreated.body.draw.id);
    drawIds.push(secondDrawId);

    const secondSnapshot = await request(
      `/admin/lucky-draws/${secondDrawId}/snapshot`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(secondSnapshot.status).toBe(201);
    expect(Number(secondSnapshot.body.draw.candidateCount)).toBe(3);
    expect(Number(secondSnapshot.body.draw.eligibleEntryCount)).toBe(1);
    expect(
      secondSnapshot.body.draw.entries.filter((row: any) => row.disposition === 'PRIOR_WINNER'),
    ).toHaveLength(2);

    const secondExecuted = await request(
      `/admin/lucky-draws/${secondDrawId}/execute`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ selectionSeed: secondSeed }),
      }),
    );
    expect(secondExecuted.status).toBe(201);
    expect(secondExecuted.body.draw.winners).toHaveLength(1);
    expect(firstWinnerIds).not.toContain(String(secondExecuted.body.draw.winners[0].userId));
    expect(secondExecuted.body.draw.winners[0].outcomeSnapshot).toBeDefined();
  });
});
