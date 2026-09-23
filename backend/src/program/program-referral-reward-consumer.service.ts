import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  ProgramBusinessEventType,
  ReferralRewardEventStatus,
  ReferralRoundingMode,
} from '../generated/prisma/enums';
import {
  type ReferralRefundHandlingMode,
} from '../referral-reward/referral-refund-rule.service';
import { ReferralRewardService } from '../referral-reward/referral-reward.service';

type ReferralBasisMode =
  | 'PAYMENT_AMOUNT'
  | 'REGISTRATION_ALLOCATION'
  | 'INSTALLMENT_ALLOCATION'
  | 'TOTAL_APPLIED_AMOUNT';

type ReferralHookStatus =
  | 'READY'
  | 'INELIGIBLE'
  | 'CANCELLED'
  | 'CONSUMED'
  | 'RECONCILIATION_REQUIRED';

type ReferralHookRow = {
  id: string;
  sourceKey: string;
  runId: string;
  businessEventId: string;
  referredUserId: string;
  sponsorUserId: string | null;
  referralPolicyVersionId: string;
  basisAmount: string | Prisma.Decimal;
  currencyCode: string;
  status: ReferralHookStatus;
  eligibilitySnapshot: unknown;
  consumedRewardEventId: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type RefundRuleRow = {
  referralPolicyVersionId: string;
  mode: ReferralRefundHandlingMode;
};

type RefundEvaluationStatus =
  | 'POSTED'
  | 'NO_REVERSAL'
  | 'SKIPPED'
  | 'RECONCILIATION_REQUIRED';

type RefundEvaluationRow = {
  id: string;
  sourceKey: string;
  refundRecordId: string;
  paymentRecordId: string;
  originalBusinessEventId: string | null;
  hookId: string | null;
  rewardEventId: string | null;
  refundRuleMode: ReferralRefundHandlingMode | null;
  basisMode: ReferralBasisMode | null;
  refundAmount: string | Prisma.Decimal;
  refundedBasisAmount: string | Prisma.Decimal;
  cumulativeRefundedBasis: string | Prisma.Decimal;
  reversalAmount: string | Prisma.Decimal;
  currencyCode: string;
  status: RefundEvaluationStatus;
  reasonCode: string;
  ledgerTransactionId: string | null;
  snapshot: unknown;
  occurredAt: Date;
  createdByUserId: string | null;
  createdAt: Date;
};

type LedgerEntryAccountRow = {
  accountId: string;
  direction: LedgerEntryDirection;
  kind: LedgerAccountKind;
  currencyCode: string;
};

type EvaluationInput = {
  sourceKey: string;
  refundRecordId: string;
  paymentRecordId: string;
  originalBusinessEventId: string | null;
  hookId: string | null;
  rewardEventId: string | null;
  refundRuleMode: ReferralRefundHandlingMode | null;
  basisMode: ReferralBasisMode | null;
  refundAmount: Prisma.Decimal;
  refundedBasisAmount: Prisma.Decimal;
  cumulativeRefundedBasis: Prisma.Decimal;
  desiredReversalAmount: Prisma.Decimal;
  originalRewardAmount: Prisma.Decimal;
  originalLedgerTransactionId: string | null;
  currencyCode: string;
  status: RefundEvaluationStatus;
  reasonCode: string;
  snapshot: Record<string, unknown>;
  occurredAt: Date;
};

@Injectable()
export class ProgramReferralRewardConsumerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly rewards: ReferralRewardService,
    private readonly audit: AuditService,
  ) {}

  async consumeHook(hookId: string, actorUserId: string) {
    let hook = await this.getHookRow(hookId);
    if (hook.status === 'CONSUMED') {
      if (!hook.consumedRewardEventId) {
        throw new ConflictException('Consumed referral hook is missing its reward event link');
      }
      return {
        hook,
        event: await this.rewards.getEvent(hook.consumedRewardEventId),
        idempotent: true,
      };
    }
    if (hook.status !== 'READY') {
      return { hook, event: null, idempotent: true };
    }
    if (!hook.sponsorUserId) {
      hook = await this.markHookReconciliation(hook, 'SPONSOR_SNAPSHOT_MISSING', actorUserId);
      return { hook, event: null, idempotent: false };
    }

    const relationship = await this.prisma.sponsorRelationship.findUnique({
      where: { memberUserId: hook.referredUserId },
      select: { sponsorUserId: true },
    });
    if (!relationship || relationship.sponsorUserId !== hook.sponsorUserId) {
      hook = await this.markHookReconciliation(hook, 'SPONSOR_SNAPSHOT_MISMATCH', actorUserId);
      return { hook, event: null, idempotent: false };
    }

    const result = await this.rewards.createEvent(
      {
        sourceKey: `PROGRAM_REFERRAL_HOOK:${hook.id}`,
        referredUserId: hook.referredUserId,
        policyVersionId: hook.referralPolicyVersionId,
        basisAmount: new Prisma.Decimal(hook.basisAmount).toFixed(2),
        currencyCode: hook.currencyCode,
        occurredAt: new Date(hook.occurredAt).toISOString(),
        metadata: {
          programReferralHookId: hook.id,
          programBusinessEventId: hook.businessEventId,
          sponsorUserIdSnapshot: hook.sponsorUserId,
        },
      },
      actorUserId,
    );

    if (result.event.sponsorUserId !== hook.sponsorUserId) {
      throw new ConflictException('Referral reward sponsor does not match the immutable hook snapshot');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE program_referral_reward_hooks
       SET status = 'CONSUMED', consumedRewardEventId = ?, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'READY'`,
      result.event.id,
      hook.id,
    );
    hook = await this.getHookRow(hook.id);
    if (hook.status !== 'CONSUMED' || hook.consumedRewardEventId !== result.event.id) {
      throw new ConflictException('Referral hook could not be linked to its reward event');
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramReferralRewardHook',
      entityId: hook.id,
      description: 'Program referral reward hook consumed',
      metadata: { rewardEventId: result.event.id },
    });
    return { hook, event: result.event, idempotent: result.idempotent };
  }

  async processReady(actorUserId: string, limit = 25) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM program_referral_reward_hooks
       WHERE status = 'READY'
       ORDER BY occurredAt ASC, createdAt ASC
       LIMIT ${safeLimit}`,
    );
    const results: Array<{ hookId: string; status: string; error?: string }> = [];
    for (const row of rows) {
      try {
        const result = await this.consumeHook(row.id, actorUserId);
        results.push({ hookId: row.id, status: result.hook.status });
      } catch (error) {
        results.push({
          hookId: row.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown referral hook error',
        });
      }
    }
    return { processed: results.length, results };
  }

  async reconcileRefundEvent(businessEventId: string, actorUserId: string) {
    const event = await this.prisma.programBusinessEvent.findUnique({
      where: { id: businessEventId },
      include: {
        refundRecord: {
          include: {
            allocations: { include: { paymentAllocation: true } },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Program business event not found');
    if (event.type !== ProgramBusinessEventType.REFUND_CONFIRMED || !event.refundRecord) {
      throw new ConflictException('Referral refund reconciliation requires a REFUND_CONFIRMED event');
    }

    const refund = event.refundRecord;
    const existing = await this.getEvaluationByRefund(refund.id);
    if (existing) return { evaluation: existing, idempotent: true };

    const originalBusinessEvent = await this.prisma.programBusinessEvent.findFirst({
      where: {
        type: ProgramBusinessEventType.PAYMENT_CONFIRMED,
        paymentRecordId: refund.paymentRecordId,
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const sourceKey = `PROGRAM_REFUND:${refund.id}:REFERRAL`;
    if (!originalBusinessEvent) {
      const evaluation = await this.persistEvaluation(
        {
          sourceKey,
          refundRecordId: refund.id,
          paymentRecordId: refund.paymentRecordId,
          originalBusinessEventId: null,
          hookId: null,
          rewardEventId: null,
          refundRuleMode: null,
          basisMode: null,
          refundAmount: new Prisma.Decimal(refund.amount),
          refundedBasisAmount: new Prisma.Decimal(0),
          cumulativeRefundedBasis: new Prisma.Decimal(0),
          desiredReversalAmount: new Prisma.Decimal(0),
          originalRewardAmount: new Prisma.Decimal(0),
          originalLedgerTransactionId: null,
          currencyCode: refund.currencyCode,
          status: 'SKIPPED',
          reasonCode: 'ORIGINAL_PAYMENT_EVENT_NOT_FOUND',
          snapshot: {},
          occurredAt: refund.occurredAt,
        },
        actorUserId,
      );
      return { evaluation, idempotent: false };
    }

    let hook = await this.getHookByBusinessEvent(originalBusinessEvent.id);
    if (!hook) {
      const evaluation = await this.persistEvaluation(
        {
          sourceKey,
          refundRecordId: refund.id,
          paymentRecordId: refund.paymentRecordId,
          originalBusinessEventId: originalBusinessEvent.id,
          hookId: null,
          rewardEventId: null,
          refundRuleMode: null,
          basisMode: null,
          refundAmount: new Prisma.Decimal(refund.amount),
          refundedBasisAmount: new Prisma.Decimal(0),
          cumulativeRefundedBasis: new Prisma.Decimal(0),
          desiredReversalAmount: new Prisma.Decimal(0),
          originalRewardAmount: new Prisma.Decimal(0),
          originalLedgerTransactionId: null,
          currencyCode: refund.currencyCode,
          status: 'SKIPPED',
          reasonCode: 'ORIGINAL_REFERRAL_HOOK_NOT_FOUND',
          snapshot: {},
          occurredAt: refund.occurredAt,
        },
        actorUserId,
      );
      return { evaluation, idempotent: false };
    }

    if (hook.status === 'READY') {
      await this.consumeHook(hook.id, actorUserId);
      hook = await this.getHookRow(hook.id);
    }

    if (hook.status !== 'CONSUMED' || !hook.consumedRewardEventId) {
      const status: RefundEvaluationStatus =
        hook.status === 'RECONCILIATION_REQUIRED' ? 'RECONCILIATION_REQUIRED' : 'SKIPPED';
      const evaluation = await this.persistEvaluation(
        {
          sourceKey,
          refundRecordId: refund.id,
          paymentRecordId: refund.paymentRecordId,
          originalBusinessEventId: originalBusinessEvent.id,
          hookId: hook.id,
          rewardEventId: null,
          refundRuleMode: null,
          basisMode: this.hookBasisMode(hook),
          refundAmount: new Prisma.Decimal(refund.amount),
          refundedBasisAmount: new Prisma.Decimal(0),
          cumulativeRefundedBasis: new Prisma.Decimal(0),
          desiredReversalAmount: new Prisma.Decimal(0),
          originalRewardAmount: new Prisma.Decimal(0),
          originalLedgerTransactionId: null,
          currencyCode: refund.currencyCode,
          status,
          reasonCode:
            status === 'RECONCILIATION_REQUIRED'
              ? 'ORIGINAL_HOOK_REQUIRES_RECONCILIATION'
              : 'ORIGINAL_HOOK_HAS_NO_POSTED_REWARD',
          snapshot: { originalHookStatus: hook.status },
          occurredAt: refund.occurredAt,
        },
        actorUserId,
      );
      return { evaluation, idempotent: false };
    }

    const reward = await this.prisma.referralRewardEvent.findUnique({
      where: { id: hook.consumedRewardEventId },
      select: {
        id: true,
        status: true,
        basisAmount: true,
        rewardAmount: true,
        currencyCode: true,
        ledgerTransactionId: true,
        policyVersionId: true,
        policyVersion: { select: { roundingMode: true } },
      },
    });
    if (!reward) throw new ConflictException('Consumed referral reward event no longer exists');

    const basisMode = this.hookBasisMode(hook);
    if (!basisMode) {
      const evaluation = await this.persistEvaluation(
        {
          sourceKey,
          refundRecordId: refund.id,
          paymentRecordId: refund.paymentRecordId,
          originalBusinessEventId: originalBusinessEvent.id,
          hookId: hook.id,
          rewardEventId: reward.id,
          refundRuleMode: null,
          basisMode: null,
          refundAmount: new Prisma.Decimal(refund.amount),
          refundedBasisAmount: new Prisma.Decimal(0),
          cumulativeRefundedBasis: new Prisma.Decimal(0),
          desiredReversalAmount: new Prisma.Decimal(0),
          originalRewardAmount: new Prisma.Decimal(reward.rewardAmount),
          originalLedgerTransactionId: reward.ledgerTransactionId,
          currencyCode: refund.currencyCode,
          status: 'RECONCILIATION_REQUIRED',
          reasonCode: 'HOOK_BASIS_MODE_MISSING',
          snapshot: {},
          occurredAt: refund.occurredAt,
        },
        actorUserId,
      );
      return { evaluation, idempotent: false };
    }

    const refundedBasisAmount = this.refundBasis(basisMode, refund);
    const cumulativeRefundedBasis = await this.cumulativeRefundedBasis(
      refund.paymentRecordId,
      basisMode,
      refund.occurredAt,
      refund.createdAt,
    );
    const rule = await this.getRefundRule(reward.policyVersionId);
    const originalBasis = new Prisma.Decimal(reward.basisAmount);
    const originalRewardAmount = new Prisma.Decimal(reward.rewardAmount);
    const snapshot = {
      basisMode,
      originalBasisAmount: originalBasis.toFixed(2),
      originalRewardAmount: originalRewardAmount.toFixed(2),
      refundedBasisAmount: refundedBasisAmount.toFixed(2),
      cumulativeRefundedBasis: cumulativeRefundedBasis.toFixed(2),
      refundRuleMode: rule?.mode ?? null,
    };

    let status: RefundEvaluationStatus = 'NO_REVERSAL';
    let reasonCode = 'NO_FINANCIAL_REFERRAL_REWARD';
    let desiredReversalAmount = new Prisma.Decimal(0);

    if (reward.currencyCode !== refund.currencyCode) {
      status = 'RECONCILIATION_REQUIRED';
      reasonCode = 'REFUND_REWARD_CURRENCY_MISMATCH';
    } else if (
      reward.status !== ReferralRewardEventStatus.POSTED ||
      !reward.ledgerTransactionId ||
      originalRewardAmount.lessThanOrEqualTo(0)
    ) {
      status = 'NO_REVERSAL';
      reasonCode = 'ORIGINAL_REWARD_NOT_POSTED';
    } else if (!rule) {
      status = 'RECONCILIATION_REQUIRED';
      reasonCode = 'REFUND_RULE_NOT_CONFIGURED';
    } else if (rule.mode === 'MANUAL_REVIEW') {
      status = 'RECONCILIATION_REQUIRED';
      reasonCode = 'REFUND_RULE_REQUIRES_MANUAL_REVIEW';
    } else if (originalBasis.lessThanOrEqualTo(0)) {
      status = 'RECONCILIATION_REQUIRED';
      reasonCode = 'ZERO_REWARD_BASIS';
    } else if (refundedBasisAmount.lessThanOrEqualTo(0)) {
      status = 'NO_REVERSAL';
      reasonCode = 'REFUND_DOES_NOT_AFFECT_REWARD_BASIS';
    } else if (rule.mode === 'FULL_BASIS_REVERSAL') {
      if (cumulativeRefundedBasis.greaterThanOrEqualTo(originalBasis)) {
        status = 'POSTED';
        reasonCode = 'FULL_BASIS_REFUNDED';
        desiredReversalAmount = originalRewardAmount;
      } else {
        status = 'NO_REVERSAL';
        reasonCode = 'BASIS_ONLY_PARTIALLY_REFUNDED';
      }
    } else {
      status = 'POSTED';
      reasonCode = 'PRO_RATA_BASIS_REFUND';
      if (cumulativeRefundedBasis.greaterThanOrEqualTo(originalBasis)) {
        desiredReversalAmount = originalRewardAmount;
      } else {
        desiredReversalAmount = this.roundAmount(
          originalRewardAmount.mul(refundedBasisAmount).div(originalBasis),
          reward.policyVersion.roundingMode,
        );
        if (desiredReversalAmount.lessThanOrEqualTo(0)) {
          status = 'NO_REVERSAL';
          reasonCode = 'PRO_RATA_ROUNDED_TO_ZERO';
        }
      }
    }

    const evaluation = await this.persistEvaluation(
      {
        sourceKey,
        refundRecordId: refund.id,
        paymentRecordId: refund.paymentRecordId,
        originalBusinessEventId: originalBusinessEvent.id,
        hookId: hook.id,
        rewardEventId: reward.id,
        refundRuleMode: rule?.mode ?? null,
        basisMode,
        refundAmount: new Prisma.Decimal(refund.amount),
        refundedBasisAmount,
        cumulativeRefundedBasis,
        desiredReversalAmount,
        originalRewardAmount,
        originalLedgerTransactionId: reward.ledgerTransactionId,
        currencyCode: refund.currencyCode,
        status,
        reasonCode,
        snapshot,
        occurredAt: refund.occurredAt,
      },
      actorUserId,
    );
    return { evaluation, idempotent: false };
  }

  async processPendingRefunds(actorUserId: string, limit = 25) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT be.id
       FROM program_business_events be
       LEFT JOIN program_referral_refund_evaluations e ON e.refundRecordId = be.refundRecordId
       WHERE be.type = 'REFUND_CONFIRMED' AND be.refundRecordId IS NOT NULL AND e.id IS NULL
       ORDER BY be.occurredAt ASC, be.createdAt ASC
       LIMIT ${safeLimit}`,
    );
    const results: Array<{ eventId: string; status: string; error?: string }> = [];
    for (const row of rows) {
      try {
        const result = await this.reconcileRefundEvent(row.id, actorUserId);
        results.push({ eventId: row.id, status: result.evaluation.status });
      } catch (error) {
        results.push({
          eventId: row.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown refund reconciliation error',
        });
      }
    }
    return { processed: results.length, results };
  }

  async getEvaluation(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<RefundEvaluationRow[]>(
      `SELECT * FROM program_referral_refund_evaluations WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Referral refund evaluation not found');
    return rows[0];
  }

  private async getHookRow(id: string): Promise<ReferralHookRow> {
    const rows = await this.prisma.$queryRawUnsafe<ReferralHookRow[]>(
      `SELECT * FROM program_referral_reward_hooks WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Program referral reward hook not found');
    return rows[0];
  }

  private async getHookByBusinessEvent(businessEventId: string): Promise<ReferralHookRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<ReferralHookRow[]>(
      `SELECT * FROM program_referral_reward_hooks WHERE businessEventId = ? LIMIT 1`,
      businessEventId,
    );
    return rows[0] ?? null;
  }

  private async getEvaluationByRefund(refundRecordId: string): Promise<RefundEvaluationRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<RefundEvaluationRow[]>(
      `SELECT * FROM program_referral_refund_evaluations WHERE refundRecordId = ? LIMIT 1`,
      refundRecordId,
    );
    return rows[0] ?? null;
  }

  private async getRefundRule(policyVersionId: string): Promise<RefundRuleRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<RefundRuleRow[]>(
      `SELECT referralPolicyVersionId, mode
       FROM referral_reward_refund_rules WHERE referralPolicyVersionId = ? LIMIT 1`,
      policyVersionId,
    );
    return rows[0] ?? null;
  }

  private async markHookReconciliation(
    hook: ReferralHookRow,
    reasonCode: string,
    actorUserId: string,
  ): Promise<ReferralHookRow> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE program_referral_reward_hooks
       SET status = 'RECONCILIATION_REQUIRED', updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'READY'`,
      hook.id,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramReferralRewardHook',
      entityId: hook.id,
      description: 'Program referral reward hook requires reconciliation',
      metadata: { reasonCode },
    });
    return this.getHookRow(hook.id);
  }

  private hookBasisMode(hook: ReferralHookRow): ReferralBasisMode | null {
    const snapshot = this.jsonObject(hook.eligibilitySnapshot);
    const mode = snapshot?.basisMode;
    return mode === 'PAYMENT_AMOUNT' ||
      mode === 'REGISTRATION_ALLOCATION' ||
      mode === 'INSTALLMENT_ALLOCATION' ||
      mode === 'TOTAL_APPLIED_AMOUNT'
      ? mode
      : null;
  }

  private refundBasis(
    mode: ReferralBasisMode,
    refund: {
      amount: Prisma.Decimal;
      allocations: Array<{
        amount: Prisma.Decimal;
        paymentAllocation: { allocationType: string };
      }>;
    },
  ): Prisma.Decimal {
    if (mode === 'PAYMENT_AMOUNT') return new Prisma.Decimal(refund.amount);
    return refund.allocations.reduce((sum, allocation) => {
      const type = allocation.paymentAllocation.allocationType;
      const matches =
        (mode === 'REGISTRATION_ALLOCATION' && type === 'REGISTRATION_FEE') ||
        (mode === 'INSTALLMENT_ALLOCATION' && type === 'INSTALLMENT') ||
        (mode === 'TOTAL_APPLIED_AMOUNT' && type !== 'UNAPPLIED');
      return matches ? sum.plus(allocation.amount) : sum;
    }, new Prisma.Decimal(0));
  }

  private async cumulativeRefundedBasis(
    paymentRecordId: string,
    mode: ReferralBasisMode,
    occurredAt: Date,
    createdAt: Date,
  ): Promise<Prisma.Decimal> {
    const refunds = await this.prisma.programRefundRecord.findMany({
      where: {
        paymentRecordId,
        OR: [
          { occurredAt: { lt: occurredAt } },
          { occurredAt, createdAt: { lte: createdAt } },
        ],
      },
      include: { allocations: { include: { paymentAllocation: true } } },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
    return refunds.reduce(
      (sum, refund) => sum.plus(this.refundBasis(mode, refund)),
      new Prisma.Decimal(0),
    );
  }

  private roundAmount(amount: Prisma.Decimal, mode: ReferralRoundingMode): Prisma.Decimal {
    if (mode === ReferralRoundingMode.DOWN) {
      return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    }
    if (mode === ReferralRoundingMode.UP) {
      return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
    }
    return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private async persistEvaluation(input: EvaluationInput, actorUserId: string) {
    const existing = await this.getEvaluationByRefund(input.refundRecordId);
    if (existing) return existing;

    const mutexKey = input.rewardEventId
      ? `RR_REVERSAL:${input.rewardEventId}`
      : `RR_REFUND:${input.refundRecordId}`;
    await this.financialDb.execute(
      `INSERT INTO system_sequences (\`key\`, nextValue, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`,
      [mutexKey],
    );

    const evaluationId = await this.financialDb.transaction(async (connection) => {
      await connection.query(
        `UPDATE system_sequences
         SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE \`key\` = ?`,
        [mutexKey],
      );
      const duplicateRows = await connection.query<Array<{ id: string }>>(
        `SELECT id FROM program_referral_refund_evaluations WHERE refundRecordId = ? LIMIT 1`,
        [input.refundRecordId],
      );
      if (duplicateRows[0]) return duplicateRows[0].id;

      let status = input.status;
      let reasonCode = input.reasonCode;
      let reversalAmount = new Prisma.Decimal(0);
      let ledgerTransactionId: string | null = null;

      if (
        status === 'POSTED' &&
        input.rewardEventId &&
        input.originalLedgerTransactionId &&
        input.desiredReversalAmount.greaterThan(0)
      ) {
        const reversedRows = await connection.query<Array<{ total: string | number | null }>>(
          `SELECT COALESCE(SUM(reversalAmount), 0) AS total
           FROM program_referral_refund_evaluations
           WHERE rewardEventId = ? AND status = 'POSTED'`,
          [input.rewardEventId],
        );
        const alreadyReversed = new Prisma.Decimal(reversedRows[0]?.total ?? 0);
        const remainingReward = Prisma.Decimal.max(
          input.originalRewardAmount.minus(alreadyReversed),
          new Prisma.Decimal(0),
        );
        reversalAmount = Prisma.Decimal.min(input.desiredReversalAmount, remainingReward);
        if (reversalAmount.lessThanOrEqualTo(0)) {
          status = 'NO_REVERSAL';
          reasonCode = 'REWARD_ALREADY_FULLY_REVERSED';
        } else {
          ledgerTransactionId = await this.postReversalLedger(
            connection,
            input,
            reversalAmount,
            actorUserId,
          );
        }
      }

      const id = randomUUID();
      await connection.query(
        `INSERT INTO program_referral_refund_evaluations
           (id, sourceKey, refundRecordId, paymentRecordId, originalBusinessEventId,
            hookId, rewardEventId, refundRuleMode, basisMode, refundAmount,
            refundedBasisAmount, cumulativeRefundedBasis, reversalAmount, currencyCode,
            status, reasonCode, ledgerTransactionId, snapshot, occurredAt,
            createdByUserId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          id,
          input.sourceKey,
          input.refundRecordId,
          input.paymentRecordId,
          input.originalBusinessEventId,
          input.hookId,
          input.rewardEventId,
          input.refundRuleMode,
          input.basisMode,
          input.refundAmount.toFixed(2),
          input.refundedBasisAmount.toFixed(2),
          input.cumulativeRefundedBasis.toFixed(2),
          reversalAmount.toFixed(2),
          input.currencyCode,
          status,
          reasonCode,
          ledgerTransactionId,
          JSON.stringify(input.snapshot),
          input.occurredAt,
          actorUserId,
        ],
      );
      return id;
    });

    const evaluation = await this.getEvaluation(evaluationId);
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'ProgramReferralRefundEvaluation',
      entityId: evaluation.id,
      description: 'Program referral refund evaluated',
      metadata: {
        refundRecordId: evaluation.refundRecordId,
        rewardEventId: evaluation.rewardEventId,
        status: evaluation.status,
        reversalAmount: String(evaluation.reversalAmount),
      },
    });
    return evaluation;
  }

  private async postReversalLedger(
    connection: PoolConnection,
    input: EvaluationInput,
    reversalAmount: Prisma.Decimal,
    actorUserId: string,
  ): Promise<string> {
    const entries = await connection.query<LedgerEntryAccountRow[]>(
      `SELECT e.accountId, e.direction, a.kind, e.currencyCode
       FROM ledger_entries e
       INNER JOIN ledger_accounts a ON a.id = e.accountId
       WHERE e.transactionId = ?`,
      [input.originalLedgerTransactionId],
    );
    const wallet = entries.find(
      (entry) =>
        entry.kind === LedgerAccountKind.USER_WALLET &&
        entry.direction === LedgerEntryDirection.CREDIT,
    );
    const expense = entries.find(
      (entry) =>
        entry.kind === LedgerAccountKind.REFERRAL_REWARD_EXPENSE &&
        entry.direction === LedgerEntryDirection.DEBIT,
    );
    if (!wallet || !expense) {
      throw new ConflictException('Original referral reward ledger entries cannot be reversed safely');
    }
    if (wallet.currencyCode !== input.currencyCode || expense.currencyCode !== input.currencyCode) {
      throw new ConflictException('Original referral reward ledger currency does not match refund currency');
    }

    const transactionId = randomUUID();
    await connection.query(
      `INSERT INTO ledger_transactions
         (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        transactionId,
        `REFERRAL_REWARD_REFUND:${input.refundRecordId}`,
        LedgerTransactionType.REVERSAL,
        `Referral reward reversal for refund ${input.refundRecordId}`,
        input.occurredAt,
        actorUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ledger_entries
         (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
       VALUES
         (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3)),
         (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        transactionId,
        wallet.accountId,
        LedgerEntryDirection.DEBIT,
        reversalAmount.toFixed(2),
        input.currencyCode,
        randomUUID(),
        transactionId,
        expense.accountId,
        LedgerEntryDirection.CREDIT,
        reversalAmount.toFixed(2),
        input.currencyCode,
      ],
    );
    return transactionId;
  }

  private jsonObject(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
