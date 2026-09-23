import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  PolicyLifecycle,
  ReferralRewardMode,
} from '../generated/prisma/enums';
import { ReferralEligibilityService } from './referral-eligibility.service';
import type {
  CreateReferralRewardPolicyDto,
  CreateReferralRewardPolicyVersionDto,
  UpdateReferralRewardPolicyVersionDto,
} from './referral-reward.dto';

@Injectable()
export class ReferralRewardPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: ReferralEligibilityService,
  ) {}

  async createPolicy(dto: CreateReferralRewardPolicyDto, actorUserId: string) {
    try {
      const policy = await this.prisma.referralRewardPolicy.create({
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
        entityType: 'ReferralRewardPolicy',
        entityId: policy.id,
        description: 'Referral reward policy created',
        metadata: { code: policy.code },
      });
      return policy;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Referral reward policy code already exists');
      }
      throw error;
    }
  }

  listPolicies() {
    return this.prisma.referralRewardPolicy.findMany({
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
  }

  async createVersion(
    policyId: string,
    dto: CreateReferralRewardPolicyVersionDto,
    actorUserId: string,
  ) {
    await this.requirePolicy(policyId);
    const normalized = this.validateVersionInput(dto);

    try {
      const version = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.referralRewardPolicyVersion.aggregate({
          where: { policyId },
          _max: { version: true },
        });
        return tx.referralRewardPolicyVersion.create({
          data: {
            policyId,
            version: (latest._max.version ?? 0) + 1,
            lifecycle: PolicyLifecycle.DRAFT,
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            rewardMode: dto.rewardMode,
            fixedAmount: normalized.fixedAmount,
            percentageRate: normalized.percentageRate,
            currencyCode: dto.currencyCode.trim().toUpperCase(),
            roundingMode: dto.roundingMode,
            minimumRewardAmount: normalized.minimumRewardAmount,
            maximumRewardAmount: normalized.maximumRewardAmount,
            eligibilityRules: normalized.eligibilityRules as Prisma.InputJsonValue,
            createdByUserId: actorUserId,
          },
        });
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'ReferralRewardPolicyVersion',
        entityId: version.id,
        description: 'Referral reward policy draft version created',
        metadata: { policyId, version: version.version },
      });
      return version;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Concurrent referral policy version creation detected; retry the request');
      }
      throw error;
    }
  }

  async updateDraft(
    versionId: string,
    dto: UpdateReferralRewardPolicyVersionDto,
    actorUserId: string,
  ) {
    const current = await this.prisma.referralRewardPolicyVersion.findUnique({
      where: { id: versionId },
    });
    if (!current) throw new NotFoundException('Referral reward policy version not found');
    if (current.lifecycle !== PolicyLifecycle.DRAFT) {
      throw new ConflictException('Published or retired referral policy versions are immutable');
    }

    const rewardMode = dto.rewardMode ?? current.rewardMode;
    const merged = {
      effectiveFrom: dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      effectiveTo: dto.effectiveTo ?? current.effectiveTo?.toISOString(),
      rewardMode,
      fixedAmount:
        dto.fixedAmount ??
        (rewardMode === ReferralRewardMode.FIXED ? current.fixedAmount?.toString() : undefined),
      percentageRate:
        dto.percentageRate ??
        (rewardMode === ReferralRewardMode.PERCENTAGE
          ? current.percentageRate?.toString()
          : undefined),
      currencyCode: dto.currencyCode ?? current.currencyCode,
      roundingMode: dto.roundingMode ?? current.roundingMode,
      minimumRewardAmount:
        dto.minimumRewardAmount ?? current.minimumRewardAmount?.toString(),
      maximumRewardAmount:
        dto.maximumRewardAmount ?? current.maximumRewardAmount?.toString(),
      eligibilityRules:
        dto.eligibilityRules ?? (current.eligibilityRules as Record<string, unknown> | null) ?? {},
    };
    const normalized = this.validateVersionInput(merged);

    const version = await this.prisma.referralRewardPolicyVersion.update({
      where: { id: versionId },
      data: {
        ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
        ...(dto.effectiveTo ? { effectiveTo: new Date(dto.effectiveTo) } : {}),
        rewardMode,
        fixedAmount: normalized.fixedAmount,
        percentageRate: normalized.percentageRate,
        ...(dto.currencyCode ? { currencyCode: dto.currencyCode.trim().toUpperCase() } : {}),
        ...(dto.roundingMode ? { roundingMode: dto.roundingMode } : {}),
        minimumRewardAmount: normalized.minimumRewardAmount,
        maximumRewardAmount: normalized.maximumRewardAmount,
        eligibilityRules: normalized.eligibilityRules as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ReferralRewardPolicyVersion',
      entityId: version.id,
      description: 'Referral reward policy draft version updated',
    });
    return version;
  }

  async publish(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.referralRewardPolicyVersion.findUnique({
        where: { id: versionId },
      });
      if (!current) throw new NotFoundException('Referral reward policy version not found');
      if (current.lifecycle !== PolicyLifecycle.DRAFT) {
        throw new ConflictException('Only draft referral policy versions can be published');
      }
      this.validateVersionInput({
        effectiveFrom: current.effectiveFrom.toISOString(),
        effectiveTo: current.effectiveTo?.toISOString(),
        rewardMode: current.rewardMode,
        fixedAmount: current.fixedAmount?.toString(),
        percentageRate: current.percentageRate?.toString(),
        currencyCode: current.currencyCode,
        roundingMode: current.roundingMode,
        minimumRewardAmount: current.minimumRewardAmount?.toString(),
        maximumRewardAmount: current.maximumRewardAmount?.toString(),
        eligibilityRules: (current.eligibilityRules as Record<string, unknown> | null) ?? {},
      });
      const published = await tx.referralRewardPolicyVersion.findFirst({
        where: { policyId: current.policyId, lifecycle: PolicyLifecycle.PUBLISHED },
      });
      if (published) {
        throw new ConflictException(
          'Retire the currently published referral policy version before publishing another',
        );
      }
      const result = await tx.referralRewardPolicyVersion.update({
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
          entityType: 'ReferralRewardPolicyVersion',
          entityId: result.id,
          description: 'Referral reward policy version published',
          metadata: { policyId: result.policyId, version: result.version },
        },
      });
      return result;
    });
  }

  async retire(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.referralRewardPolicyVersion.findUnique({
        where: { id: versionId },
      });
      if (!current) throw new NotFoundException('Referral reward policy version not found');
      if (current.lifecycle !== PolicyLifecycle.PUBLISHED) {
        throw new ConflictException('Only published referral policy versions can be retired');
      }
      const now = new Date();
      const result = await tx.referralRewardPolicyVersion.update({
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
          entityType: 'ReferralRewardPolicyVersion',
          entityId: result.id,
          description: 'Referral reward policy version retired',
          metadata: { policyId: result.policyId, version: result.version },
        },
      });
      return result;
    });
  }

  async getVersion(versionId: string) {
    const version = await this.prisma.referralRewardPolicyVersion.findUnique({
      where: { id: versionId },
      include: { policy: true },
    });
    if (!version) throw new NotFoundException('Referral reward policy version not found');
    return version;
  }

  private async requirePolicy(policyId: string): Promise<void> {
    const policy = await this.prisma.referralRewardPolicy.findUnique({
      where: { id: policyId },
      select: { id: true },
    });
    if (!policy) throw new NotFoundException('Referral reward policy not found');
  }

  private validateVersionInput(input: {
    effectiveFrom: string;
    effectiveTo?: string;
    rewardMode: ReferralRewardMode;
    fixedAmount?: string;
    percentageRate?: string;
    currencyCode: string;
    roundingMode: string;
    minimumRewardAmount?: string;
    maximumRewardAmount?: string;
    eligibilityRules?: Record<string, unknown>;
  }) {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (!Number.isFinite(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid date');
    }
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('effectiveTo must be later than effectiveFrom');
    }
    if (!/^[A-Za-z]{3}$/.test(input.currencyCode)) {
      throw new BadRequestException('currencyCode must be a three-letter code');
    }

    let fixedAmount: string | null = null;
    let percentageRate: string | null = null;
    if (input.rewardMode === ReferralRewardMode.FIXED) {
      fixedAmount = this.positiveAmount(input.fixedAmount, 'fixedAmount');
    } else if (input.rewardMode === ReferralRewardMode.PERCENTAGE) {
      percentageRate = this.positiveAmount(input.percentageRate, 'percentageRate', 4);
    } else {
      throw new BadRequestException('Unsupported referral reward mode');
    }

    const minimumRewardAmount = this.optionalNonNegativeAmount(
      input.minimumRewardAmount,
      'minimumRewardAmount',
    );
    const maximumRewardAmount = this.optionalNonNegativeAmount(
      input.maximumRewardAmount,
      'maximumRewardAmount',
    );
    if (
      minimumRewardAmount !== null &&
      maximumRewardAmount !== null &&
      new Prisma.Decimal(maximumRewardAmount).lessThan(minimumRewardAmount)
    ) {
      throw new BadRequestException(
        'maximumRewardAmount must be greater than or equal to minimumRewardAmount',
      );
    }

    const eligibilityRules = this.eligibility.validateRules(input.eligibilityRules ?? {});
    return {
      fixedAmount,
      percentageRate,
      minimumRewardAmount,
      maximumRewardAmount,
      eligibilityRules,
    };
  }

  private positiveAmount(raw: string | undefined, field: string, scale = 2): string {
    try {
      if (raw === undefined) throw new Error('missing');
      const value = new Prisma.Decimal(raw);
      if (!value.isFinite() || value.lessThanOrEqualTo(0)) throw new Error('invalid');
      return value.toFixed(scale);
    } catch {
      throw new BadRequestException(`${field} must be greater than zero`);
    }
  }

  private optionalNonNegativeAmount(raw: string | undefined, field: string): string | null {
    if (raw === undefined) return null;
    try {
      const value = new Prisma.Decimal(raw);
      if (!value.isFinite() || value.isNegative()) throw new Error('invalid');
      return value.toFixed(2);
    } catch {
      throw new BadRequestException(`${field} must be zero or greater`);
    }
  }
}
