import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { AuditAction, PolicyLifecycle } from '../generated/prisma/enums';
import type {
  CreateBinaryPlanDto,
  CreateBinaryPlanVersionDto,
  UpdateBinaryPlanVersionDto,
} from './binary-policy.dto';

@Injectable()
export class BinaryPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createPlan(dto: CreateBinaryPlanDto, actorUserId: string) {
    try {
      const plan = await this.prisma.binaryPlan.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryPlan',
        entityId: plan.id,
        description: 'Binary plan created',
        metadata: { code: plan.code },
      });
      return plan;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Binary plan code already exists');
      }
      throw error;
    }
  }

  listPlans() {
    return this.prisma.binaryPlan.findMany({
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
  }

  async createVersion(planId: string, dto: CreateBinaryPlanVersionDto, actorUserId: string) {
    await this.requirePlan(planId);
    this.validateVersionInput(dto);

    try {
      const version = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.binaryPlanVersion.aggregate({
          where: { planId },
          _max: { version: true },
        });
        return tx.binaryPlanVersion.create({
          data: {
            planId,
            version: (latest._max.version ?? 0) + 1,
            lifecycle: PolicyLifecycle.DRAFT,
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            qualifyingUnit: dto.qualifyingUnit,
            leftVolumePerPair: dto.leftVolumePerPair,
            rightVolumePerPair: dto.rightVolumePerPair,
            pairPayoutAmount: dto.pairPayoutAmount,
            dailyPairCap: dto.dailyPairCap,
            monthlyPairCap: dto.monthlyPairCap,
            carryForwardEnabled: dto.carryForwardEnabled,
            carryForwardExpiryDays: dto.carryForwardExpiryDays,
            qualificationRules: dto.qualificationRules as Prisma.InputJsonValue | undefined,
            settlementRules: dto.settlementRules as Prisma.InputJsonValue | undefined,
            createdByUserId: actorUserId,
          },
        });
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryPlanVersion',
        entityId: version.id,
        description: 'Binary plan draft version created',
        metadata: { planId, version: version.version },
      });
      return version;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Concurrent version creation detected; retry the request');
      }
      throw error;
    }
  }

  async updateDraft(versionId: string, dto: UpdateBinaryPlanVersionDto, actorUserId: string) {
    const current = await this.prisma.binaryPlanVersion.findUnique({ where: { id: versionId } });
    if (!current) throw new NotFoundException('Binary plan version not found');
    if (current.lifecycle !== PolicyLifecycle.DRAFT) {
      throw new ConflictException('Published or retired policy versions are immutable');
    }

    const merged = {
      effectiveFrom: dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      effectiveTo: dto.effectiveTo ?? current.effectiveTo?.toISOString(),
      qualifyingUnit: dto.qualifyingUnit ?? current.qualifyingUnit.toString(),
      leftVolumePerPair: dto.leftVolumePerPair ?? current.leftVolumePerPair.toString(),
      rightVolumePerPair: dto.rightVolumePerPair ?? current.rightVolumePerPair.toString(),
      pairPayoutAmount: dto.pairPayoutAmount ?? current.pairPayoutAmount.toString(),
    };
    this.validateVersionInput(merged);

    const version = await this.prisma.binaryPlanVersion.update({
      where: { id: versionId },
      data: {
        ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
        ...(dto.effectiveTo ? { effectiveTo: new Date(dto.effectiveTo) } : {}),
        ...(dto.qualifyingUnit ? { qualifyingUnit: dto.qualifyingUnit } : {}),
        ...(dto.leftVolumePerPair ? { leftVolumePerPair: dto.leftVolumePerPair } : {}),
        ...(dto.rightVolumePerPair ? { rightVolumePerPair: dto.rightVolumePerPair } : {}),
        ...(dto.pairPayoutAmount ? { pairPayoutAmount: dto.pairPayoutAmount } : {}),
        ...(dto.dailyPairCap !== undefined ? { dailyPairCap: dto.dailyPairCap } : {}),
        ...(dto.monthlyPairCap !== undefined ? { monthlyPairCap: dto.monthlyPairCap } : {}),
        ...(dto.carryForwardEnabled !== undefined ? { carryForwardEnabled: dto.carryForwardEnabled } : {}),
        ...(dto.carryForwardExpiryDays !== undefined ? { carryForwardExpiryDays: dto.carryForwardExpiryDays } : {}),
        ...(dto.qualificationRules !== undefined
          ? { qualificationRules: dto.qualificationRules as Prisma.InputJsonValue }
          : {}),
        ...(dto.settlementRules !== undefined
          ? { settlementRules: dto.settlementRules as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'BinaryPlanVersion',
      entityId: version.id,
      description: 'Binary plan draft version updated',
    });
    return version;
  }

  async publish(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.binaryPlanVersion.findUnique({ where: { id: versionId } });
      if (!current) throw new NotFoundException('Binary plan version not found');
      if (current.lifecycle !== PolicyLifecycle.DRAFT) {
        throw new ConflictException('Only draft policy versions can be published');
      }
      const published = await tx.binaryPlanVersion.findFirst({
        where: { planId: current.planId, lifecycle: PolicyLifecycle.PUBLISHED },
      });
      if (published) {
        throw new ConflictException('Retire the currently published version before publishing another');
      }
      const result = await tx.binaryPlanVersion.update({
        where: { id: versionId },
        data: {
          lifecycle: PolicyLifecycle.PUBLISHED,
          publishedAt: new Date(),
          publishedByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.UPDATE,
          entityType: 'BinaryPlanVersion',
          entityId: result.id,
          description: 'Binary plan version published',
          metadata: { planId: result.planId, version: result.version },
        },
      });
      return result;
    });
  }

  async retire(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.binaryPlanVersion.findUnique({ where: { id: versionId } });
      if (!current) throw new NotFoundException('Binary plan version not found');
      if (current.lifecycle !== PolicyLifecycle.PUBLISHED) {
        throw new ConflictException('Only published policy versions can be retired');
      }
      const now = new Date();
      const result = await tx.binaryPlanVersion.update({
        where: { id: versionId },
        data: {
          lifecycle: PolicyLifecycle.RETIRED,
          retiredAt: now,
          retiredByUserId: actorUserId,
          effectiveTo: current.effectiveTo && current.effectiveTo < now ? current.effectiveTo : now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.UPDATE,
          entityType: 'BinaryPlanVersion',
          entityId: result.id,
          description: 'Binary plan version retired',
          metadata: { planId: result.planId, version: result.version },
        },
      });
      return result;
    });
  }

  async getVersion(versionId: string) {
    const version = await this.prisma.binaryPlanVersion.findUnique({
      where: { id: versionId },
      include: { plan: true },
    });
    if (!version) throw new NotFoundException('Binary plan version not found');
    return version;
  }

  private async requirePlan(planId: string): Promise<void> {
    if (!(await this.prisma.binaryPlan.findUnique({ where: { id: planId }, select: { id: true } }))) {
      throw new NotFoundException('Binary plan not found');
    }
  }

  private validateVersionInput(input: {
    effectiveFrom: string;
    effectiveTo?: string;
    qualifyingUnit: string;
    leftVolumePerPair: string;
    rightVolumePerPair: string;
    pairPayoutAmount: string;
  }): void {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('effectiveTo must be later than effectiveFrom');
    }
    for (const [name, raw] of [
      ['qualifyingUnit', input.qualifyingUnit],
      ['leftVolumePerPair', input.leftVolumePerPair],
      ['rightVolumePerPair', input.rightVolumePerPair],
    ] as const) {
      if (!Number.isFinite(Number(raw)) || Number(raw) <= 0) {
        throw new BadRequestException(`${name} must be greater than zero`);
      }
    }
    if (!Number.isFinite(Number(input.pairPayoutAmount)) || Number(input.pairPayoutAmount) < 0) {
      throw new BadRequestException('pairPayoutAmount cannot be negative');
    }
  }
}
