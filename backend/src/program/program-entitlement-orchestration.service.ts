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
import { EntitlementGenerationService } from '../entitlement/entitlement-generation.service';
import { AuditAction } from '../generated/prisma/enums';
import { ProgramOrchestrationService } from './program-orchestration.service';

type EntitlementBindingRow = {
  id: string;
  programEventPolicyVersionId: string;
  entitlementPolicyVersionId: string;
  entitlementPolicyCode: string;
  entitlementPolicyName: string;
  entitlementPolicyVersion: number | bigint;
  entitlementPolicyLifecycle: string;
  entitlementPolicyEffectiveFrom: Date;
  entitlementPolicyEffectiveTo: Date | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EntitlementTargetRow = {
  lifecycle: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  entitlementProgramId: string | null;
  orchestrationProgramId: string;
};

type EntitlementGenerationLinkRow = {
  id: string;
  sourceKey: string;
  bindingId: string;
  runId: string;
  businessEventId: string;
  entitlementGenerationRunId: string;
  status: 'GENERATED' | 'INELIGIBLE';
  entitlementPolicyVersionId: string;
  generatedCount: number | bigint;
  createdAt: Date;
};

@Injectable()
export class ProgramEntitlementOrchestrationService extends ProgramOrchestrationService {
  private readonly db: PrismaService;
  private readonly audits: AuditService;

  constructor(
    prisma: PrismaService,
    binaryUnits: BinaryUnitService,
    audit: AuditService,
    private readonly entitlementGeneration: EntitlementGenerationService,
  ) {
    super(prisma, binaryUnits, audit);
    this.db = prisma;
    this.audits = audit;
  }

  async getEntitlementHook(programEventPolicyVersionId: string) {
    await super.getPolicy(programEventPolicyVersionId);
    const binding = await this.findBinding(programEventPolicyVersionId);
    return { configured: Boolean(binding), binding };
  }

  async configureEntitlementHook(
    programEventPolicyVersionId: string,
    entitlementPolicyVersionId: string,
    actorUserId: string,
  ) {
    const policy = await super.getPolicy(programEventPolicyVersionId);
    if (policy.lifecycle !== 'DRAFT') {
      throw new ConflictException(
        'Entitlement hook configuration is immutable after the orchestration policy is published',
      );
    }

    const targetRows = await this.db.$queryRawUnsafe<EntitlementTargetRow[]>(
      `SELECT v.lifecycle, v.effectiveFrom, v.effectiveTo,
              p.programId AS entitlementProgramId, pv.programId AS orchestrationProgramId
       FROM entitlement_policy_versions v
       INNER JOIN entitlement_policies p ON p.id = v.policyId
       INNER JOIN program_versions pv ON pv.id = ?
       WHERE v.id = ? LIMIT 1`,
      policy.programVersionId,
      entitlementPolicyVersionId,
    );
    const target = targetRows[0];
    if (!target) throw new NotFoundException('Entitlement policy version not found');
    if (target.lifecycle !== 'PUBLISHED') {
      throw new ConflictException(
        'Entitlement policy version must be published before it can be attached to orchestration',
      );
    }
    if (
      target.entitlementProgramId !== null &&
      target.entitlementProgramId !== target.orchestrationProgramId
    ) {
      throw new BadRequestException('Entitlement policy version belongs to a different program');
    }

    this.assertTargetCoversOrchestrationWindow(policy, target);

    const existing = await this.findBinding(programEventPolicyVersionId);
    if (existing?.entitlementPolicyVersionId === entitlementPolicyVersionId) {
      return { configured: true, binding: existing, idempotent: true };
    }

    if (existing) {
      await this.db.$executeRawUnsafe(
        `UPDATE program_entitlement_orchestration_bindings
         SET entitlementPolicyVersionId = ?, updatedByUserId = ?, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        entitlementPolicyVersionId,
        actorUserId,
        existing.id,
      );
      await this.audits.log({
        actorUserId,
        action: AuditAction.UPDATE,
        entityType: 'ProgramEntitlementOrchestrationBinding',
        entityId: existing.id,
        description: 'Program entitlement orchestration target updated',
        metadata: { programEventPolicyVersionId, entitlementPolicyVersionId },
      });
    } else {
      const id = randomUUID();
      await this.db.$executeRawUnsafe(
        `INSERT INTO program_entitlement_orchestration_bindings
           (id, programEventPolicyVersionId, entitlementPolicyVersionId,
            createdByUserId, updatedByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        id,
        programEventPolicyVersionId,
        entitlementPolicyVersionId,
        actorUserId,
        actorUserId,
      );
      await this.audits.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'ProgramEntitlementOrchestrationBinding',
        entityId: id,
        description: 'Program entitlement orchestration target configured',
        metadata: { programEventPolicyVersionId, entitlementPolicyVersionId },
      });
    }

    return {
      configured: true,
      binding: await this.findBinding(programEventPolicyVersionId),
      idempotent: false,
    };
  }

  async removeEntitlementHook(programEventPolicyVersionId: string, actorUserId: string) {
    const policy = await super.getPolicy(programEventPolicyVersionId);
    if (policy.lifecycle !== 'DRAFT') {
      throw new ConflictException(
        'Entitlement hook configuration is immutable after the orchestration policy is published',
      );
    }
    const existing = await this.findBinding(programEventPolicyVersionId);
    if (!existing) return { configured: false, removed: false };

    await this.db.$executeRawUnsafe(
      `DELETE FROM program_entitlement_orchestration_bindings WHERE id = ?`,
      existing.id,
    );
    await this.audits.log({
      actorUserId,
      action: AuditAction.DELETE,
      entityType: 'ProgramEntitlementOrchestrationBinding',
      entityId: existing.id,
      description: 'Program entitlement orchestration target removed',
      metadata: { programEventPolicyVersionId },
    });
    return { configured: false, removed: true };
  }

  async processEvent(businessEventId: string, actorUserId: string) {
    const result = await super.processEvent(businessEventId, actorUserId);
    const runId = String(result.run.id);
    const policyVersionId = result.run.policyVersionId
      ? String(result.run.policyVersionId)
      : null;

    if (String(result.run.status) !== 'PROCESSED' || !policyVersionId) {
      return { ...result, run: await this.getRun(runId) };
    }

    const binding = await this.findBinding(policyVersionId);
    if (!binding) return { ...result, run: await this.getRun(runId) };

    const existingLink = await this.findGenerationLink(businessEventId);
    if (existingLink) return { ...result, run: await this.getRun(runId) };

    const event = await this.db.programBusinessEvent.findUnique({
      where: { id: businessEventId },
      select: { id: true, enrollmentId: true },
    });
    if (!event) throw new NotFoundException('Program business event not found');

    const sourceKey = `PROGRAM_EVENT:${businessEventId}:ENTITLEMENT`;
    try {
      const generation = await this.entitlementGeneration.generate(actorUserId, {
        sourceKey,
        enrollmentId: event.enrollmentId,
        policyVersionId: binding.entitlementPolicyVersionId,
      });
      const generationRunId = String(generation.id);
      const status = String(generation.status);
      if (status !== 'GENERATED' && status !== 'INELIGIBLE') {
        throw new ConflictException('Unexpected entitlement generation status');
      }

      const candidateLinkId = randomUUID();
      await this.db.$executeRawUnsafe(
        `INSERT INTO program_entitlement_generation_links
           (id, sourceKey, bindingId, runId, businessEventId,
            entitlementGenerationRunId, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id = id`,
        candidateLinkId,
        sourceKey,
        binding.id,
        runId,
        businessEventId,
        generationRunId,
        status,
      );

      const stored = await this.findGenerationLink(businessEventId);
      if (!stored) throw new ConflictException('Entitlement generation link was not persisted');
      if (
        stored.bindingId !== binding.id ||
        stored.entitlementGenerationRunId !== generationRunId
      ) {
        throw new ConflictException(
          'Program event is already linked to a different entitlement generation',
        );
      }

      if (stored.id === candidateLinkId) {
        await this.audits.log({
          actorUserId,
          action: AuditAction.CREATE,
          entityType: 'ProgramEntitlementGenerationLink',
          entityId: stored.id,
          description: 'Program event triggered entitlement generation',
          metadata: {
            businessEventId,
            programEventProcessingRunId: runId,
            entitlementGenerationRunId: generationRunId,
            entitlementPolicyVersionId: binding.entitlementPolicyVersionId,
            status,
          },
        });
      }
    } catch (error) {
      await this.markReconciliationRequired(runId, businessEventId, actorUserId, error);
      throw error;
    }

    return { ...result, run: await this.getRun(runId) };
  }

  async getRun(id: string) {
    const run = await super.getRun(id);
    const entitlementLinks = await this.db.$queryRawUnsafe<EntitlementGenerationLinkRow[]>(
      `SELECT l.id, l.sourceKey, l.bindingId, l.runId, l.businessEventId,
              l.entitlementGenerationRunId, l.status,
              g.policyVersionId AS entitlementPolicyVersionId,
              g.generatedCount, l.createdAt
       FROM program_entitlement_generation_links l
       INNER JOIN entitlement_generation_runs g ON g.id = l.entitlementGenerationRunId
       WHERE l.runId = ? ORDER BY l.createdAt ASC`,
      id,
    );
    return { ...run, entitlementLinks };
  }

  private async findBinding(
    programEventPolicyVersionId: string,
  ): Promise<EntitlementBindingRow | null> {
    const rows = await this.db.$queryRawUnsafe<EntitlementBindingRow[]>(
      `SELECT b.id, b.programEventPolicyVersionId, b.entitlementPolicyVersionId,
              p.code AS entitlementPolicyCode, p.name AS entitlementPolicyName,
              v.version AS entitlementPolicyVersion, v.lifecycle AS entitlementPolicyLifecycle,
              v.effectiveFrom AS entitlementPolicyEffectiveFrom,
              v.effectiveTo AS entitlementPolicyEffectiveTo,
              b.createdByUserId, b.updatedByUserId, b.createdAt, b.updatedAt
       FROM program_entitlement_orchestration_bindings b
       INNER JOIN entitlement_policy_versions v ON v.id = b.entitlementPolicyVersionId
       INNER JOIN entitlement_policies p ON p.id = v.policyId
       WHERE b.programEventPolicyVersionId = ? LIMIT 1`,
      programEventPolicyVersionId,
    );
    return rows[0] ?? null;
  }

  private async findGenerationLink(
    businessEventId: string,
  ): Promise<EntitlementGenerationLinkRow | null> {
    const rows = await this.db.$queryRawUnsafe<EntitlementGenerationLinkRow[]>(
      `SELECT l.id, l.sourceKey, l.bindingId, l.runId, l.businessEventId,
              l.entitlementGenerationRunId, l.status,
              g.policyVersionId AS entitlementPolicyVersionId,
              g.generatedCount, l.createdAt
       FROM program_entitlement_generation_links l
       INNER JOIN entitlement_generation_runs g ON g.id = l.entitlementGenerationRunId
       WHERE l.businessEventId = ? LIMIT 1`,
      businessEventId,
    );
    return rows[0] ?? null;
  }

  private assertTargetCoversOrchestrationWindow(
    policy: Awaited<ReturnType<ProgramOrchestrationService['getPolicy']>>,
    target: EntitlementTargetRow,
  ) {
    const policyFrom = new Date(policy.effectiveFrom).getTime();
    const policyTo = policy.effectiveTo ? new Date(policy.effectiveTo).getTime() : null;
    const targetFrom = new Date(target.effectiveFrom).getTime();
    const targetTo = target.effectiveTo ? new Date(target.effectiveTo).getTime() : null;

    if (targetFrom > policyFrom) {
      throw new BadRequestException(
        'Entitlement policy must be effective on or before the orchestration policy starts',
      );
    }
    if (policyTo === null && targetTo !== null) {
      throw new BadRequestException(
        'An open-ended orchestration policy requires an open-ended entitlement policy version',
      );
    }
    if (policyTo !== null && targetTo !== null && targetTo < policyTo) {
      throw new BadRequestException(
        'Entitlement policy effective window must cover the orchestration policy window',
      );
    }
  }

  private async markReconciliationRequired(
    runId: string,
    businessEventId: string,
    actorUserId: string,
    error: unknown,
  ) {
    const reason =
      error instanceof Error ? error.message.slice(0, 900) : 'Unknown entitlement orchestration error';
    const message = `Entitlement orchestration failed: ${reason}`.slice(0, 1000);
    await this.db.$executeRawUnsafe(
      `UPDATE program_event_processing_runs
       SET status = 'RECONCILIATION_REQUIRED', errorMessage = ?,
           completedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      message,
      runId,
    );
    await this.audits.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramEventProcessingRun',
      entityId: runId,
      description: 'Program entitlement orchestration requires reconciliation',
      metadata: { businessEventId, error: reason },
    });
  }
}
