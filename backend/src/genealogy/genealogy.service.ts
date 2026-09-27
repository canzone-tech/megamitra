import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, BinaryPlacementSide } from '../generated/prisma/enums';
import type {
  AssignPlacementDto,
  AssignSponsorDto,
  BinaryPlacementSlot,
} from './genealogy.dto';

const SLOT_ORDER: BinaryPlacementSlot[] = ['A', 'B', 'C', 'D'];

type PlacementRow = {
  id: string;
  memberUserId: string;
  parentUserId: string;
  side: BinaryPlacementSide;
  slot: BinaryPlacementSlot;
  createdByUserId: string | null;
  createdAt: Date;
};

type AncestorRow = {
  ancestorUserId: string;
  depth: number;
  firstLegSide: BinaryPlacementSide;
  firstLegSlot: BinaryPlacementSlot;
};

type ChildRow = { memberUserId: string; slot: BinaryPlacementSlot };

@Injectable()
export class GenealogyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assignSponsor(dto: AssignSponsorDto, actorUserId: string) {
    if (dto.memberUserId === dto.sponsorUserId) {
      throw new BadRequestException('A member cannot sponsor themselves');
    }
    await this.requireUsers(dto.memberUserId, dto.sponsorUserId);

    const existing = await this.prisma.sponsorRelationship.findUnique({
      where: { memberUserId: dto.memberUserId },
    });
    if (existing) throw new ConflictException('Sponsor is already assigned');

    await this.assertSponsorDoesNotCreateCycle(dto.memberUserId, dto.sponsorUserId);

    try {
      const relationship = await this.prisma.sponsorRelationship.create({
        data: { ...dto, createdByUserId: actorUserId },
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'SponsorRelationship',
        entityId: relationship.id,
        description: 'Sponsor relationship assigned',
        metadata: dto,
      });
      return relationship;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Sponsor is already assigned');
      }
      throw error;
    }
  }

  async assignPlacement(dto: AssignPlacementDto, actorUserId: string) {
    const slot = this.resolveSlot(dto);
    const side = this.sideForSlot(slot);
    if (dto.memberUserId === dto.parentUserId) {
      throw new BadRequestException('A member cannot be placed under themselves');
    }
    await this.requireUsers(dto.memberUserId, dto.parentUserId);

    const [existingPlacement, occupiedRows, cycle] = await Promise.all([
      this.prisma.binaryPlacement.findUnique({ where: { memberUserId: dto.memberUserId } }),
      this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT id FROM binary_placements WHERE parentUserId = ? AND slot = ? LIMIT 1',
        dto.parentUserId,
        slot,
      ),
      this.prisma.binaryAncestry.findUnique({
        where: {
          ancestorUserId_descendantUserId: {
            ancestorUserId: dto.memberUserId,
            descendantUserId: dto.parentUserId,
          },
        },
      }),
    ]);

    if (existingPlacement) throw new ConflictException('Binary placement is already assigned');
    if (occupiedRows[0]) throw new ConflictException(`Parent slot ${slot} is already occupied`);
    if (cycle) throw new BadRequestException('Binary placement would create a cycle');

    const placementId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        const parentAncestors = await tx.$queryRawUnsafe<AncestorRow[]>(
          `SELECT ancestorUserId, depth, firstLegSide, firstLegSlot
           FROM binary_ancestry
           WHERE descendantUserId = ?`,
          dto.parentUserId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO binary_placements
             (id, memberUserId, parentUserId, side, slot, createdByUserId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          placementId,
          dto.memberUserId,
          dto.parentUserId,
          side,
          slot,
          actorUserId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO binary_ancestry
             (ancestorUserId, descendantUserId, depth, firstLegSide, firstLegSlot, createdAt)
           VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
          dto.parentUserId,
          dto.memberUserId,
          side,
          slot,
        );
        for (const ancestor of parentAncestors) {
          await tx.$executeRawUnsafe(
            `INSERT INTO binary_ancestry
               (ancestorUserId, descendantUserId, depth, firstLegSide, firstLegSlot, createdAt)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            ancestor.ancestorUserId,
            dto.memberUserId,
            ancestor.depth + 1,
            ancestor.firstLegSide,
            ancestor.firstLegSlot,
          );
        }
      });

      const placement: PlacementRow = {
        id: placementId,
        memberUserId: dto.memberUserId,
        parentUserId: dto.parentUserId,
        side,
        slot,
        createdByUserId: actorUserId,
        createdAt: new Date(),
      };
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryPlacement',
        entityId: placement.id,
        description: 'Binary 1:4 placement assigned',
        metadata: { memberUserId: dto.memberUserId, parentUserId: dto.parentUserId, side, slot },
      });
      return placement;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || (error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Binary member or placement slot is already assigned');
      }
      throw error;
    }
  }

  async autoPlace(memberUserId: string, rootUserId: string, actorUserId: string) {
    if (memberUserId === rootUserId) {
      throw new BadRequestException('A member cannot be placed under themselves');
    }
    await this.requireUsers(memberUserId, rootUserId);
    const queue = [rootUserId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const parentUserId = queue.shift();
      if (!parentUserId || visited.has(parentUserId)) continue;
      visited.add(parentUserId);
      const children = await this.prisma.$queryRawUnsafe<ChildRow[]>(
        `SELECT memberUserId, slot
         FROM binary_placements
         WHERE parentUserId = ?
         ORDER BY FIELD(slot, 'A','B','C','D'), createdAt ASC`,
        parentUserId,
      );
      const occupied = new Set(children.map((child) => child.slot));
      const slot = SLOT_ORDER.find((candidate) => !occupied.has(candidate));
      if (slot) {
        return this.assignPlacement({ memberUserId, parentUserId, slot }, actorUserId);
      }
      for (const child of children) queue.push(child.memberUserId);
      if (visited.size > 100000) {
        throw new BadRequestException('Placement tree exceeds supported traversal depth');
      }
    }
    throw new ConflictException('No available placement slot was found');
  }

  async getMember(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        sponsorRelationship: {
          include: { sponsor: { select: { id: true, username: true } } },
        },
        sponsoredMembers: {
          orderBy: { createdAt: 'asc' },
          include: { member: { select: { id: true, username: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [placements, children, ancestors] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<PlacementRow & { parentUsername: string }>>(
        `SELECT bp.id, bp.memberUserId, bp.parentUserId, bp.side, bp.slot,
                bp.createdByUserId, bp.createdAt, parent.username AS parentUsername
         FROM binary_placements bp
         INNER JOIN users parent ON parent.id = bp.parentUserId
         WHERE bp.memberUserId = ? LIMIT 1`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<Array<PlacementRow & { memberUsername: string }>>(
        `SELECT bp.id, bp.memberUserId, bp.parentUserId, bp.side, bp.slot,
                bp.createdByUserId, bp.createdAt, member.username AS memberUsername
         FROM binary_placements bp
         INNER JOIN users member ON member.id = bp.memberUserId
         WHERE bp.parentUserId = ?
         ORDER BY FIELD(bp.slot, 'A','B','C','D'), bp.createdAt ASC`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<Array<AncestorRow & { username: string }>>(
        `SELECT ba.ancestorUserId, ba.depth, ba.firstLegSide, ba.firstLegSlot, u.username
         FROM binary_ancestry ba
         INNER JOIN users u ON u.id = ba.ancestorUserId
         WHERE ba.descendantUserId = ?
         ORDER BY ba.depth ASC`,
        userId,
      ),
    ]);

    const placement = placements[0];
    return {
      ...user,
      binaryPlacement: placement
        ? {
            ...placement,
            parent: { id: placement.parentUserId, username: placement.parentUsername },
          }
        : null,
      binaryChildren: children.map((child) => ({
        ...child,
        member: { id: child.memberUserId, username: child.memberUsername },
      })),
      binaryDescendantLinks: ancestors.map((ancestor) => ({
        ancestorUserId: ancestor.ancestorUserId,
        descendantUserId: userId,
        depth: ancestor.depth,
        firstLegSide: ancestor.firstLegSide,
        firstLegSlot: ancestor.firstLegSlot,
        ancestor: { id: ancestor.ancestorUserId, username: ancestor.username },
      })),
    };
  }

  private resolveSlot(dto: AssignPlacementDto): BinaryPlacementSlot {
    if (dto.slot) return dto.slot;
    if (dto.side === BinaryPlacementSide.LEFT) return 'A';
    if (dto.side === BinaryPlacementSide.RIGHT) return 'C';
    throw new BadRequestException('Placement slot A, B, C or D is required');
  }

  private sideForSlot(slot: BinaryPlacementSlot): BinaryPlacementSide {
    return slot === 'A' || slot === 'B' ? BinaryPlacementSide.LEFT : BinaryPlacementSide.RIGHT;
  }

  private async requireUsers(...userIds: string[]): Promise<void> {
    const count = await this.prisma.user.count({ where: { id: { in: userIds } } });
    if (count !== new Set(userIds).size) throw new NotFoundException('One or more users were not found');
  }

  private async assertSponsorDoesNotCreateCycle(memberUserId: string, sponsorUserId: string): Promise<void> {
    let currentUserId: string | null = sponsorUserId;
    let hops = 0;
    while (currentUserId) {
      if (currentUserId === memberUserId) {
        throw new BadRequestException('Sponsor relationship would create a cycle');
      }
      const relationship: { sponsorUserId: string } | null =
        await this.prisma.sponsorRelationship.findUnique({
          where: { memberUserId: currentUserId },
          select: { sponsorUserId: true },
        });
      currentUserId = relationship?.sponsorUserId ?? null;
      hops += 1;
      if (hops > 10000) throw new BadRequestException('Sponsor chain exceeds supported traversal depth');
    }
  }
}
