import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { generateLuckyDrawToken } from '../src/lucky-draw/lucky-draw-token.util';
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

describe('MegaGoldenClub owner lucky draw workflow integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let adminToken: string;
  let memberToken: string;
  let adminId = '';
  let memberId = '';
  let externalMemberId = '';
  let externalEnrollmentId = '';
  let externalInstallmentToken = '';
  let secondPrizeCode = '';
  let seasonId = '';
  let seasonCode = '';
  let programId = '';
  let programVersionId = '';
  let enrollmentId = '';
  let businessEventId = '';
  let processingRunId = '';
  let hookId = '';
  let drawRunId = '';
  let drawId = '';
  let drawPolicyId = '';
  let drawPolicyVersionId = '';
  let installmentToken = '';
  let futureInstallmentToken = '';
  let secondDrawRunId = '';
  let secondDrawId = '';
  let secondDrawPolicyId = '';
  let secondDrawPolicyVersionId = '';

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
      body: (await response.json()) as Record<string, any>,
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

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const password = 'Owner-Draw-Workflow-Pass-123!';
    const passwordHash = await passwords.hash(password);
    const [admin, member, externalMember] = await Promise.all([
      prisma.user.create({
        data: {
          username: `owner_flow_admin_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `owner_flow_member_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `owner_flow_external_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    adminId = admin.id;
    memberId = member.id;
    externalMemberId = externalMember.id;
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdmin.id } });
    [adminToken, memberToken] = await Promise.all([
      login(admin.username, password),
      login(member.username, password),
    ]);

    programId = randomUUID();
    await prisma.program.create({
      data: {
        id: programId,
        code: `OWP${suffix}`,
        name: `Owner workflow program ${suffix}`,
      },
    });
    const programVersion = await prisma.programVersion.create({
      data: {
        programId,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date('2025-12-01T00:00:00.000Z'),
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
        publishedAt: new Date('2025-12-01T00:00:00.000Z'),
      },
    });
    programVersionId = programVersion.id;

    const enrollment = await prisma.programEnrollment.create({
      data: {
        sourceKey: `OWNER-FLOW-ENROLL-${suffix}`,
        requestFingerprint: 'a'.repeat(64),
        userId: member.id,
        programVersionId,
        enrolledAt: new Date('2026-01-02T00:00:00.000Z'),
        enrollmentDate: '2026-01-02',
        status: ProgramEnrollmentStatus.ACTIVE,
        eligibilitySnapshot: { eligible: true, source: 'owner-workflow-uat' },
        currencyCode: 'INR',
        registrationFeeSnapshot: '0.00',
        installmentAmountSnapshot: '0.00',
        installmentCountSnapshot: 0,
        gracePeriodDaysSnapshot: 0,
      },
    });
    enrollmentId = enrollment.id;

    const externalEnrollment = await prisma.programEnrollment.create({
      data: {
        sourceKey: `OWNER-FLOW-EXTERNAL-ENROLL-${suffix}`,
        requestFingerprint: 'b'.repeat(64),
        userId: externalMember.id,
        programVersionId,
        enrolledAt: new Date('2026-01-02T00:00:00.000Z'),
        enrollmentDate: '2026-01-02',
        status: ProgramEnrollmentStatus.ACTIVE,
        eligibilitySnapshot: { eligible: true, source: 'owner-workflow-external-uat' },
        currencyCode: 'INR',
        registrationFeeSnapshot: '0.00',
        installmentAmountSnapshot: '0.00',
        installmentCountSnapshot: 0,
        gracePeriodDaysSnapshot: 0,
      },
    });
    externalEnrollmentId = externalEnrollment.id;

    const occurredAt = new Date('2026-01-10T06:00:00.000Z');
    const businessEvent = await prisma.programBusinessEvent.create({
      data: {
        sourceKey: `OWNER-FLOW-EVENT-${suffix}`,
        type: ProgramBusinessEventType.ENROLLMENT_CREATED,
        enrollmentId,
        occurredAt,
        payload: { source: 'owner-workflow-uat' },
      },
    });
    businessEventId = businessEvent.id;
    processingRunId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_event_processing_runs
         (id, businessEventId, policyVersionId, status, eligible, eligibilitySnapshot,
          attempts, errorMessage, startedAt, completedAt, createdAt, updatedAt)
       VALUES (?, ?, NULL, 'PROCESSED', TRUE, ?, 1, NULL, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      processingRunId,
      businessEventId,
      JSON.stringify({ eligible: true, source: 'owner-workflow-uat' }),
      occurredAt,
      occurredAt,
    );
    hookId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_draw_eligibility_hooks
         (id, sourceKey, runId, businessEventId, userId, programVersionId, status,
          eligibilitySnapshot, occurredAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'ELIGIBLE', ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      hookId,
      `OWNER-FLOW-HOOK-${suffix}`,
      processingRunId,
      businessEventId,
      member.id,
      programVersionId,
      JSON.stringify({ eligible: true, source: 'legacy-hook-must-not-drive-owner-draw' }),
      occurredAt,
    );

    const createInstallmentToken = async (
      userId: string,
      tokenEnrollmentId: string,
      sequence: number,
    ) => {
      for (let attempt = 0; attempt < 128; attempt += 1) {
        const candidate = generateLuckyDrawToken();
        const existing = await prisma.$queryRawUnsafe<Array<{ token: string }>>(
          'SELECT token FROM lucky_draw_tokens WHERE token=? LIMIT 1',
          candidate,
        );
        if (existing[0]) continue;
        await prisma.$executeRawUnsafe(
          `INSERT INTO lucky_draw_tokens
             (token, sourceType, userId, enrollmentId, installmentSequence, status, createdAt)
           VALUES (?, 'INSTALLMENT', ?, ?, ?, 'AVAILABLE', ?)`,
          candidate,
          userId,
          tokenEnrollmentId,
          sequence,
          occurredAt,
        );
        return candidate;
      }
      throw new Error('Unable to allocate token test fixture');
    };
    installmentToken = await createInstallmentToken(member.id, enrollmentId, 1);
    futureInstallmentToken = await createInstallmentToken(member.id, enrollmentId, 2);
    externalInstallmentToken = await createInstallmentToken(
      externalMember.id,
      externalEnrollmentId,
      2,
    );

    seasonId = randomUUID();
    seasonCode = `OWS${suffix}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_seasons
         (id, code, name, status, startDate, drawDay, eligibilityCutoff,
          programId, programVersionId, createdByUserId)
       VALUES (?, ?, ?, 'ACTIVE', ?, 25, 'BEFORE_DRAW_DATE', ?, ?, ?)`,
      seasonId,
      seasonCode,
      `Owner workflow season ${suffix}`,
      new Date('2026-01-01T00:00:00.000Z'),
      programId,
      programVersionId,
      admin.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_season_prizes
         (id, seasonId, monthNumber, prizeCode, category, name, winnerCount, currencyCode)
       VALUES
         (?, ?, 1, ?, 'UAT', 'January Workflow Prize', 1, 'INR'),
         (?, ?, 2, ?, 'UAT', 'February Workflow Prize', 1, 'INR')`,
      randomUUID(),
      seasonId,
      `JAN${suffix}`,
      randomUUID(),
      seasonId,
      `FEB${suffix}`,
    );
    secondPrizeCode = `FEB${suffix}`;
  });

  afterAll(async () => {
    if (prisma) {
      const userIds = [adminId, memberId, externalMemberId].filter(Boolean);
      if (userIds.length) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
      }

      if (installmentToken || futureInstallmentToken || externalInstallmentToken) {
        const tokens = [installmentToken, futureInstallmentToken, externalInstallmentToken].filter(Boolean);
        await prisma.$executeRawUnsafe(
          `DELETE FROM lucky_draw_tokens WHERE token IN (${tokens.map(() => '?').join(',')})`,
          ...tokens,
        );
      }

      if (secondDrawId) {
        await prisma.$executeRawUnsafe('DELETE FROM owner_winner_verifications WHERE drawRunId = ?', secondDrawRunId);
        await prisma.$executeRawUnsafe('DELETE FROM owner_draw_runs WHERE id = ?', secondDrawRunId);
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_winners WHERE drawId = ?', secondDrawId);
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_entries WHERE drawId = ?', secondDrawId);
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_instances WHERE id = ?', secondDrawId);
      }
      if (secondDrawPolicyVersionId) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM lucky_draw_fulfillment_rules WHERE policyVersionId = ?',
          secondDrawPolicyVersionId,
        );
        await prisma.$executeRawUnsafe(
          'DELETE FROM lucky_draw_prize_tiers WHERE policyVersionId = ?',
          secondDrawPolicyVersionId,
        );
        await prisma.$executeRawUnsafe(
          'DELETE FROM lucky_draw_policy_versions WHERE id = ?',
          secondDrawPolicyVersionId,
        );
      }
      if (secondDrawPolicyId) {
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_policies WHERE id = ?', secondDrawPolicyId);
      }

      if (drawId) {
        const claims = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT id FROM lucky_draw_prize_claims WHERE drawId = ?',
          drawId,
        );
        const claimIds = claims.map((row) => row.id);
        if (claimIds.length) {
          await prisma.$executeRawUnsafe(
            `DELETE FROM lucky_draw_prize_claim_events WHERE claimId IN (${claimIds.map(() => '?').join(',')})`,
            ...claimIds,
          );
          await prisma.$executeRawUnsafe(
            `DELETE FROM lucky_draw_prize_fulfillment_reversals WHERE fulfillmentId IN (
               SELECT id FROM lucky_draw_prize_fulfillments WHERE claimId IN (${claimIds.map(() => '?').join(',')})
             )`,
            ...claimIds,
          );
          await prisma.$executeRawUnsafe(
            `DELETE FROM lucky_draw_prize_fulfillments WHERE claimId IN (${claimIds.map(() => '?').join(',')})`,
            ...claimIds,
          );
          await prisma.$executeRawUnsafe(
            `DELETE FROM lucky_draw_prize_claims WHERE id IN (${claimIds.map(() => '?').join(',')})`,
            ...claimIds,
          );
        }
        await prisma.$executeRawUnsafe('DELETE FROM owner_winner_verifications WHERE drawRunId = ?', drawRunId);
        await prisma.$executeRawUnsafe('DELETE FROM owner_draw_runs WHERE id = ?', drawRunId);
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_winners WHERE drawId = ?', drawId);
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_entries WHERE drawId = ?', drawId);
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_instances WHERE id = ?', drawId);
      }

      if (drawPolicyVersionId) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM lucky_draw_fulfillment_rules WHERE policyVersionId = ?',
          drawPolicyVersionId,
        );
        await prisma.$executeRawUnsafe(
          'DELETE FROM lucky_draw_prize_tiers WHERE policyVersionId = ?',
          drawPolicyVersionId,
        );
        await prisma.$executeRawUnsafe(
          'DELETE FROM lucky_draw_policy_versions WHERE id = ?',
          drawPolicyVersionId,
        );
      }
      if (drawPolicyId) {
        await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_policies WHERE id = ?', drawPolicyId);
      }

      if (hookId) {
        await prisma.$executeRawUnsafe('DELETE FROM program_draw_eligibility_hooks WHERE id = ?', hookId);
      }
      if (processingRunId) {
        await prisma.$executeRawUnsafe('DELETE FROM program_event_processing_runs WHERE id = ?', processingRunId);
      }
      if (businessEventId) {
        await prisma.programBusinessEvent.deleteMany({ where: { id: businessEventId } });
      }
      if (enrollmentId) {
        await prisma.programEnrollment.deleteMany({ where: { id: enrollmentId } });
      }
      if (externalEnrollmentId) {
        await prisma.programEnrollment.deleteMany({ where: { id: externalEnrollmentId } });
      }
      if (seasonId) {
        await prisma.$executeRawUnsafe('DELETE FROM owner_season_prizes WHERE seasonId = ?', seasonId);
        await prisma.$executeRawUnsafe('DELETE FROM owner_seasons WHERE id = ?', seasonId);
      }
      if (programVersionId) {
        await prisma.programVersion.deleteMany({ where: { id: programVersionId } });
      }
      if (programId) {
        await prisma.program.deleteMany({ where: { id: programId } });
      }
      await prisma.systemSequence.deleteMany({ where: { key: { startsWith: 'DRAW:' } } });
      if (userIds.length) {
        await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    }
    await app?.close();
  });

  it('keeps failed verification reviewable and completes publish, claim, and fulfilment after correction', async () => {
    const prepared = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          monthNumber: 1,
          entryWindowStart: '2026-01-01T00:00:00+05:30',
          entryWindowEnd: '2026-01-17T23:00:00+05:30',
          drawAt: '2026-01-18T10:00:00+05:30',
          claimWindowDays: 36500,
        }),
      },
    );
    expect(prepared.status).toBe(201);
    expect(prepared.body.status).toBe('SCHEDULED');
    drawRunId = String(prepared.body.id);
    drawId = String(prepared.body.drawId);
    drawPolicyId = String(prepared.body.policyId);
    drawPolicyVersionId = String(prepared.body.policyVersionId);

    const memberDenied = await request(
      `/admin/owner-portal/draws/${drawRunId}/lock-eligibility`,
      memberToken,
      { method: 'POST', body: '{}' },
    );
    expect(memberDenied.status).toBe(403);

    const locked = await request(
      `/admin/owner-portal/draws/${drawRunId}/lock-eligibility`,
      adminToken,
      { method: 'POST', body: '{}' },
    );
    expect(locked.status).toBe(201);
    expect(locked.body.status).toBe('ELIGIBILITY_LOCKED');
    expect(Number(locked.body.eligibleEntryCount)).toBe(1);

    const firstEntries = await prisma.$queryRawUnsafe<
      Array<{ sourceHookId: string | null; drawToken: string | null }>
    >(
      'SELECT sourceHookId, drawToken FROM lucky_draw_entries WHERE drawId=? AND disposition=\'ELIGIBLE\'',
      drawId,
    );
    expect(firstEntries).toHaveLength(1);
    expect(firstEntries[0]?.sourceHookId).toBeNull();
    expect(firstEntries[0]?.drawToken).toBe(installmentToken);

    const tokenStates = await prisma.$queryRawUnsafe<
      Array<{ token: string; status: string; drawId: string | null }>
    >(
      'SELECT token, status, drawId FROM lucky_draw_tokens WHERE token IN (?, ?) ORDER BY installmentSequence',
      installmentToken,
      futureInstallmentToken,
    );
    expect(tokenStates).toEqual([
      expect.objectContaining({ token: installmentToken, status: 'USED', drawId }),
      expect.objectContaining({ token: futureInstallmentToken, status: 'AVAILABLE', drawId: null }),
    ]);

    const selected = await request(
      `/admin/owner-portal/draws/${drawRunId}/select-winners`,
      adminToken,
      { method: 'POST', body: '{}' },
    );
    expect(selected.status).toBe(201);
    expect(selected.body.status).toBe('SELECTED');
    expect(selected.body.winners).toHaveLength(1);
    expect(selected.body.winners[0].verificationStatus).toBe('PENDING');
    const winnerId = String(selected.body.winners[0].id);

    const secondPrepared = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          monthNumber: 2,
          entryWindowStart: '2026-01-18T10:01:00+05:30',
          entryWindowEnd: '2026-02-15T22:00:00+05:30',
          drawAt: '2026-02-15T23:00:00+05:30',
          claimWindowDays: 36500,
          selectionMode: 'MANUAL_EXTERNAL',
        }),
      },
    );
    expect(secondPrepared.status).toBe(201);
    secondDrawRunId = String(secondPrepared.body.id);
    secondDrawId = String(secondPrepared.body.drawId);
    secondDrawPolicyId = String(secondPrepared.body.policyId);
    secondDrawPolicyVersionId = String(secondPrepared.body.policyVersionId);

    const secondLocked = await request(
      `/admin/owner-portal/draws/${secondDrawRunId}/lock-eligibility`,
      adminToken,
      { method: 'POST', body: '{}' },
    );
    expect(secondLocked.status).toBe(201);
    expect(secondLocked.body.selectionMode).toBe('MANUAL_EXTERNAL');
    expect(Number(secondLocked.body.eligibleEntryCount)).toBe(1);
    expect(Number(secondLocked.body.excludedEntryCount)).toBe(1);
    const secondEntries = await prisma.$queryRawUnsafe<
      Array<{ disposition: string; drawToken: string | null }>
    >(
      'SELECT disposition, drawToken FROM lucky_draw_entries WHERE drawId=?',
      secondDrawId,
    );
    expect(secondEntries).toHaveLength(2);
    expect(secondEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ disposition: 'PRIOR_WINNER', drawToken: null }),
      expect.objectContaining({ disposition: 'ELIGIBLE', drawToken: externalInstallmentToken }),
    ]));
    const advanceToken = await prisma.$queryRawUnsafe<
      Array<{ status: string; drawId: string | null; entryId: string | null }>
    >(
      'SELECT status, drawId, entryId FROM lucky_draw_tokens WHERE token=? LIMIT 1',
      futureInstallmentToken,
    );
    expect(advanceToken[0]).toMatchObject({
      status: 'AVAILABLE',
      drawId: null,
      entryId: null,
    });
    const externalTokenState = await prisma.$queryRawUnsafe<
      Array<{ status: string; drawId: string | null; entryId: string | null }>
    >(
      'SELECT status, drawId, entryId FROM lucky_draw_tokens WHERE token=? LIMIT 1',
      externalInstallmentToken,
    );
    expect(externalTokenState[0]).toMatchObject({
      status: 'USED',
      drawId: secondDrawId,
    });
    expect(externalTokenState[0]?.entryId).toBeTruthy();

    const autoSelectionBlocked = await request(
      `/admin/owner-portal/draws/${secondDrawRunId}/select-winners`,
      adminToken,
      { method: 'POST', body: '{}' },
    );
    expect(autoSelectionBlocked.status).toBe(409);

    const externalRecorded = await request(
      `/admin/owner-portal/draws/${secondDrawRunId}/external-winners`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          drawToken: externalInstallmentToken,
          prizeCode: secondPrizeCode,
        }),
      },
    );
    expect(externalRecorded.status).toBe(201);
    expect(externalRecorded.body.status).toBe('ELIGIBILITY_LOCKED');
    expect(externalRecorded.body.winners).toHaveLength(1);
    expect(externalRecorded.body.winners[0]).toMatchObject({
      drawToken: externalInstallmentToken,
      prizeCode: secondPrizeCode,
      prizeName: 'February Workflow Prize',
      tierWinnerPosition: 1,
      prizeWinnerCount: 1,
    });
    expect(externalRecorded.body.winners[0].verificationStatus).toBeNull();

    const finalizedExternal = await request(
      `/admin/owner-portal/draws/${secondDrawRunId}/finalize-external-selection`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          externalReference: 'UAT-EXTERNAL-DRAW-REGISTER-001',
          note: 'External draw result entered against the locked five-digit token',
        }),
      },
    );
    expect(finalizedExternal.status).toBe(201);
    expect(finalizedExternal.body.status).toBe('SELECTED');
    expect(finalizedExternal.body.engineStatus).toBe('DRAWN');
    expect(finalizedExternal.body.winnerCount).toBe(1);
    expect(finalizedExternal.body.externalDrawReference).toBe('UAT-EXTERNAL-DRAW-REGISTER-001');
    expect(finalizedExternal.body.winners[0].verificationStatus).toBe('PENDING');

    const externalOutcome = await prisma.$queryRawUnsafe<Array<{
      selectionAlgorithm: string | null;
      winnerCount: number;
    }>>(
      'SELECT selectionAlgorithm, winnerCount FROM lucky_draw_instances WHERE id=? LIMIT 1',
      secondDrawId,
    );
    expect(externalOutcome[0]).toMatchObject({
      selectionAlgorithm: 'MANUAL_EXTERNAL_V1',
      winnerCount: 1,
    });

    const failedVerification = await request(
      `/admin/owner-portal/draws/${drawRunId}/winners/${winnerId}/verify`,
      adminToken,
      {
        method: 'PATCH',
        body: JSON.stringify({
          eligibilityStatus: 'PASS',
          identityStatus: 'FAIL',
          paymentStatus: 'PASS',
        }),
      },
    );
    expect(failedVerification.status).toBe(200);
    expect(failedVerification.body.status).toBe('VERIFICATION');
    expect(failedVerification.body.winners[0].verificationStatus).toBe('FAILED');

    const prematureApproval = await request(
      `/admin/owner-portal/draws/${drawRunId}/approve`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({ approvalReference: 'UAT-FAIL-BLOCK' }),
      },
    );
    expect(prematureApproval.status).toBe(409);

    const correctedVerification = await request(
      `/admin/owner-portal/draws/${drawRunId}/winners/${winnerId}/verify`,
      adminToken,
      {
        method: 'PATCH',
        body: JSON.stringify({
          eligibilityStatus: 'PASS',
          identityStatus: 'PASS',
          paymentStatus: 'PASS',
        }),
      },
    );
    expect(correctedVerification.status).toBe(200);
    expect(correctedVerification.body.status).toBe('VERIFIED');
    expect(correctedVerification.body.winners[0].verificationStatus).toBe('VERIFIED');

    const approved = await request(
      `/admin/owner-portal/draws/${drawRunId}/approve`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          approvalReference: 'UAT-WINNER-APPROVAL',
          approvalNote: 'Owner workflow authenticated integration',
        }),
      },
    );
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');

    const published = await request(
      `/admin/owner-portal/draws/${drawRunId}/publish`,
      adminToken,
      { method: 'POST', body: '{}' },
    );
    expect(published.status).toBe(201);
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.winners[0].claimStatus).toBe('PENDING');
    const claimId = String(published.body.winners[0].claimId);
    expect(claimId).toBeTruthy();

    const claimWindow = await prisma.$queryRawUnsafe<
      Array<{ claimWindowDaysSnapshot: number; deadlineMatches: number | bigint }>
    >(
      `SELECT c.claimWindowDaysSnapshot,
              CASE WHEN c.claimDeadline = DATE_ADD(d.drawnAt, INTERVAL c.claimWindowDaysSnapshot DAY)
                   THEN 1 ELSE 0 END AS deadlineMatches
       FROM lucky_draw_prize_claims c
       JOIN lucky_draw_instances d ON d.id=c.drawId
       WHERE c.id=? LIMIT 1`,
      claimId,
    );
    expect(Number(claimWindow[0]?.claimWindowDaysSnapshot)).toBe(36500);
    expect(Number(claimWindow[0]?.deadlineMatches)).toBe(1);

    const memberClaimDenied = await request(
      `/admin/owner-portal/draws/${drawRunId}/winners/${winnerId}/claim`,
      memberToken,
      { method: 'POST', body: '{}' },
    );
    expect(memberClaimDenied.status).toBe(403);

    const claimed = await request(
      `/admin/owner-portal/draws/${drawRunId}/winners/${winnerId}/claim`,
      adminToken,
      { method: 'POST', body: '{}' },
    );
    expect(claimed.status).toBe(201);
    expect(claimed.body.winners[0].claimStatus).toBe('CLAIMED');

    const fulfilled = await request(
      `/admin/owner-portal/draws/${drawRunId}/winners/${winnerId}/fulfill`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          externalReference: 'UAT-NON-CASH-REF-001',
          note: 'Prize handed over in authenticated workflow UAT',
        }),
      },
    );
    expect(fulfilled.status).toBe(201);
    expect(fulfilled.body.winners[0].claimStatus).toBe('FULFILLED');

    const fulfillment = await prisma.$queryRawUnsafe<Array<{ externalReference: string | null }>>(
      'SELECT externalReference FROM lucky_draw_prize_fulfillments WHERE claimId=? LIMIT 1',
      claimId,
    );
    expect(fulfillment[0]?.externalReference).toBe('UAT-NON-CASH-REF-001');
  });
});
