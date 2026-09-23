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
  CancelLuckyDrawPrizeClaimDto,
  ClaimLuckyDrawPrizeDto,
  ConfigureLuckyDrawFulfillmentRuleDto,
  FulfillLuckyDrawPrizeDto,
  ReverseLuckyDrawPrizeFulfillmentDto,
} from './lucky-draw-fulfillment.dto';

type ClaimStatus = 'PENDING' | 'CLAIMED' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED';
type PrizeKind = 'CASH' | 'ITEM' | 'BENEFIT' | 'OTHER';

type FulfillmentRuleRow = {
  id: string;
  policyVersionId: string;
  claimWindowDays: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ClaimRow = {
  id: string;
  winnerId: string;
  drawId: string;
  userId: string;
  policyVersionId: string;
  prizeTierId: string;
  fulfillmentRuleId: string;
  status: ClaimStatus;
  claimWindowDaysSnapshot: number;
  claimDeadline: Date;
  prizeKind: PrizeKind;
  cashAmount: string | number | null;
  currencyCode: string | null;
  prizeSnapshot: unknown;
  claimedAt: Date | null;
  claimedByUserId: string | null;
  claimMetadata: unknown;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type WinnerForClaimRow = {
  winnerId: string;
  drawId: string;
  userId: string;
  prizeTierId: string;
  policyVersionId: string;
  drawnAt: Date;
  outcomeSnapshot: unknown;
  prizeKind: PrizeKind;
  cashAmount: string | number | null;
  currencyCode: string | null;
  prizeDefinition: unknown;
  tierCode: string;
  tierName: string;
};

type FulfillmentRow = {
  id: string;
  sourceKey: string;
  requestFingerprint: string;
  claimId: string;
  winnerId: string;
  userId: string;
  fulfillmentType: 'CASH_LEDGER' | 'NON_CASH';
  prizeKind: PrizeKind;
  cashAmount: string | number | null;
  currencyCode: string | null;
  ledgerTransactionId: string | null;
  externalReference: string | null;
  fulfillmentSnapshot: unknown;
  metadata: unknown;
  occurredAt: Date;
  createdByUserId: string | null;
  createdAt: Date;
};

type ReversalRow = {
  id: string;
  sourceKey: string;
  requestFingerprint: string;
  fulfillmentId: string;
  ledgerTransactionId: string | null;
  reason: string;
  metadata: unknown;
  occurredAt: Date;
  createdByUserId: string | null;
  createdAt: Date;
};

type ClaimEventRow = {
  id: string;
  claimId: string;
  eventType: string;
  occurredAt: Date;
  actorUserId: string | null;
  metadata: unknown;
  createdAt: Date;
};

type LockedClaimRow = ClaimRow & {
  username: string;
};

@Injectable()
export class LuckyDrawFulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
  ) {}

  async configureRule(
    policyVersionId: string,
    dto: ConfigureLuckyDrawFulfillmentRuleDto,
    actorUserId: string,
  ) {
    if (!Number.isInteger(dto.claimWindowDays) || dto.claimWindowDays < 0 || dto.claimWindowDays > 36500) {
      throw new BadRequestException('claimWindowDays must be an integer between 0 and 36500');
    }
    await this.financialDb.transaction(async (connection) => {
      const versions = await connection.query<Array<{ lifecycle: string }>>(
        `SELECT lifecycle FROM lucky_draw_policy_versions WHERE id = ? FOR UPDATE`,
        [policyVersionId],
      );
      const version = versions[0];
      if (!version) throw new NotFoundException('Lucky draw policy version not found');
      if (version.lifecycle !== 'DRAFT') {
        throw new ConflictException('Published or retired lucky draw fulfillment rules are immutable');
      }
      await connection.query(
        `INSERT INTO lucky_draw_fulfillment_rules
           (id, policyVersionId, claimWindowDays, createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE claimWindowDays = VALUES(claimWindowDays), updatedAt = CURRENT_TIMESTAMP(3)`,
        [randomUUID(), policyVersionId, dto.claimWindowDays, actorUserId],
      );
    });
    const rule = await this.getRule(policyVersionId);
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'LuckyDrawFulfillmentRule',
      entityId: rule.id,
      description: 'Lucky draw prize fulfillment rule configured',
      metadata: { policyVersionId, claimWindowDays: dto.claimWindowDays },
    });
    return rule;
  }

  async getRule(policyVersionId: string) {
    const rows = await this.prisma.$queryRawUnsafe<FulfillmentRuleRow[]>(
      `SELECT * FROM lucky_draw_fulfillment_rules WHERE policyVersionId = ? LIMIT 1`,
      policyVersionId,
    );
    if (!rows[0]) throw new NotFoundException('Lucky draw fulfillment rule not found');
    return rows[0];
  }

  async initializeClaims(drawId: string, actorUserId: string) {
    const drawRows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; status: string; policyVersionId: string; drawnAt: Date | null }>
    >(
      `SELECT id, status, policyVersionId, drawnAt FROM lucky_draw_instances WHERE id = ? LIMIT 1`,
      drawId,
    );
    const draw = drawRows[0];
    if (!draw) throw new NotFoundException('Lucky draw instance not found');
    if (draw.status !== 'DRAWN' || !draw.drawnAt) {
      throw new ConflictException('Prize claims can only be initialized after the lucky draw is executed');
    }
    const rule = await this.getRule(draw.policyVersionId);
    const winners = await this.prisma.$queryRawUnsafe<WinnerForClaimRow[]>(
      `SELECT w.id AS winnerId, w.drawId, w.userId, w.prizeTierId,
              d.policyVersionId, d.drawnAt, w.outcomeSnapshot,
              t.prizeKind, t.cashAmount, t.currencyCode, t.prizeDefinition,
              t.code AS tierCode, t.name AS tierName
       FROM lucky_draw_winners w
       INNER JOIN lucky_draw_instances d ON d.id = w.drawId
       INNER JOIN lucky_draw_prize_tiers t ON t.id = w.prizeTierId
       WHERE w.drawId = ?
       ORDER BY w.overallRank ASC`,
      drawId,
    );

    let created = 0;
    for (const winner of winners) {
      const claimId = randomUUID();
      const claimDeadline = new Date(
        new Date(winner.drawnAt).getTime() + Number(rule.claimWindowDays) * 86_400_000,
      );
      const prizeSnapshot = {
        winnerOutcome: this.parseJson(winner.outcomeSnapshot),
        fulfillmentRule: {
          id: rule.id,
          policyVersionId: rule.policyVersionId,
          claimWindowDays: Number(rule.claimWindowDays),
        },
        prizeTier: {
          id: winner.prizeTierId,
          code: winner.tierCode,
          name: winner.tierName,
          prizeKind: winner.prizeKind,
          cashAmount: winner.cashAmount === null ? null : String(winner.cashAmount),
          currencyCode: winner.currencyCode,
          prizeDefinition: this.parseJson(winner.prizeDefinition),
        },
      };
      const result = await this.prisma.$executeRawUnsafe(
        `INSERT IGNORE INTO lucky_draw_prize_claims
           (id, winnerId, drawId, userId, policyVersionId, prizeTierId, fulfillmentRuleId,
            status, claimWindowDaysSnapshot, claimDeadline, prizeKind, cashAmount, currencyCode,
            prizeSnapshot, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        claimId,
        winner.winnerId,
        winner.drawId,
        winner.userId,
        winner.policyVersionId,
        winner.prizeTierId,
        rule.id,
        Number(rule.claimWindowDays),
        claimDeadline,
        winner.prizeKind,
        winner.cashAmount === null ? null : String(winner.cashAmount),
        winner.currencyCode,
        JSON.stringify(prizeSnapshot),
      );
      if (Number(result) > 0) {
        created += 1;
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO lucky_draw_prize_claim_events
             (id, claimId, eventType, occurredAt, actorUserId, metadata, createdAt)
           VALUES (?, ?, 'CREATED', ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          randomUUID(),
          claimId,
          winner.drawnAt,
          actorUserId,
          JSON.stringify({ claimDeadline: claimDeadline.toISOString() }),
        );
      }
    }
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'LuckyDrawPrizeClaims',
      entityId: drawId,
      description: 'Lucky draw prize claims initialized from immutable winners',
      metadata: { winnerCount: winners.length, claimsCreated: created, fulfillmentRuleId: rule.id },
    });
    return { drawId, winnerCount: winners.length, claimsCreated: created, claims: await this.listClaims({ drawId }) };
  }

  async claim(claimId: string, dto: ClaimLuckyDrawPrizeDto, actorUserId: string) {
    const occurredAt = this.validDate(dto.occurredAt, 'occurredAt');
    const result = await this.financialDb.transaction(async (connection) => {
      const claim = await this.lockClaim(connection, claimId);
      if (claim.status === 'CLAIMED' || claim.status === 'FULFILLED') {
        return { idempotent: true, status: claim.status };
      }
      if (claim.status !== 'PENDING') {
        throw new ConflictException(`Prize claim cannot be claimed from status ${claim.status}`);
      }
      const deadline = new Date(claim.claimDeadline);
      if (occurredAt > deadline || new Date() > deadline) {
        await connection.query(
          `UPDATE lucky_draw_prize_claims
           SET status = 'EXPIRED', updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [claimId],
        );
        await this.insertClaimEvent(connection, claimId, 'EXPIRED', new Date(), actorUserId, {
          reason: 'CLAIM_WINDOW_EXPIRED',
          claimDeadline: deadline.toISOString(),
        });
        return { idempotent: false, status: 'EXPIRED' as ClaimStatus };
      }
      await connection.query(
        `UPDATE lucky_draw_prize_claims
         SET status = 'CLAIMED', claimedAt = ?, claimedByUserId = ?, claimMetadata = ?,
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [occurredAt, actorUserId, dto.metadata ? JSON.stringify(dto.metadata) : null, claimId],
      );
      await this.insertClaimEvent(connection, claimId, 'CLAIMED', occurredAt, actorUserId, dto.metadata ?? {});
      return { idempotent: false, status: 'CLAIMED' as ClaimStatus };
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'LuckyDrawPrizeClaim',
      entityId: claimId,
      description: result.status === 'EXPIRED' ? 'Lucky draw prize claim expired at claim attempt' : 'Lucky draw prize claimed',
      metadata: { status: result.status, idempotent: result.idempotent },
    });
    return { claim: await this.getClaim(claimId), idempotent: result.idempotent };
  }

  async fulfill(claimId: string, dto: FulfillLuckyDrawPrizeDto, actorUserId: string) {
    const occurredAt = this.validDate(dto.occurredAt, 'occurredAt');
    const externalReference = dto.externalReference?.trim() || null;
    const fingerprint = this.fingerprint([
      claimId,
      occurredAt.toISOString(),
      externalReference ?? '',
      this.stableJson(dto.metadata ?? {}),
    ]);
    const existingBySource = await this.findFulfillmentBySourceKey(dto.sourceKey);
    if (existingBySource) {
      this.assertFulfillmentIdempotent(existingBySource, claimId, fingerprint);
      return { claim: await this.getClaim(claimId), fulfillment: existingBySource, idempotent: true };
    }

    await this.ensureMutex(`LUCKY_DRAW_CLAIM:${claimId}`);
    let fulfillmentId: string;
    try {
      fulfillmentId = await this.financialDb.transaction((connection) =>
        this.fulfillTransaction(
          connection,
          claimId,
          dto,
          actorUserId,
          occurredAt,
          externalReference,
          fingerprint,
        ),
      );
    } catch (error) {
      const raced = await this.findFulfillmentBySourceKey(dto.sourceKey);
      if (raced) {
        this.assertFulfillmentIdempotent(raced, claimId, fingerprint);
        return { claim: await this.getClaim(claimId), fulfillment: raced, idempotent: true };
      }
      throw error;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'LuckyDrawPrizeFulfillment',
      entityId: fulfillmentId,
      description: 'Lucky draw prize fulfillment completed',
      metadata: { claimId, sourceKey: dto.sourceKey },
    });
    return {
      claim: await this.getClaim(claimId),
      fulfillment: await this.getFulfillment(fulfillmentId),
      idempotent: false,
    };
  }

  async cancelClaim(claimId: string, dto: CancelLuckyDrawPrizeClaimDto, actorUserId: string) {
    const occurredAt = this.validDate(dto.occurredAt, 'occurredAt');
    const reason = dto.reason.trim();
    const result = await this.financialDb.transaction(async (connection) => {
      const claim = await this.lockClaim(connection, claimId);
      if (claim.status === 'CANCELLED') return { idempotent: true };
      if (claim.status === 'FULFILLED') {
        throw new ConflictException('Fulfilled prize claims must be reversed through the fulfillment reversal endpoint');
      }
      if (claim.status === 'EXPIRED') {
        throw new ConflictException('Expired prize claims cannot be cancelled');
      }
      await connection.query(
        `UPDATE lucky_draw_prize_claims
         SET status = 'CANCELLED', cancelledAt = ?, cancelledByUserId = ?, cancellationReason = ?,
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [occurredAt, actorUserId, reason, claimId],
      );
      await this.insertClaimEvent(connection, claimId, 'CANCELLED', occurredAt, actorUserId, {
        reason,
        ...(dto.metadata ?? {}),
      });
      return { idempotent: false };
    });
    if (!result.idempotent) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.UPDATE,
        entityType: 'LuckyDrawPrizeClaim',
        entityId: claimId,
        description: 'Lucky draw prize claim cancelled before fulfillment',
        metadata: { reason },
      });
    }
    return { claim: await this.getClaim(claimId), idempotent: result.idempotent };
  }

  async reverseFulfillment(
    fulfillmentId: string,
    dto: ReverseLuckyDrawPrizeFulfillmentDto,
    actorUserId: string,
  ) {
    const occurredAt = this.validDate(dto.occurredAt, 'occurredAt');
    const reason = dto.reason.trim();
    const fingerprint = this.fingerprint([
      fulfillmentId,
      occurredAt.toISOString(),
      reason,
      this.stableJson(dto.metadata ?? {}),
    ]);
    const existingBySource = await this.findReversalBySourceKey(dto.sourceKey);
    if (existingBySource) {
      this.assertReversalIdempotent(existingBySource, fulfillmentId, fingerprint);
      return {
        fulfillment: await this.getFulfillment(fulfillmentId),
        reversal: existingBySource,
        idempotent: true,
      };
    }

    await this.ensureMutex(`LUCKY_DRAW_FULFILLMENT:${fulfillmentId}`);
    let reversalId: string;
    try {
      reversalId = await this.financialDb.transaction((connection) =>
        this.reverseTransaction(
          connection,
          fulfillmentId,
          dto,
          actorUserId,
          occurredAt,
          reason,
          fingerprint,
        ),
      );
    } catch (error) {
      const raced = await this.findReversalBySourceKey(dto.sourceKey);
      if (raced) {
        this.assertReversalIdempotent(raced, fulfillmentId, fingerprint);
        return {
          fulfillment: await this.getFulfillment(fulfillmentId),
          reversal: raced,
          idempotent: true,
        };
      }
      throw error;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'LuckyDrawPrizeFulfillmentReversal',
      entityId: reversalId,
      description: 'Lucky draw prize fulfillment reversed without mutating original fulfillment',
      metadata: { fulfillmentId, reason },
    });
    return {
      fulfillment: await this.getFulfillment(fulfillmentId),
      reversal: await this.getReversal(reversalId),
      idempotent: false,
    };
  }

  async expirePending(actorUserId: string, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM lucky_draw_prize_claims
       WHERE status = 'PENDING' AND claimDeadline < CURRENT_TIMESTAMP(3)
       ORDER BY claimDeadline ASC, createdAt ASC
       LIMIT ${safeLimit}`,
    );
    let expired = 0;
    for (const row of rows) {
      const changed = await this.financialDb.transaction(async (connection) => {
        const claim = await this.lockClaim(connection, row.id);
        if (claim.status !== 'PENDING' || new Date(claim.claimDeadline) >= new Date()) return false;
        const now = new Date();
        await connection.query(
          `UPDATE lucky_draw_prize_claims SET status = 'EXPIRED', updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [row.id],
        );
        await this.insertClaimEvent(connection, row.id, 'EXPIRED', now, actorUserId, {
          reason: 'CLAIM_WINDOW_EXPIRED',
        });
        return true;
      });
      if (changed) expired += 1;
    }
    if (expired > 0) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.UPDATE,
        entityType: 'LuckyDrawPrizeClaims',
        entityId: 'expire-pending',
        description: 'Expired lucky draw prize claims past their claim deadline',
        metadata: { expired, scanned: rows.length },
      });
    }
    return { scanned: rows.length, expired };
  }

  async getClaim(claimId: string) {
    const rows = await this.prisma.$queryRawUnsafe<ClaimRow[]>(
      `SELECT * FROM lucky_draw_prize_claims WHERE id = ? LIMIT 1`,
      claimId,
    );
    const claim = rows[0];
    if (!claim) throw new NotFoundException('Lucky draw prize claim not found');
    const [events, fulfillments] = await Promise.all([
      this.prisma.$queryRawUnsafe<ClaimEventRow[]>(
        `SELECT * FROM lucky_draw_prize_claim_events WHERE claimId = ? ORDER BY occurredAt ASC, createdAt ASC`,
        claimId,
      ),
      this.prisma.$queryRawUnsafe<FulfillmentRow[]>(
        `SELECT * FROM lucky_draw_prize_fulfillments WHERE claimId = ? LIMIT 1`,
        claimId,
      ),
    ]);
    const fulfillment = fulfillments[0] ?? null;
    const reversal = fulfillment
      ? (
          await this.prisma.$queryRawUnsafe<ReversalRow[]>(
            `SELECT * FROM lucky_draw_prize_fulfillment_reversals WHERE fulfillmentId = ? LIMIT 1`,
            fulfillment.id,
          )
        )[0] ?? null
      : null;
    return { ...claim, events, fulfillment, reversal };
  }

  async listClaims(filters: { drawId?: string; userId?: string; status?: string }) {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.drawId) {
      clauses.push('drawId = ?');
      values.push(filters.drawId);
    }
    if (filters.userId) {
      clauses.push('userId = ?');
      values.push(filters.userId);
    }
    if (filters.status) {
      const allowed: ClaimStatus[] = ['PENDING', 'CLAIMED', 'FULFILLED', 'EXPIRED', 'CANCELLED'];
      if (!allowed.includes(filters.status as ClaimStatus)) {
        throw new BadRequestException('Unsupported lucky draw prize claim status');
      }
      clauses.push('status = ?');
      values.push(filters.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.prisma.$queryRawUnsafe<ClaimRow[]>(
      `SELECT * FROM lucky_draw_prize_claims ${where} ORDER BY claimDeadline ASC, createdAt ASC`,
      ...values,
    );
  }

  async getFulfillment(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<FulfillmentRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillments WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Lucky draw prize fulfillment not found');
    return rows[0];
  }

  async getReversal(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<ReversalRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillment_reversals WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Lucky draw prize fulfillment reversal not found');
    return rows[0];
  }

  private async fulfillTransaction(
    connection: PoolConnection,
    claimId: string,
    dto: FulfillLuckyDrawPrizeDto,
    actorUserId: string,
    occurredAt: Date,
    externalReference: string | null,
    fingerprint: string,
  ): Promise<string> {
    await this.touchMutex(connection, `LUCKY_DRAW_CLAIM:${claimId}`);
    const claim = await this.lockClaim(connection, claimId);
    const bySource = await connection.query<FulfillmentRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillments WHERE sourceKey = ? LIMIT 1`,
      [dto.sourceKey],
    );
    if (bySource[0]) {
      this.assertFulfillmentIdempotent(bySource[0], claimId, fingerprint);
      return bySource[0].id;
    }
    const byClaim = await connection.query<FulfillmentRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillments WHERE claimId = ? LIMIT 1`,
      [claimId],
    );
    if (byClaim[0]) {
      throw new ConflictException('Lucky draw prize claim is already fulfilled under a different source key');
    }
    if (claim.status !== 'CLAIMED') {
      throw new ConflictException('Lucky draw prize must be claimed before fulfillment');
    }

    const fulfillmentType = claim.prizeKind === 'CASH' ? 'CASH_LEDGER' : 'NON_CASH';
    let ledgerTransactionId: string | null = null;
    if (claim.prizeKind === 'CASH') {
      if (claim.cashAmount === null || !claim.currencyCode) {
        throw new ConflictException('Cash prize claim is missing its immutable amount or currency snapshot');
      }
      ledgerTransactionId = await this.postCashPrize(
        connection,
        dto.sourceKey,
        claim,
        actorUserId,
        occurredAt,
      );
    } else if (!externalReference) {
      throw new BadRequestException('Non-cash prize fulfillment requires externalReference');
    }

    const fulfillmentId = randomUUID();
    const snapshot = {
      claimId,
      winnerId: claim.winnerId,
      drawId: claim.drawId,
      userId: claim.userId,
      prizeKind: claim.prizeKind,
      cashAmount: claim.cashAmount === null ? null : String(claim.cashAmount),
      currencyCode: claim.currencyCode,
      prizeSnapshot: this.parseJson(claim.prizeSnapshot),
      fulfillmentType,
      externalReference,
    };
    await connection.query(
      `INSERT INTO lucky_draw_prize_fulfillments
         (id, sourceKey, requestFingerprint, claimId, winnerId, userId, fulfillmentType,
          prizeKind, cashAmount, currencyCode, ledgerTransactionId, externalReference,
          fulfillmentSnapshot, metadata, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        fulfillmentId,
        dto.sourceKey,
        fingerprint,
        claimId,
        claim.winnerId,
        claim.userId,
        fulfillmentType,
        claim.prizeKind,
        claim.cashAmount === null ? null : String(claim.cashAmount),
        claim.currencyCode,
        ledgerTransactionId,
        externalReference,
        JSON.stringify(snapshot),
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        occurredAt,
        actorUserId,
      ],
    );
    await connection.query(
      `UPDATE lucky_draw_prize_claims SET status = 'FULFILLED', updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [claimId],
    );
    await this.insertClaimEvent(connection, claimId, 'FULFILLED', occurredAt, actorUserId, {
      fulfillmentId,
      fulfillmentType,
      ledgerTransactionId,
      externalReference,
    });
    return fulfillmentId;
  }

  private async reverseTransaction(
    connection: PoolConnection,
    fulfillmentId: string,
    dto: ReverseLuckyDrawPrizeFulfillmentDto,
    actorUserId: string,
    occurredAt: Date,
    reason: string,
    fingerprint: string,
  ): Promise<string> {
    await this.touchMutex(connection, `LUCKY_DRAW_FULFILLMENT:${fulfillmentId}`);
    const rows = await connection.query<
      Array<FulfillmentRow & { claimStatus: ClaimStatus; username: string }>
    >(
      `SELECT f.*, c.status AS claimStatus, u.username
       FROM lucky_draw_prize_fulfillments f
       INNER JOIN lucky_draw_prize_claims c ON c.id = f.claimId
       INNER JOIN users u ON u.id = f.userId
       WHERE f.id = ? FOR UPDATE`,
      [fulfillmentId],
    );
    const fulfillment = rows[0];
    if (!fulfillment) throw new NotFoundException('Lucky draw prize fulfillment not found');

    const bySource = await connection.query<ReversalRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillment_reversals WHERE sourceKey = ? LIMIT 1`,
      [dto.sourceKey],
    );
    if (bySource[0]) {
      this.assertReversalIdempotent(bySource[0], fulfillmentId, fingerprint);
      return bySource[0].id;
    }
    const prior = await connection.query<ReversalRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillment_reversals WHERE fulfillmentId = ? LIMIT 1`,
      [fulfillmentId],
    );
    if (prior[0]) {
      throw new ConflictException('Lucky draw prize fulfillment is already reversed under a different source key');
    }
    if (fulfillment.claimStatus !== 'FULFILLED') {
      throw new ConflictException('Only a fulfilled lucky draw prize can be reversed');
    }

    let ledgerTransactionId: string | null = null;
    if (fulfillment.fulfillmentType === 'CASH_LEDGER') {
      if (fulfillment.cashAmount === null || !fulfillment.currencyCode) {
        throw new ConflictException('Cash prize fulfillment is missing amount or currency');
      }
      ledgerTransactionId = await this.postCashPrizeReversal(
        connection,
        dto.sourceKey,
        fulfillment,
        actorUserId,
        occurredAt,
      );
    }

    const reversalId = randomUUID();
    await connection.query(
      `INSERT INTO lucky_draw_prize_fulfillment_reversals
         (id, sourceKey, requestFingerprint, fulfillmentId, ledgerTransactionId, reason,
          metadata, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        reversalId,
        dto.sourceKey,
        fingerprint,
        fulfillmentId,
        ledgerTransactionId,
        reason,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        occurredAt,
        actorUserId,
      ],
    );
    await connection.query(
      `UPDATE lucky_draw_prize_claims
       SET status = 'CANCELLED', cancelledAt = ?, cancelledByUserId = ?, cancellationReason = ?,
           updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [occurredAt, actorUserId, reason, fulfillment.claimId],
    );
    await this.insertClaimEvent(
      connection,
      fulfillment.claimId,
      'FULFILLMENT_REVERSED',
      occurredAt,
      actorUserId,
      { fulfillmentId, reversalId, ledgerTransactionId, reason },
    );
    return reversalId;
  }

  private async postCashPrize(
    connection: PoolConnection,
    sourceKey: string,
    claim: LockedClaimRow,
    actorUserId: string,
    occurredAt: Date,
  ): Promise<string> {
    const amount = String(claim.cashAmount);
    const currency = String(claim.currencyCode).toUpperCase();
    const walletCode = `USER_WALLET:${claim.userId}:${currency}`;
    const expenseCode = `LUCKY_DRAW_PRIZE_EXPENSE:${currency}`;
    await this.ensureLedgerAccount(
      connection,
      walletCode,
      `${claim.username} wallet ${currency}`,
      'USER_WALLET',
      claim.userId,
      currency,
    );
    await this.ensureLedgerAccount(
      connection,
      expenseCode,
      `Lucky draw prize expense ${currency}`,
      'LUCKY_DRAW_PRIZE_EXPENSE',
      null,
      currency,
    );
    const walletId = await this.ledgerAccountId(connection, walletCode);
    const expenseId = await this.ledgerAccountId(connection, expenseCode);
    const transactionId = randomUUID();
    await connection.query(
      `INSERT INTO ledger_transactions
         (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, 'LUCKY_DRAW_PRIZE_PAYOUT', ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        transactionId,
        `LUCKY_DRAW_PRIZE:${sourceKey}`,
        `Lucky draw cash prize for winner ${claim.username}`,
        occurredAt,
        actorUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ledger_entries
         (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
       VALUES
         (?, ?, ?, 'DEBIT', ?, ?, CURRENT_TIMESTAMP(3)),
         (?, ?, ?, 'CREDIT', ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        transactionId,
        expenseId,
        amount,
        currency,
        randomUUID(),
        transactionId,
        walletId,
        amount,
        currency,
      ],
    );
    return transactionId;
  }

  private async postCashPrizeReversal(
    connection: PoolConnection,
    sourceKey: string,
    fulfillment: FulfillmentRow & { username: string },
    actorUserId: string,
    occurredAt: Date,
  ): Promise<string> {
    const amount = String(fulfillment.cashAmount);
    const currency = String(fulfillment.currencyCode).toUpperCase();
    const walletCode = `USER_WALLET:${fulfillment.userId}:${currency}`;
    const expenseCode = `LUCKY_DRAW_PRIZE_EXPENSE:${currency}`;
    const walletId = await this.ledgerAccountId(connection, walletCode);
    const expenseId = await this.ledgerAccountId(connection, expenseCode);
    const transactionId = randomUUID();
    await connection.query(
      `INSERT INTO ledger_transactions
         (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, 'REVERSAL', ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        transactionId,
        `LUCKY_DRAW_PRIZE_REVERSAL:${sourceKey}`,
        `Reversal of lucky draw cash prize for ${fulfillment.username}`,
        occurredAt,
        actorUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ledger_entries
         (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
       VALUES
         (?, ?, ?, 'DEBIT', ?, ?, CURRENT_TIMESTAMP(3)),
         (?, ?, ?, 'CREDIT', ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        transactionId,
        walletId,
        amount,
        currency,
        randomUUID(),
        transactionId,
        expenseId,
        amount,
        currency,
      ],
    );
    return transactionId;
  }

  private async lockClaim(connection: PoolConnection, claimId: string): Promise<LockedClaimRow> {
    const rows = await connection.query<LockedClaimRow[]>(
      `SELECT c.*, u.username
       FROM lucky_draw_prize_claims c
       INNER JOIN users u ON u.id = c.userId
       WHERE c.id = ? FOR UPDATE`,
      [claimId],
    );
    if (!rows[0]) throw new NotFoundException('Lucky draw prize claim not found');
    return rows[0];
  }

  private async insertClaimEvent(
    connection: PoolConnection,
    claimId: string,
    eventType: string,
    occurredAt: Date,
    actorUserId: string | null,
    metadata: Record<string, unknown>,
  ) {
    await connection.query(
      `INSERT INTO lucky_draw_prize_claim_events
         (id, claimId, eventType, occurredAt, actorUserId, metadata, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [randomUUID(), claimId, eventType, occurredAt, actorUserId, JSON.stringify(metadata)],
    );
  }

  private async ensureLedgerAccount(
    connection: PoolConnection,
    code: string,
    name: string,
    kind: string,
    ownerUserId: string | null,
    currencyCode: string,
  ) {
    await connection.query(
      `INSERT INTO ledger_accounts
         (id, code, name, kind, ownerUserId, currencyCode, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE code = VALUES(code)`,
      [randomUUID(), code, name, kind, ownerUserId, currencyCode],
    );
  }

  private async ledgerAccountId(connection: PoolConnection, code: string) {
    const rows = await connection.query<Array<{ id: string }>>(
      `SELECT id FROM ledger_accounts WHERE code = ? LIMIT 1`,
      [code],
    );
    if (!rows[0]) throw new ConflictException('Ledger account could not be resolved');
    return rows[0].id;
  }

  private async ensureMutex(key: string) {
    await this.financialDb.execute(
      `INSERT INTO system_sequences (\`key\`, nextValue, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`,
      [key],
    );
  }

  private async touchMutex(connection: PoolConnection, key: string) {
    await connection.query(
      `UPDATE system_sequences SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [key],
    );
  }

  private async findFulfillmentBySourceKey(sourceKey: string) {
    const rows = await this.prisma.$queryRawUnsafe<FulfillmentRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillments WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    return rows[0] ?? null;
  }

  private async findReversalBySourceKey(sourceKey: string) {
    const rows = await this.prisma.$queryRawUnsafe<ReversalRow[]>(
      `SELECT * FROM lucky_draw_prize_fulfillment_reversals WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    return rows[0] ?? null;
  }

  private assertFulfillmentIdempotent(
    existing: FulfillmentRow,
    claimId: string,
    fingerprint: string,
  ) {
    if (existing.claimId !== claimId || existing.requestFingerprint !== fingerprint) {
      throw new ConflictException('Prize fulfillment source key already exists with a different payload');
    }
  }

  private assertReversalIdempotent(
    existing: ReversalRow,
    fulfillmentId: string,
    fingerprint: string,
  ) {
    if (existing.fulfillmentId !== fulfillmentId || existing.requestFingerprint !== fingerprint) {
      throw new ConflictException('Prize fulfillment reversal source key already exists with a different payload');
    }
  }

  private validDate(raw: string, field: string) {
    const value = new Date(raw);
    if (!Number.isFinite(value.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return value;
  }

  private fingerprint(parts: string[]) {
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    if (typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableJson(object[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private parseJson(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
}
