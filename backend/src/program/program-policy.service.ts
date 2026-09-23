import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, PolicyLifecycle } from '../generated/prisma/enums';
import type {
  CreateProgramDto,
  CreateProgramVersionDto,
  UpdateProgramVersionDto,
} from './program.dto';
import { ProgramEligibilityService } from './program-eligibility.service';

@Injectable()
export class ProgramPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: ProgramEligibilityService,
  ) {}

  async createProgram(dto: CreateProgramDto, actorUserId: string) {
    try {
      const program = await this.prisma.program.create({
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
        entityType: 'Program',
        entityId: program.id,
        description: 'Program created',
        metadata: { code: program.code },
      });
      return program;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Program code already exists');
      }
      throw error;
    }
  }

  listPrograms() {
    return this.prisma.program.findMany({
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
  }

  async createVersion(programId: string, dto: CreateProgramVersionDto, actorUserId: string) {
    await this.requireProgram(programId);
    const normalized = this.validateVersion(dto);
    try {
      const version = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.programVersion.aggregate({
          where: { programId },
          _max: { version: true },
        });
        return tx.programVersion.create({
          data: {
            programId,
            version: (latest._max.version ?? 0) + 1,
            lifecycle: PolicyLifecycle.DRAFT,
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            currencyCode: dto.currencyCode.trim().toUpperCase(),
            registrationFee: normalized.registrationFee,
            installmentAmount: normalized.installmentAmount,
            installmentCount: dto.installmentCount,
            installmentIntervalUnit: dto.installmentIntervalUnit,
            installmentIntervalCount: dto.installmentIntervalCount,
            firstInstallmentOffsetDays: dto.firstInstallmentOffsetDays,
            gracePeriodDays: dto.gracePeriodDays,
            maxActiveEnrollmentsPerUser: dto.maxActiveEnrollmentsPerUser ?? null,
            partialPaymentsAllowed: dto.partialPaymentsAllowed,
            overpaymentsAllowed: dto.overpaymentsAllowed,
            eligibilityRules: normalized.eligibilityRules as Prisma.InputJsonValue,
            createdByUserId: actorUserId,
          },
        });
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'ProgramVersion',
        entityId: version.id,
        description: 'Program draft version created',
        metadata: { programId, version: version.version },
      });
      return version;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Concurrent program version creation detected; retry the request');
      }
      throw error;
    }
  }

  async updateDraft(versionId: string, dto: UpdateProgramVersionDto, actorUserId: string) {
    const current = await this.prisma.programVersion.findUnique({ where: { id: versionId } });
    if (!current) throw new NotFoundException('Program version not found');
    if (current.lifecycle !== PolicyLifecycle.DRAFT) {
      throw new ConflictException('Published or retired program versions are immutable');
    }

    const merged = {
      effectiveFrom: dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      effectiveTo: dto.effectiveTo ?? current.effectiveTo?.toISOString(),
      currencyCode: dto.currencyCode ?? current.currencyCode,
      registrationFee: dto.registrationFee ?? current.registrationFee.toString(),
      installmentAmount: dto.installmentAmount ?? current.installmentAmount.toString(),
      installmentCount: dto.installmentCount ?? current.installmentCount,
      installmentIntervalUnit: dto.installmentIntervalUnit ?? current.installmentIntervalUnit,
      installmentIntervalCount: dto.installmentIntervalCount ?? current.installmentIntervalCount,
      firstInstallmentOffsetDays:
        dto.firstInstallmentOffsetDays ?? current.firstInstallmentOffsetDays,
      gracePeriodDays: dto.gracePeriodDays ?? current.gracePeriodDays,
      maxActiveEnrollmentsPerUser:
        dto.maxActiveEnrollmentsPerUser ?? current.maxActiveEnrollmentsPerUser ?? undefined,
      partialPaymentsAllowed: dto.partialPaymentsAllowed ?? current.partialPaymentsAllowed,
      overpaymentsAllowed: dto.overpaymentsAllowed ?? current.overpaymentsAllowed,
      eligibilityRules:
        dto.eligibilityRules ?? (current.eligibilityRules as Record<string, unknown> | null) ?? {},
    };
    const normalized = this.validateVersion(merged);

    const version = await this.prisma.programVersion.update({
      where: { id: versionId },
      data: {
        ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
        ...(dto.effectiveTo ? { effectiveTo: new Date(dto.effectiveTo) } : {}),
        ...(dto.currencyCode ? { currencyCode: dto.currencyCode.trim().toUpperCase() } : {}),
        registrationFee: normalized.registrationFee,
        installmentAmount: normalized.installmentAmount,
        installmentCount: merged.installmentCount,
        installmentIntervalUnit: merged.installmentIntervalUnit,
        installmentIntervalCount: merged.installmentIntervalCount,
        firstInstallmentOffsetDays: merged.firstInstallmentOffsetDays,
        gracePeriodDays: merged.gracePeriodDays,
        maxActiveEnrollmentsPerUser: merged.maxActiveEnrollmentsPerUser ?? null,
        partialPaymentsAllowed: merged.partialPaymentsAllowed,
        overpaymentsAllowed: merged.overpaymentsAllowed,
        eligibilityRules: normalized.eligibilityRules as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramVersion',
      entityId: version.id,
      description: 'Program draft version updated',
    });
    return version;
  }

  async publish(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.programVersion.findUnique({ where: { id: versionId } });
      if (!current) throw new NotFoundException('Program version not found');
      if (current.lifecycle !== PolicyLifecycle.DRAFT) {
        throw new ConflictException('Only draft program versions can be published');
      }
      this.validateVersion({
        effectiveFrom: current.effectiveFrom.toISOString(),
        effectiveTo: current.effectiveTo?.toISOString(),
        currencyCode: current.currencyCode,
        registrationFee: current.registrationFee.toString(),
        installmentAmount: current.installmentAmount.toString(),
        installmentCount: current.installmentCount,
        installmentIntervalUnit: current.installmentIntervalUnit,
        installmentIntervalCount: current.installmentIntervalCount,
        firstInstallmentOffsetDays: current.firstInstallmentOffsetDays,
        gracePeriodDays: current.gracePeriodDays,
        maxActiveEnrollmentsPerUser: current.maxActiveEnrollmentsPerUser ?? undefined,
        partialPaymentsAllowed: current.partialPaymentsAllowed,
        overpaymentsAllowed: current.overpaymentsAllowed,
        eligibilityRules: (current.eligibilityRules as Record<string, unknown> | null) ?? {},
      });
      const published = await tx.programVersion.findFirst({
        where: { programId: current.programId, lifecycle: PolicyLifecycle.PUBLISHED },
      });
      if (published) {
        throw new ConflictException('Retire the currently published program version first');
      }
      const result = await tx.programVersion.update({
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
          entityType: 'ProgramVersion',
          entityId: result.id,
          description: 'Program version published',
          metadata: { programId: result.programId, version: result.version },
        },
      });
      return result;
    });
  }

  async retire(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.programVersion.findUnique({ where: { id: versionId } });
      if (!current) throw new NotFoundException('Program version not found');
      if (current.lifecycle !== PolicyLifecycle.PUBLISHED) {
        throw new ConflictException('Only published program versions can be retired');
      }
      const now = new Date();
      const result = await tx.programVersion.update({
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
          entityType: 'ProgramVersion',
          entityId: result.id,
          description: 'Program version retired',
          metadata: { programId: result.programId, version: result.version },
        },
      });
      return result;
    });
  }

  async getVersion(versionId: string) {
    const version = await this.prisma.programVersion.findUnique({
      where: { id: versionId },
      include: { program: true },
    });
    if (!version) throw new NotFoundException('Program version not found');
    return version;
  }

  private async requireProgram(programId: string) {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    if (!program) throw new NotFoundException('Program not found');
  }

  private validateVersion(input: {
    effectiveFrom: string;
    effectiveTo?: string;
    currencyCode: string;
    registrationFee: string;
    installmentAmount: string;
    installmentCount: number;
    installmentIntervalUnit: string;
    installmentIntervalCount: number;
    firstInstallmentOffsetDays: number;
    gracePeriodDays: number;
    maxActiveEnrollmentsPerUser?: number;
    partialPaymentsAllowed: boolean;
    overpaymentsAllowed: boolean;
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
    if (!Number.isInteger(input.installmentCount) || input.installmentCount < 0) {
      throw new BadRequestException('installmentCount must be zero or greater');
    }
    if (!Number.isInteger(input.installmentIntervalCount) || input.installmentIntervalCount < 1) {
      throw new BadRequestException('installmentIntervalCount must be at least one');
    }
    if (!Number.isInteger(input.firstInstallmentOffsetDays) || input.firstInstallmentOffsetDays < 0) {
      throw new BadRequestException('firstInstallmentOffsetDays must be zero or greater');
    }
    if (!Number.isInteger(input.gracePeriodDays) || input.gracePeriodDays < 0) {
      throw new BadRequestException('gracePeriodDays must be zero or greater');
    }
    if (
      input.maxActiveEnrollmentsPerUser !== undefined &&
      (!Number.isInteger(input.maxActiveEnrollmentsPerUser) || input.maxActiveEnrollmentsPerUser < 1)
    ) {
      throw new BadRequestException('maxActiveEnrollmentsPerUser must be at least one');
    }

    const registrationFee = this.nonNegativeAmount(input.registrationFee, 'registrationFee');
    const installmentAmount = this.nonNegativeAmount(
      input.installmentAmount,
      'installmentAmount',
    );
    if (input.installmentCount > 0 && new Prisma.Decimal(installmentAmount).equals(0)) {
      throw new BadRequestException('installmentAmount must be greater than zero when installments exist');
    }
    if (input.installmentCount === 0 && !new Prisma.Decimal(installmentAmount).equals(0)) {
      throw new BadRequestException('installmentAmount must be zero when installmentCount is zero');
    }

    return {
      registrationFee,
      installmentAmount,
      eligibilityRules: this.eligibility.validateRules(input.eligibilityRules ?? {}),
    };
  }

  private nonNegativeAmount(raw: string, field: string): string {
    try {
      const value = new Prisma.Decimal(raw);
      if (!value.isFinite() || value.isNegative()) throw new Error('invalid');
      return value.toFixed(2);
    } catch {
      throw new BadRequestException(`${field} must be zero or greater`);
    }
  }
}
