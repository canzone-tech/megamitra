import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BinaryUnitService } from '../binary-unit/binary-unit.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, PolicyLifecycle } from '../generated/prisma/enums';
import type {
  CreateProgramEventPolicyDto,
  ProgramEventTriggerType,
  ReferralBasisMode,
  UpdateProgramEventPolicyDto,
} from './program-orchestration.dto';

type PolicyRow = {
  id: string;
  programVersionId: string;
  triggerType: ProgramEventTriggerType;
  version: number;
  lifecycle: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  binaryPlanVersionId: string | null;
  binaryUnitsPerEvent: number;
  referralHookEnabled: boolean | number;
  referralPolicyVersionId: string | null;
  referralBasisMode: ReferralBasisMode | null;
  drawEligibilityHookEnabled: boolean | number;
  eligibilityRules: unknown;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  retiredByUserId: string | null;
  publishedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RunRow = {
  id: string;
  businessEventId: string;
  policyVersionId: string | null;
  status: 'PENDING' | 'PROCESSED' | 'SKIPPED' | 'FAILED' | 'RECONCILIATION_REQUIRED';
  eligible: boolean | number;
  eligibilitySnapshot: unknown;
  attempts: number;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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
  status: 'READY' | 'INELIGIBLE' | 'CANCELLED' | 'CONSUMED';
  eligibilitySnapshot: unknown;
  consumedRewardEventId: string | null;
  occurredAt: Date;
};

type DrawHookRow = {
  id: string;
  sourceKey: string;
  runId: string;
  businessEventId: string;
  userId: string;
  programVersionId: string;
  status: 'ELIGIBLE' | 'INELIGIBLE' | 'CANCELLED' | 'CONSUMED';
  eligibilitySnapshot: unknown;
  occurredAt: Date;
};

type BinaryLinkRow = {
  id: string;
  sourceKey: string;
  runId: string;
  businessEventId: string;
  qualifyingUnitEventId: string;
  unitSequence: number;
};

type EligibilityFacts = {
  paymentAmount: Prisma.Decimal;
  registrationAllocation: Prisma.Decimal;
  installmentAllocation: Prisma.Decimal;
  unappliedAllocation: Prisma.Decimal;
  allocationTypes: string[];
};

@Injectable()
export class ProgramOrchestrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly binaryUnits: BinaryUnitService,
    private readonly audit: AuditService,
  ) {}

  async createPolicy(dto: CreateProgramEventPolicyDto, actorUserId: string) {
    const normalized = await this.normalizePolicy(dto);
    const programVersion = await this.prisma.programVersion.findUnique({
      where: { id: dto.programVersionId },
      select: { id: true },
    });
    if (!programVersion) throw new NotFoundException('Program version not found');

    const versions = await this.prisma.$queryRawUnsafe<Array<{ nextVersion: bigint | number }>>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
       FROM program_event_policy_versions
       WHERE programVersionId = ? AND triggerType = ?`,
      dto.programVersionId,
      dto.triggerType,
    );
    const version = Number(versions[0]?.nextVersion ?? 1);
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO program_event_policy_versions
         (id, programVersionId, triggerType, version, lifecycle, effectiveFrom, effectiveTo,
          binaryPlanVersionId, binaryUnitsPerEvent, referralHookEnabled, referralPolicyVersionId,
          referralBasisMode, drawEligibilityHookEnabled, eligibilityRules, createdByUserId,
          createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      id,
      dto.programVersionId,
      dto.triggerType,
      version,
      normalized.effectiveFrom,
      normalized.effectiveTo,
      normalized.binaryPlanVersionId,
      normalized.binaryUnitsPerEvent,
      normalized.referralHookEnabled,
      normalized.referralPolicyVersionId,
      normalized.referralBasisMode,
      normalized.drawEligibilityHookEnabled,
      normalized.eligibilityRules ? JSON.stringify(normalized.eligibilityRules) : null,
      actorUserId,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'ProgramEventPolicyVersion',
      entityId: id,
      description: 'Program event orchestration policy draft created',
      metadata: { programVersionId: dto.programVersionId, triggerType: dto.triggerType, version },
    });
    return this.getPolicy(id);
  }

  async updateDraft(id: string, dto: UpdateProgramEventPolicyDto, actorUserId: string) {
    const current = await this.getPolicy(id);
    if (current.lifecycle !== 'DRAFT') {
      throw new ConflictException('Published or retired program event policies are immutable');
    }
    const merged: CreateProgramEventPolicyDto = {
      programVersionId: current.programVersionId,
      triggerType: current.triggerType,
      effectiveFrom: dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      effectiveTo:
        dto.effectiveTo !== undefined
          ? dto.effectiveTo
          : current.effectiveTo?.toISOString(),
      binaryPlanVersionId:
        dto.binaryPlanVersionId !== undefined
          ? dto.binaryPlanVersionId
          : current.binaryPlanVersionId ?? undefined,
      binaryUnitsPerEvent:
        dto.binaryUnitsPerEvent !== undefined ? dto.binaryUnitsPerEvent : current.binaryUnitsPerEvent,
      referralHookEnabled:
        dto.referralHookEnabled !== undefined
          ? dto.referralHookEnabled
          : this.truthy(current.referralHookEnabled),
      referralPolicyVersionId:
        dto.referralPolicyVersionId !== undefined
          ? dto.referralPolicyVersionId
          : current.referralPolicyVersionId ?? undefined,
      referralBasisMode:
        dto.referralBasisMode !== undefined
          ? dto.referralBasisMode
          : current.referralBasisMode ?? undefined,
      drawEligibilityHookEnabled:
        dto.drawEligibilityHookEnabled !== undefined
          ? dto.drawEligibilityHookEnabled
          : this.truthy(current.drawEligibilityHookEnabled),
      eligibilityRules:
        dto.eligibilityRules !== undefined
          ? dto.eligibilityRules
          : this.jsonObject(current.eligibilityRules),
    };
    const normalized = await this.normalizePolicy(merged);
    await this.prisma.$executeRawUnsafe(
      `UPDATE program_event_policy_versions
       SET effectiveFrom = ?, effectiveTo = ?, binaryPlanVersionId = ?, binaryUnitsPerEvent = ?,
           referralHookEnabled = ?, referralPolicyVersionId = ?, referralBasisMode = ?,
           drawEligibilityHookEnabled = ?, eligibilityRules = ?, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND lifecycle = 'DRAFT'`,
      normalized.effectiveFrom,
      normalized.effectiveTo,
      normalized.binaryPlanVersionId,
      normalized.binaryUnitsPerEvent,
      normalized.referralHookEnabled,
      normalized.referralPolicyVersionId,
      normalized.referralBasisMode,
      normalized.drawEligibilityHookEnabled,
      normalized.eligibilityRules ? JSON.stringify(normalized.eligibilityRules) : null,
      id,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramEventPolicyVersion',
      entityId: id,
      description: 'Program event orchestration policy draft updated',
    });
    return this.getPolicy(id);
  }

  async publish(id: string, actorUserId: string) {
    const policy = await this.getPolicy(id);
    if (policy.lifecycle !== 'DRAFT') {
      throw new ConflictException('Only draft program event policies can be published');
    }
    await this.validateTargetVersions(policy);
    const overlaps = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM program_event_policy_versions
       WHERE programVersionId = ? AND triggerType = ? AND lifecycle = 'PUBLISHED' AND id <> ?
         AND effectiveFrom <= COALESCE(?, '9999-12-31 23:59:59.999')
         AND (effectiveTo IS NULL OR effectiveTo >= ?)
       LIMIT 1`,
      policy.programVersionId,
      policy.triggerType,
      id,
      policy.effectiveTo,
      policy.effectiveFrom,
    );
    if (overlaps[0]) {
      throw new ConflictException('Another published orchestration policy overlaps this effective window');
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE program_event_policy_versions
       SET lifecycle = 'PUBLISHED', publishedByUserId = ?, publishedAt = CURRENT_TIMESTAMP(3),
           updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND lifecycle = 'DRAFT'`,
      actorUserId,
      id,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramEventPolicyVersion',
      entityId: id,
      description: 'Program event orchestration policy published',
    });
    return this.getPolicy(id);
  }

  async retire(id: string, actorUserId: string) {
    const policy = await this.getPolicy(id);
    if (policy.lifecycle !== 'PUBLISHED') {
      throw new ConflictException('Only published program event policies can be retired');
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE program_event_policy_versions
       SET lifecycle = 'RETIRED', retiredByUserId = ?, retiredAt = CURRENT_TIMESTAMP(3),
           updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND lifecycle = 'PUBLISHED'`,
      actorUserId,
      id,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramEventPolicyVersion',
      entityId: id,
      description: 'Program event orchestration policy retired',
    });
    return this.getPolicy(id);
  }

  async getPolicy(id: string): Promise<PolicyRow> {
    const rows = await this.prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT * FROM program_event_policy_versions WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Program event orchestration policy not found');
    return rows[0];
  }

  async listPolicies(programVersionId?: string) {
    if (programVersionId) {
      return this.prisma.$queryRawUnsafe<PolicyRow[]>(
        `SELECT * FROM program_event_policy_versions
         WHERE programVersionId = ? ORDER BY triggerType ASC, version DESC`,
        programVersionId,
      );
    }
    return this.prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT * FROM program_event_policy_versions ORDER BY createdAt DESC, version DESC`,
    );
  }

  async processEvent(businessEventId: string, actorUserId: string) {
    const existing = await this.getRunByEventId(businessEventId);
    if (existing && (existing.status === 'PROCESSED' || existing.status === 'SKIPPED')) {
      return { run: await this.getRun(existing.id), idempotent: true };
    }

    const event = await this.prisma.programBusinessEvent.findUnique({
      where: { id: businessEventId },
      include: {
        enrollment: {
          include: {
            programVersion: true,
            user: { select: { id: true, username: true } },
          },
        },
        paymentRecord: { include: { allocations: true } },
        refundRecord: true,
      },
    });
    if (!event) throw new NotFoundException('Program business event not found');

    const policies = await this.prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT * FROM program_event_policy_versions
       WHERE programVersionId = ? AND triggerType = ? AND lifecycle = 'PUBLISHED'
         AND effectiveFrom <= ? AND (effectiveTo IS NULL OR effectiveTo >= ?)
       ORDER BY version DESC LIMIT 2`,
      event.enrollment.programVersionId,
      event.type,
      event.occurredAt,
      event.occurredAt,
    );
    if (policies.length > 1) {
      throw new ConflictException('Multiple orchestration policies are effective for this business event');
    }
    const policy = policies[0] ?? null;
    if (!policy) {
      const runId = await this.upsertRun({
        businessEventId,
        policyVersionId: null,
        status: 'SKIPPED',
        eligible: false,
        snapshot: { eligible: false, reasons: ['NO_PUBLISHED_POLICY'] },
        errorMessage: null,
      });
      return { run: await this.getRun(runId), idempotent: false };
    }

    const facts = this.paymentFacts(event.paymentRecord);
    const eligibility = this.evaluateEligibility(policy.eligibilityRules, facts);
    const runId = await this.upsertRun({
      businessEventId,
      policyVersionId: policy.id,
      status: 'PENDING',
      eligible: eligibility.eligible,
      snapshot: eligibility,
      errorMessage: null,
    });

    try {
      if (eligibility.eligible && policy.binaryPlanVersionId && policy.binaryUnitsPerEvent > 0) {
        for (let sequence = 1; sequence <= policy.binaryUnitsPerEvent; sequence += 1) {
          const sourceKey = `PROGRAM_EVENT:${businessEventId}:BINARY:${sequence}`;
          const result = await this.binaryUnits.createEvent(
            {
              sourceKey,
              sourceMemberUserId: event.enrollment.userId,
              planVersionId: policy.binaryPlanVersionId,
              occurredAt: event.occurredAt.toISOString(),
              metadata: {
                programBusinessEventId: businessEventId,
                programEnrollmentId: event.enrollmentId,
                programEventPolicyVersionId: policy.id,
                unitSequence: sequence,
              },
            },
            actorUserId,
          );
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO program_binary_qualification_links
               (id, sourceKey, runId, businessEventId, qualifyingUnitEventId, unitSequence, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE qualifyingUnitEventId = VALUES(qualifyingUnitEventId)`,
            randomUUID(),
            sourceKey,
            runId,
            businessEventId,
            result.event.id,
            sequence,
          );
        }
      }

      if (this.truthy(policy.referralHookEnabled) && policy.referralPolicyVersionId) {
        await this.createReferralHook(runId, policy, event, facts, eligibility);
      }
      if (this.truthy(policy.drawEligibilityHookEnabled)) {
        await this.createDrawHook(runId, policy, event, eligibility);
      }

      await this.prisma.$executeRawUnsafe(
        `UPDATE program_event_processing_runs
         SET status = ?, eligible = ?, eligibilitySnapshot = ?, errorMessage = NULL,
             completedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        eligibility.eligible ? 'PROCESSED' : 'SKIPPED',
        eligibility.eligible,
        JSON.stringify(eligibility),
        runId,
      );
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'ProgramEventProcessingRun',
        entityId: runId,
        description: 'Program business event orchestration processed',
        metadata: { businessEventId, policyVersionId: policy.id, eligible: eligibility.eligible },
      });
      return { run: await this.getRun(runId), idempotent: false };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown orchestration error';
      await this.prisma.$executeRawUnsafe(
        `UPDATE program_event_processing_runs
         SET status = 'FAILED', errorMessage = ?, completedAt = CURRENT_TIMESTAMP(3),
             updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        message,
        runId,
      );
      throw error;
    }
  }

  async processPending(actorUserId: string, limit = 25) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const events = await this.prisma.programBusinessEvent.findMany({
      where: {
        NOT: {
          id: {
            in: (
              await this.prisma.$queryRawUnsafe<Array<{ businessEventId: string }>>(
                `SELECT businessEventId FROM program_event_processing_runs
                 WHERE status IN ('PROCESSED','SKIPPED')`,
              )
            ).map((row) => row.businessEventId),
          },
        },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      take: safeLimit,
      select: { id: true },
    });
    const results: Array<{ eventId: string; status: string; error?: string }> = [];
    for (const event of events) {
      try {
        const result = await this.processEvent(event.id, actorUserId);
        results.push({ eventId: event.id, status: result.run.status });
      } catch (error) {
        results.push({
          eventId: event.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return { processed: results.length, results };
  }

  async getRun(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<RunRow[]>(
      `SELECT * FROM program_event_processing_runs WHERE id = ? LIMIT 1`,
      id,
    );
    const run = rows[0];
    if (!run) throw new NotFoundException('Program event processing run not found');
    const [binaryLinks, referralHooks, drawHooks] = await Promise.all([
      this.prisma.$queryRawUnsafe<BinaryLinkRow[]>(
        `SELECT * FROM program_binary_qualification_links WHERE runId = ? ORDER BY unitSequence ASC`,
        id,
      ),
      this.prisma.$queryRawUnsafe<ReferralHookRow[]>(
        `SELECT * FROM program_referral_reward_hooks WHERE runId = ? ORDER BY occurredAt ASC`,
        id,
      ),
      this.prisma.$queryRawUnsafe<DrawHookRow[]>(
        `SELECT * FROM program_draw_eligibility_hooks WHERE runId = ? ORDER BY occurredAt ASC`,
        id,
      ),
    ]);
    return { ...run, binaryLinks, referralHooks, drawHooks };
  }

  async getReferralHook(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<ReferralHookRow[]>(
      `SELECT * FROM program_referral_reward_hooks WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Program referral reward hook not found');
    return rows[0];
  }

  async getDrawHook(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<DrawHookRow[]>(
      `SELECT * FROM program_draw_eligibility_hooks WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Program draw eligibility hook not found');
    return rows[0];
  }

  private async normalizePolicy(dto: CreateProgramEventPolicyDto) {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (!Number.isFinite(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid date');
    }
    if (effectiveTo && (!Number.isFinite(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
      throw new BadRequestException('effectiveTo must be greater than or equal to effectiveFrom');
    }
    const binaryUnitsPerEvent = dto.binaryUnitsPerEvent ?? 0;
    const referralHookEnabled = dto.referralHookEnabled ?? false;
    const drawEligibilityHookEnabled = dto.drawEligibilityHookEnabled ?? false;
    if (binaryUnitsPerEvent > 0 && !dto.binaryPlanVersionId) {
      throw new BadRequestException('binaryPlanVersionId is required when binaryUnitsPerEvent is greater than zero');
    }
    if (referralHookEnabled) {
      if (dto.triggerType !== 'PAYMENT_CONFIRMED') {
        throw new BadRequestException('Referral reward handoff currently requires a PAYMENT_CONFIRMED trigger');
      }
      if (!dto.referralPolicyVersionId || !dto.referralBasisMode) {
        throw new BadRequestException(
          'referralPolicyVersionId and referralBasisMode are required when referralHookEnabled is true',
        );
      }
    }
    this.validateEligibilityRules(dto.eligibilityRules);
    return {
      effectiveFrom,
      effectiveTo,
      binaryPlanVersionId: dto.binaryPlanVersionId ?? null,
      binaryUnitsPerEvent,
      referralHookEnabled,
      referralPolicyVersionId: dto.referralPolicyVersionId ?? null,
      referralBasisMode: dto.referralBasisMode ?? null,
      drawEligibilityHookEnabled,
      eligibilityRules: dto.eligibilityRules ?? null,
    };
  }

  private async validateTargetVersions(policy: PolicyRow): Promise<void> {
    if (policy.binaryUnitsPerEvent > 0) {
      if (!policy.binaryPlanVersionId) throw new BadRequestException('Binary plan version is required');
      const binary = await this.prisma.binaryPlanVersion.findUnique({
        where: { id: policy.binaryPlanVersionId },
        select: { lifecycle: true },
      });
      if (!binary) throw new NotFoundException('Binary plan version not found');
      if (binary.lifecycle !== PolicyLifecycle.PUBLISHED) {
        throw new ConflictException('Binary plan version must be published before orchestration policy publish');
      }
    }
    if (this.truthy(policy.referralHookEnabled)) {
      if (!policy.referralPolicyVersionId || !policy.referralBasisMode) {
        throw new BadRequestException('Referral hook target policy and basis mode are required');
      }
      const referral = await this.prisma.referralRewardPolicyVersion.findUnique({
        where: { id: policy.referralPolicyVersionId },
        select: { lifecycle: true },
      });
      if (!referral) throw new NotFoundException('Referral reward policy version not found');
      if (referral.lifecycle !== PolicyLifecycle.PUBLISHED) {
        throw new ConflictException('Referral reward policy version must be published before handoff');
      }
    }
  }

  private paymentFacts(
    payment:
      | {
          amount: Prisma.Decimal;
          allocations: Array<{ allocationType: string; amount: Prisma.Decimal }>;
        }
      | null,
  ): EligibilityFacts {
    const zero = new Prisma.Decimal(0);
    if (!payment) {
      return {
        paymentAmount: zero,
        registrationAllocation: zero,
        installmentAllocation: zero,
        unappliedAllocation: zero,
        allocationTypes: [],
      };
    }
    let registrationAllocation = zero;
    let installmentAllocation = zero;
    let unappliedAllocation = zero;
    const allocationTypes = new Set<string>();
    for (const allocation of payment.allocations) {
      allocationTypes.add(allocation.allocationType);
      if (allocation.allocationType === 'REGISTRATION_FEE') {
        registrationAllocation = registrationAllocation.plus(allocation.amount);
      } else if (allocation.allocationType === 'INSTALLMENT') {
        installmentAllocation = installmentAllocation.plus(allocation.amount);
      } else if (allocation.allocationType === 'UNAPPLIED') {
        unappliedAllocation = unappliedAllocation.plus(allocation.amount);
      }
    }
    return {
      paymentAmount: new Prisma.Decimal(payment.amount),
      registrationAllocation,
      installmentAllocation,
      unappliedAllocation,
      allocationTypes: [...allocationTypes].sort(),
    };
  }

  private evaluateEligibility(rulesValue: unknown, facts: EligibilityFacts) {
    const rules = this.jsonObject(rulesValue) ?? {};
    const reasons: string[] = [];
    const minimumPaymentAmount = this.optionalRuleAmount(rules.minimumPaymentAmount, 'minimumPaymentAmount');
    const minimumRegistrationAllocation = this.optionalRuleAmount(
      rules.minimumRegistrationAllocation,
      'minimumRegistrationAllocation',
    );
    const minimumInstallmentAllocation = this.optionalRuleAmount(
      rules.minimumInstallmentAllocation,
      'minimumInstallmentAllocation',
    );
    if (minimumPaymentAmount && facts.paymentAmount.lessThan(minimumPaymentAmount)) {
      reasons.push('MINIMUM_PAYMENT_AMOUNT_NOT_MET');
    }
    if (
      minimumRegistrationAllocation &&
      facts.registrationAllocation.lessThan(minimumRegistrationAllocation)
    ) {
      reasons.push('MINIMUM_REGISTRATION_ALLOCATION_NOT_MET');
    }
    if (
      minimumInstallmentAllocation &&
      facts.installmentAllocation.lessThan(minimumInstallmentAllocation)
    ) {
      reasons.push('MINIMUM_INSTALLMENT_ALLOCATION_NOT_MET');
    }
    const requiredAllocationTypes = rules.requiredAllocationTypes;
    if (requiredAllocationTypes !== undefined) {
      if (!Array.isArray(requiredAllocationTypes) || requiredAllocationTypes.some((item) => typeof item !== 'string')) {
        throw new BadRequestException('eligibilityRules.requiredAllocationTypes must be a string array');
      }
      const missing = requiredAllocationTypes.filter((item) => !facts.allocationTypes.includes(item));
      if (missing.length > 0) reasons.push('REQUIRED_ALLOCATION_TYPE_MISSING');
    }
    return {
      eligible: reasons.length === 0,
      reasons,
      rules: {
        minimumPaymentAmount: minimumPaymentAmount?.toFixed(2) ?? null,
        minimumRegistrationAllocation: minimumRegistrationAllocation?.toFixed(2) ?? null,
        minimumInstallmentAllocation: minimumInstallmentAllocation?.toFixed(2) ?? null,
        requiredAllocationTypes: Array.isArray(requiredAllocationTypes) ? requiredAllocationTypes : [],
      },
      facts: {
        paymentAmount: facts.paymentAmount.toFixed(2),
        registrationAllocation: facts.registrationAllocation.toFixed(2),
        installmentAllocation: facts.installmentAllocation.toFixed(2),
        unappliedAllocation: facts.unappliedAllocation.toFixed(2),
        allocationTypes: facts.allocationTypes,
      },
    };
  }

  private async createReferralHook(
    runId: string,
    policy: PolicyRow,
    event: Awaited<ReturnType<ProgramOrchestrationService['loadEventForHook']>>,
    facts: EligibilityFacts,
    eligibility: ReturnType<ProgramOrchestrationService['evaluateEligibility']>,
  ) {
    if (!policy.referralPolicyVersionId || !policy.referralBasisMode) return;
    const target = await this.prisma.referralRewardPolicyVersion.findUnique({
      where: { id: policy.referralPolicyVersionId },
      select: {
        lifecycle: true,
        effectiveFrom: true,
        effectiveTo: true,
        currencyCode: true,
      },
    });
    if (!target) throw new NotFoundException('Referral reward policy version not found');
    const sponsor = await this.prisma.sponsorRelationship.findUnique({
      where: { memberUserId: event.enrollment.userId },
      select: { sponsorUserId: true },
    });
    const basisAmount = this.referralBasis(policy.referralBasisMode, facts);
    const targetEffective =
      target.lifecycle === PolicyLifecycle.PUBLISHED &&
      target.effectiveFrom <= event.occurredAt &&
      (!target.effectiveTo || target.effectiveTo >= event.occurredAt);
    const currencyMatches = target.currencyCode === event.enrollment.currencyCode;
    const ready = eligibility.eligible && Boolean(sponsor) && targetEffective && currencyMatches;
    const snapshot = {
      orchestrationEligibility: eligibility,
      sponsorAssigned: Boolean(sponsor),
      targetPolicyPublishedAndEffective: targetEffective,
      currencyMatches,
      basisMode: policy.referralBasisMode,
      basisAmount: basisAmount.toFixed(2),
    };
    const sourceKey = `PROGRAM_EVENT:${event.id}:REFERRAL`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO program_referral_reward_hooks
         (id, sourceKey, runId, businessEventId, referredUserId, sponsorUserId,
          referralPolicyVersionId, basisAmount, currencyCode, status, eligibilitySnapshot,
          consumedRewardEventId, occurredAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE updatedAt = CURRENT_TIMESTAMP(3)`,
      randomUUID(),
      sourceKey,
      runId,
      event.id,
      event.enrollment.userId,
      sponsor?.sponsorUserId ?? null,
      policy.referralPolicyVersionId,
      basisAmount.toFixed(2),
      event.enrollment.currencyCode,
      ready ? 'READY' : 'INELIGIBLE',
      JSON.stringify(snapshot),
      event.occurredAt,
    );
  }

  private async createDrawHook(
    runId: string,
    _policy: PolicyRow,
    event: Awaited<ReturnType<ProgramOrchestrationService['loadEventForHook']>>,
    eligibility: ReturnType<ProgramOrchestrationService['evaluateEligibility']>,
  ) {
    const sourceKey = `PROGRAM_EVENT:${event.id}:DRAW`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO program_draw_eligibility_hooks
         (id, sourceKey, runId, businessEventId, userId, programVersionId, status,
          eligibilitySnapshot, occurredAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE updatedAt = CURRENT_TIMESTAMP(3)`,
      randomUUID(),
      sourceKey,
      runId,
      event.id,
      event.enrollment.userId,
      event.enrollment.programVersionId,
      eligibility.eligible ? 'ELIGIBLE' : 'INELIGIBLE',
      JSON.stringify(eligibility),
      event.occurredAt,
    );
  }

  private referralBasis(mode: ReferralBasisMode, facts: EligibilityFacts): Prisma.Decimal {
    if (mode === 'PAYMENT_AMOUNT') return facts.paymentAmount;
    if (mode === 'REGISTRATION_ALLOCATION') return facts.registrationAllocation;
    if (mode === 'INSTALLMENT_ALLOCATION') return facts.installmentAllocation;
    return facts.registrationAllocation.plus(facts.installmentAllocation);
  }

  private async upsertRun(input: {
    businessEventId: string;
    policyVersionId: string | null;
    status: RunRow['status'];
    eligible: boolean;
    snapshot: unknown;
    errorMessage: string | null;
  }): Promise<string> {
    const existing = await this.getRunByEventId(input.businessEventId);
    if (existing) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE program_event_processing_runs
         SET policyVersionId = ?, status = ?, eligible = ?, eligibilitySnapshot = ?,
             attempts = attempts + 1, errorMessage = ?, startedAt = CURRENT_TIMESTAMP(3),
             completedAt = ?, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        input.policyVersionId,
        input.status,
        input.eligible,
        JSON.stringify(input.snapshot),
        input.errorMessage,
        input.status === 'PENDING' ? null : new Date(),
        existing.id,
      );
      return existing.id;
    }
    const id = randomUUID();
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO program_event_processing_runs
           (id, businessEventId, policyVersionId, status, eligible, eligibilitySnapshot,
            attempts, errorMessage, startedAt, completedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP(3), ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        id,
        input.businessEventId,
        input.policyVersionId,
        input.status,
        input.eligible,
        JSON.stringify(input.snapshot),
        input.errorMessage,
        input.status === 'PENDING' ? null : new Date(),
      );
      return id;
    } catch (error) {
      const raced = await this.getRunByEventId(input.businessEventId);
      if (raced) return raced.id;
      throw error;
    }
  }

  private async getRunByEventId(businessEventId: string): Promise<RunRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<RunRow[]>(
      `SELECT * FROM program_event_processing_runs WHERE businessEventId = ? LIMIT 1`,
      businessEventId,
    );
    return rows[0] ?? null;
  }

  private async loadEventForHook(id: string) {
    const event = await this.prisma.programBusinessEvent.findUnique({
      where: { id },
      include: {
        enrollment: { include: { programVersion: true } },
        paymentRecord: { include: { allocations: true } },
      },
    });
    if (!event) throw new NotFoundException('Program business event not found');
    return event;
  }

  private validateEligibilityRules(value: unknown): void {
    const rules = this.jsonObject(value);
    if (!rules) return;
    for (const key of [
      'minimumPaymentAmount',
      'minimumRegistrationAllocation',
      'minimumInstallmentAllocation',
    ]) {
      if (rules[key] !== undefined) this.optionalRuleAmount(rules[key], key);
    }
    if (
      rules.requiredAllocationTypes !== undefined &&
      (!Array.isArray(rules.requiredAllocationTypes) ||
        rules.requiredAllocationTypes.some((item) =>
          !['REGISTRATION_FEE', 'INSTALLMENT', 'UNAPPLIED'].includes(String(item)),
        ))
    ) {
      throw new BadRequestException(
        'eligibilityRules.requiredAllocationTypes may only contain REGISTRATION_FEE, INSTALLMENT or UNAPPLIED',
      );
    }
  }

  private optionalRuleAmount(value: unknown, field: string): Prisma.Decimal | null {
    if (value === undefined || value === null) return null;
    try {
      const amount = new Prisma.Decimal(String(value));
      if (!amount.isFinite() || amount.isNegative()) throw new Error('invalid');
      return amount;
    } catch {
      throw new BadRequestException(`eligibilityRules.${field} must be a non-negative decimal`);
    }
  }

  private jsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private truthy(value: boolean | number): boolean {
    return value === true || value === 1;
  }
}
