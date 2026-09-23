import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, BinaryVolumeEventType, PolicyLifecycle } from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateBinaryVolumeEventDto,
  ReverseBinaryVolumeEventDto,
} from './binary-volume.dto';

@Injectable()
export class BinaryVolumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createEvent(dto: CreateBinaryVolumeEventDto, actorUserId: string) {
    if (dto.eventType === BinaryVolumeEventType.REVERSAL) {
      throw new BadRequestException('Use the reversal endpoint to reverse an existing volume event');
    }
    const numericVolume = Number(dto.volume);
    if (!Number.isFinite(numericVolume) || numericVolume === 0) {
      throw new BadRequestException('Volume must be non-zero');
    }
    if (dto.eventType === BinaryVolumeEventType.CREDIT && numericVolume <= 0) {
      throw new BadRequestException('Credit volume must be greater than zero');
    }

    const occurredAt = new Date(dto.occurredAt);
    const existing = await this.prisma.binaryVolumeEvent.findUnique({
      where: { sourceKey: dto.sourceKey },
      include: { uplineCredits: { orderBy: { depth: 'asc' } } },
    });
    if (existing) {
      this.assertIdempotentMatch(existing, dto, occurredAt);
      return { event: existing, idempotent: true };
    }

    await this.requireEligiblePolicyVersion(dto.planVersionId, occurredAt);
    if (!(await this.prisma.user.findUnique({ where: { id: dto.sourceMemberUserId }, select: { id: true } }))) {
      throw new NotFoundException('Source member not found');
    }

    try {
      const event = await this.prisma.$transaction(async (tx) => {
        const ancestry = await tx.binaryAncestry.findMany({
          where: { descendantUserId: dto.sourceMemberUserId },
          orderBy: { depth: 'asc' },
        });
        const created = await tx.binaryVolumeEvent.create({
          data: {
            sourceKey: dto.sourceKey,
            sourceMemberUserId: dto.sourceMemberUserId,
            planVersionId: dto.planVersionId,
            eventType: dto.eventType,
            volume: dto.volume,
            occurredAt,
            metadata: dto.metadata as Prisma.InputJsonValue | undefined,
            createdByUserId: actorUserId,
          },
        });
        if (ancestry.length > 0) {
          await tx.binaryUplineVolumeCredit.createMany({
            data: ancestry.map((ancestor) => ({
              volumeEventId: created.id,
              ancestorUserId: ancestor.ancestorUserId,
              planVersionId: dto.planVersionId,
              side: ancestor.firstLegSide,
              depth: ancestor.depth,
              volume: dto.volume,
            })),
          });
        }
        return tx.binaryVolumeEvent.findUniqueOrThrow({
          where: { id: created.id },
          include: { uplineCredits: { orderBy: { depth: 'asc' } } },
        });
      });

      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryVolumeEvent',
        entityId: event.id,
        description: 'Binary volume event created',
        metadata: { sourceKey: dto.sourceKey, eventType: dto.eventType },
      });
      return { event, idempotent: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.binaryVolumeEvent.findUnique({
          where: { sourceKey: dto.sourceKey },
          include: { uplineCredits: { orderBy: { depth: 'asc' } } },
        });
        if (raced) {
          this.assertIdempotentMatch(raced, dto, occurredAt);
          return { event: raced, idempotent: true };
        }
        throw new ConflictException('Duplicate binary volume source key');
      }
      throw error;
    }
  }

  async reverseEvent(eventId: string, dto: ReverseBinaryVolumeEventDto, actorUserId: string) {
    const existingSource = await this.prisma.binaryVolumeEvent.findUnique({
      where: { sourceKey: dto.sourceKey },
      include: { uplineCredits: { orderBy: { depth: 'asc' } } },
    });
    if (existingSource) {
      if (existingSource.eventType === BinaryVolumeEventType.REVERSAL && existingSource.reversalOfEventId === eventId) {
        return { event: existingSource, idempotent: true };
      }
      throw new ConflictException('Source key is already used by another volume event');
    }

    const original = await this.prisma.binaryVolumeEvent.findUnique({
      where: { id: eventId },
      include: {
        reversedBy: true,
        uplineCredits: { orderBy: { depth: 'asc' } },
      },
    });
    if (!original) throw new NotFoundException('Binary volume event not found');
    if (original.eventType === BinaryVolumeEventType.REVERSAL) {
      throw new BadRequestException('A reversal event cannot be reversed again');
    }
    if (original.reversedBy) throw new ConflictException('Binary volume event is already reversed');

    try {
      const event = await this.prisma.$transaction(async (tx) => {
        const created = await tx.binaryVolumeEvent.create({
          data: {
            sourceKey: dto.sourceKey,
            sourceMemberUserId: original.sourceMemberUserId,
            planVersionId: original.planVersionId,
            eventType: BinaryVolumeEventType.REVERSAL,
            volume: original.volume.negated(),
            reversalOfEventId: original.id,
            occurredAt: new Date(),
            metadata: dto.metadata as Prisma.InputJsonValue | undefined,
            createdByUserId: actorUserId,
          },
        });
        if (original.uplineCredits.length > 0) {
          await tx.binaryUplineVolumeCredit.createMany({
            data: original.uplineCredits.map((credit) => ({
              volumeEventId: created.id,
              ancestorUserId: credit.ancestorUserId,
              planVersionId: credit.planVersionId,
              side: credit.side,
              depth: credit.depth,
              volume: credit.volume.negated(),
            })),
          });
        }
        return tx.binaryVolumeEvent.findUniqueOrThrow({
          where: { id: created.id },
          include: { uplineCredits: { orderBy: { depth: 'asc' } } },
        });
      });

      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryVolumeEvent',
        entityId: event.id,
        description: 'Binary volume event reversed',
        metadata: { reversalOfEventId: original.id, sourceKey: dto.sourceKey },
      });
      return { event, idempotent: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Binary volume event was already reversed or source key is duplicated');
      }
      throw error;
    }
  }

  async getEvent(eventId: string) {
    const event = await this.prisma.binaryVolumeEvent.findUnique({
      where: { id: eventId },
      include: {
        planVersion: { include: { plan: true } },
        uplineCredits: { orderBy: { depth: 'asc' } },
        reversedBy: true,
      },
    });
    if (!event) throw new NotFoundException('Binary volume event not found');
    return event;
  }

  async getMemberVolume(userId: string) {
    const [user, totals, recentCredits] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } }),
      this.prisma.binaryUplineVolumeCredit.groupBy({
        by: ['side'],
        where: { ancestorUserId: userId },
        _sum: { volume: true },
      }),
      this.prisma.binaryUplineVolumeCredit.findMany({
        where: { ancestorUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { volumeEvent: true, planVersion: { include: { plan: true } } },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    return { user, totals, recentCredits };
  }

  private async requireEligiblePolicyVersion(planVersionId: string, occurredAt: Date): Promise<void> {
    const version = await this.prisma.binaryPlanVersion.findUnique({ where: { id: planVersionId } });
    if (!version) throw new NotFoundException('Binary plan version not found');
    if (version.lifecycle !== PolicyLifecycle.PUBLISHED) {
      throw new ConflictException('Binary volume can only use a published policy version');
    }
    if (version.effectiveFrom > occurredAt || (version.effectiveTo && version.effectiveTo < occurredAt)) {
      throw new BadRequestException('Binary plan version is not effective at the event time');
    }
  }

  private assertIdempotentMatch(
    existing: {
      sourceMemberUserId: string;
      planVersionId: string;
      eventType: BinaryVolumeEventType;
      volume: Prisma.Decimal;
      occurredAt: Date;
    },
    dto: CreateBinaryVolumeEventDto,
    occurredAt: Date,
  ): void {
    const matches =
      existing.sourceMemberUserId === dto.sourceMemberUserId &&
      existing.planVersionId === dto.planVersionId &&
      existing.eventType === dto.eventType &&
      existing.volume.equals(dto.volume) &&
      existing.occurredAt.getTime() === occurredAt.getTime();
    if (!matches) {
      throw new ConflictException('Source key already exists with different binary volume payload');
    }
  }
}
