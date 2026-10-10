import { Injectable, Logger } from '@nestjs/common';
import { LuckyDrawTokenService } from '../lucky-draw/lucky-draw-token.service';
import { printedLuckyDrawTokenReference } from '../lucky-draw/lucky-draw-token.util';
import { PrismaService } from '../database/prisma.service';
import { OperationalReadService } from './operational-read.service';

type CountRow = { total: bigint | number | string };
type GenericRow = Record<string, unknown>;

@Injectable()
export class MemberPortalReadService {
  private readonly logger = new Logger(MemberPortalReadService.name);

  constructor(
    private readonly reads: OperationalReadService,
    private readonly prisma: PrismaService,
    private readonly drawTokens: LuckyDrawTokenService,
  ) {}

  /** A member-scoped, read-only register for all months of each enrollment. */
  async installmentHistory(userId: string) {
    // Repair any historical fully-paid months automatically for THIS member.
    // Never block financial history if token provisioning is transiently unavailable.
    let tokenSyncPending = false;
    try {
      await this.drawTokens.ensureMemberConfirmedInstallmentTokens(userId);
    } catch (reason) {
      tokenSyncPending = true;
      this.logger.warn('Member installment draw token self-repair needs retry: ' +
        (reason instanceof Error ? reason.message : String(reason)));
    }
    type Enrollment = {
      id: string; seasonId: string; seasonCode: string; seasonName: string;
      status: string; currencyCode: string; installmentCountSnapshot: number;
      installmentAmountSnapshot: string; registrationFeeSnapshot: string;
    };
    type Month = {
      id: string; enrollmentId: string; sequence: number;
      dueDate: Date | string; amount: string;
      applied: string | number; refunded: string | number;
    };
    type Payment = {
      installmentId: string; id: string; allocatedAmount: string;
      refundedAmount: string | number; occurredAt: Date | string;
      mode: string; reference: string | null;
    };
    type Token = {
      installmentId: string; token: string; installmentSequence: number; status: string;
    };
    const [enrollments, months, payments, tokens] = await Promise.all([
      this.prisma.$queryRawUnsafe<Enrollment[]>(
        "SELECT e.id, s.id AS seasonId, s.code AS seasonCode, " +
        "s.name AS seasonName, e.status, e.currencyCode, " +
        "e.installmentCountSnapshot, e.installmentAmountSnapshot, e.registrationFeeSnapshot " +
        "FROM program_enrollments e " +
        "JOIN owner_seasons s ON s.programVersionId=e.programVersionId " +
        "WHERE e.userId=? ORDER BY e.enrolledAt DESC, e.id DESC", userId,
      ),
      this.prisma.$queryRawUnsafe<Month[]>(
        "SELECT i.id, i.enrollmentId, i.sequence, i.dueDate, i.amount, " +
        "COALESCE(applied.total,0) AS applied, COALESCE(refunded.total,0) AS refunded " +
        "FROM program_installments i " +
        "JOIN program_enrollments e ON e.id=i.enrollmentId " +
        "LEFT JOIN (SELECT installmentId, SUM(amount) AS total FROM program_payment_allocations " +
        "WHERE allocationType='INSTALLMENT' GROUP BY installmentId) applied ON applied.installmentId=i.id " +
        "LEFT JOIN (SELECT pa.installmentId, SUM(ra.amount) AS total FROM program_refund_allocations ra " +
        "JOIN program_payment_allocations pa ON pa.id=ra.paymentAllocationId " +
        "WHERE pa.allocationType='INSTALLMENT' GROUP BY pa.installmentId) refunded ON refunded.installmentId=i.id " +
        "WHERE e.userId=? ORDER BY e.enrolledAt DESC, i.sequence ASC", userId,
      ),
      this.prisma.$queryRawUnsafe<Payment[]>(
        "SELECT pa.installmentId, pr.id, pa.amount AS allocatedAmount, " +
        "COALESCE(refunded.total,0) AS refundedAmount, pr.occurredAt, " +
        "pr.provider AS mode, pr.providerReference AS reference " +
        "FROM program_payment_allocations pa " +
        "JOIN program_payment_records pr ON pr.id=pa.paymentRecordId " +
        "JOIN program_enrollments e ON e.id=pa.enrollmentId " +
        "LEFT JOIN (SELECT paymentAllocationId, SUM(amount) AS total " +
        "FROM program_refund_allocations GROUP BY paymentAllocationId) refunded ON refunded.paymentAllocationId=pa.id " +
        "WHERE e.userId=? AND pa.allocationType='INSTALLMENT' " +
        "ORDER BY pr.occurredAt ASC, pr.id ASC", userId,
      ),
      this.prisma.$queryRawUnsafe<Token[]>(
        "SELECT t.installmentId, t.token, t.installmentSequence, t.status " +
        "FROM lucky_draw_tokens t JOIN program_enrollments e ON e.id=t.enrollmentId " +
        "WHERE e.userId=? AND t.sourceType='INSTALLMENT' " +
        "ORDER BY t.installmentSequence ASC, t.createdAt ASC", userId,
      ),
    ]);
    const iso = (value: Date | string): string => {
      if (value instanceof Date) return value.toISOString();
      const raw = String(value);
      return raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
    };
    const receiptNumber = (payment: Payment) =>
      'MGC-' + iso(payment.occurredAt).slice(0,10).replaceAll('-','') +
      '-' + payment.id.replaceAll('-','').slice(-8).toUpperCase();
    const paymentsByMonth = new Map<string, Payment[]>();
    for (const payment of payments) {
      const entries = paymentsByMonth.get(payment.installmentId) ?? [];
      entries.push(payment);
      paymentsByMonth.set(payment.installmentId, entries);
    }
    const tokensByMonth = new Map<string, Token[]>();
    for (const token of tokens) {
      const entries = tokensByMonth.get(token.installmentId) ?? [];
      entries.push(token);
      tokensByMonth.set(token.installmentId, entries);
    }
    return {
      tokenSyncPending,
      enrollments: enrollments.map((enrollment) => {
        const installments = months
          .filter((month) => month.enrollmentId === enrollment.id)
          .map((month) => {
            const due = Number(month.amount);
            const paid = Math.max(0, Number(month.applied) - Number(month.refunded));
            const status = paid + 0.0001 >= due ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
            return {
              sequence: Number(month.sequence),
              dueDate: iso(month.dueDate).slice(0,10),
              amount: due.toFixed(2),
              netPaid: paid.toFixed(2),
              balance: Math.max(0, due - paid).toFixed(2),
              status,
              payments: (paymentsByMonth.get(month.id) ?? []).map((payment) => ({
                receiptNumber: receiptNumber(payment),
                occurredAt: iso(payment.occurredAt),
                mode: payment.mode,
                reference: payment.reference,
                allocatedAmount: Number(payment.allocatedAmount).toFixed(2),
                refundedAmount: Number(payment.refundedAmount).toFixed(2),
                netAmount: (Number(payment.allocatedAmount) - Number(payment.refundedAmount)).toFixed(2),
              })),
              drawTokens: (tokensByMonth.get(month.id) ?? []).map((token) => ({
                token: token.token,
                status: token.status,
                printedReference: printedLuckyDrawTokenReference(
                  enrollment.seasonCode, Number(token.installmentSequence), token.token,
                ),
              })),
            };
          });
        return {
          ...enrollment,
          installmentCount: Number(enrollment.installmentCountSnapshot),
          installmentAmount: Number(enrollment.installmentAmountSnapshot).toFixed(2),
          installments,
          paidCount: installments.filter((item) => item.status === 'PAID').length,
          totalPaid: installments.reduce((sum, item) => sum + Number(item.netPaid),0).toFixed(2),
          outstanding: installments.reduce((sum, item) => sum + Number(item.balance),0).toFixed(2),
        };
      }),
    };
  }

  /**
   * Member-safe, season-scoped incentives and draw calendar. Never expose
   * draft/unpublished financial rank policies, other member histories or
   * privileged draw execution inputs. Targets are policy snapshots, not promises.
   */
  async rewardGuide(userId: string) {
    type Season = { id: string; enrollmentId: string; programVersionId: string; code: string; name: string; status: string; enrolledAt: Date | string; currencyCode: string };
    type Prize = { seasonId: string; monthNumber: number; prizeCode: string; category: string; name: string; description: string | null; winnerCount: number; nominalValue: string | null; currencyCode: string };
    type Draw = { seasonId: string; monthNumber: number; status: string; drawAt: Date | string };
    type Token = { seasonId: string; installmentSequence: number; token: string; status: string };
    const [seasons, prizes, draws, tokens, awards, memberDraws] = await Promise.all([
      this.prisma.$queryRawUnsafe<Season[]>(
        "SELECT DISTINCT s.id, e.id AS enrollmentId, e.programVersionId, s.code, s.name, s.status, e.enrolledAt, e.currencyCode " +
        "FROM program_enrollments e JOIN owner_seasons s ON s.programVersionId=e.programVersionId " +
        "WHERE e.userId=? AND s.status IN ('ACTIVE','CLOSED') " +
        "ORDER BY e.enrolledAt DESC, s.id DESC", userId,
      ),
      this.prisma.$queryRawUnsafe<Prize[]>(
        "SELECT p.seasonId, p.monthNumber, p.prizeCode, p.category, p.name, p.description, " +
        "p.winnerCount, p.nominalValue, p.currencyCode " +
        "FROM owner_season_prizes p JOIN owner_seasons s ON s.id=p.seasonId " +
        "JOIN program_enrollments e ON e.programVersionId=s.programVersionId " +
        "WHERE e.userId=? AND s.status IN ('ACTIVE','CLOSED') AND p.status='ACTIVE' " +
        "ORDER BY p.monthNumber ASC, p.prizeCode ASC", userId,
      ),
      this.prisma.$queryRawUnsafe<Draw[]>(
        "SELECT r.seasonId, r.monthNumber, d.status, d.drawAt " +
        "FROM owner_draw_runs r JOIN lucky_draw_instances d ON d.id=r.drawId " +
        "JOIN owner_seasons s ON s.id=r.seasonId " +
        "JOIN program_enrollments e ON e.programVersionId=s.programVersionId " +
        "WHERE e.userId=? AND s.status IN ('ACTIVE','CLOSED') " +
        "ORDER BY r.monthNumber ASC", userId,
      ),
      this.prisma.$queryRawUnsafe<Token[]>(
        "SELECT t.seasonId, t.installmentSequence, t.token, t.status " +
        "FROM lucky_draw_tokens t WHERE t.userId=? AND t.sourceType='INSTALLMENT' " +
        "ORDER BY t.installmentSequence ASC", userId,
      ),
      this.prisma.rankAchievement.findMany({
        where: { userId }, orderBy: { achievedAt: 'desc' },
        include: { monthlyPayouts: { select: { sequence: true, amount: true }, orderBy: { sequence: 'asc' } } },
      }),
      this.reads.memberRewards(userId, { page: '1', limit: '100' }),
    ]);
    const versionIds = [...new Set(seasons.map((row) => row.programVersionId))];
    const published = versionIds.length ? await this.prisma.rankRewardPolicyVersion.findMany({
      where: { programVersionId: { in: versionIds }, lifecycle: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
      select: { programVersionId: true, version: true, tiers: true },
    }) : [];
    const policiesByProgram = new Map<string, typeof published[number]>();
    for (const policy of published) {
      if (!policiesByProgram.has(policy.programVersionId)) policiesByProgram.set(policy.programVersionId, policy);
    }
    const toDate = (value: Date | string) => value instanceof Date ? value.toISOString() : String(value);
    return {
      wins: memberDraws.wins.items.map((winner) => ({
        winnerId: winner.winnerId, drawId: winner.drawId,
        prizeTierName: winner.prizeTierName, prizeKind: winner.prizeKind,
        claimStatus: winner.claimStatus, claimDeadline: winner.claimDeadline,
        wonAt: winner.wonAt,
      })),
      seasons: seasons.map((season) => ({
        id: season.id, code: season.code, name: season.name, status: season.status,
        currencyCode: season.currencyCode, enrolledAt: toDate(season.enrolledAt),
        rankPolicy: (() => {
          const policy = policiesByProgram.get(season.programVersionId);
          const tiers: unknown = policy?.tiers;
          return policy ? {
            version: policy.version,
            tiers: Array.isArray(tiers) ? tiers : typeof tiers === 'string' ? JSON.parse(tiers) as unknown : [],
          } : null;
        })(),
        achievements: awards.filter((award) => award.enrollmentId === season.enrollmentId).map((award) => ({
          tierCode: award.tierCode, tierName: award.tierName,
          achievedAt: award.achievedAt, cashAmount: award.cashAmount.toString(),
          monthlyAmount: award.monthlyAmount.toString(), monthlyMonths: award.monthlyMonths,
          paidMonths: award.monthlyPayouts.length,
          tripDescription: award.tripDescription, tripStatus: award.tripStatus,
        })),
        prizes: prizes.filter((p) => p.seasonId === season.id).map((p) => ({
          monthNumber: Number(p.monthNumber), prizeCode: p.prizeCode, category: p.category,
          name: p.name, description: p.description, winnerCount: Number(p.winnerCount),
          nominalValue: p.nominalValue === null ? null : String(p.nominalValue),
          currencyCode: p.currencyCode,
        })),
        draws: draws.filter((d) => d.seasonId === season.id).map((d) => ({
          monthNumber: Number(d.monthNumber), status: d.status, drawAt: toDate(d.drawAt),
        })),
        tokens: tokens.filter((t) => t.seasonId === season.id).map((t) => ({
          monthNumber: Number(t.installmentSequence), token: t.token, status: t.status,
        })),
      })),
    };
  }

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
