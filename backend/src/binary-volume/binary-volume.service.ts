import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, BinaryVolumeEventType, PolicyLifecycle } from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateBinaryVolumeEventDto,
  ReverseBinaryVolumeEventDto,
} from './binary-volume.dto';

type AncestryRow = {
  ancestorUserId: string;
  depth: number;
  firstLegSide: 'LEFT' | 'RIGHT';
  firstLegSlot: 'A' | 'B' | 'C' | 'D';
};
type CreditRow = {
  ancestorUserId: string;
  planVersionId: string;
  side: 'LEFT' | 'RIGHT';
  slot: 'A' | 'B' | 'C' | 'D';
  depth: number;
  volume: Prisma.Decimal;
};

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
        const ancestry = await tx.$queryRawUnsafe<AncestryRow[]>(
          `SELECT ancestorUserId, depth, firstLegSide, firstLegSlot
           FROM binary_ancestry WHERE descendantUserId = ? ORDER BY depth ASC`,
          dto.sourceMemberUserId,
        );
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
        for (const ancestor of ancestry) {
          await tx.$executeRawUnsafe(
            `INSERT INTO binary_upline_volume_credits
               (id, volumeEventId, ancestorUserId, planVersionId, side, slot, depth, volume, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            randomUUID(),
            created.id,
            ancestor.ancestorUserId,
            dto.planVersionId,
            ancestor.firstLegSide,
            ancestor.firstLegSlot,
            ancestor.depth,
            dto.volume,
          );
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
        description: 'Binary 1:4 volume event created',
        metadata: { sourceKey: dto.sourceKey, eventType: dto.eventType },
      });
      return { event, idempotent: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || (error as { code?: string }).code === 'ER_DUP_ENTRY') {
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
      include: { reversedBy: true },
    });
    if (!original) throw new NotFoundException('Binary volume event not found');
    if (original.eventType === BinaryVolumeEventType.REVERSAL) {
      throw new BadRequestException('A reversal event cannot be reversed again');
    }
    if (original.reversedBy) throw new ConflictException('Binary volume event is already reversed');

    const originalCredits = await this.prisma.$queryRawUnsafe<CreditRow[]>(
      `SELECT ancestorUserId, planVersionId, side, slot, depth, volume
       FROM binary_upline_volume_credits WHERE volumeEventId = ? ORDER BY depth ASC`,
      original.id,
    );

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
        for (const credit of originalCredits) {
          const volume = credit.volume instanceof Prisma.Decimal
            ? credit.volume.negated().toFixed(4)
            : new Prisma.Decimal(String(credit.volume)).negated().toFixed(4);
          await tx.$executeRawUnsafe(
            `INSERT INTO binary_upline_volume_credits
               (id, volumeEventId, ancestorUserId, planVersionId, side, slot, depth, volume, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            randomUUID(),
            created.id,
            credit.ancestorUserId,
            credit.planVersionId,
            credit.side,
            credit.slot,
            credit.depth,
            volume,
          );
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
      if ((error as { code?: string }).code === 'P2002' || (error as { code?: string }).code === 'ER_DUP_ENTRY') {
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const [totals, recentCredits] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ slot: string; side: string; volume: string }>>(
        `SELECT slot, side, CAST(COALESCE(SUM(volume), 0) AS CHAR) AS volume
         FROM binary_upline_volume_credits
         WHERE ancestorUserId = ? GROUP BY slot, side ORDER BY FIELD(slot,'A','B','C','D')`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT c.*, e.sourceMemberUserId, e.occurredAt
         FROM binary_upline_volume_credits c
         INNER JOIN binary_volume_events e ON e.id=c.volumeEventId
         WHERE c.ancestorUserId=? ORDER BY c.createdAt DESC LIMIT 100`,
        userId,
      ),
    ]);
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
