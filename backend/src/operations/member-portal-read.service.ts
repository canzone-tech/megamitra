import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OperationalReadService } from './operational-read.service';

type CountRow = { total: bigint | number | string };
type GenericRow = Record<string, unknown>;

@Injectable()
export class MemberPortalReadService {
  constructor(
    private readonly reads: OperationalReadService,
    private readonly prisma: PrismaService,
  ) {}

  async overview(userId: string) {
    const query = { page: '1', limit: '10' };
    const [
      dashboard,
      enrollments,
      walletHistory,
      referralRewards,
      binary,
      rewards,
      directReferralRows,
      enrollmentProgress,
      binaryPlanContext,
    ] = await Promise.all([
      this.reads.memberDashboard(userId),
      this.reads.memberEnrollments(userId, query),
      this.reads.memberWalletHistory(userId, query),
      this.reads.memberReferralRewards(userId, query),
      this.reads.memberBinary(userId, query),
      this.reads.memberRewards(userId, query),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total
         FROM sponsor_relationships
         WHERE sponsorUserId = ?`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT enrollment.id AS enrollmentId,
                enrollment.installmentCountSnapshot AS installmentCount,
                COALESCE(progress.scheduledInstallments, 0) AS scheduledInstallments,
                COALESCE(progress.paidInstallments, 0) AS paidInstallments,
                progress.nextUnpaidDueDate
         FROM program_enrollments enrollment
         LEFT JOIN (
           SELECT installment.enrollmentId,
                  COUNT(*) AS scheduledInstallments,
                  SUM(
                    CASE
                      WHEN GREATEST(
                        COALESCE(applied.appliedAmount, 0) - COALESCE(refunded.refundedAmount, 0),
                        0
                      ) >= installment.amount THEN 1
                      ELSE 0
                    END
                  ) AS paidInstallments,
                  MIN(
                    CASE
                      WHEN GREATEST(
                        COALESCE(applied.appliedAmount, 0) - COALESCE(refunded.refundedAmount, 0),
                        0
                      ) < installment.amount THEN installment.dueDate
                      ELSE NULL
                    END
                  ) AS nextUnpaidDueDate
           FROM program_installments installment
           LEFT JOIN (
             SELECT installmentId, SUM(amount) AS appliedAmount
             FROM program_payment_allocations
             WHERE installmentId IS NOT NULL
             GROUP BY installmentId
           ) applied ON applied.installmentId = installment.id
           LEFT JOIN (
             SELECT allocation.installmentId, SUM(refundAllocation.amount) AS refundedAmount
             FROM program_refund_allocations refundAllocation
             INNER JOIN program_payment_allocations allocation
               ON allocation.id = refundAllocation.paymentAllocationId
             WHERE allocation.installmentId IS NOT NULL
             GROUP BY allocation.installmentId
           ) refunded ON refunded.installmentId = installment.id
           GROUP BY installment.enrollmentId
         ) progress ON progress.enrollmentId = enrollment.id
         WHERE enrollment.userId = ?
         ORDER BY enrollment.enrolledAt DESC, enrollment.id DESC
         LIMIT 10`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<GenericRow[]>(
        `SELECT DISTINCT plan.id AS planVersionId,
                plan.version,
                plan.effectiveFrom,
                plan.qualifyingUnit,
                plan.leftVolumePerPair,
                plan.rightVolumePerPair,
                plan.pairPayoutAmount,
                plan.currencyCode,
                plan.settlementTimezone,
                plan.capOverflowMode,
                plan.dailyPairCap,
                plan.monthlyPairCap,
                plan.carryForwardEnabled,
                plan.carryForwardExpiryDays
         FROM binary_plan_versions plan
         WHERE EXISTS (
           SELECT 1
           FROM binary_upline_qualifying_units unit
           WHERE unit.ancestorUserId = ? AND unit.planVersionId = plan.id
         ) OR EXISTS (
           SELECT 1
           FROM binary_pair_settlements settlement
           WHERE settlement.memberUserId = ? AND settlement.planVersionId = plan.id
         )
         ORDER BY plan.effectiveFrom DESC, plan.version DESC`,
        userId,
        userId,
      ),
    ]);

    return {
      dashboard,
      enrollments,
      walletHistory,
      referralRewards,
      binary,
      rewards,
      directReferralCount: Number(directReferralRows[0]?.total ?? 0),
      enrollmentProgress,
      binaryPlanContext,
    };
  }
}
