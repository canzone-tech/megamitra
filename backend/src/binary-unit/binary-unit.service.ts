import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  BinaryQualifyingUnitEventType,
  PolicyLifecycle,
} from '../generated/prisma/enums';
import type {
  CreateBinaryQualifyingUnitDto,
  ReverseBinaryQualifyingUnitDto,
} from './binary-unit.dto';

type SlotAncestryRow = {
  ancestorUserId: string;
  depth: number;
  firstLegSide: 'LEFT' | 'RIGHT';
  firstLegSlot: 'A' | 'B' | 'C' | 'D';
};

@Injectable()
export class BinaryUnitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createEvent(dto: CreateBinaryQualifyingUnitDto, actorUserId: string) {
    const occurredAt = new Date(dto.occurredAt);
    const fingerprint = this.qualifyFingerprint(dto, occurredAt);
    const existing = await this.prisma.binaryQualifyingUnitEvent.findUnique({
      where: { sourceKey: dto.sourceKey },
      include: { uplineUnits: { orderBy: { depth: 'asc' } } },
    });
    if (existing) {
      this.assertFingerprint(existing.requestFingerprint, fingerprint);
      return { event: existing, idempotent: true };
    }

    await this.requireEligiblePolicyVersion(dto.planVersionId, occurredAt);
    const sourceMember = await this.prisma.user.findUnique({
      where: { id: dto.sourceMemberUserId },
      select: { id: true },
    });
    if (!sourceMember) throw new NotFoundException('Source member not found');

    try {
      const event = await this.prisma.$transaction(async (tx) => {
        const ancestry = await tx.$queryRawUnsafe<SlotAncestryRow[]>(
          `SELECT ancestorUserId, depth, firstLegSide, firstLegSlot
           FROM binary_ancestry
           WHERE descendantUserId = ?
           ORDER BY depth ASC`,
          dto.sourceMemberUserId,
        );
        const created = await tx.binaryQualifyingUnitEvent.create({
          data: {
            sourceKey: dto.sourceKey,
            requestFingerprint: fingerprint,
            sourceMemberUserId: dto.sourceMemberUserId,
            planVersionId: dto.planVersionId,
            eventType: BinaryQualifyingUnitEventType.QUALIFY,
            occurredAt,
            metadata: dto.metadata as Prisma.InputJsonValue | undefined,
            createdByUserId: actorUserId,
          },
        });

        for (const ancestor of ancestry) {
          const sequenceKey = `BU:${ancestor.ancestorUserId}:${dto.planVersionId}:${ancestor.firstLegSlot}`;
          const state = await tx.systemSequence.upsert({
            where: { key: sequenceKey },
            create: { key: sequenceKey, nextValue: 1n },
            update: { nextValue: { increment: 1n } },
            select: { nextValue: true },
          });
          await tx.$executeRawUnsafe(
            `INSERT INTO binary_upline_qualifying_units
               (id, unitEventId, ancestorUserId, planVersionId, side, slot, depth, sequence, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            randomUUID(),
            created.id,
            ancestor.ancestorUserId,
            dto.planVersionId,
            ancestor.firstLegSide,
            ancestor.firstLegSlot,
            ancestor.depth,
            Number(state.nextValue),
          );
        }

        return tx.binaryQualifyingUnitEvent.findUniqueOrThrow({
          where: { id: created.id },
          include: { uplineUnits: { orderBy: { depth: 'asc' } } },
        });
      });

      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryQualifyingUnitEvent',
        entityId: event.id,
        description: 'Binary qualifying unit created for slot-aware 1:4 genealogy',
        metadata: { sourceKey: dto.sourceKey, sourceMemberUserId: dto.sourceMemberUserId },
      });
      return { event, idempotent: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || (error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const raced = await this.prisma.binaryQualifyingUnitEvent.findUnique({
          where: { sourceKey: dto.sourceKey },
          include: { uplineUnits: { orderBy: { depth: 'asc' } } },
        });
        if (raced) {
          this.assertFingerprint(raced.requestFingerprint, fingerprint);
          return { event: raced, idempotent: true };
        }
      }
      throw error;
    }
  }

  async reverseEvent(
    eventId: string,
    dto: ReverseBinaryQualifyingUnitDto,
    actorUserId: string,
  ) {
    const existingSource = await this.prisma.binaryQualifyingUnitEvent.findUnique({
      where: { sourceKey: dto.sourceKey },
      include: { uplineUnits: true },
    });
    if (existingSource) {
      if (
        existingSource.eventType === BinaryQualifyingUnitEventType.REVERSAL &&
        existingSource.reversalOfEventId === eventId
      ) {
        return { event: existingSource, idempotent: true };
      }
      throw new ConflictException('Source key is already used by another qualifying unit event');
    }

    const original = await this.prisma.binaryQualifyingUnitEvent.findUnique({
      where: { id: eventId },
      include: {
        reversedBy: true,
        uplineUnits: {
          include: {
            leftPairMatch: { select: { id: true } },
            rightPairMatch: { select: { id: true } },
            disposition: { select: { id: true } },
          },
        },
      },
    });
    if (!original) throw new NotFoundException('Binary qualifying unit event not found');
    if (original.eventType === BinaryQualifyingUnitEventType.REVERSAL) {
      throw new ConflictException('A qualifying unit reversal cannot be reversed again');
    }
    if (original.reversedBy) throw new ConflictException('Binary qualifying unit is already reversed');

    const consumed = original.uplineUnits.some(
      (unit) => unit.leftPairMatch || unit.rightPairMatch || unit.disposition,
    );
    if (consumed) {
      throw new ConflictException(
        'Qualifying unit has already been consumed; financial reconciliation is required before reversal',
      );
    }

    try {
      const event = await this.prisma.binaryQualifyingUnitEvent.create({
        data: {
          sourceKey: dto.sourceKey,
          requestFingerprint: this.reversalFingerprint(eventId, dto.sourceKey),
          sourceMemberUserId: original.sourceMemberUserId,
          planVersionId: original.planVersionId,
          eventType: BinaryQualifyingUnitEventType.REVERSAL,
          reversalOfEventId: original.id,
          occurredAt: new Date(),
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          createdByUserId: actorUserId,
        },
        include: { uplineUnits: true },
      });

      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryQualifyingUnitEvent',
        entityId: event.id,
        description: 'Binary qualifying unit reversed',
        metadata: { reversalOfEventId: original.id, sourceKey: dto.sourceKey },
      });
      return { event, idempotent: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Qualifying unit was already reversed or source key is duplicated');
      }
      throw error;
    }
  }

  async getEvent(eventId: string) {
    const event = await this.prisma.binaryQualifyingUnitEvent.findUnique({
      where: { id: eventId },
      include: {
        sourceMember: { select: { id: true, username: true } },
        planVersion: { include: { plan: true } },
        reversedBy: true,
        uplineUnits: {
          orderBy: [{ ancestorUserId: 'asc' }, { sequence: 'asc' }],
          include: { leftPairMatch: true, rightPairMatch: true, disposition: true },
        },
      },
    });
    if (!event) throw new NotFoundException('Binary qualifying unit event not found');
    return event;
  }

  async getMemberUnits(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const units = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT u.*, e.sourceMemberUserId, e.occurredAt,
              lm.id AS leftPairMatchId, rm.id AS rightPairMatchId, d.id AS dispositionId
       FROM binary_upline_qualifying_units u
       INNER JOIN binary_qualifying_unit_events e ON e.id=u.unitEventId
       LEFT JOIN binary_pair_matches lm ON lm.leftUnitId=u.id
       LEFT JOIN binary_pair_matches rm ON rm.rightUnitId=u.id
       LEFT JOIN binary_unit_dispositions d ON d.uplineUnitId=u.id
       WHERE u.ancestorUserId=?
       ORDER BY u.planVersionId, FIELD(u.slot,'A','B','C','D'), u.sequence`,
      userId,
    );
    return { user, units };
  }

  private async requireEligiblePolicyVersion(planVersionId: string, occurredAt: Date): Promise<void> {
    const version = await this.prisma.binaryPlanVersion.findUnique({ where: { id: planVersionId } });
    if (!version) throw new NotFoundException('Binary plan version not found');
    if (version.lifecycle !== PolicyLifecycle.PUBLISHED) {
      throw new ConflictException('Qualifying units can only use a published policy version');
    }
    if (version.effectiveFrom > occurredAt || (version.effectiveTo && version.effectiveTo < occurredAt)) {
      throw new ConflictException('Binary plan version is not effective at the qualifying unit time');
    }
  }

  private qualifyFingerprint(dto: CreateBinaryQualifyingUnitDto, occurredAt: Date): string {
    return createHash('sha256')
      .update(`${dto.sourceMemberUserId}|${dto.planVersionId}|${occurredAt.toISOString()}`)
      .digest('hex');
  }

  private reversalFingerprint(eventId: string, sourceKey: string): string {
    return createHash('sha256').update(`REVERSAL|${eventId}|${sourceKey}`).digest('hex');
  }

  private assertFingerprint(existing: string, expected: string): void {
    if (existing !== expected) {
      throw new ConflictException('Source key already exists with a different qualifying unit payload');
    }
  }
}
