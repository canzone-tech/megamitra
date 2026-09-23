import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import type {
  CreateLuckyDrawInstanceDto,
  ExecuteLuckyDrawDto,
  LuckyDrawEntryMode,
  LuckyDrawInsufficientEntrantsMode,
  LuckyDrawPriorWinnerMode,
  LuckyDrawPrizeKind,
} from './lucky-draw.dto';

type DrawStatus = 'SCHEDULED' | 'SNAPSHOTTED' | 'DRAWN' | 'VOIDED';
type EntryDisposition = 'ELIGIBLE' | 'DUPLICATE_USER' | 'PRIOR_WINNER';

type DrawRow = {
  id: string;
  sourceKey: string;
  requestFingerprint: string;
  policyVersionId: string;
  entryWindowStart: Date;
  entryWindowEnd: Date;
  drawAt: Date;
  seedCommitment: string;
  status: DrawStatus;
  snapshotHash: string | null;
  candidateCount: number;
  eligibleEntryCount: number;
  excludedEntryCount: number;
  revealedSeed: string | null;
  selectionAlgorithm: string | null;
  winnerCount: number;
  snapshottedAt: Date | null;
  drawnAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type LockedDrawRow = DrawRow & {
  policyId: string;
  programVersionId: string;
  lifecycle: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  entryMode: LuckyDrawEntryMode;
  priorWinnerMode: LuckyDrawPriorWinnerMode;
  allowMultipleWinsPerDraw: boolean | number;
  insufficientEntrantsMode: LuckyDrawInsufficientEntrantsMode;
};

type PolicyVersionRow = {
  id: string;
  policyId: string;
  programVersionId: string;
  lifecycle: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

type HookRow = {
  id: string;
  userId: string;
  programVersionId: string;
  eligibilitySnapshot: unknown;
  occurredAt: Date;
};

type PrizeTierRow = {
  id: string;
  policyVersionId: string;
  tierOrder: number;
  code: string;
  name: string;
  winnerCount: number;
  prizeKind: LuckyDrawPrizeKind;
  cashAmount: string | number | null;
  currencyCode: string | null;
  prizeDefinition: unknown;
};

type EntryRow = {
  id: string;
  drawId: string;
  sourceHookId: string;
  userId: string;
  hookOccurredAt: Date;
  disposition: EntryDisposition;
  exclusionReason: string | null;
  entrySequence: number | null;
  selectionScore: string | null;
  eligibilitySnapshot: unknown;
  createdAt: Date;
};

type WinnerRow = {
  id: string;
  drawId: string;
  entryId: string;
  userId: string;
  prizeTierId: string;
  overallRank: number;
  tierWinnerPosition: number;
  selectionScore: string;
  outcomeSnapshot: unknown;
  createdAt: Date;
};

type Candidate = {
  hook: HookRow;
  disposition: EntryDisposition;
  exclusionReason: string | null;
  entrySequence: number | null;
};

type ScoredEntry = EntryRow & { score: string };

@Injectable()
export class LuckyDrawExecutionService {
  private readonly selectionAlgorithm = 'SHA256_V1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
  ) {}

  async createInstance(dto: CreateLuckyDrawInstanceDto, actorUserId: string) {
    const entryWindowStart = new Date(dto.entryWindowStart);
    const entryWindowEnd = new Date(dto.entryWindowEnd);
    const drawAt = new Date(dto.drawAt);
    this.validateDrawDates(entryWindowStart, entryWindowEnd, drawAt);
    const seedCommitment = dto.seedCommitment.trim().toLowerCase();
    const fingerprint = this.instanceFingerprint(
      dto.policyVersionId,
      entryWindowStart,
      entryWindowEnd,
      drawAt,
      seedCommitment,
    );

    const existing = await this.findDrawBySourceKey(dto.sourceKey);
    if (existing) {
      this.assertInstanceIdempotent(existing, fingerprint);
      return { draw: await this.getDraw(existing.id), idempotent: true };
    }

    const policy = await this.requirePublishedPolicyVersion(dto.policyVersionId, drawAt);
    const overlap = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT d.id
       FROM lucky_draw_instances d
       INNER JOIN lucky_draw_policy_versions v ON v.id = d.policyVersionId
       WHERE v.policyId = ? AND d.status <> 'VOIDED'
         AND d.entryWindowStart <= ? AND d.entryWindowEnd >= ?
       LIMIT 1`,
      policy.policyId,
      entryWindowEnd,
      entryWindowStart,
    );
    if (overlap[0]) {
      throw new ConflictException('Lucky draw entry window overlaps another active draw for this policy');
    }

    const id = randomUUID();
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO lucky_draw_instances
           (id, sourceKey, requestFingerprint, policyVersionId, entryWindowStart, entryWindowEnd,
            drawAt, seedCommitment, status, createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        id,
        dto.sourceKey,
        fingerprint,
        dto.policyVersionId,
        entryWindowStart,
        entryWindowEnd,
        drawAt,
        seedCommitment,
        actorUserId,
      );
    } catch (error) {
      const raced = await this.findDrawBySourceKey(dto.sourceKey);
      if (raced) {
        this.assertInstanceIdempotent(raced, fingerprint);
        return { draw: await this.getDraw(raced.id), idempotent: true };
      }
      throw error;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'LuckyDrawInstance',
      entityId: id,
      description: 'Lucky draw instance scheduled with committed selection seed',
      metadata: {
        policyVersionId: dto.policyVersionId,
        entryWindowStart: entryWindowStart.toISOString(),
        entryWindowEnd: entryWindowEnd.toISOString(),
        drawAt: drawAt.toISOString(),
        seedCommitment,
      },
    });
    return { draw: await this.getDraw(id), idempotent: false };
  }

  async snapshotEntrants(drawId: string, actorUserId: string) {
    await this.ensureMutex(drawId);
    const result = await this.financialDb.transaction((connection) =>
      this.snapshotTransaction(connection, drawId),
    );
    if (!result.idempotent) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'LuckyDrawEntrantSnapshot',
        entityId: drawId,
        description: 'Lucky draw entrant snapshot frozen',
        metadata: {
          snapshotHash: result.snapshotHash,
          candidateCount: result.candidateCount,
          eligibleEntryCount: result.eligibleEntryCount,
          excludedEntryCount: result.excludedEntryCount,
        },
      });
    }
    return { draw: await this.getDraw(drawId), idempotent: result.idempotent };
  }

  async execute(drawId: string, dto: ExecuteLuckyDrawDto, actorUserId: string) {
    const selectionSeed = dto.selectionSeed;
    await this.ensureMutex(drawId);
    const result = await this.financialDb.transaction((connection) =>
      this.executeTransaction(connection, drawId, selectionSeed),
    );
    if (!result.idempotent) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'LuckyDrawOutcome',
        entityId: drawId,
        description: 'Lucky draw winners selected from frozen entrant snapshot',
        metadata: {
          selectionAlgorithm: this.selectionAlgorithm,
          snapshotHash: result.snapshotHash,
          winnerCount: result.winnerCount,
          seedCommitment: result.seedCommitment,
        },
      });
    }
    return { draw: await this.getDraw(drawId), idempotent: result.idempotent };
  }

  async voidScheduled(drawId: string, actorUserId: string) {
    await this.ensureMutex(drawId);
    await this.financialDb.transaction(async (connection) => {
      await this.touchMutex(connection, drawId);
      const rows = await connection.query<Array<{ status: DrawStatus }>>(
        `SELECT status FROM lucky_draw_instances WHERE id = ? FOR UPDATE`,
        [drawId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Lucky draw instance not found');
      if (row.status === 'VOIDED') return;
      if (row.status !== 'SCHEDULED') {
        throw new ConflictException('Only an unsnapshotted lucky draw may be voided');
      }
      await connection.query(
        `UPDATE lucky_draw_instances SET status = 'VOIDED', updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [drawId],
      );
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'LuckyDrawInstance',
      entityId: drawId,
      description: 'Lucky draw instance voided before entrant snapshot',
    });
    return this.getDraw(drawId);
  }

  async getDraw(drawId: string) {
    const rows = await this.prisma.$queryRawUnsafe<DrawRow[]>(
      `SELECT * FROM lucky_draw_instances WHERE id = ? LIMIT 1`,
      drawId,
    );
    const draw = rows[0];
    if (!draw) throw new NotFoundException('Lucky draw instance not found');
    const [entries, winners, policyVersion, prizeTiers] = await Promise.all([
      this.prisma.$queryRawUnsafe<EntryRow[]>(
        `SELECT * FROM lucky_draw_entries
         WHERE drawId = ?
         ORDER BY CASE disposition WHEN 'ELIGIBLE' THEN 0 ELSE 1 END,
                  entrySequence ASC, hookOccurredAt ASC, id ASC`,
        drawId,
      ),
      this.prisma.$queryRawUnsafe<WinnerRow[]>(
        `SELECT * FROM lucky_draw_winners WHERE drawId = ? ORDER BY overallRank ASC`,
        drawId,
      ),
      this.prisma.$queryRawUnsafe<PolicyVersionRow[]>(
        `SELECT id, policyId, programVersionId, lifecycle, effectiveFrom, effectiveTo
         FROM lucky_draw_policy_versions WHERE id = ? LIMIT 1`,
        draw.policyVersionId,
      ),
      this.prisma.$queryRawUnsafe<PrizeTierRow[]>(
        `SELECT * FROM lucky_draw_prize_tiers
         WHERE policyVersionId = ? ORDER BY tierOrder ASC`,
        draw.policyVersionId,
      ),
    ]);
    return {
      ...draw,
      policyVersion: policyVersion[0] ?? null,
      prizeTiers,
      entries,
      winners,
    };
  }

  async listDraws(policyVersionId?: string) {
    const rows = policyVersionId
      ? await this.prisma.$queryRawUnsafe<DrawRow[]>(
          `SELECT * FROM lucky_draw_instances WHERE policyVersionId = ? ORDER BY drawAt ASC, createdAt ASC`,
          policyVersionId,
        )
      : await this.prisma.$queryRawUnsafe<DrawRow[]>(
          `SELECT * FROM lucky_draw_instances ORDER BY drawAt ASC, createdAt ASC`,
        );
    return rows;
  }

  private async snapshotTransaction(connection: PoolConnection, drawId: string) {
    await this.touchMutex(connection, drawId);
    const draw = await this.lockDraw(connection, drawId);
    if (draw.status === 'SNAPSHOTTED' || draw.status === 'DRAWN') {
      return {
        idempotent: true,
        snapshotHash: draw.snapshotHash,
        candidateCount: Number(draw.candidateCount),
        eligibleEntryCount: Number(draw.eligibleEntryCount),
        excludedEntryCount: Number(draw.excludedEntryCount),
      };
    }
    if (draw.status === 'VOIDED') throw new ConflictException('Voided lucky draw cannot be snapshotted');
    if (new Date(draw.entryWindowEnd).getTime() > Date.now()) {
      throw new ConflictException('Lucky draw entry window has not closed yet');
    }
    if (draw.lifecycle !== 'PUBLISHED') {
      throw new ConflictException('Lucky draw policy version is no longer published');
    }

    const hooks = await connection.query<HookRow[]>(
      `SELECT id, userId, programVersionId, eligibilitySnapshot, occurredAt
       FROM program_draw_eligibility_hooks
       WHERE programVersionId = ? AND status = 'ELIGIBLE'
         AND occurredAt >= ? AND occurredAt <= ?
       ORDER BY occurredAt ASC, id ASC`,
      [draw.programVersionId, draw.entryWindowStart, draw.entryWindowEnd],
    );

    const priorWinners = new Set<string>();
    if (draw.priorWinnerMode === 'DISALLOW_WITHIN_POLICY') {
      const rows = await connection.query<Array<{ userId: string }>>(
        `SELECT DISTINCT w.userId
         FROM lucky_draw_winners w
         INNER JOIN lucky_draw_instances d ON d.id = w.drawId
         INNER JOIN lucky_draw_policy_versions v ON v.id = d.policyVersionId
         WHERE v.policyId = ? AND d.status = 'DRAWN'`,
        [draw.policyId],
      );
      for (const row of rows) priorWinners.add(row.userId);
    }

    const seenUsers = new Set<string>();
    let sequence = 0;
    const candidates: Candidate[] = hooks.map((hook) => {
      let disposition: EntryDisposition = 'ELIGIBLE';
      let exclusionReason: string | null = null;
      if (priorWinners.has(hook.userId)) {
        disposition = 'PRIOR_WINNER';
        exclusionReason = 'PRIOR_WINNER_DISALLOWED_BY_POLICY';
      } else if (draw.entryMode === 'ONE_PER_USER' && seenUsers.has(hook.userId)) {
        disposition = 'DUPLICATE_USER';
        exclusionReason = 'ONE_ENTRY_PER_USER_POLICY';
      }
      seenUsers.add(hook.userId);
      const entrySequence = disposition === 'ELIGIBLE' ? ++sequence : null;
      return { hook, disposition, exclusionReason, entrySequence };
    });

    const snapshotHash = createHash('sha256')
      .update(
        candidates
          .map((candidate) =>
            [
              candidate.hook.id,
              candidate.hook.userId,
              new Date(candidate.hook.occurredAt).toISOString(),
              candidate.disposition,
              candidate.entrySequence ?? '',
              this.stableJson(candidate.hook.eligibilitySnapshot),
            ].join('|'),
          )
          .join('\n'),
      )
      .digest('hex');

    for (const candidate of candidates) {
      await connection.query(
        `INSERT INTO lucky_draw_entries
           (id, drawId, sourceHookId, userId, hookOccurredAt, disposition, exclusionReason,
            entrySequence, selectionScore, eligibilitySnapshot, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP(3))`,
        [
          randomUUID(),
          drawId,
          candidate.hook.id,
          candidate.hook.userId,
          candidate.hook.occurredAt,
          candidate.disposition,
          candidate.exclusionReason,
          candidate.entrySequence,
          this.jsonString(candidate.hook.eligibilitySnapshot),
        ],
      );
    }

    const eligibleEntryCount = candidates.filter((candidate) => candidate.disposition === 'ELIGIBLE').length;
    const candidateCount = candidates.length;
    const excludedEntryCount = candidateCount - eligibleEntryCount;
    await connection.query(
      `UPDATE lucky_draw_instances
       SET status = 'SNAPSHOTTED', snapshotHash = ?, candidateCount = ?, eligibleEntryCount = ?,
           excludedEntryCount = ?, snapshottedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [snapshotHash, candidateCount, eligibleEntryCount, excludedEntryCount, drawId],
    );
    return {
      idempotent: false,
      snapshotHash,
      candidateCount,
      eligibleEntryCount,
      excludedEntryCount,
    };
  }

  private async executeTransaction(
    connection: PoolConnection,
    drawId: string,
    selectionSeed: string,
  ) {
    await this.touchMutex(connection, drawId);
    const draw = await this.lockDraw(connection, drawId);
    const revealHash = createHash('sha256').update(selectionSeed).digest('hex');
    if (revealHash !== draw.seedCommitment.toLowerCase()) {
      throw new ConflictException('Selection seed does not match the committed seed hash');
    }
    if (draw.status === 'DRAWN') {
      if (draw.revealedSeed !== selectionSeed) {
        throw new ConflictException('Lucky draw has already been executed with a different seed reveal');
      }
      return {
        idempotent: true,
        snapshotHash: draw.snapshotHash,
        winnerCount: Number(draw.winnerCount),
        seedCommitment: draw.seedCommitment,
      };
    }
    if (draw.status !== 'SNAPSHOTTED') {
      throw new ConflictException('Lucky draw must have a frozen entrant snapshot before execution');
    }
    if (!draw.snapshotHash) throw new ConflictException('Lucky draw snapshot hash is missing');
    if (new Date(draw.drawAt).getTime() > Date.now()) {
      throw new ConflictException('Lucky draw cannot be executed before its scheduled draw time');
    }

    const entries = await connection.query<EntryRow[]>(
      `SELECT * FROM lucky_draw_entries
       WHERE drawId = ? AND disposition = 'ELIGIBLE'
       ORDER BY entrySequence ASC`,
      [drawId],
    );
    const prizeTiers = await connection.query<PrizeTierRow[]>(
      `SELECT * FROM lucky_draw_prize_tiers
       WHERE policyVersionId = ? ORDER BY tierOrder ASC`,
      [draw.policyVersionId],
    );
    if (prizeTiers.length === 0) throw new ConflictException('Lucky draw policy has no prize tiers');
    const configuredWinnerCount = prizeTiers.reduce(
      (sum, tier) => sum + Number(tier.winnerCount),
      0,
    );

    const scored: ScoredEntry[] = entries
      .map((entry) => ({
        ...entry,
        score: createHash('sha256')
          .update(
            [
              selectionSeed,
              drawId,
              draw.snapshotHash,
              String(entry.entrySequence ?? ''),
              entry.sourceHookId,
              entry.userId,
            ].join('|'),
          )
          .digest('hex'),
      }))
      .sort((left, right) =>
        left.score === right.score
          ? String(left.entrySequence).localeCompare(String(right.entrySequence))
          : left.score.localeCompare(right.score),
      );

    const selected: ScoredEntry[] = [];
    const selectedUsers = new Set<string>();
    for (const entry of scored) {
      if (selected.length >= configuredWinnerCount) break;
      if (!this.truthy(draw.allowMultipleWinsPerDraw) && selectedUsers.has(entry.userId)) continue;
      selected.push(entry);
      selectedUsers.add(entry.userId);
    }
    if (
      draw.insufficientEntrantsMode === 'REQUIRE_FULL' &&
      selected.length < configuredWinnerCount
    ) {
      throw new ConflictException(
        `Lucky draw requires ${configuredWinnerCount} winner slots but only ${selected.length} selectable entries are available`,
      );
    }

    for (const entry of scored) {
      await connection.query(
        `UPDATE lucky_draw_entries SET selectionScore = ? WHERE id = ?`,
        [entry.score, entry.id],
      );
    }

    let selectedIndex = 0;
    let overallRank = 1;
    for (const tier of prizeTiers) {
      for (let position = 1; position <= Number(tier.winnerCount); position += 1) {
        const entry = selected[selectedIndex];
        if (!entry) break;
        const outcomeSnapshot = {
          policyVersionId: draw.policyVersionId,
          policyId: draw.policyId,
          snapshotHash: draw.snapshotHash,
          selectionAlgorithm: this.selectionAlgorithm,
          seedCommitment: draw.seedCommitment,
          revealedSeed: selectionSeed,
          entrySequence: entry.entrySequence,
          sourceHookId: entry.sourceHookId,
          prizeTier: {
            id: tier.id,
            tierOrder: Number(tier.tierOrder),
            code: tier.code,
            name: tier.name,
            prizeKind: tier.prizeKind,
            cashAmount: tier.cashAmount === null ? null : String(tier.cashAmount),
            currencyCode: tier.currencyCode,
            prizeDefinition: this.parseJson(tier.prizeDefinition),
          },
        };
        await connection.query(
          `INSERT INTO lucky_draw_winners
             (id, drawId, entryId, userId, prizeTierId, overallRank, tierWinnerPosition,
              selectionScore, outcomeSnapshot, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          [
            randomUUID(),
            drawId,
            entry.id,
            entry.userId,
            tier.id,
            overallRank,
            position,
            entry.score,
            JSON.stringify(outcomeSnapshot),
          ],
        );
        selectedIndex += 1;
        overallRank += 1;
      }
      if (selectedIndex >= selected.length) break;
    }

    await connection.query(
      `UPDATE lucky_draw_instances
       SET status = 'DRAWN', revealedSeed = ?, selectionAlgorithm = ?, winnerCount = ?,
           drawnAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [selectionSeed, this.selectionAlgorithm, selected.length, drawId],
    );
    return {
      idempotent: false,
      snapshotHash: draw.snapshotHash,
      winnerCount: selected.length,
      seedCommitment: draw.seedCommitment,
    };
  }

  private async requirePublishedPolicyVersion(id: string, drawAt: Date): Promise<PolicyVersionRow> {
    const rows = await this.prisma.$queryRawUnsafe<PolicyVersionRow[]>(
      `SELECT id, policyId, programVersionId, lifecycle, effectiveFrom, effectiveTo
       FROM lucky_draw_policy_versions WHERE id = ? LIMIT 1`,
      id,
    );
    const version = rows[0];
    if (!version) throw new NotFoundException('Lucky draw policy version not found');
    if (version.lifecycle !== 'PUBLISHED') {
      throw new ConflictException('Lucky draw instance requires a published policy version');
    }
    if (
      new Date(version.effectiveFrom) > drawAt ||
      (version.effectiveTo && new Date(version.effectiveTo) < drawAt)
    ) {
      throw new ConflictException('Lucky draw policy version is not effective at draw time');
    }
    return version;
  }

  private async lockDraw(connection: PoolConnection, drawId: string): Promise<LockedDrawRow> {
    const rows = await connection.query<LockedDrawRow[]>(
      `SELECT d.*, v.policyId, v.programVersionId, v.lifecycle, v.effectiveFrom, v.effectiveTo,
              v.entryMode, v.priorWinnerMode, v.allowMultipleWinsPerDraw, v.insufficientEntrantsMode
       FROM lucky_draw_instances d
       INNER JOIN lucky_draw_policy_versions v ON v.id = d.policyVersionId
       WHERE d.id = ? FOR UPDATE`,
      [drawId],
    );
    const draw = rows[0];
    if (!draw) throw new NotFoundException('Lucky draw instance not found');
    return draw;
  }

  private async findDrawBySourceKey(sourceKey: string): Promise<DrawRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<DrawRow[]>(
      `SELECT * FROM lucky_draw_instances WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    return rows[0] ?? null;
  }

  private assertInstanceIdempotent(existing: DrawRow, fingerprint: string): void {
    if (existing.requestFingerprint !== fingerprint) {
      throw new ConflictException('Lucky draw source key already exists with a different payload');
    }
  }

  private validateDrawDates(start: Date, end: Date, drawAt: Date): void {
    if (![start, end, drawAt].every((date) => Number.isFinite(date.getTime()))) {
      throw new BadRequestException('Lucky draw dates must be valid ISO timestamps');
    }
    if (end <= start) throw new BadRequestException('entryWindowEnd must be later than entryWindowStart');
    if (drawAt < end) throw new BadRequestException('drawAt must be at or after entryWindowEnd');
  }

  private instanceFingerprint(
    policyVersionId: string,
    start: Date,
    end: Date,
    drawAt: Date,
    seedCommitment: string,
  ): string {
    return createHash('sha256')
      .update(
        [
          policyVersionId,
          start.toISOString(),
          end.toISOString(),
          drawAt.toISOString(),
          seedCommitment,
        ].join('|'),
      )
      .digest('hex');
  }

  private async ensureMutex(drawId: string): Promise<void> {
    await this.financialDb.execute(
      `INSERT INTO system_sequences (\`key\`, nextValue, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`,
      [`DRAW:${drawId}`],
    );
  }

  private async touchMutex(connection: PoolConnection, drawId: string): Promise<void> {
    await connection.query(
      `UPDATE system_sequences
       SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [`DRAW:${drawId}`],
    );
  }

  private truthy(value: boolean | number): boolean {
    return value === true || value === 1;
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value ?? null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private jsonString(value: unknown): string {
    return JSON.stringify(this.parseJson(value) ?? {});
  }

  private stableJson(value: unknown): string {
    const normalized = this.parseJson(value);
    return JSON.stringify(this.stableValue(normalized));
  }

  private stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.stableValue(item));
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object)
          .sort()
          .map((key) => [key, this.stableValue(object[key])]),
      );
    }
    return value;
  }
}
