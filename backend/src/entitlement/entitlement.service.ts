import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CancelEntitlementDto,
  ClaimEntitlementDto,
  CompleteProductFulfillmentDto,
  FailProductFulfillmentDto,
  ListEntitlementsDto,
  StartProductFulfillmentDto,
} from './entitlement.dto';
import { fingerprint, insertAudit, normalizeJsonFields, normalizeRow, type Row } from './entitlement.support';

type EntitlementRow = Row & { id: string; userId: string; status: string; claimDeadline: Date | string | null };
type AttemptRow = Row & { id: string; requestFingerprint: string; entitlementId: string; status: string };

@Injectable()
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
  ) {}

  async getMine(userId: string) {
    await this.expireDue();
    const [items, counts] = await Promise.all([
      this.prisma.$queryRawUnsafe<Row[]>(
        `SELECT e.id, e.status, e.quantity, e.productSnapshot, e.eligibilitySnapshot,
                e.grantedAt, e.claimDeadline, e.claimedAt, e.claimMetadata, e.fulfilledAt,
                e.cancelledAt, e.cancellationReason,
                cp.code AS productCode, cp.name AS productName, cp.kind AS productKind,
                cp.nominalValue, cp.currencyCode,
                p.code AS policyCode, p.name AS policyName, v.version AS policyVersion,
                pr.code AS programCode, pr.name AS programName
         FROM product_entitlements e
         INNER JOIN catalog_products cp ON cp.id = e.productId
         INNER JOIN entitlement_policy_versions v ON v.id = e.policyVersionId
         INNER JOIN entitlement_policies p ON p.id = v.policyId
         INNER JOIN program_enrollments pe ON pe.id = e.enrollmentId
         INNER JOIN program_versions pv ON pv.id = pe.programVersionId
         INNER JOIN programs pr ON pr.id = pv.programId
         WHERE e.userId = ? ORDER BY e.grantedAt DESC, e.createdAt DESC`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<Row[]>(
        `SELECT status, COUNT(*) AS count FROM product_entitlements WHERE userId = ? GROUP BY status`,
        userId,
      ),
    ]);
    return {
      items: items.map((row) => normalizeJsonFields(row, ['productSnapshot', 'eligibilitySnapshot', 'claimMetadata'])),
      counts: counts.map((row) => normalizeRow(row)),
    };
  }

  async claimMine(userId: string, id: string, dto: ClaimEntitlementDto) {
    return this.financialDb.transaction(async (connection) => {
      const item = await this.getItem(connection, id, true);
      if (String(item.userId) !== userId) throw new NotFoundException('Product entitlement not found');
      if (['CLAIMED', 'FULFILLED'].includes(String(item.status))) return item;
      if (String(item.status) !== 'GRANTED') throw new ConflictException(`Entitlement cannot be claimed from status ${String(item.status)}`);
      const deadline = item.claimDeadline ? new Date(String(item.claimDeadline)) : null;
      if (deadline && deadline.getTime() < Date.now()) {
        await connection.query(`UPDATE product_entitlements SET status = 'EXPIRED', updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`, [id]);
        throw new ConflictException('Product entitlement claim window has expired');
      }
      await connection.query(
        `UPDATE product_entitlements SET status = 'CLAIMED', claimedAt = CURRENT_TIMESTAMP(3),
         claimMetadata = ?, updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [dto.metadata ? JSON.stringify(dto.metadata) : null, id],
      );
      await insertAudit(connection, {
        actorUserId: userId,
        action: 'UPDATE',
        entityType: 'ProductEntitlement',
        entityId: id,
        description: 'Product entitlement claimed by member',
      });
      return this.getItem(connection, id);
    });
  }

  async listEntitlements(query: ListEntitlementsDto) {
    await this.expireDue();
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '25')));
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.status) { conditions.push('e.status = ?'); params.push(query.status); }
    if (query.q?.trim()) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR cp.code LIKE ? OR cp.name LIKE ?)');
      const pattern = `%${query.q.trim()}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRows = await this.prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS count FROM product_entitlements e
       INNER JOIN users u ON u.id = e.userId INNER JOIN catalog_products cp ON cp.id = e.productId ${where}`,
      ...params,
    );
    const items = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT e.id, e.status, e.quantity, e.productSnapshot, e.eligibilitySnapshot,
              e.grantedAt, e.claimDeadline, e.claimedAt, e.fulfilledAt, e.cancellationReason,
              u.username, u.email, cp.code AS productCode, cp.name AS productName, cp.kind AS productKind,
              p.code AS policyCode, p.name AS policyName, v.version AS policyVersion,
              pr.code AS programCode, pr.name AS programName
       FROM product_entitlements e
       INNER JOIN users u ON u.id = e.userId INNER JOIN catalog_products cp ON cp.id = e.productId
       INNER JOIN entitlement_policy_versions v ON v.id = e.policyVersionId
       INNER JOIN entitlement_policies p ON p.id = v.policyId
       INNER JOIN program_enrollments pe ON pe.id = e.enrollmentId
       INNER JOIN program_versions pv ON pv.id = pe.programVersionId INNER JOIN programs pr ON pr.id = pv.programId
       ${where} ORDER BY e.grantedAt DESC, e.createdAt DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      (page - 1) * limit,
    );
    const total = Number(countRows[0]?.count ?? 0);
    return { items: items.map((row) => normalizeJsonFields(row, ['productSnapshot', 'eligibilitySnapshot'])), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async getEntitlement(id: string) {
    await this.expireDue();
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT e.*, u.username, u.email, cp.code AS productCode, cp.name AS productName, cp.kind AS productKind,
              p.code AS policyCode, p.name AS policyName, v.version AS policyVersion,
              pr.code AS programCode, pr.name AS programName
       FROM product_entitlements e
       INNER JOIN users u ON u.id = e.userId INNER JOIN catalog_products cp ON cp.id = e.productId
       INNER JOIN entitlement_policy_versions v ON v.id = e.policyVersionId INNER JOIN entitlement_policies p ON p.id = v.policyId
       INNER JOIN program_enrollments pe ON pe.id = e.enrollmentId INNER JOIN program_versions pv ON pv.id = pe.programVersionId
       INNER JOIN programs pr ON pr.id = pv.programId WHERE e.id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Product entitlement not found');
    const attempts = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, sourceKey, status, provider, providerReference, metadata, initiatedAt, finalizedAt, failureReason, createdAt
       FROM product_fulfillment_attempts WHERE entitlementId = ? ORDER BY initiatedAt DESC, createdAt DESC`,
      id,
    );
    return {
      ...normalizeJsonFields(rows[0], ['productSnapshot', 'eligibilitySnapshot', 'claimMetadata']),
      fulfillmentAttempts: attempts.map((row) => normalizeJsonFields(row, ['metadata'])),
    };
  }

  async cancelEntitlement(id: string, actorUserId: string, dto: CancelEntitlementDto) {
    return this.financialDb.transaction(async (connection) => {
      const item = await this.getItem(connection, id, true);
      if (String(item.status) === 'CANCELLED') return item;
      if (!['GRANTED', 'CLAIMED'].includes(String(item.status))) throw new ConflictException('Only granted or claimed entitlements can be cancelled');
      await connection.query(
        `UPDATE product_entitlements SET status = 'CANCELLED', cancelledAt = CURRENT_TIMESTAMP(3),
         cancelledByUserId = ?, cancellationReason = ?, updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [actorUserId, dto.reason.trim(), id],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'ProductEntitlement',
        entityId: id,
        description: 'Product entitlement cancelled',
        metadata: { reason: dto.reason.trim() },
      });
      return this.getItem(connection, id);
    });
  }

  async startFulfillment(id: string, actorUserId: string, dto: StartProductFulfillmentDto) {
    const sourceKey = dto.sourceKey.trim();
    const requestFingerprint = fingerprint({
      entitlementId: id,
      provider: dto.provider.trim(),
      providerReference: dto.providerReference?.trim() ?? null,
      metadata: dto.metadata ?? null,
    });
    const replay = await this.prisma.$queryRawUnsafe<AttemptRow[]>(
      `SELECT id, requestFingerprint, entitlementId, status FROM product_fulfillment_attempts WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    if (replay[0]) return this.replayAttempt(replay[0], id, requestFingerprint);
    return this.financialDb.transaction(async (connection) => {
      const item = await this.getItem(connection, id, true);
      if (String(item.status) !== 'CLAIMED') throw new ConflictException('Only claimed entitlements can enter fulfillment');
      const lockedReplay = (await connection.query(
        `SELECT id, requestFingerprint, entitlementId, status FROM product_fulfillment_attempts WHERE sourceKey = ? LIMIT 1 FOR UPDATE`,
        [sourceKey],
      )) as AttemptRow[];
      if (lockedReplay[0]) return this.replayAttemptWithConnection(connection, lockedReplay[0], id, requestFingerprint);
      const attemptId = randomUUID();
      await connection.query(
        `INSERT INTO product_fulfillment_attempts
           (id, sourceKey, requestFingerprint, entitlementId, status, provider, providerReference,
            metadata, initiatedAt, createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'INITIATED', ?, ?, ?, CURRENT_TIMESTAMP(3), ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [attemptId, sourceKey, requestFingerprint, id, dto.provider.trim(), dto.providerReference?.trim() || null, dto.metadata ? JSON.stringify(dto.metadata) : null, actorUserId],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'ProductFulfillmentAttempt',
        entityId: attemptId,
        description: 'Product fulfillment attempt started',
        metadata: { entitlementId: id, provider: dto.provider.trim() },
      });
      return this.getAttempt(connection, attemptId);
    });
  }

  async completeFulfillment(attemptId: string, actorUserId: string, dto: CompleteProductFulfillmentDto) {
    return this.financialDb.transaction(async (connection) => {
      const attempt = await this.getAttempt(connection, attemptId, true);
      if (String(attempt.status) === 'FULFILLED') return attempt;
      if (String(attempt.status) !== 'INITIATED') throw new ConflictException('Only initiated product fulfillment attempts can be completed');
      const item = await this.getItem(connection, String(attempt.entitlementId), true);
      if (String(item.status) !== 'CLAIMED') throw new ConflictException('Entitlement is no longer claim-ready for fulfillment');
      await connection.query(
        `UPDATE product_fulfillment_attempts SET status = 'FULFILLED', providerReference = COALESCE(?, providerReference),
         metadata = COALESCE(?, metadata), finalizedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [dto.providerReference?.trim() || null, dto.metadata ? JSON.stringify(dto.metadata) : null, attemptId],
      );
      await connection.query(
        `UPDATE product_entitlements SET status = 'FULFILLED', fulfilledAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [String(attempt.entitlementId)],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'ProductFulfillmentAttempt',
        entityId: attemptId,
        description: 'Product fulfillment completed',
        metadata: { entitlementId: attempt.entitlementId },
      });
      return this.getAttempt(connection, attemptId);
    });
  }

  async failFulfillment(attemptId: string, actorUserId: string, dto: FailProductFulfillmentDto) {
    return this.financialDb.transaction(async (connection) => {
      const attempt = await this.getAttempt(connection, attemptId, true);
      if (String(attempt.status) === 'FAILED') return attempt;
      if (String(attempt.status) !== 'INITIATED') throw new ConflictException('Only initiated product fulfillment attempts can fail');
      await connection.query(
        `UPDATE product_fulfillment_attempts SET status = 'FAILED', failureReason = ?, metadata = COALESCE(?, metadata),
         finalizedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [dto.reason.trim(), dto.metadata ? JSON.stringify(dto.metadata) : null, attemptId],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'ProductFulfillmentAttempt',
        entityId: attemptId,
        description: 'Product fulfillment attempt failed',
        metadata: { entitlementId: attempt.entitlementId, reason: dto.reason.trim() },
      });
      return this.getAttempt(connection, attemptId);
    });
  }

  private async expireDue() {
    await this.prisma.$executeRawUnsafe(
      `UPDATE product_entitlements SET status = 'EXPIRED', updatedAt = CURRENT_TIMESTAMP(3)
       WHERE status = 'GRANTED' AND claimDeadline IS NOT NULL AND claimDeadline < CURRENT_TIMESTAMP(3)`,
    );
  }

  private async getItem(connection: PoolConnection, id: string, lock = false) {
    const rows = (await connection.query(
      `SELECT e.id, e.userId, e.enrollmentId, e.policyVersionId, e.productId, e.status, e.quantity,
              e.productSnapshot, e.eligibilitySnapshot, e.grantedAt, e.claimDeadline, e.claimedAt,
              e.claimMetadata, e.fulfilledAt, e.cancelledAt, e.cancellationReason,
              cp.code AS productCode, cp.name AS productName
       FROM product_entitlements e INNER JOIN catalog_products cp ON cp.id = e.productId
       WHERE e.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as EntitlementRow[];
    if (!rows[0]) throw new NotFoundException('Product entitlement not found');
    return normalizeJsonFields(rows[0], ['productSnapshot', 'eligibilitySnapshot', 'claimMetadata']);
  }

  private assertAttemptReplay(attempt: AttemptRow, entitlementId: string, requestFingerprint: string) {
    if (String(attempt.entitlementId) !== entitlementId || String(attempt.requestFingerprint) !== requestFingerprint) {
      throw new ConflictException('Fulfillment sourceKey was already used with different input');
    }
  }

  private async replayAttempt(attempt: AttemptRow, entitlementId: string, requestFingerprint: string) {
    this.assertAttemptReplay(attempt, entitlementId, requestFingerprint);
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, sourceKey, entitlementId, status, provider, providerReference, metadata,
              initiatedAt, finalizedAt, failureReason, createdAt, updatedAt
       FROM product_fulfillment_attempts WHERE id = ? LIMIT 1`,
      attempt.id,
    );
    if (!rows[0]) throw new NotFoundException('Product fulfillment attempt not found');
    return normalizeJsonFields(rows[0], ['metadata']);
  }

  private async replayAttemptWithConnection(connection: PoolConnection, attempt: AttemptRow, entitlementId: string, requestFingerprint: string) {
    this.assertAttemptReplay(attempt, entitlementId, requestFingerprint);
    return this.getAttempt(connection, attempt.id);
  }

  private async getAttempt(connection: PoolConnection, id: string, lock = false) {
    const rows = (await connection.query(
      `SELECT id, sourceKey, entitlementId, status, provider, providerReference, metadata,
              initiatedAt, finalizedAt, failureReason, createdAt, updatedAt
       FROM product_fulfillment_attempts WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Product fulfillment attempt not found');
    return normalizeJsonFields(rows[0], ['metadata']);
  }
}
