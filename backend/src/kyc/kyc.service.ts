import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  KycProfileStatus,
  KycSubmissionStatus,
  PolicyLifecycle,
} from '../generated/prisma/enums';
import type {
  CreateKycPolicyDto,
  CreateKycPolicyVersionDto,
  ListKycSubmissionsDto,
  ReviewKycSubmissionDto,
  SubmitKycDto,
  UpdateKycPolicyVersionDto,
} from './kyc.dto';
import { KycReviewDecision } from './kyc.dto';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMemberKyc(userId: string) {
    const [profile, policyVersion] = await Promise.all([
      this.prisma.kycProfile.findUnique({
        where: { userId },
        include: {
          submissions: {
            orderBy: { submittedAt: 'desc' },
            take: 10,
            include: {
              policyVersion: {
                include: { policy: true },
              },
            },
          },
        },
      }),
      this.findActiveDefaultPolicyVersion(),
    ]);

    return {
      profile: profile ?? {
        userId,
        status: KycProfileStatus.NOT_STARTED,
        approvedAt: null,
        lastSubmittedAt: null,
        lastReviewedAt: null,
        submissions: [],
      },
      currentPolicy: policyVersion,
    };
  }

  async submit(userId: string, dto: SubmitKycDto) {
    const sourceKey = dto.sourceKey.trim();
    const documents = dto.documents ?? [];
    const requestFingerprint = this.fingerprint({
      userId,
      data: dto.data,
      documents,
    });

    const existing = await this.prisma.kycSubmission.findUnique({
      where: { sourceKey },
      include: {
        policyVersion: { include: { policy: true } },
      },
    });
    if (existing) {
      return this.resolveSubmissionReplay(
        existing,
        userId,
        requestFingerprint,
      );
    }

    const policyVersion = await this.requireActiveDefaultPolicyVersion();
    this.validateSubmissionAgainstRequirements(
      policyVersion.requirements,
      dto.data,
      documents,
    );

    const currentProfile = await this.prisma.kycProfile.findUnique({
      where: { userId },
    });
    if (
      currentProfile?.status === KycProfileStatus.APPROVED ||
      currentProfile?.status === KycProfileStatus.SUBMITTED ||
      currentProfile?.status === KycProfileStatus.UNDER_REVIEW
    ) {
      throw new ConflictException(
        `KYC cannot be resubmitted while profile status is ${currentProfile.status}`,
      );
    }

    const now = new Date();
    try {
      const submission = await this.prisma.$transaction(async (tx) => {
        const profile = await tx.kycProfile.upsert({
          where: { userId },
          create: {
            userId,
            status: KycProfileStatus.SUBMITTED,
            lastSubmittedAt: now,
          },
          update: {
            status: KycProfileStatus.SUBMITTED,
            lastSubmittedAt: now,
            approvedAt: null,
          },
        });

        const created = await tx.kycSubmission.create({
          data: {
            sourceKey,
            requestFingerprint,
            userId,
            profileId: profile.id,
            policyVersionId: policyVersion.id,
            status: KycSubmissionStatus.SUBMITTED,
            data: dto.data as Prisma.InputJsonValue,
            documents: documents as Prisma.InputJsonValue,
            submittedAt: now,
          },
          include: {
            policyVersion: { include: { policy: true } },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: AuditAction.CREATE,
            entityType: 'KycSubmission',
            entityId: created.id,
            description: 'KYC submission created',
            metadata: {
              policyVersionId: policyVersion.id,
              policyCode: policyVersion.policy.code,
            },
          },
        });
        return created;
      });
      return submission;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const replay = await this.prisma.kycSubmission.findUnique({
          where: { sourceKey },
          include: {
            policyVersion: { include: { policy: true } },
          },
        });
        if (replay) {
          return this.resolveSubmissionReplay(
            replay,
            userId,
            requestFingerprint,
          );
        }
        throw new ConflictException('Concurrent KYC submission detected; retry');
      }
      throw error;
    }
  }

  async listSubmissions(query: ListKycSubmissionsDto) {
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '25')));
    const q = query.q?.trim();
    const where: Prisma.KycSubmissionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            user: {
              is: {
                OR: [
                  { username: { contains: q } },
                  { email: { contains: q } },
                  { phone: { contains: q } },
                ],
              },
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.kycSubmission.count({ where }),
      this.prisma.kycSubmission.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
          policyVersion: { include: { policy: true } },
        },
      }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getSubmission(id: string) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        },
        profile: true,
        policyVersion: { include: { policy: true } },
        reviewer: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });
    if (!submission) throw new NotFoundException('KYC submission not found');
    return submission;
  }

  async startReview(id: string, actorUserId: string) {
    const current = await this.prisma.kycSubmission.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('KYC submission not found');
    if (current.status === KycSubmissionStatus.UNDER_REVIEW) {
      return this.getSubmission(id);
    }
    if (current.status !== KycSubmissionStatus.SUBMITTED) {
      throw new ConflictException('Only submitted KYC can enter review');
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kycSubmission.update({
        where: { id },
        data: {
          status: KycSubmissionStatus.UNDER_REVIEW,
          reviewedByUserId: actorUserId,
        },
      });
      await tx.kycProfile.update({
        where: { id: updated.profileId },
        data: { status: KycProfileStatus.UNDER_REVIEW },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.UPDATE,
          entityType: 'KycSubmission',
          entityId: id,
          description: 'KYC review started',
        },
      });
    });
    return this.getSubmission(id);
  }

  async reviewSubmission(
    id: string,
    dto: ReviewKycSubmissionDto,
    actorUserId: string,
  ) {
    const current = await this.prisma.kycSubmission.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('KYC submission not found');
    if (
      current.status !== KycSubmissionStatus.SUBMITTED &&
      current.status !== KycSubmissionStatus.UNDER_REVIEW
    ) {
      throw new ConflictException('KYC submission has already been finalized');
    }

    const reason = dto.reason?.trim() || null;
    if (dto.decision !== KycReviewDecision.APPROVED && !reason) {
      throw new BadRequestException(
        'A review reason is required when KYC is not approved',
      );
    }

    const now = new Date();
    const submissionStatus = dto.decision as KycSubmissionStatus;
    const profileStatus = this.profileStatusForDecision(dto.decision);

    await this.prisma.$transaction(async (tx) => {
      await tx.kycSubmission.update({
        where: { id },
        data: {
          status: submissionStatus,
          reviewedAt: now,
          reviewedByUserId: actorUserId,
          reviewReason: reason,
        },
      });
      await tx.kycProfile.update({
        where: { id: current.profileId },
        data: {
          status: profileStatus,
          lastReviewedAt: now,
          approvedAt:
            profileStatus === KycProfileStatus.APPROVED ? now : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.UPDATE,
          entityType: 'KycSubmission',
          entityId: id,
          description: `KYC review completed: ${dto.decision}`,
          metadata: { decision: dto.decision, reason },
        },
      });
    });

    return this.getSubmission(id);
  }

  listPolicies() {
    return this.prisma.kycPolicy.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { versions: { orderBy: { version: 'asc' } } },
    });
  }

  async createPolicy(dto: CreateKycPolicyDto, actorUserId: string) {
    const code = dto.code.trim().toUpperCase();
    try {
      const policy = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.kycPolicy.updateMany({ data: { isDefault: false } });
        }
        return tx.kycPolicy.create({
          data: {
            code,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            isDefault: dto.isDefault ?? false,
            createdByUserId: actorUserId,
          },
        });
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'KycPolicy',
        entityId: policy.id,
        description: 'KYC policy created',
        metadata: { code: policy.code, isDefault: policy.isDefault },
      });
      return policy;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('KYC policy code already exists');
      }
      throw error;
    }
  }

  async setDefaultPolicy(policyId: string, actorUserId: string) {
    await this.requirePolicy(policyId);
    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.kycPolicy.updateMany({
        where: { id: { not: policyId } },
        data: { isDefault: false },
      });
      const result = await tx.kycPolicy.update({
        where: { id: policyId },
        data: { isDefault: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.UPDATE,
          entityType: 'KycPolicy',
          entityId: policyId,
          description: 'KYC policy set as default',
          metadata: { code: result.code },
        },
      });
      return result;
    });
    return policy;
  }

  async createPolicyVersion(
    policyId: string,
    dto: CreateKycPolicyVersionDto,
    actorUserId: string,
  ) {
    await this.requirePolicy(policyId);
    this.validatePolicyVersionInput(dto);

    try {
      const version = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.kycPolicyVersion.aggregate({
          where: { policyId },
          _max: { version: true },
        });
        return tx.kycPolicyVersion.create({
          data: {
            policyId,
            version: (latest._max.version ?? 0) + 1,
            lifecycle: PolicyLifecycle.DRAFT,
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            requirements: dto.requirements as Prisma.InputJsonValue,
            reviewRules: dto.reviewRules as Prisma.InputJsonValue | undefined,
            createdByUserId: actorUserId,
          },
        });
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'KycPolicyVersion',
        entityId: version.id,
        description: 'KYC policy draft version created',
        metadata: { policyId, version: version.version },
      });
      return version;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'Concurrent KYC policy version creation detected; retry',
        );
      }
      throw error;
    }
  }

  async updatePolicyDraft(
    versionId: string,
    dto: UpdateKycPolicyVersionDto,
    actorUserId: string,
  ) {
    const current = await this.prisma.kycPolicyVersion.findUnique({
      where: { id: versionId },
    });
    if (!current) throw new NotFoundException('KYC policy version not found');
    if (current.lifecycle !== PolicyLifecycle.DRAFT) {
      throw new ConflictException('Published or retired KYC policy versions are immutable');
    }

    this.validatePolicyVersionInput({
      effectiveFrom: dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      effectiveTo: dto.effectiveTo ?? current.effectiveTo?.toISOString(),
      requirements:
        dto.requirements ??
        (current.requirements as Record<string, unknown>),
      reviewRules:
        dto.reviewRules ??
        (current.reviewRules as Record<string, unknown> | null) ??
        undefined,
    });

    const version = await this.prisma.kycPolicyVersion.update({
      where: { id: versionId },
      data: {
        ...(dto.effectiveFrom
          ? { effectiveFrom: new Date(dto.effectiveFrom) }
          : {}),
        ...(dto.effectiveTo ? { effectiveTo: new Date(dto.effectiveTo) } : {}),
        ...(dto.requirements !== undefined
          ? { requirements: dto.requirements as Prisma.InputJsonValue }
          : {}),
        ...(dto.reviewRules !== undefined
          ? { reviewRules: dto.reviewRules as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'KycPolicyVersion',
      entityId: version.id,
      description: 'KYC policy draft version updated',
    });
    return version;
  }

  async publishPolicyVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.kycPolicyVersion.findUnique({
        where: { id: versionId },
      });
      if (!current) throw new NotFoundException('KYC policy version not found');
      if (current.lifecycle !== PolicyLifecycle.DRAFT) {
        throw new ConflictException('Only draft KYC policy versions can be published');
      }
      this.validatePolicyVersionInput({
        effectiveFrom: current.effectiveFrom.toISOString(),
        effectiveTo: current.effectiveTo?.toISOString(),
        requirements: current.requirements as Record<string, unknown>,
        reviewRules:
          (current.reviewRules as Record<string, unknown> | null) ?? undefined,
      });
      const published = await tx.kycPolicyVersion.findFirst({
        where: {
          policyId: current.policyId,
          lifecycle: PolicyLifecycle.PUBLISHED,
        },
      });
      if (published) {
        throw new ConflictException(
          'Retire the currently published KYC policy version before publishing another',
        );
      }
      const result = await tx.kycPolicyVersion.update({
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
          entityType: 'KycPolicyVersion',
          entityId: result.id,
          description: 'KYC policy version published',
          metadata: { policyId: result.policyId, version: result.version },
        },
      });
      return result;
    });
  }

  async retirePolicyVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.kycPolicyVersion.findUnique({
        where: { id: versionId },
      });
      if (!current) throw new NotFoundException('KYC policy version not found');
      if (current.lifecycle !== PolicyLifecycle.PUBLISHED) {
        throw new ConflictException('Only published KYC policy versions can be retired');
      }
      const now = new Date();
      const result = await tx.kycPolicyVersion.update({
        where: { id: versionId },
        data: {
          lifecycle: PolicyLifecycle.RETIRED,
          retiredAt: now,
          retiredByUserId: actorUserId,
          effectiveTo:
            current.effectiveTo && current.effectiveTo < now
              ? current.effectiveTo
              : now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.UPDATE,
          entityType: 'KycPolicyVersion',
          entityId: result.id,
          description: 'KYC policy version retired',
          metadata: { policyId: result.policyId, version: result.version },
        },
      });
      return result;
    });
  }

  async getPolicyVersion(versionId: string) {
    const version = await this.prisma.kycPolicyVersion.findUnique({
      where: { id: versionId },
      include: { policy: true },
    });
    if (!version) throw new NotFoundException('KYC policy version not found');
    return version;
  }

  private async requirePolicy(policyId: string): Promise<void> {
    const policy = await this.prisma.kycPolicy.findUnique({
      where: { id: policyId },
      select: { id: true },
    });
    if (!policy) throw new NotFoundException('KYC policy not found');
  }

  private async findActiveDefaultPolicyVersion() {
    const policy = await this.prisma.kycPolicy.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!policy) return null;

    const now = new Date();
    return this.prisma.kycPolicyVersion.findFirst({
      where: {
        policyId: policy.id,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      include: { policy: true },
    });
  }

  private async requireActiveDefaultPolicyVersion() {
    const version = await this.findActiveDefaultPolicyVersion();
    if (!version) {
      throw new ConflictException(
        'No active published default KYC policy is configured',
      );
    }
    return version;
  }

  private resolveSubmissionReplay<T extends {
    userId: string;
    requestFingerprint: string;
  }>(existing: T, userId: string, requestFingerprint: string): T {
    if (
      existing.userId !== userId ||
      existing.requestFingerprint !== requestFingerprint
    ) {
      throw new ConflictException(
        'KYC sourceKey already exists with different request data',
      );
    }
    return existing;
  }

  private validatePolicyVersionInput(input: {
    effectiveFrom: string;
    effectiveTo?: string;
    requirements: Record<string, unknown>;
    reviewRules?: Record<string, unknown>;
  }): void {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (!Number.isFinite(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid timestamp');
    }
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('effectiveTo must be later than effectiveFrom');
    }
    this.requireStringArray(input.requirements.fields, 'requirements.fields');
    this.requireStringArray(
      input.requirements.documents,
      'requirements.documents',
    );
  }

  private validateSubmissionAgainstRequirements(
    rawRequirements: Prisma.JsonValue,
    data: Record<string, unknown>,
    documents: Record<string, unknown>[],
  ): void {
    if (!this.isRecord(rawRequirements)) {
      throw new ConflictException('Published KYC policy requirements are invalid');
    }
    const fields = this.requireStringArray(
      rawRequirements.fields,
      'requirements.fields',
    );
    const requiredDocuments = this.requireStringArray(
      rawRequirements.documents,
      'requirements.documents',
    );

    const missingFields = fields.filter((field) =>
      this.isMissing(this.readPath(data, field)),
    );
    if (missingFields.length) {
      throw new BadRequestException(
        `Missing required KYC fields: ${missingFields.join(', ')}`,
      );
    }

    const documentTypes = new Set<string>();
    for (const document of documents) {
      if (!this.isRecord(document)) {
        throw new BadRequestException('Each KYC document must be an object');
      }
      const type = typeof document.type === 'string' ? document.type.trim() : '';
      const reference =
        typeof document.reference === 'string' ? document.reference.trim() : '';
      if (!type || !reference) {
        throw new BadRequestException(
          'Each KYC document requires non-empty type and reference values',
        );
      }
      documentTypes.add(type);
    }

    const missingDocuments = requiredDocuments.filter(
      (type) => !documentTypes.has(type),
    );
    if (missingDocuments.length) {
      throw new BadRequestException(
        `Missing required KYC documents: ${missingDocuments.join(', ')}`,
      );
    }
  }

  private requireStringArray(value: unknown, name: string): string[] {
    if (
      !Array.isArray(value) ||
      value.some(
        (item) => typeof item !== 'string' || item.trim().length === 0,
      )
    ) {
      throw new BadRequestException(`${name} must be an array of strings`);
    }
    return value.map((item) => String(item).trim());
  }

  private profileStatusForDecision(
    decision: KycReviewDecision,
  ): KycProfileStatus {
    if (decision === KycReviewDecision.APPROVED) {
      return KycProfileStatus.APPROVED;
    }
    if (decision === KycReviewDecision.REJECTED) {
      return KycProfileStatus.REJECTED;
    }
    return KycProfileStatus.RESUBMISSION_REQUIRED;
  }

  private readPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (!this.isRecord(current)) return undefined;
      return current[segment];
    }, source);
  }

  private isMissing(value: unknown): boolean {
    return (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0)
    );
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(this.canonicalize(value)))
      .digest('hex');
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalize(item));
    }
    if (this.isRecord(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = this.canonicalize(value[key]);
          return result;
        }, {});
    }
    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
