import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { OperationalListQueryDto } from './operational-read.dto';

type PageSpec = {
  page: number;
  limit: number;
  offset: number;
};

type CountRow = { total: bigint | number | string };
type GenericRow = Record<string, unknown>;

@Injectable()
export class OperationalReadService {
  constructor(private readonly prisma: PrismaService) {}

  async memberDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        status: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [wallets, enrollmentCounts, dues, referralRewards, pairSummary, unitQueues, drawCounts, claimCounts] =
      await Promise.all([
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT a.id AS accountId, a.currencyCode,
                  COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END), 0) AS balance
           FROM ledger_accounts a
           LEFT JOIN ledger_entries e ON e.accountId = a.id
           WHERE a.ownerUserId = ? AND a.kind = 'USER_WALLET'
           GROUP BY a.id, a.currencyCode
           ORDER BY a.currencyCode ASC, a.id ASC`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT status, COUNT(*) AS count
           FROM program_enrollments
           WHERE userId = ?
           GROUP BY status
           ORDER BY status ASC`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT e.currencyCode,
                  SUM(e.registrationFeeSnapshot + (e.installmentAmountSnapshot * e.installmentCountSnapshot)) AS obligationAmount,
                  SUM(GREATEST(
                    (e.registrationFeeSnapshot + (e.installmentAmountSnapshot * e.installmentCountSnapshot))
                    - (COALESCE(p.appliedAmount, 0) - COALESCE(r.refundedAmount, 0)),
                    0
                  )) AS outstandingAmount
           FROM program_enrollments e
           LEFT JOIN (
             SELECT enrollmentId,
                    SUM(CASE WHEN allocationType <> 'UNAPPLIED' THEN amount ELSE 0 END) AS appliedAmount
             FROM program_payment_allocations
             GROUP BY enrollmentId
           ) p ON p.enrollmentId = e.id
           LEFT JOIN (
             SELECT pa.enrollmentId,
                    SUM(CASE WHEN pa.allocationType <> 'UNAPPLIED' THEN ra.amount ELSE 0 END) AS refundedAmount
             FROM program_refund_allocations ra
             INNER JOIN program_payment_allocations pa ON pa.id = ra.paymentAllocationId
             GROUP BY pa.enrollmentId
           ) r ON r.enrollmentId = e.id
           WHERE e.userId = ? AND e.status <> 'CANCELLED'
           GROUP BY e.currencyCode
           ORDER BY e.currencyCode ASC`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT reward.currencyCode,
                  COUNT(*) AS postedRewardCount,
                  COALESCE(SUM(reward.rewardAmount), 0) AS grossRewardAmount,
                  COALESCE(SUM(reversal.reversedAmount), 0) AS reversedRewardAmount,
                  COALESCE(SUM(reward.rewardAmount - COALESCE(reversal.reversedAmount, 0)), 0) AS netRewardAmount
           FROM referral_reward_events reward
           LEFT JOIN (
             SELECT rewardEventId, SUM(reversalAmount) AS reversedAmount
             FROM program_referral_refund_evaluations
             WHERE status = 'POSTED'
             GROUP BY rewardEventId
           ) reversal ON reversal.rewardEventId = reward.id
           WHERE reward.sponsorUserId = ? AND reward.status = 'POSTED'
           GROUP BY reward.currencyCode
           ORDER BY reward.currencyCode ASC`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT COUNT(*) AS pairCount,
                  COALESCE(SUM(CASE WHEN payable = TRUE THEN 1 ELSE 0 END), 0) AS payablePairCount,
                  COALESCE(SUM(CASE WHEN payable = TRUE THEN payoutAmount ELSE 0 END), 0) AS payoutAmount
           FROM binary_pair_matches
           WHERE memberUserId = ?`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT unit.side,
                  COUNT(*) AS totalUnits,
                  COALESCE(SUM(CASE WHEN pair.id IS NULL AND disposition.id IS NULL THEN 1 ELSE 0 END), 0) AS availableUnits
           FROM binary_upline_qualifying_units unit
           LEFT JOIN binary_pair_matches pair ON pair.leftUnitId = unit.id OR pair.rightUnitId = unit.id
           LEFT JOIN binary_unit_dispositions disposition ON disposition.uplineUnitId = unit.id
           WHERE unit.ancestorUserId = ?
           GROUP BY unit.side
           ORDER BY unit.side ASC`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT
             (SELECT COUNT(*) FROM program_draw_eligibility_hooks h WHERE h.userId = ? AND h.status = 'ELIGIBLE') AS eligibleHookCount,
             (SELECT COUNT(*) FROM lucky_draw_entries e WHERE e.userId = ? AND e.disposition = 'ELIGIBLE') AS entrantCount,
             (SELECT COUNT(*) FROM lucky_draw_winners w WHERE w.userId = ?) AS winnerCount`,
          userId,
          userId,
          userId,
        ),
        this.prisma.$queryRawUnsafe<GenericRow[]>(
          `SELECT status, COUNT(*) AS count
           FROM lucky_draw_prize_claims
           WHERE userId = ?
           GROUP BY status
           ORDER BY status ASC`,
          userId,
        ),
      ]);

    return {
      user,
      wallets,
      enrollments: {
        counts: enrollmentCounts,
        dues,
      },
      referralRewards,
      binary: {
        summary: pairSummary[0] ?? { pairCount: 0, payablePairCount: 0, payoutAmount: 0 },
        unitQueues,
      },
      luckyDraw: {
        summary: drawCounts[0] ?? { eligibleHookCount: 0, entrantCount: 0, winnerCount: 0 },
        claimCounts,
      },
    };
  }

  async memberEnrollments(userId: string, query: OperationalListQueryDto) {
    const page = this.page(query);
    const filters = this.memberFilters(query, 'e.enrolledAt', 'e.status');
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT e.id, e.sourceKey, e.status, e.enrolledAt, e.enrollmentDate, e.currencyCode,
              e.registrationFeeSnapshot, e.installmentAmountSnapshot, e.installmentCountSnapshot,
              e.gracePeriodDaysSnapshot, e.programVersionId,
              p.id AS programId, p.code AS programCode, p.name AS programName, pv.version AS programVersion,
              COALESCE(pay.appliedAmount, 0) AS appliedAmount,
              COALESCE(ref.refundedAmount, 0) AS refundedAmount,
              GREATEST(
                (e.registrationFeeSnapshot + (e.installmentAmountSnapshot * e.installmentCountSnapshot))
                - (COALESCE(pay.appliedAmount, 0) - COALESCE(ref.refundedAmount, 0)),
                0
              ) AS outstandingAmount
       FROM program_enrollments e
       INNER JOIN program_versions pv ON pv.id = e.programVersionId
       INNER JOIN programs p ON p.id = pv.programId
       LEFT JOIN (
         SELECT enrollmentId, SUM(CASE WHEN allocationType <> 'UNAPPLIED' THEN amount ELSE 0 END) AS appliedAmount
         FROM program_payment_allocations
         GROUP BY enrollmentId
       ) pay ON pay.enrollmentId = e.id
       LEFT JOIN (
         SELECT pa.enrollmentId,
                SUM(CASE WHEN pa.allocationType <> 'UNAPPLIED' THEN ra.amount ELSE 0 END) AS refundedAmount
         FROM program_refund_allocations ra
         INNER JOIN program_payment_allocations pa ON pa.id = ra.paymentAllocationId
         GROUP BY pa.enrollmentId
       ) ref ON ref.enrollmentId = e.id
       WHERE e.userId = ?${filters.sql}
       ORDER BY e.enrolledAt DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      userId,
      ...filters.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total FROM program_enrollments e WHERE e.userId = ?${filters.sql}`,
      userId,
      ...filters.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async memberWalletHistory(userId: string, query: OperationalListQueryDto) {
    const page = this.page(query);
    const filters = this.memberFilters(query, 't.occurredAt');
    const currencySql = query.currencyCode ? ' AND a.currencyCode = ?' : '';
    const currencyParams = query.currencyCode ? [query.currencyCode.toUpperCase()] : [];
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT e.id AS entryId, e.direction, e.amount, e.currencyCode, e.createdAt AS entryCreatedAt,
              a.id AS accountId, a.code AS accountCode,
              t.id AS transactionId, t.sourceKey, t.type AS transactionType,
              t.description, t.occurredAt
       FROM ledger_entries e
       INNER JOIN ledger_accounts a ON a.id = e.accountId
       INNER JOIN ledger_transactions t ON t.id = e.transactionId
       WHERE a.ownerUserId = ? AND a.kind = 'USER_WALLET'${currencySql}${filters.sql}
       ORDER BY t.occurredAt DESC, t.id DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      userId,
      ...currencyParams,
      ...filters.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM ledger_entries e
       INNER JOIN ledger_accounts a ON a.id = e.accountId
       INNER JOIN ledger_transactions t ON t.id = e.transactionId
       WHERE a.ownerUserId = ? AND a.kind = 'USER_WALLET'${currencySql}${filters.sql}`,
      userId,
      ...currencyParams,
      ...filters.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async memberReferralRewards(userId: string, query: OperationalListQueryDto) {
    const page = this.page(query);
    const filters = this.memberFilters(query, 'reward.occurredAt', 'reward.status');
    const currencySql = query.currencyCode ? ' AND reward.currencyCode = ?' : '';
    const currencyParams = query.currencyCode ? [query.currencyCode.toUpperCase()] : [];
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT reward.id, reward.sourceKey, reward.referredUserId, referred.username AS referredUsername,
              reward.policyVersionId, reward.basisAmount, reward.currencyCode, reward.eligible,
              reward.rewardAmount, reward.status, reward.ledgerTransactionId, reward.occurredAt,
              COALESCE(reversal.reversedAmount, 0) AS reversedAmount,
              reward.rewardAmount - COALESCE(reversal.reversedAmount, 0) AS netRewardAmount
       FROM referral_reward_events reward
       INNER JOIN users referred ON referred.id = reward.referredUserId
       LEFT JOIN (
         SELECT rewardEventId, SUM(reversalAmount) AS reversedAmount
         FROM program_referral_refund_evaluations
         WHERE status = 'POSTED'
         GROUP BY rewardEventId
       ) reversal ON reversal.rewardEventId = reward.id
       WHERE reward.sponsorUserId = ?${currencySql}${filters.sql}
       ORDER BY reward.occurredAt DESC, reward.id DESC
       LIMIT ? OFFSET ?`,
      userId,
      ...currencyParams,
      ...filters.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total FROM referral_reward_events reward
       WHERE reward.sponsorUserId = ?${currencySql}${filters.sql}`,
      userId,
      ...currencyParams,
      ...filters.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async memberBinary(userId: string, query: OperationalListQueryDto) {
    const page = this.page(query);
    const filters = this.memberFilters(query, 'settlement.settledAt');
    const [settlements, settlementCount, matches, matchCount, queueSummary] = await Promise.all([
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT settlement.id, settlement.sourceKey, settlement.planVersionId,
                settlement.settledAt, settlement.settlementLocalDate, settlement.settlementLocalMonth,
                settlement.pairCountCalculated, settlement.pairCountPayable, settlement.capLimitedPairs,
                settlement.leftUnitsAvailableBefore, settlement.rightUnitsAvailableBefore,
                settlement.leftUnitsConsumed, settlement.rightUnitsConsumed,
                settlement.leftUnitsCarryAfter, settlement.rightUnitsCarryAfter,
                settlement.payoutAmount, settlement.currencyCode, settlement.ledgerTransactionId
         FROM binary_pair_settlements settlement
         WHERE settlement.memberUserId = ?${filters.sql}
         ORDER BY settlement.settledAt DESC, settlement.id DESC
         LIMIT ? OFFSET ?`,
        userId,
        ...filters.params,
        page.limit,
        page.offset,
      ),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total FROM binary_pair_settlements settlement
         WHERE settlement.memberUserId = ?${filters.sql}`,
        userId,
        ...filters.params,
      ),
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT matchRow.id, matchRow.settlementId, matchRow.planVersionId, matchRow.pairSequence,
                matchRow.leftUnitId, matchRow.rightUnitId, matchRow.payable, matchRow.payoutAmount,
                matchRow.createdAt
         FROM binary_pair_matches matchRow
         WHERE matchRow.memberUserId = ?
         ORDER BY matchRow.createdAt DESC, matchRow.id DESC
         LIMIT ? OFFSET ?`,
        userId,
        page.limit,
        page.offset,
      ),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total FROM binary_pair_matches WHERE memberUserId = ?`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT unit.planVersionId, unit.side,
                COUNT(*) AS totalUnits,
                COALESCE(SUM(CASE WHEN pair.id IS NULL AND disposition.id IS NULL THEN 1 ELSE 0 END), 0) AS availableUnits,
                MIN(CASE WHEN pair.id IS NULL AND disposition.id IS NULL THEN unit.sequence END) AS nextAvailableSequence
         FROM binary_upline_qualifying_units unit
         LEFT JOIN binary_pair_matches pair ON pair.leftUnitId = unit.id OR pair.rightUnitId = unit.id
         LEFT JOIN binary_unit_dispositions disposition ON disposition.uplineUnitId = unit.id
         WHERE unit.ancestorUserId = ?
         GROUP BY unit.planVersionId, unit.side
         ORDER BY unit.planVersionId ASC, unit.side ASC`,
        userId,
      ),
    ]);
    return {
      queueSummary,
      settlements: this.paginated(settlements, settlementCount[0]?.total, page),
      pairMatches: this.paginated(matches, matchCount[0]?.total, page),
    };
  }

  async memberRewards(userId: string, query: OperationalListQueryDto) {
    const page = this.page(query);
    const filters = this.memberFilters(query, 'winner.createdAt');
    const [wins, winCount, hooks, hookCount] = await Promise.all([
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT winner.id AS winnerId, winner.drawId, winner.overallRank, winner.tierWinnerPosition,
                winner.selectionScore, winner.outcomeSnapshot, winner.createdAt AS wonAt,
                tier.code AS prizeTierCode, tier.name AS prizeTierName, tier.prizeKind,
                tier.cashAmount, tier.currencyCode, tier.prizeDefinition,
                claim.id AS claimId, claim.status AS claimStatus, claim.claimDeadline,
                claim.claimedAt, fulfillment.id AS fulfillmentId,
                fulfillment.fulfillmentType, fulfillment.externalReference,
                fulfillment.ledgerTransactionId, reversal.id AS reversalId,
                reversal.ledgerTransactionId AS reversalLedgerTransactionId
         FROM lucky_draw_winners winner
         INNER JOIN lucky_draw_prize_tiers tier ON tier.id = winner.prizeTierId
         LEFT JOIN lucky_draw_prize_claims claim ON claim.winnerId = winner.id
         LEFT JOIN lucky_draw_prize_fulfillments fulfillment ON fulfillment.winnerId = winner.id
         LEFT JOIN lucky_draw_prize_fulfillment_reversals reversal ON reversal.fulfillmentId = fulfillment.id
         WHERE winner.userId = ?${filters.sql}
         ORDER BY winner.createdAt DESC, winner.id DESC
         LIMIT ? OFFSET ?`,
        userId,
        ...filters.params,
        page.limit,
        page.offset,
      ),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total FROM lucky_draw_winners winner
         WHERE winner.userId = ?${filters.sql}`,
        userId,
        ...filters.params,
      ),
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT hook.id, hook.sourceKey, hook.businessEventId, hook.programVersionId,
                hook.status, hook.eligibilitySnapshot, hook.occurredAt,
                entry.drawId, entry.disposition, entry.entrySequence, entry.selectionScore
         FROM program_draw_eligibility_hooks hook
         LEFT JOIN lucky_draw_entries entry ON entry.sourceHookId = hook.id
         WHERE hook.userId = ?
         ORDER BY hook.occurredAt DESC, hook.id DESC
         LIMIT ? OFFSET ?`,
        userId,
        page.limit,
        page.offset,
      ),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total FROM program_draw_eligibility_hooks WHERE userId = ?`,
        userId,
      ),
    ]);
    return {
      wins: this.paginated(wins, winCount[0]?.total, page),
      eligibility: this.paginated(hooks, hookCount[0]?.total, page),
    };
  }

  async adminSummary() {
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT
         (SELECT COUNT(*) FROM program_business_events event
          LEFT JOIN program_event_processing_runs run ON run.businessEventId = event.id
          WHERE run.id IS NULL) AS unprocessedBusinessEvents,
         (SELECT COUNT(*) FROM program_event_processing_runs
          WHERE status IN ('PENDING','FAILED','RECONCILIATION_REQUIRED')) AS orchestrationAttention,
         (SELECT COUNT(*) FROM program_referral_reward_hooks
          WHERE status IN ('READY','RECONCILIATION_REQUIRED')) AS referralHandoffsAttention,
         (SELECT COUNT(*) FROM lucky_draw_instances
          WHERE status IN ('SCHEDULED','SNAPSHOTTED')) AS openDraws,
         (SELECT COUNT(*) FROM lucky_draw_prize_claims
          WHERE status IN ('PENDING','CLAIMED')) AS openPrizeClaims,
         (SELECT COUNT(*) FROM lucky_draw_prize_claims
          WHERE status IN ('PENDING','CLAIMED') AND claimDeadline < CURRENT_TIMESTAMP(3)) AS overduePrizeClaims`,
    );
    return rows[0] ?? {};
  }

  async adminOrchestration(query: OperationalListQueryDto) {
    const page = this.page(query);
    const where = this.adminStatusAndDate(query, 'event.occurredAt', 'COALESCE(run.status, \'UNPROCESSED\')');
    const select = `FROM program_business_events event
      INNER JOIN program_enrollments enrollment ON enrollment.id = event.enrollmentId
      INNER JOIN users member ON member.id = enrollment.userId
      LEFT JOIN program_event_processing_runs run ON run.businessEventId = event.id
      WHERE 1 = 1${where.sql}`;
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT event.id AS businessEventId, event.sourceKey, event.type, event.enrollmentId,
              event.paymentRecordId, event.refundRecordId, event.occurredAt, event.payload,
              member.id AS memberUserId, member.username AS memberUsername,
              run.id AS runId, COALESCE(run.status, 'UNPROCESSED') AS processingStatus,
              run.eligible, run.attempts, run.errorMessage, run.completedAt
       ${select}
       ORDER BY event.occurredAt ASC, event.id ASC
       LIMIT ? OFFSET ?`,
      ...where.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...where.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async adminReferralHandoffs(query: OperationalListQueryDto) {
    const page = this.page(query);
    const where = this.adminStatusAndDate(query, 'hook.occurredAt', 'hook.status');
    const currencySql = query.currencyCode ? ' AND hook.currencyCode = ?' : '';
    const params = [...where.params, ...(query.currencyCode ? [query.currencyCode.toUpperCase()] : [])];
    const select = `FROM program_referral_reward_hooks hook
      INNER JOIN users referred ON referred.id = hook.referredUserId
      LEFT JOIN users sponsor ON sponsor.id = hook.sponsorUserId
      WHERE 1 = 1${where.sql}${currencySql}`;
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT hook.id, hook.sourceKey, hook.businessEventId, hook.status,
              hook.referredUserId, referred.username AS referredUsername,
              hook.sponsorUserId, sponsor.username AS sponsorUsername,
              hook.referralPolicyVersionId, hook.basisAmount, hook.currencyCode,
              hook.consumedRewardEventId, hook.occurredAt
       ${select}
       ORDER BY hook.occurredAt ASC, hook.id ASC
       LIMIT ? OFFSET ?`,
      ...params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async adminDraws(query: OperationalListQueryDto) {
    const page = this.page(query);
    const where = this.adminStatusAndDate(query, 'drawRow.drawAt', 'drawRow.status');
    const select = `FROM lucky_draw_instances drawRow
      INNER JOIN lucky_draw_policy_versions versionRow ON versionRow.id = drawRow.policyVersionId
      INNER JOIN lucky_draw_policies policy ON policy.id = versionRow.policyId
      WHERE 1 = 1${where.sql}`;
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT drawRow.id, drawRow.sourceKey, drawRow.policyVersionId, policy.code AS policyCode,
              policy.name AS policyName, drawRow.entryWindowStart, drawRow.entryWindowEnd,
              drawRow.drawAt, drawRow.status, drawRow.candidateCount, drawRow.eligibleEntryCount,
              drawRow.excludedEntryCount, drawRow.winnerCount, drawRow.snapshottedAt, drawRow.drawnAt
       ${select}
       ORDER BY drawRow.drawAt ASC, drawRow.id ASC
       LIMIT ? OFFSET ?`,
      ...where.params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...where.params,
    );
    return this.paginated(rows, count[0]?.total, page);
  }

  async adminPrizeClaims(query: OperationalListQueryDto) {
    const page = this.page(query);
    const where = this.adminStatusAndDate(query, 'claim.claimDeadline', 'claim.status');
    const currencySql = query.currencyCode ? ' AND claim.currencyCode = ?' : '';
    const params = [...where.params, ...(query.currencyCode ? [query.currencyCode.toUpperCase()] : [])];
    const select = `FROM lucky_draw_prize_claims claim
      INNER JOIN users member ON member.id = claim.userId
      INNER JOIN lucky_draw_prize_tiers tier ON tier.id = claim.prizeTierId
      LEFT JOIN lucky_draw_prize_fulfillments fulfillment ON fulfillment.claimId = claim.id
      LEFT JOIN lucky_draw_prize_fulfillment_reversals reversal ON reversal.fulfillmentId = fulfillment.id
      WHERE 1 = 1${where.sql}${currencySql}`;
    const rows = await this.prisma.$queryRawUnsafe<GenericRow[]>(
      `SELECT claim.id, claim.winnerId, claim.drawId, claim.userId, member.username,
              claim.status, claim.claimDeadline, claim.prizeKind, claim.cashAmount, claim.currencyCode,
              claim.claimedAt, claim.cancelledAt, claim.cancellationReason,
              tier.code AS prizeTierCode, tier.name AS prizeTierName,
              fulfillment.id AS fulfillmentId, fulfillment.fulfillmentType,
              fulfillment.externalReference, fulfillment.ledgerTransactionId,
              reversal.id AS reversalId, reversal.ledgerTransactionId AS reversalLedgerTransactionId
       ${select}
       ORDER BY claim.claimDeadline ASC, claim.id ASC
       LIMIT ? OFFSET ?`,
      ...params,
      page.limit,
      page.offset,
    );
    const count = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS total ${select}`,
      ...params,
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

  private memberFilters(
    query: OperationalListQueryDto,
    dateColumn: string,
    statusColumn?: string,
  ): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    const range = this.range(query);
    if (range.from) {
      parts.push(` AND ${dateColumn} >= ?`);
      params.push(range.from);
    }
    if (range.to) {
      parts.push(` AND ${dateColumn} <= ?`);
      params.push(range.to);
    }
    if (query.status) {
      if (!statusColumn) throw new BadRequestException('status filter is not supported for this endpoint');
      parts.push(` AND ${statusColumn} = ?`);
      params.push(query.status.trim().toUpperCase());
    }
    return { sql: parts.join(''), params };
  }

  private adminStatusAndDate(
    query: OperationalListQueryDto,
    dateColumn: string,
    statusColumn: string,
  ): { sql: string; params: unknown[] } {
    return this.memberFilters(query, dateColumn, statusColumn);
  }

  private range(query: OperationalListQueryDto): { from: Date | null; to: Date | null } {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from && !Number.isFinite(from.getTime())) throw new BadRequestException('from is invalid');
    if (to && !Number.isFinite(to.getTime())) throw new BadRequestException('to is invalid');
    if (from && to && from > to) throw new BadRequestException('from must not be later than to');
    return { from, to };
  }

  private paginated(rows: GenericRow[], totalValue: bigint | number | string | undefined, page: PageSpec) {
    const total = Number(totalValue ?? 0);
    return {
      items: rows,
      page: page.page,
      limit: page.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / page.limit),
    };
  }
}
