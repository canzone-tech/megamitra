import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { AuditAction } from '../generated/prisma/enums';
import { LuckyDrawExecutionService } from '../lucky-draw/lucky-draw-execution.service';
import { LuckyDrawFulfillmentService } from '../lucky-draw/lucky-draw-fulfillment.service';
import { LuckyDrawPolicyService } from '../lucky-draw/lucky-draw-policy.service';
import {
  evaluateOwnerDrawSchedule,
  ownerDrawScheduleLabel,
} from './owner-draw-schedule';
import type {
  FinalizeExternalDrawDto,
  FulfillOwnerWinnerDto,
  PrepareOwnerDrawDto,
  RecordExternalDrawWinnerDto,
  VerifyOwnerWinnerDto,
} from './owner-portal.dto';
import { OwnerPortalService } from './owner-portal.service';

type SqlValue = string | number | bigint | boolean | Date | null;

type DrawSeasonRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  programVersionId: string | null;
  startDate: Date;
  drawStartMonth: number;
  drawWeekOfMonth: number;
  drawWeekday: string;
  drawTimezone: string;
};

type DrawRunRow = {
  id: string;
  seasonId: string;
  monthNumber: number;
  policyId: string;
  policyVersionId: string;
  drawId: string;
  status: string;
  selectionMode: 'AUTO' | 'MANUAL_EXTERNAL';
};

type ExistingDrawRunRow = DrawRunRow & {
  entryWindowStartUtc: string;
  entryWindowEndUtc: string;
  drawAtUtc: string;
  claimWindowDays: number;
};

@Injectable()
export class OwnerPortalDrawWorkflowService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly drawPolicies: LuckyDrawPolicyService,
    private readonly draws: LuckyDrawExecutionService,
    private readonly fulfillment: LuckyDrawFulfillmentService,
    private readonly portal: OwnerPortalService,
  ) {}

  async prepareDraw(
    seasonId: string,
    dto: PrepareOwnerDrawDto,
    actorUserId: string,
  ) {
    const seasonRows = await this.rows<DrawSeasonRow>(
      `SELECT id, code, name, status, programVersionId, startDate,
              drawStartMonth, drawWeekOfMonth, drawWeekday, drawTimezone
       FROM owner_seasons WHERE id=? LIMIT 1`,
      [seasonId],
    );
    const season = seasonRows[0];
    if (!season) throw new NotFoundException('Season not found');
    if (season.status !== 'ACTIVE') {
      throw new ConflictException('Only an active season can schedule a draw');
    }
    if (!season.programVersionId) {
      throw new ConflictException('Season program version is missing');
    }

    const scheduleLabel = this.assertConfiguredDrawDate(season, dto);
    const selectionMode = dto.selectionMode ?? 'AUTO';

    const existing = await this.rows<ExistingDrawRunRow>(
      `SELECT odr.id, odr.seasonId, odr.monthNumber, odr.policyId,
              odr.policyVersionId, odr.drawId, odr.status, odr.selectionMode,
              DATE_FORMAT(ldi.entryWindowStart, '%Y-%m-%d %H:%i:%s.%f') AS entryWindowStartUtc,
              DATE_FORMAT(ldi.entryWindowEnd, '%Y-%m-%d %H:%i:%s.%f') AS entryWindowEndUtc,
              DATE_FORMAT(ldi.drawAt, '%Y-%m-%d %H:%i:%s.%f') AS drawAtUtc,
              lfr.claimWindowDays
       FROM owner_draw_runs odr
       JOIN lucky_draw_instances ldi ON ldi.id=odr.drawId
       JOIN lucky_draw_fulfillment_rules lfr ON lfr.policyVersionId=odr.policyVersionId
       WHERE odr.seasonId=? AND odr.monthNumber=?
       LIMIT 1`,
      [seasonId, dto.monthNumber],
    );
    if (existing[0]) {
      this.assertExistingDrawReplay(existing[0], dto);
      return this.portal.drawRun(existing[0].id);
    }

    const prizes = await this.rows<{
      prizeCode: string;
      name: string;
      winnerCount: number;
      nominalValue: string | null;
      currencyCode: string;
    }>(
      `SELECT prizeCode, name, winnerCount, nominalValue, currencyCode
       FROM owner_season_prizes
       WHERE seasonId=? AND monthNumber=? AND status='ACTIVE'
       ORDER BY createdAt ASC`,
      [seasonId, dto.monthNumber],
    );
    if (!prizes.length) {
      throw new BadRequestException('Configure at least one prize for this draw month');
    }

    const runId = randomUUID();
    const policy = await this.drawPolicies.createPolicy(
      {
        code: this.policyCode(`${season.code}M${dto.monthNumber}`, 'DRAW'),
        name: `${season.name} Month ${dto.monthNumber} Draw`,
        description: `Month ${dto.monthNumber} prize schedule • ${scheduleLabel}`,
      },
      actorUserId,
    );
    const policyVersion = await this.drawPolicies.createVersion(
      policy.id,
      {
        programVersionId: season.programVersionId,
        effectiveFrom: dto.entryWindowStart,
        effectiveTo: dto.drawAt,
        entryMode: 'ONE_PER_USER',
        priorWinnerMode: 'ALLOW',
        allowMultipleWinsPerDraw: false,
        insufficientEntrantsMode: 'DRAW_AVAILABLE',
        prizeTiers: prizes.map((prize) => ({
          code: prize.prizeCode,
          name: prize.name,
          winnerCount: Number(prize.winnerCount),
          prizeKind: 'ITEM' as const,
          ...(prize.nominalValue
            ? {
                prizeDefinition: {
                  nominalValue: String(prize.nominalValue),
                  currencyCode: prize.currencyCode,
                },
              }
            : { prizeDefinition: {} }),
        })),
      },
      actorUserId,
    );

    // The final client workflow requires claim → fulfilment after publication.
    // The source does not define a duration, so the owner supplies the window
    // for each prepared draw rather than the application inventing a default.
    await this.fulfillment.configureRule(
      policyVersion.id,
      { claimWindowDays: dto.claimWindowDays },
      actorUserId,
    );
    await this.drawPolicies.publish(policyVersion.id, actorUserId);

    const seed = this.drawSeed(runId);
    const { draw } = await this.draws.createInstance(
      {
        sourceKey: `owner-draw:${runId}`,
        policyVersionId: policyVersion.id,
        entryWindowStart: dto.entryWindowStart,
        entryWindowEnd: dto.entryWindowEnd,
        drawAt: dto.drawAt,
        seedCommitment: createHash('sha256').update(seed).digest('hex'),
      },
      actorUserId,
    );

    await this.db.execute(
      `INSERT INTO owner_draw_runs
       (id, seasonId, monthNumber, policyId, policyVersionId, drawId, status, selectionMode, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?)`,
      [
        runId,
        seasonId,
        dto.monthNumber,
        policy.id,
        policyVersion.id,
        draw.id,
        selectionMode,
        actorUserId,
      ],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Monthly draw prepared from season prize schedule',
      metadata: {
        seasonId,
        monthNumber: dto.monthNumber,
        drawId: draw.id,
        claimWindowDays: dto.claimWindowDays,
        recurrence: scheduleLabel,
        drawTimezone: season.drawTimezone,
        selectionMode,
      },
    });
    return this.portal.drawRun(runId);
  }

  async recordExternalWinner(
    runId: string,
    dto: RecordExternalDrawWinnerDto,
    actorUserId: string,
  ) {
    const recorded = await this.db.transaction(async (connection) => {
      const runRows = await connection.query<Array<DrawRunRow & {
        engineStatus: string;
        snapshotHash: string | null;
        drawAt: Date;
      }>>(
        `SELECT odr.id, odr.seasonId, odr.monthNumber, odr.policyId, odr.policyVersionId,
                odr.drawId, odr.status, odr.selectionMode,
                ldi.status AS engineStatus, ldi.snapshotHash, ldi.drawAt
         FROM owner_draw_runs odr
         JOIN lucky_draw_instances ldi ON ldi.id=odr.drawId
         WHERE odr.id=? FOR UPDATE`,
        [runId],
      );
      const run = runRows[0];
      if (!run) throw new NotFoundException('Draw run not found');
      if (run.selectionMode !== 'MANUAL_EXTERNAL') {
        throw new ConflictException('External winners can only be recorded for a manual external draw');
      }
      if (run.status !== 'ELIGIBILITY_LOCKED' || run.engineStatus !== 'SNAPSHOTTED') {
        throw new ConflictException('Lock eligibility before recording external draw winners');
      }
      if (!run.snapshotHash) throw new ConflictException('Lucky draw snapshot hash is missing');
      if (new Date(run.drawAt).getTime() > Date.now()) {
        throw new ConflictException('External draw winners cannot be recorded before the scheduled draw time');
      }

      const tierRows = await connection.query<Array<{
        id: string;
        tierOrder: number;
        code: string;
        name: string;
        winnerCount: number;
      }>>(
        `SELECT id, tierOrder, code, name, winnerCount
         FROM lucky_draw_prize_tiers
         WHERE policyVersionId=? AND code=? LIMIT 1 FOR UPDATE`,
        [run.policyVersionId, dto.prizeCode.trim().toUpperCase()],
      );
      const tier = tierRows[0];
      if (!tier) throw new NotFoundException('Prize tier not found for this draw');

      const tierWinnerRows = await connection.query<Array<{ tierWinnerPosition: number }>>(
        `SELECT tierWinnerPosition
         FROM lucky_draw_winners
         WHERE drawId=? AND prizeTierId=?
         ORDER BY tierWinnerPosition ASC FOR UPDATE`,
        [run.drawId, tier.id],
      );
      const occupiedTierPositions = new Set(
        tierWinnerRows.map((row) => Number(row.tierWinnerPosition)),
      );
      const tierWinnerPosition = Array.from(
        { length: Number(tier.winnerCount) },
        (_, index) => index + 1,
      ).find((position) => !occupiedTierPositions.has(position));
      if (!tierWinnerPosition) {
        throw new ConflictException(`${tier.name} already has all configured winners`);
      }

      const entryRows = await connection.query<Array<{
        id: string;
        userId: string;
        drawToken: string;
        entrySequence: number | null;
      }>>(
        `SELECT id, userId, drawToken, entrySequence
         FROM lucky_draw_entries
         WHERE drawId=? AND drawToken=? AND disposition='ELIGIBLE'
         LIMIT 1 FOR UPDATE`,
        [run.drawId, dto.drawToken],
      );
      const entry = entryRows[0];
      if (!entry) {
        throw new BadRequestException('Draw token is not an eligible token in this locked draw');
      }

      const duplicateRows = await connection.query<Array<{ id: string }>>(
        `SELECT id FROM lucky_draw_winners
         WHERE drawId=? AND (entryId=? OR userId=?) LIMIT 1 FOR UPDATE`,
        [run.drawId, entry.id, entry.userId],
      );
      if (duplicateRows[0]) {
        throw new ConflictException('This member is already recorded as a winner in this draw');
      }

      const rankRows = await connection.query<Array<{ nextRank: number | string | bigint }>>(
        'SELECT COALESCE(MAX(overallRank), 0) + 1 AS nextRank FROM lucky_draw_winners WHERE drawId=?',
        [run.drawId],
      );
      const overallRank = Number(rankRows[0]?.nextRank ?? 1);
      const selectionScore = createHash('sha256')
        .update([
          'MANUAL_EXTERNAL_V1',
          runId,
          run.drawId,
          run.snapshotHash,
          entry.id,
          entry.drawToken,
          tier.id,
          String(tierWinnerPosition),
        ].join('|'))
        .digest('hex');
      const winnerId = randomUUID();
      const outcomeSnapshot = {
        policyVersionId: run.policyVersionId,
        policyId: run.policyId,
        snapshotHash: run.snapshotHash,
        selectionAlgorithm: 'MANUAL_EXTERNAL_V1',
        selectionMode: 'MANUAL_EXTERNAL',
        entrySequence: entry.entrySequence,
        drawToken: entry.drawToken,
        prizeTier: {
          id: tier.id,
          tierOrder: Number(tier.tierOrder),
          code: tier.code,
          name: tier.name,
        },
        recordedByUserId: actorUserId,
      };
      await connection.query(
        `INSERT INTO lucky_draw_winners
           (id, drawId, entryId, userId, prizeTierId, overallRank, tierWinnerPosition,
            selectionScore, outcomeSnapshot, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          winnerId,
          run.drawId,
          entry.id,
          entry.userId,
          tier.id,
          overallRank,
          tierWinnerPosition,
          selectionScore,
          JSON.stringify(outcomeSnapshot),
        ],
      );
      return {
        winnerId,
        drawToken: entry.drawToken,
        prizeCode: tier.code,
        prizeName: tier.name,
        tierWinnerPosition,
      };
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerExternalDrawWinner',
      entityId: recorded.winnerId,
      description: 'External draw winner recorded against locked eligible token',
      metadata: {
        drawRunId: runId,
        drawToken: recorded.drawToken,
        prizeCode: recorded.prizeCode,
        prizeName: recorded.prizeName,
        tierWinnerPosition: recorded.tierWinnerPosition,
      },
    });
    return this.portal.drawRun(runId);
  }

  async removeExternalWinner(
    runId: string,
    winnerId: string,
    actorUserId: string,
  ) {
    const removed = await this.db.transaction(async (connection) => {
      const runRows = await connection.query<DrawRunRow[]>(
        'SELECT id, seasonId, monthNumber, policyId, policyVersionId, drawId, status, selectionMode FROM owner_draw_runs WHERE id=? FOR UPDATE',
        [runId],
      );
      const run = runRows[0];
      if (!run) throw new NotFoundException('Draw run not found');
      if (run.selectionMode !== 'MANUAL_EXTERNAL' || run.status !== 'ELIGIBILITY_LOCKED') {
        throw new ConflictException('External winners can only be changed before manual selection is finalized');
      }
      const winnerRows = await connection.query<Array<{
        id: string;
        drawToken: string | null;
        prizeCode: string;
        prizeName: string;
      }>>(
        `SELECT w.id, e.drawToken, t.code AS prizeCode, t.name AS prizeName
         FROM lucky_draw_winners w
         JOIN lucky_draw_entries e ON e.id=w.entryId
         JOIN lucky_draw_prize_tiers t ON t.id=w.prizeTierId
         WHERE w.id=? AND w.drawId=? LIMIT 1 FOR UPDATE`,
        [winnerId, run.drawId],
      );
      const winner = winnerRows[0];
      if (!winner) throw new NotFoundException('External winner not found for this draw');
      await connection.query('DELETE FROM lucky_draw_winners WHERE id=?', [winnerId]);
      return winner;
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerExternalDrawWinner',
      entityId: winnerId,
      description: 'External draw winner removed before finalization',
      metadata: {
        drawRunId: runId,
        drawToken: removed.drawToken,
        prizeCode: removed.prizeCode,
        prizeName: removed.prizeName,
      },
    });
    return this.portal.drawRun(runId);
  }

  async finalizeExternalDraw(
    runId: string,
    dto: FinalizeExternalDrawDto,
    actorUserId: string,
  ) {
    const finalized = await this.db.transaction(async (connection) => {
      const runRows = await connection.query<Array<DrawRunRow & {
        engineStatus: string;
        eligibleEntryCount: number;
        drawAt: Date;
      }>>(
        `SELECT odr.id, odr.seasonId, odr.monthNumber, odr.policyId, odr.policyVersionId,
                odr.drawId, odr.status, odr.selectionMode,
                ldi.status AS engineStatus, ldi.eligibleEntryCount, ldi.drawAt
         FROM owner_draw_runs odr
         JOIN lucky_draw_instances ldi ON ldi.id=odr.drawId
         WHERE odr.id=? FOR UPDATE`,
        [runId],
      );
      const run = runRows[0];
      if (!run) throw new NotFoundException('Draw run not found');
      if (run.selectionMode !== 'MANUAL_EXTERNAL') {
        throw new ConflictException('Only manual external draws can be finalized here');
      }
      if (run.status !== 'ELIGIBILITY_LOCKED' || run.engineStatus !== 'SNAPSHOTTED') {
        throw new ConflictException('Manual selection must be open on a locked draw');
      }
      if (new Date(run.drawAt).getTime() > Date.now()) {
        throw new ConflictException('External draw cannot be finalized before the scheduled draw time');
      }

      const tiers = await connection.query<Array<{
        id: string;
        tierOrder: number;
        code: string;
        name: string;
        winnerCount: number;
      }>>(
        `SELECT id, tierOrder, code, name, winnerCount
         FROM lucky_draw_prize_tiers
         WHERE policyVersionId=? ORDER BY tierOrder ASC FOR UPDATE`,
        [run.policyVersionId],
      );
      if (!tiers.length) throw new ConflictException('Lucky draw policy has no prize tiers');

      const winnerCounts = await connection.query<Array<{
        prizeTierId: string;
        selectedCount: number | string | bigint;
      }>>(
        `SELECT prizeTierId, COUNT(*) AS selectedCount
         FROM lucky_draw_winners WHERE drawId=? GROUP BY prizeTierId`,
        [run.drawId],
      );
      const selectedByTier = new Map(
        winnerCounts.map((row) => [row.prizeTierId, Number(row.selectedCount)]),
      );
      const configuredWinnerCount = tiers.reduce(
        (sum, tier) => sum + Number(tier.winnerCount),
        0,
      );
      const targetWinnerCount = Math.min(
        configuredWinnerCount,
        Number(run.eligibleEntryCount),
      );

      let remaining = targetWinnerCount;
      for (const tier of tiers) {
        const expected = Math.min(Number(tier.winnerCount), remaining);
        const selected = selectedByTier.get(tier.id) ?? 0;
        if (selected !== expected) {
          throw new ConflictException(
            `${tier.name} requires ${expected} recorded winner(s) before external draw finalization; currently ${selected}`,
          );
        }
        remaining -= expected;
      }

      const selectedTotal = [...selectedByTier.values()].reduce((sum, count) => sum + count, 0);
      if (selectedTotal !== targetWinnerCount) {
        throw new ConflictException(
          `External draw requires ${targetWinnerCount} winner(s); currently ${selectedTotal} are recorded`,
        );
      }

      await connection.query(
        `UPDATE lucky_draw_instances
         SET status='DRAWN', selectionAlgorithm='MANUAL_EXTERNAL_V1', winnerCount=?,
             drawnAt=CURRENT_TIMESTAMP(3), updatedAt=CURRENT_TIMESTAMP(3)
         WHERE id=? AND status='SNAPSHOTTED'`,
        [selectedTotal, run.drawId],
      );
      await connection.query(
        `UPDATE owner_draw_runs
         SET status='SELECTED', externalDrawReference=?, externalDrawNote=?,
             externalDrawFinalizedAt=CURRENT_TIMESTAMP(3), externalDrawRecordedByUserId=?
         WHERE id=?`,
        [
          dto.externalReference.trim(),
          dto.note?.trim() || null,
          actorUserId,
          runId,
        ],
      );
      await connection.query(
        `INSERT IGNORE INTO owner_winner_verifications
           (winnerId, drawRunId, eligibilityStatus, identityStatus, paymentStatus, status)
         SELECT w.id, ?, 'PASS', 'PENDING', 'PASS', 'PENDING'
         FROM lucky_draw_winners w WHERE w.drawId=?`,
        [runId, run.drawId],
      );
      return {
        drawId: run.drawId,
        winnerCount: selectedTotal,
        externalReference: dto.externalReference.trim(),
      };
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerExternalDrawOutcome',
      entityId: runId,
      description: 'Externally conducted draw finalized with prize-mapped winners',
      metadata: {
        drawId: finalized.drawId,
        winnerCount: finalized.winnerCount,
        externalReference: finalized.externalReference,
        note: dto.note?.trim() || null,
      },
    });
    return this.portal.drawRun(runId);
  }

  async verifyWinner(
    runId: string,
    winnerId: string,
    dto: VerifyOwnerWinnerDto,
    actorUserId: string,
  ) {
    const verificationStatus =
      dto.eligibilityStatus === 'PASS' &&
      dto.identityStatus === 'PASS' &&
      dto.paymentStatus === 'PASS'
        ? 'VERIFIED'
        : 'FAILED';

    await this.db.transaction(async (connection) => {
      const runRows = await connection.query<Array<{ status: string }>>(
        'SELECT status FROM owner_draw_runs WHERE id=? FOR UPDATE',
        [runId],
      );
      const run = runRows[0];
      if (!run) throw new NotFoundException('Draw run not found');
      if (!['SELECTED', 'VERIFICATION'].includes(run.status)) {
        throw new ConflictException('Winner verification is not available at this stage');
      }

      const result = (await connection.query(
        `UPDATE owner_winner_verifications
         SET eligibilityStatus=?, identityStatus=?, paymentStatus=?, status=?, verifiedByUserId=?, verifiedAt=CURRENT_TIMESTAMP(3)
         WHERE winnerId=? AND drawRunId=?`,
        [
          dto.eligibilityStatus,
          dto.identityStatus,
          dto.paymentStatus,
          verificationStatus,
          actorUserId,
          winnerId,
          runId,
        ],
      )) as { affectedRows?: number };
      if (Number(result.affectedRows ?? 0) === 0) {
        throw new NotFoundException('Winner record not found for this draw');
      }

      const verifications = await connection.query<Array<{ status: string }>>(
        'SELECT status FROM owner_winner_verifications WHERE drawRunId=? FOR UPDATE',
        [runId],
      );
      const allVerified =
        verifications.length > 0 &&
        verifications.every((verification) => verification.status === 'VERIFIED');
      await connection.query(
        'UPDATE owner_draw_runs SET status=?, verifiedAt=? WHERE id=?',
        [
          allVerified ? 'VERIFIED' : 'VERIFICATION',
          allVerified ? new Date() : null,
          runId,
        ],
      );
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerWinnerVerification',
      entityId: winnerId,
      description: `Winner verification recorded as ${verificationStatus}`,
      metadata: dto,
    });
    return this.portal.drawRun(runId);
  }

  async publishDraw(runId: string, actorUserId: string) {
    const run = await this.requireRun(runId);
    if (run.status === 'PUBLISHED') return this.portal.drawRun(runId);
    if (run.status !== 'APPROVED') {
      throw new ConflictException('Approve verified winners before publication');
    }

    await this.fulfillment.initializeClaims(run.drawId, actorUserId);
    await this.db.execute(
      "UPDATE owner_draw_runs SET status='PUBLISHED', publishedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [runId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Approved winner list published and prize claims opened',
      metadata: { drawId: run.drawId },
    });
    return this.portal.drawRun(runId);
  }

  async claimWinner(runId: string, winnerId: string, actorUserId: string) {
    const run = await this.requirePublishedRun(runId);
    const claim = await this.requireWinnerClaim(run, winnerId);
    await this.fulfillment.claim(
      claim.claimId,
      {
        occurredAt: new Date().toISOString(),
        metadata: { ownerPortal: true, drawRunId: runId },
      },
      actorUserId,
    );
    return this.portal.drawRun(runId);
  }

  async fulfillWinner(
    runId: string,
    winnerId: string,
    dto: FulfillOwnerWinnerDto,
    actorUserId: string,
  ) {
    const run = await this.requirePublishedRun(runId);
    const claim = await this.requireWinnerClaim(run, winnerId);
    const occurredAt = new Date().toISOString();
    await this.fulfillment.fulfill(
      claim.claimId,
      {
        sourceKey: `owner-winner-fulfillment:${runId}:${winnerId}`,
        occurredAt,
        ...(dto.externalReference?.trim()
          ? { externalReference: dto.externalReference.trim() }
          : {}),
        metadata: {
          ownerPortal: true,
          drawRunId: runId,
          ...(dto.note?.trim() ? { note: dto.note.trim() } : {}),
        },
      },
      actorUserId,
    );
    return this.portal.drawRun(runId);
  }

  private assertConfiguredDrawDate(
    season: DrawSeasonRow,
    dto: PrepareOwnerDrawDto,
  ) {
    const schedule = {
      seasonStartDate: season.startDate,
      startMonth: Number(season.drawStartMonth),
      weekOfMonth: Number(season.drawWeekOfMonth),
      weekday: season.drawWeekday,
      timezone: season.drawTimezone,
    };
    let evaluation;
    try {
      evaluation = evaluateOwnerDrawSchedule(schedule, dto.monthNumber, dto.drawAt);
    } catch (error) {
      throw new ConflictException(
        `Season lucky draw schedule is invalid: ${error instanceof Error ? error.message : 'invalid configuration'}`,
      );
    }
    if (!evaluation.matches) {
      const received = [
        evaluation.actualYear,
        String(evaluation.actualMonth).padStart(2, '0'),
        String(evaluation.actualDay).padStart(2, '0'),
      ].join('-');
      throw new BadRequestException(
        `Month ${dto.monthNumber} draw must follow ${ownerDrawScheduleLabel(schedule.startMonth, schedule.weekOfMonth, schedule.weekday)} in ${schedule.timezone}. Expected calendar month ${evaluation.expectedYear}-${String(evaluation.expectedMonth).padStart(2, '0')}; received ${received} (${evaluation.actualWeekday}, week ${evaluation.actualWeekOfMonth}).`,
      );
    }
    return ownerDrawScheduleLabel(
      schedule.startMonth,
      schedule.weekOfMonth,
      schedule.weekday,
    );
  }

  private assertExistingDrawReplay(
    existing: ExistingDrawRunRow,
    dto: PrepareOwnerDrawDto,
  ) {
    const canonicalIncoming = (value: string) =>
      new Date(value).toISOString().slice(0, 23).replace('T', ' ');
    const storedMilliseconds = (value: string) => value.slice(0, 23);
    const exactReplay =
      existing.monthNumber === dto.monthNumber &&
      storedMilliseconds(existing.entryWindowStartUtc) ===
        canonicalIncoming(dto.entryWindowStart) &&
      storedMilliseconds(existing.entryWindowEndUtc) ===
        canonicalIncoming(dto.entryWindowEnd) &&
      storedMilliseconds(existing.drawAtUtc) === canonicalIncoming(dto.drawAt) &&
      Number(existing.claimWindowDays) === dto.claimWindowDays &&
      existing.selectionMode === (dto.selectionMode ?? 'AUTO');
    if (!exactReplay) {
      throw new ConflictException(
        `Month ${dto.monthNumber} draw is already prepared with different entry window, draw time, claim window, or selection mode settings`,
      );
    }
  }

  private async requirePublishedRun(runId: string) {
    const run = await this.requireRun(runId);
    if (run.status !== 'PUBLISHED') {
      throw new ConflictException('Prize claims are available only after winners are published');
    }
    return run;
  }

  private async requireRun(runId: string) {
    const rows = await this.rows<DrawRunRow>(
      'SELECT id, seasonId, monthNumber, policyId, policyVersionId, drawId, status, selectionMode FROM owner_draw_runs WHERE id=? LIMIT 1',
      [runId],
    );
    if (!rows[0]) throw new NotFoundException('Draw run not found');
    return rows[0];
  }

  private async requireWinnerClaim(run: DrawRunRow, winnerId: string) {
    const rows = await this.rows<{ claimId: string; claimStatus: string }>(
      `SELECT c.id AS claimId, c.status AS claimStatus
       FROM lucky_draw_winners w
       JOIN lucky_draw_prize_claims c ON c.winnerId=w.id
       WHERE w.id=? AND w.drawId=? LIMIT 1`,
      [winnerId, run.drawId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Prize claim was not found for this winner');
    }
    return rows[0];
  }

  private drawSeed(runId: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'),
    )
      .update(`owner-draw-selection:${runId}`)
      .digest('hex');
  }

  private policyCode(code: string, suffix: string) {
    const tail = `_${suffix}`;
    return `${code.slice(0, Math.max(2, 50 - tail.length))}${tail}`;
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(
      async (connection) => (await connection.query(sql, values)) as T[],
    );
  }
}
