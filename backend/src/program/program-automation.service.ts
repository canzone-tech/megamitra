import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BinarySettlementService } from '../binary-settlement/binary-settlement.service';
import { PrismaService } from '../database/prisma.service';
import { ProgramBusinessEventType } from '../generated/prisma/enums';
import { ProgramOrchestrationService } from './program-orchestration.service';
import { ProgramReferralRewardConsumerService } from './program-referral-reward-consumer.service';

type AutomationRun = {
  status: string;
  binaryLinks?: Array<{ qualifyingUnitEventId: string }>;
  referralHooks?: Array<{ id: string; status: string }>;
};

type ReadyPairRow = {
  ancestorUserId: string;
  planVersionId: string;
  unitCount: number | bigint | string;
  latestCreatedAt: Date;
  settlementTimezone: string | null;
};

type MissingBinaryQualificationRow = {
  businessEventId: string;
};


@Injectable()
export class ProgramAutomationService {
  private readonly logger = new Logger(ProgramAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestration: ProgramOrchestrationService,
    private readonly referralConsumer: ProgramReferralRewardConsumerService,
    private readonly settlements: BinarySettlementService,
  ) {}

  async processEvent(businessEventId: string, actorUserId?: string) {
    const event = await this.prisma.programBusinessEvent.findUnique({
      where: { id: businessEventId },
      select: {
        id: true,
        type: true,
        occurredAt: true,
        enrollment: { select: { userId: true } },
      },
    });
    if (!event) throw new NotFoundException('Program business event not found');
    const actor = actorUserId ?? event.enrollment.userId;
    const processed = await this.orchestration.processEvent(event.id, actor);
    const run = processed.run as unknown as AutomationRun;

    const settlementResults = [];
    if (run.status === 'PROCESSED' && (run.binaryLinks?.length ?? 0) > 0) {
      const qualifyingIds = (run.binaryLinks ?? []).map((item) => item.qualifyingUnitEventId);
      const unitEvents = await this.prisma.binaryQualifyingUnitEvent.findMany({
        where: { id: { in: qualifyingIds } },
        select: {
          id: true,
          planVersionId: true,
          uplineUnits: { select: { ancestorUserId: true } },
        },
      });
      const targets = new Map<string, { memberUserId: string; planVersionId: string }>();
      for (const unitEvent of unitEvents) {
        for (const unit of unitEvent.uplineUnits) {
          const key = `${unit.ancestorUserId}:${unitEvent.planVersionId}`;
          targets.set(key, {
            memberUserId: unit.ancestorUserId,
            planVersionId: unitEvent.planVersionId,
          });
        }
      }
      for (const target of targets.values()) {
        settlementResults.push(
          await this.settlements.runIfPairReady(
            {
              sourceKey: `AUTO_BINARY:${event.id}:${target.memberUserId}:${target.planVersionId}`,
              memberUserId: target.memberUserId,
              planVersionId: target.planVersionId,
              settledAt: event.occurredAt.toISOString(),
            },
            actor,
          ),
        );
      }
    }

    const referrals = [];
    for (const hook of run.referralHooks ?? []) {
      if (hook.status !== 'READY') continue;
      try {
        referrals.push(await this.referralConsumer.consumeHook(hook.id, actor));
      } catch (error) {
        this.logger.warn(
          `Automatic referral hook ${hook.id} failed after event ${event.id}: ${this.errorMessage(error)}`,
        );
      }
    }

    const refund =
      event.type === ProgramBusinessEventType.REFUND_CONFIRMED
        ? await this.referralConsumer.reconcileRefundEvent(event.id, actor)
        : null;

    return { ...processed, referrals, settlements: settlementResults, refund };
  }

  async processPending(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const processedRows = await this.prisma.$queryRawUnsafe<Array<{ businessEventId: string }>>(
      `SELECT businessEventId FROM program_event_processing_runs
       WHERE status IN ('PROCESSED','SKIPPED')`,
    );
    const events = await this.prisma.programBusinessEvent.findMany({
      where: {
        NOT: { id: { in: processedRows.map((row) => row.businessEventId) } },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      take: safeLimit,
      select: { id: true },
    });
    const results = [];
    for (const event of events) {
      try {
        results.push({ eventId: event.id, result: await this.processEvent(event.id) });
      } catch (error) {
        results.push({
          eventId: event.id,
          error: error instanceof Error ? error.message : 'Unknown automation error',
        });
      }
    }
    return { processed: results.length, results };
  }

  async consumeReadyReferralHooks(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const hooks = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; referredUserId: string }>
    >(
      `SELECT id, referredUserId
       FROM program_referral_reward_hooks
       WHERE status = 'READY'
       ORDER BY occurredAt ASC, createdAt ASC
       LIMIT ${safeLimit}`,
    );
    let processed = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const hook of hooks) {
      try {
        await this.referralConsumer.consumeHook(hook.id, hook.referredUserId);
        processed += 1;
      } catch (error) {
        const message = this.errorMessage(error);
        failures.push({ id: hook.id, error: message });
        this.logger.warn(`Automatic referral hook ${hook.id} failed: ${message}`);
      }
    }
    return { processed, failed: failures.length, failures };
  }

  async reconcilePendingReferralRefunds(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const events = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; actorUserId: string }>
    >(
      `SELECT be.id, pe.userId AS actorUserId
       FROM program_business_events be
       INNER JOIN program_enrollments pe ON pe.id = be.enrollmentId
       LEFT JOIN program_referral_refund_evaluations e ON e.refundRecordId = be.refundRecordId
       WHERE be.type = 'REFUND_CONFIRMED' AND be.refundRecordId IS NOT NULL AND e.id IS NULL
       ORDER BY be.occurredAt ASC, be.createdAt ASC
       LIMIT ${safeLimit}`,
    );
    let processed = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const event of events) {
      try {
        await this.referralConsumer.reconcileRefundEvent(event.id, event.actorUserId);
        processed += 1;
      } catch (error) {
        const message = this.errorMessage(error);
        failures.push({ id: event.id, error: message });
        this.logger.warn(`Automatic referral refund ${event.id} failed: ${message}`);
      }
    }
    return { processed, failed: failures.length, failures };
  }

  async repairMissingBinaryQualifications(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = await this.prisma.$queryRawUnsafe<MissingBinaryQualificationRow[]>(
      `SELECT r.businessEventId
       FROM program_event_processing_runs r
       INNER JOIN program_event_policy_versions p ON p.id = r.policyVersionId
       WHERE r.status = 'PROCESSED' AND r.eligible = 1
         AND p.binaryPlanVersionId IS NOT NULL
         AND p.binaryUnitsPerEvent > 0
         AND (
           SELECT COUNT(*)
           FROM program_binary_qualification_links l
           WHERE l.runId = r.id
         ) < p.binaryUnitsPerEvent
       ORDER BY r.completedAt ASC, r.createdAt ASC
       LIMIT ${safeLimit}`,
    );

    const results: Array<{ eventId: string; result?: unknown; error?: string }> = [];
    for (const row of rows) {
      try {
        results.push({
          eventId: row.businessEventId,
          result: await this.processEvent(row.businessEventId),
        });
      } catch (error) {
        results.push({
          eventId: row.businessEventId,
          error: this.errorMessage(error),
        });
      }
    }
    return {
      processed: results.filter((item) => !item.error).length,
      failed: results.filter((item) => item.error).length,
      results,
    };
  }

  async settleReadyPairs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = await this.prisma.$queryRawUnsafe<ReadyPairRow[]>(
      `SELECT u.ancestorUserId, u.planVersionId, COUNT(*) AS unitCount,
              MAX(e.createdAt) AS latestCreatedAt, bpv.settlementTimezone
       FROM binary_upline_qualifying_units u
       INNER JOIN binary_qualifying_unit_events e ON e.id = u.unitEventId
       INNER JOIN binary_plan_versions bpv ON bpv.id = u.planVersionId
       LEFT JOIN binary_qualifying_unit_events reversal ON reversal.reversalOfEventId = e.id
       LEFT JOIN binary_pair_matches lm ON lm.leftUnitId = u.id
       LEFT JOIN binary_pair_matches rm ON rm.rightUnitId = u.id
       LEFT JOIN binary_unit_dispositions d ON d.uplineUnitId = u.id
       WHERE e.eventType = 'QUALIFY' AND reversal.id IS NULL
         AND lm.id IS NULL AND rm.id IS NULL AND d.id IS NULL
       GROUP BY u.ancestorUserId, u.planVersionId, bpv.settlementTimezone
       HAVING (
         SUM(CASE WHEN u.slot='A' THEN 1 ELSE 0 END) > 0
         AND SUM(CASE WHEN u.slot='C' THEN 1 ELSE 0 END) > 0
       ) OR (
         SUM(CASE WHEN u.slot='B' THEN 1 ELSE 0 END) > 0
         AND SUM(CASE WHEN u.slot='D' THEN 1 ELSE 0 END) > 0
       )
       ORDER BY MAX(e.createdAt) ASC
       LIMIT ${safeLimit}`,
    );
    const settledAt = new Date();
    const results = [];
    const failures: Array<{ memberUserId: string; planVersionId: string; error: string }> = [];
    for (const row of rows) {
      const localDate = this.businessDate(settledAt, row.settlementTimezone || 'UTC');
      const latest = new Date(row.latestCreatedAt).toISOString();
      try {
        results.push(
          await this.settlements.runIfPairReady(
            {
              sourceKey:
                `AUTO_BINARY_SWEEP:${row.ancestorUserId}:${row.planVersionId}:${localDate}:${latest}:${Number(row.unitCount)}`,
              memberUserId: row.ancestorUserId,
              planVersionId: row.planVersionId,
              settledAt: settledAt.toISOString(),
            },
            row.ancestorUserId,
          ),
        );
      } catch (error) {
        const message = this.errorMessage(error);
        failures.push({
          memberUserId: row.ancestorUserId,
          planVersionId: row.planVersionId,
          error: message,
        });
        this.logger.warn(
          `Automatic binary settlement failed for ${row.ancestorUserId}/${row.planVersionId}: ${message}`,
        );
      }
    }
    return { processed: results.length, failed: failures.length, results, failures };
  }

  async runCycle() {
    const pending = await this.processPending();
    // Processed runs are durable business truth. If a derived binary qualification/link
    // is missing, rebuild it idempotently before the settlement sweep.
    const repairedBinaryQualifications = await this.repairMissingBinaryQualifications();
    // Settlement runs immediately after qualification so a stale referral/reconciliation
    // item can never starve ready A:C / B:D earnings.
    const settlements = await this.settleReadyPairs();
    const referralHooks = await this.consumeReadyReferralHooks();
    const referralRefunds = await this.reconcilePendingReferralRefunds();
    return {
      pending,
      repairedBinaryQualifications,
      settlements,
      referralHooks,
      referralRefunds,
    };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 500) : 'Unknown automation error';
  }

  private businessDate(value: Date, timeZone: string) {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(value)
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, part.value]),
      );
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      return value.toISOString().slice(0, 10);
    }
  }
}

@Injectable()
export class ProgramAutomationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProgramAutomationWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly automation: ProgramAutomationService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const initial = setTimeout(() => void this.run(), 250);
    initial.unref();
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.automation.runCycle();
    } catch (error) {
      this.logger.error(
        'Automatic business processing cycle failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
