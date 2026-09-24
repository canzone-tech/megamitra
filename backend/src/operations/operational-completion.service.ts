import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { OperationalListQueryDto } from './operational-read.dto';

type PageSpec = { page: number; limit: number; offset: number };
type CountRow = { total: bigint | number | string };
type Row = Record<string, unknown>;

@Injectable()
export class OperationalCompletionService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT
         (SELECT COUNT(*) FROM program_referral_refund_evaluations
          WHERE status = 'RECONCILIATION_REQUIRED') AS refundReconciliationAttention,
         (SELECT COUNT(*) FROM withdrawal_requests
          WHERE status IN ('REQUESTED','APPROVED','PROCESSING','PAYOUT_FAILED')) AS withdrawalAttention,
         (SELECT COUNT(*) FROM withdrawal_requests
          WHERE status = 'PAYOUT_FAILED') AS failedPayouts,
         (SELECT COUNT(*) FROM product_entitlements
          WHERE status = 'CLAIMED') AS entitlementFulfillmentAttention,
         (SELECT COUNT(DISTINCT e.id)
          FROM product_entitlements e
          INNER JOIN product_fulfillment_attempts a ON a.entitlementId = e.id
          WHERE e.status = 'CLAIMED' AND a.status = 'FAILED') AS failedProductFulfillments`,
    );
    return rows[0] ?? {};
  }

  async refunds(query: OperationalListQueryDto) {
    const page = this.page(query);
    const statusExpression = `CASE
      WHEN evaluation.status = 'RECONCILIATION_REQUIRED' OR run.status IN ('FAILED','RECONCILIATION_REQUIRED') THEN 'ATTENTION'
      WHEN evaluation.id IS NULL THEN 'PENDING_EVALUATION'
      ELSE evaluation.status
    END`;
    const filter = this.filters(query, 'refund.occurredAt', statusExpression, 'refund.currencyCode');
    const select = `FROM program_refund_records refund
      INNER JOIN program_enrollments enrollment ON enrollment.id = refund.enrollmentId
      INNER JOIN users member ON member.id = enrollment.userId
      LEFT JOIN program_referral_refund_evaluations evaluation ON evaluation.refundRecordId = refund.id
      LEFT JOIN program_business_events event ON event.refundRecordId = refund.id AND event.type = 'REFUND_CONFIRMED'
      LEFT JOIN program_event_processing_runs run ON run.businessEventId = event.id
      WHERE 1 = 1${filter.sql}`;
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT refund.id AS refundRecordId, refund.sourceKey AS refundSourceKey,
              refund.paymentRecordId, refund.enrollmentId, refund.amount AS refundAmount,
              refund.currencyCode, refund.occurredAt, refund.reason,
              member.id AS memberUserId, member.username AS memberUsername,
              event.id AS businessEventId, COALESCE(run.status, CASE WHEN event.id IS NULL THEN NULL ELSE 'UNPROCESSED' END) AS processingStatus,
              evaluation.id AS evaluationId, evaluation.status AS evaluationStatus,
              evaluation.reasonCode, evaluation.refundRuleMode, evaluation.refundedBasisAmount,
              evaluation.cumulativeRefundedBasis, evaluation.reversalAmount,
              evaluation.ledgerTransactionId AS reversalLedgerTransactionId,
              ${statusExpression} AS operationalStatus
       ${select}
       ORDER BY refund.occurredAt DESC, refund.id DESC
       LIMIT ? OFFSET ?`,
      ...filter.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...filter.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async withdrawals(query: OperationalListQueryDto) {
    const page = this.page(query);
    const filter = this.filters(query, 'requestRow.requestedAt', 'requestRow.status', 'requestRow.currencyCode');
    const attentionSql = query.status ? '' : ` AND requestRow.status IN ('REQUESTED','APPROVED','PROCESSING','PAYOUT_FAILED')`;
    const select = `FROM withdrawal_requests requestRow
      INNER JOIN users member ON member.id = requestRow.userId
      INNER JOIN withdrawal_destinations destination ON destination.id = requestRow.destinationId
      WHERE 1 = 1${attentionSql}${filter.sql}`;
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT requestRow.id, requestRow.userId, member.username, member.email,
              requestRow.status, requestRow.amount, requestRow.feeAmount, requestRow.netAmount,
              requestRow.currencyCode, requestRow.kycStatusSnapshot, requestRow.requestedAt,
              requestRow.processingAt, requestRow.failedAt, requestRow.failureReason,
              requestRow.ledgerTransactionId,
              destination.type AS destinationType, destination.label AS destinationLabel,
              (SELECT attempt.id FROM withdrawal_payout_attempts attempt
               WHERE attempt.requestId = requestRow.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestAttemptId,
              (SELECT attempt.status FROM withdrawal_payout_attempts attempt
               WHERE attempt.requestId = requestRow.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestAttemptStatus,
              (SELECT attempt.provider FROM withdrawal_payout_attempts attempt
               WHERE attempt.requestId = requestRow.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestProvider,
              (SELECT attempt.providerReference FROM withdrawal_payout_attempts attempt
               WHERE attempt.requestId = requestRow.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestProviderReference,
              (SELECT attempt.failureReason FROM withdrawal_payout_attempts attempt
               WHERE attempt.requestId = requestRow.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestAttemptFailureReason
       ${select}
       ORDER BY requestRow.requestedAt ASC, requestRow.id ASC
       LIMIT ? OFFSET ?`,
      ...filter.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...filter.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async entitlements(query: OperationalListQueryDto) {
    const page = this.page(query);
    const filter = this.filters(query, 'entitlement.grantedAt', 'entitlement.status');
    const attentionSql = query.status ? '' : ` AND entitlement.status IN ('GRANTED','CLAIMED')`;
    const select = `FROM product_entitlements entitlement
      INNER JOIN users member ON member.id = entitlement.userId
      INNER JOIN catalog_products product ON product.id = entitlement.productId
      WHERE 1 = 1${attentionSql}${filter.sql}`;
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT entitlement.id, entitlement.userId, member.username, member.email,
              entitlement.status, entitlement.quantity, entitlement.grantedAt,
              entitlement.claimDeadline, entitlement.claimedAt,
              product.code AS productCode, product.name AS productName, product.kind AS productKind,
              (SELECT attempt.id FROM product_fulfillment_attempts attempt
               WHERE attempt.entitlementId = entitlement.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestAttemptId,
              (SELECT attempt.status FROM product_fulfillment_attempts attempt
               WHERE attempt.entitlementId = entitlement.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestAttemptStatus,
              (SELECT attempt.provider FROM product_fulfillment_attempts attempt
               WHERE attempt.entitlementId = entitlement.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestProvider,
              (SELECT attempt.providerReference FROM product_fulfillment_attempts attempt
               WHERE attempt.entitlementId = entitlement.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestProviderReference,
              (SELECT attempt.failureReason FROM product_fulfillment_attempts attempt
               WHERE attempt.entitlementId = entitlement.id
               ORDER BY attempt.initiatedAt DESC, attempt.createdAt DESC LIMIT 1) AS latestAttemptFailureReason
       ${select}
       ORDER BY entitlement.grantedAt ASC, entitlement.id ASC
       LIMIT ? OFFSET ?`,
      ...filter.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...filter.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async history(query: OperationalListQueryDto) {
    const page = this.page(query);
    const filter = this.filters(query, 'audit.createdAt');
    const select = `FROM audit_logs audit
      LEFT JOIN users actor ON actor.id = audit.actorUserId
      WHERE (
        audit.entityType LIKE 'Program%' OR
        audit.entityType LIKE 'Withdrawal%' OR
        audit.entityType IN ('ProductEntitlement','ProductFulfillmentAttempt') OR
        audit.entityType LIKE 'LuckyDrawPrize%'
      )${filter.sql}`;
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT audit.id, audit.actorUserId, actor.username AS actorUsername,
              audit.action, audit.entityType, audit.entityId, audit.description,
              audit.metadata, audit.createdAt
       ${select}
       ORDER BY audit.createdAt DESC, audit.id DESC
       LIMIT ? OFFSET ?`,
      ...filter.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...filter.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  private page(query: OperationalListQueryDto): PageSpec {
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 25;
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be at least 1');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }
    return { page, limit, offset: (page - 1) * limit };
  }

  private filters(
    query: OperationalListQueryDto,
    dateColumn: string,
    statusColumn?: string,
    currencyColumn?: string,
  ) {
    const sql: string[] = [];
    const params: unknown[] = [];
    if (query.from) {
      sql.push(` AND ${dateColumn} >= ?`);
      params.push(new Date(query.from));
    }
    if (query.to) {
      sql.push(` AND ${dateColumn} <= ?`);
      params.push(new Date(query.to));
    }
    if (query.status) {
      if (!statusColumn) throw new BadRequestException('status filter is not supported for this endpoint');
      sql.push(` AND ${statusColumn} = ?`);
      params.push(query.status.toUpperCase());
    }
    if (query.currencyCode) {
      if (!currencyColumn) throw new BadRequestException('currencyCode filter is not supported for this endpoint');
      sql.push(` AND ${currencyColumn} = ?`);
      params.push(query.currencyCode.toUpperCase());
    }
    return { sql: sql.join(''), params };
  }

  private paginated(rows: Row[], totalValue: bigint | number | string | undefined, page: PageSpec) {
    const total = Number(totalValue ?? 0);
    return {
      items: rows,
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.limit)),
    };
  }
}
