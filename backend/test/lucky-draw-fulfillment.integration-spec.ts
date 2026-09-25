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

describe('MegaGoldenClub lucky draw prize fulfillment integration', () => {
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
    const username = `draw_fulfillment_admin_${suffix}`;
    const password = 'Lucky-Draw-Fulfillment-Pass-123!';
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
          `DELETE FROM lucky_draw_prize_fulfillment_reversals
           WHERE fulfillmentId IN (
             SELECT id FROM lucky_draw_prize_fulfillments
             WHERE claimId IN (
               SELECT id FROM lucky_draw_prize_claims
               WHERE drawId IN (${drawIds.map(() => '?').join(',')})
             )
           )`,
          ...drawIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_prize_fulfillments
           WHERE claimId IN (
             SELECT id FROM lucky_draw_prize_claims
             WHERE drawId IN (${drawIds.map(() => '?').join(',')})
           )`,
          ...drawIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_prize_claim_events
           WHERE claimId IN (
             SELECT id FROM lucky_draw_prize_claims
             WHERE drawId IN (${drawIds.map(() => '?').join(',')})
           )`,
          ...drawIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_prize_claims WHERE drawId IN (${drawIds.map(() => '?').join(',')})`,
          ...drawIds,
        );
      }

      if (ledgerTransactionIds.length > 0) {
        await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerTransactionIds } } });
        await prisma.ledgerTransaction.deleteMany({ where: { id: { in: ledgerTransactionIds } } });
      }
      await prisma.$executeRawUnsafe(
        `DELETE FROM ledger_accounts
         WHERE code = 'LUCKY_DRAW_PRIZE_EXPENSE:INR'
            OR ownerUserId IN (${userIds.map(() => '?').join(',') || "''"})`,
        ...userIds,
      );

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
          `DELETE FROM lucky_draw_fulfillment_rules WHERE policyVersionId IN (${drawVersionIds.map(() => '?').join(',')})`,
          ...drawVersionIds,
        );
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
      await prisma.systemSequence.deleteMany({
        where: {
          OR: [
            { key: { startsWith: 'DRAW:' } },
            { key: { startsWith: 'LUCKY_DRAW_CLAIM:' } },
            { key: { startsWith: 'LUCKY_DRAW_FULFILLMENT:' } },
          ],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('separates immutable draw outcomes from cash and non-cash prize fulfillment and reversals', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const winners = await Promise.all(
      ['cash', 'item'].map((label) =>
        prisma.user.create({
          data: {
            username: `fulfillment_${label}_${suffix}`,
            passwordHash: 'integration-not-used',
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    userIds.push(...winners.map((user) => user.id));

    const program = await prisma.program.create({
      data: { code: `FPG${suffix}`, name: `Fulfillment program ${suffix}` },
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
      winners.map((user, index) =>
        prisma.programEnrollment.create({
          data: {
            sourceKey: `FULFILL-ENROLL-${index}-${suffix}`,
            requestFingerprint: `${index + 4}`.repeat(64).slice(0, 64),
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

    const now = Date.now();
    const entryStart = new Date(now - 180_000);
    const entryEnd = new Date(now - 120_000);
    const drawAt = new Date(now - 90_000);
    for (let index = 0; index < winners.length; index += 1) {
      const occurredAt = new Date(now - 170_000 + index * 5_000);
      const event = await prisma.programBusinessEvent.create({
        data: {
          sourceKey: `FULFILL-EVENT-${index}-${suffix}`,
          type: ProgramBusinessEventType.ENROLLMENT_CREATED,
          enrollmentId: enrollments[index].id,
          occurredAt,
          payload: { index },
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
        JSON.stringify({ eligible: true, index }),
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
        `FULFILL-HOOK-${index}-${suffix}`,
        runId,
        event.id,
        winners[index].id,
        programVersion.id,
        JSON.stringify({ eligible: true, index }),
        occurredAt,
      );
    }

    const policy = await request(
      '/admin/lucky-draw-policies',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ code: `LDF${suffix}`, name: `Fulfillment draw ${suffix}` }),
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
          priorWinnerMode: 'ALLOW',
          allowMultipleWinsPerDraw: false,
          insufficientEntrantsMode: 'REQUIRE_FULL',
          prizeTiers: [
            {
              code: 'CASH',
              name: 'Cash prize',
              winnerCount: 1,
              prizeKind: 'CASH',
              cashAmount: '25.00',
              currencyCode: 'INR',
            },
            {
              code: 'ITEM',
              name: 'Item prize',
              winnerCount: 1,
              prizeKind: 'ITEM',
              prizeDefinition: { sku: 'TEST-ITEM', testFixture: true },
            },
          ],
        }),
      }),
    );
    expect(version.status).toBe(201);
    const versionId = String(version.body.id);
    drawVersionIds.push(versionId);

    const rule = await request(
      `/admin/lucky-draw-fulfillment/policy-versions/${versionId}/rule`,
      authenticated({ method: 'POST', body: JSON.stringify({ claimWindowDays: 30 }) }),
    );
    expect(rule.status).toBe(201);
    expect(Number(rule.body.claimWindowDays)).toBe(30);

    const published = await request(
      `/admin/lucky-draw-policies/versions/${versionId}/publish`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(published.status).toBe(201);

    const immutableRule = await request(
      `/admin/lucky-draw-fulfillment/policy-versions/${versionId}/rule`,
      authenticated({ method: 'POST', body: JSON.stringify({ claimWindowDays: 1 }) }),
    );
    expect(immutableRule.status).toBe(409);

    const seed = `fulfillment-seed-${suffix}`;
    const commitment = createHash('sha256').update(seed).digest('hex');
    const created = await request(
      '/admin/lucky-draws',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `FULFILL-DRAW-${suffix}`,
          policyVersionId: versionId,
          entryWindowStart: entryStart.toISOString(),
          entryWindowEnd: entryEnd.toISOString(),
          drawAt: drawAt.toISOString(),
          seedCommitment: commitment,
        }),
      }),
    );
    expect(created.status).toBe(201);
    const drawId = String(created.body.draw.id);
    drawIds.push(drawId);

    expect(
      (
        await request(
          `/admin/lucky-draws/${drawId}/snapshot`,
          authenticated({ method: 'POST', body: '{}' }),
        )
      ).status,
    ).toBe(201);
    const executed = await request(
      `/admin/lucky-draws/${drawId}/execute`,
      authenticated({ method: 'POST', body: JSON.stringify({ selectionSeed: seed }) }),
    );
    expect(executed.status).toBe(201);
    expect(executed.body.draw.winners).toHaveLength(2);

    const claimsInitialized = await request(
      `/admin/lucky-draw-fulfillment/draws/${drawId}/claims/initialize`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(claimsInitialized.status).toBe(201);
    expect(claimsInitialized.body.winnerCount).toBe(2);
    expect(claimsInitialized.body.claimsCreated).toBe(2);
    expect(claimsInitialized.body.claims).toHaveLength(2);

    const duplicateInitialization = await request(
      `/admin/lucky-draw-fulfillment/draws/${drawId}/claims/initialize`,
      authenticated({ method: 'POST', body: '{}' }),
    );
    expect(duplicateInitialization.status).toBe(201);
    expect(duplicateInitialization.body.claimsCreated).toBe(0);

    const cashClaim = claimsInitialized.body.claims.find((claim: any) => claim.prizeKind === 'CASH');
    const itemClaim = claimsInitialized.body.claims.find((claim: any) => claim.prizeKind === 'ITEM');
    expect(cashClaim).toBeDefined();
    expect(itemClaim).toBeDefined();
    expect(Number(cashClaim.cashAmount)).toBe(25);
    expect(cashClaim.currencyCode).toBe('INR');

    const claimAt = new Date(now + 1_000).toISOString();
    const cashClaimed = await request(
      `/admin/lucky-draw-fulfillment/claims/${cashClaim.id}/claim`,
      authenticated({ method: 'POST', body: JSON.stringify({ occurredAt: claimAt }) }),
    );
    expect(cashClaimed.status).toBe(201);
    expect(cashClaimed.body.claim.status).toBe('CLAIMED');

    const duplicateCashClaim = await request(
      `/admin/lucky-draw-fulfillment/claims/${cashClaim.id}/claim`,
      authenticated({ method: 'POST', body: JSON.stringify({ occurredAt: claimAt }) }),
    );
    expect(duplicateCashClaim.status).toBe(201);
    expect(duplicateCashClaim.body.idempotent).toBe(true);

    const fulfillAt = new Date(now + 2_000).toISOString();
    const cashSourceKey = `CASH-FULFILL-${suffix}`;
    const cashFulfilled = await request(
      `/admin/lucky-draw-fulfillment/claims/${cashClaim.id}/fulfill`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ sourceKey: cashSourceKey, occurredAt: fulfillAt }),
      }),
    );
    expect(cashFulfilled.status).toBe(201);
    expect(cashFulfilled.body.claim.status).toBe('FULFILLED');
    expect(cashFulfilled.body.fulfillment.fulfillmentType).toBe('CASH_LEDGER');
    expect(cashFulfilled.body.fulfillment.ledgerTransactionId).toBeTruthy();
    const cashFulfillmentId = String(cashFulfilled.body.fulfillment.id);
    const payoutLedgerId = String(cashFulfilled.body.fulfillment.ledgerTransactionId);
    ledgerTransactionIds.push(payoutLedgerId);

    const duplicateCashFulfillment = await request(
      `/admin/lucky-draw-fulfillment/claims/${cashClaim.id}/fulfill`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({ sourceKey: cashSourceKey, occurredAt: fulfillAt }),
      }),
    );
    expect(duplicateCashFulfillment.status).toBe(201);
    expect(duplicateCashFulfillment.body.idempotent).toBe(true);

    const payoutLedger = await request(
      `/admin/ledger/transactions/${payoutLedgerId}`,
      authenticated(),
    );
    expect(payoutLedger.status).toBe(200);
    expect(payoutLedger.body.balanced).toBe(true);
    expect(Number(payoutLedger.body.debitTotal)).toBe(25);
    expect(Number(payoutLedger.body.creditTotal)).toBe(25);

    const cashWinnerUserId = String(cashClaim.userId);
    const walletBeforeReversal = await request(
      `/admin/ledger/wallets/users/${cashWinnerUserId}/INR`,
      authenticated(),
    );
    expect(walletBeforeReversal.status).toBe(200);
    expect(Number(walletBeforeReversal.body.balance)).toBe(25);

    const reversalAt = new Date(now + 3_000).toISOString();
    const reversalSourceKey = `CASH-REVERSAL-${suffix}`;
    const reversed = await request(
      `/admin/lucky-draw-fulfillment/fulfillments/${cashFulfillmentId}/reverse`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: reversalSourceKey,
          occurredAt: reversalAt,
          reason: 'integration reversal',
        }),
      }),
    );
    expect(reversed.status).toBe(201);
    expect(reversed.body.fulfillment.id).toBe(cashFulfillmentId);
    expect(reversed.body.reversal.ledgerTransactionId).toBeTruthy();
    const reversalLedgerId = String(reversed.body.reversal.ledgerTransactionId);
    ledgerTransactionIds.push(reversalLedgerId);

    const duplicateReversal = await request(
      `/admin/lucky-draw-fulfillment/fulfillments/${cashFulfillmentId}/reverse`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: reversalSourceKey,
          occurredAt: reversalAt,
          reason: 'integration reversal',
        }),
      }),
    );
    expect(duplicateReversal.status).toBe(201);
    expect(duplicateReversal.body.idempotent).toBe(true);

    const walletAfterReversal = await request(
      `/admin/ledger/wallets/users/${cashWinnerUserId}/INR`,
      authenticated(),
    );
    expect(Number(walletAfterReversal.body.balance)).toBe(0);

    const originalPayoutStillExists = await request(
      `/admin/ledger/transactions/${payoutLedgerId}`,
      authenticated(),
    );
    expect(originalPayoutStillExists.status).toBe(200);
    expect(originalPayoutStillExists.body.balanced).toBe(true);

    const cashClaimAfterReversal = await request(
      `/admin/lucky-draw-fulfillment/claims/${cashClaim.id}`,
      authenticated(),
    );
    expect(cashClaimAfterReversal.body.status).toBe('CANCELLED');
    expect(cashClaimAfterReversal.body.events.map((event: any) => event.eventType)).toEqual(
      expect.arrayContaining(['CREATED', 'CLAIMED', 'FULFILLED', 'FULFILLMENT_REVERSED']),
    );

    const itemClaimAt = new Date(now + 4_000).toISOString();
    const itemClaimed = await request(
      `/admin/lucky-draw-fulfillment/claims/${itemClaim.id}/claim`,
      authenticated({ method: 'POST', body: JSON.stringify({ occurredAt: itemClaimAt }) }),
    );
    expect(itemClaimed.status).toBe(201);
    expect(itemClaimed.body.claim.status).toBe('CLAIMED');

    const itemMissingReference = await request(
      `/admin/lucky-draw-fulfillment/claims/${itemClaim.id}/fulfill`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `ITEM-MISSING-${suffix}`,
          occurredAt: new Date(now + 5_000).toISOString(),
        }),
      }),
    );
    expect(itemMissingReference.status).toBe(400);

    const itemFulfilled = await request(
      `/admin/lucky-draw-fulfillment/claims/${itemClaim.id}/fulfill`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `ITEM-FULFILL-${suffix}`,
          occurredAt: new Date(now + 6_000).toISOString(),
          externalReference: `SHIPMENT-${suffix}`,
          metadata: { carrier: 'integration-fixture' },
        }),
      }),
    );
    expect(itemFulfilled.status).toBe(201);
    expect(itemFulfilled.body.claim.status).toBe('FULFILLED');
    expect(itemFulfilled.body.fulfillment.fulfillmentType).toBe('NON_CASH');
    expect(itemFulfilled.body.fulfillment.ledgerTransactionId).toBeNull();
    expect(itemFulfilled.body.fulfillment.externalReference).toBe(`SHIPMENT-${suffix}`);

    const finalDraw = await request(`/admin/lucky-draws/${drawId}`, authenticated());
    expect(finalDraw.status).toBe(200);
    expect(finalDraw.body.status).toBe('DRAWN');
    expect(finalDraw.body.winners).toHaveLength(2);
  });
});
