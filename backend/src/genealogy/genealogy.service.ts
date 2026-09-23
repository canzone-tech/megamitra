import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import type { AssignPlacementDto, AssignSponsorDto } from './genealogy.dto';

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
    if (dto.memberUserId === dto.parentUserId) {
      throw new BadRequestException('A member cannot be placed under themselves');
    }
    await this.requireUsers(dto.memberUserId, dto.parentUserId);

    const [existingPlacement, occupiedSlot, cycle] = await Promise.all([
      this.prisma.binaryPlacement.findUnique({
        where: { memberUserId: dto.memberUserId },
      }),
      this.prisma.binaryPlacement.findUnique({
        where: {
          parentUserId_side: {
            parentUserId: dto.parentUserId,
            side: dto.side,
          },
        },
      }),
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
    if (occupiedSlot) throw new ConflictException(`Parent ${dto.side} placement is already occupied`);
    if (cycle) throw new BadRequestException('Binary placement would create a cycle');

    try {
      const placement = await this.prisma.$transaction(async (tx) => {
        const created = await tx.binaryPlacement.create({
          data: { ...dto, createdByUserId: actorUserId },
        });
        const parentAncestors = await tx.binaryAncestry.findMany({
          where: { descendantUserId: dto.parentUserId },
        });
        const ancestryRows = [
          {
            ancestorUserId: dto.parentUserId,
            descendantUserId: dto.memberUserId,
            depth: 1,
            firstLegSide: dto.side,
          },
          ...parentAncestors.map((ancestor) => ({
            ancestorUserId: ancestor.ancestorUserId,
            descendantUserId: dto.memberUserId,
            depth: ancestor.depth + 1,
            firstLegSide: ancestor.firstLegSide,
          })),
        ];
        await tx.binaryAncestry.createMany({ data: ancestryRows });
        return created;
      });

      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryPlacement',
        entityId: placement.id,
        description: 'Binary placement assigned',
        metadata: dto,
      });
      return placement;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Binary member or placement slot is already assigned');
      }
      throw error;
    }
  }

  async getMember(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        sponsorRelationship: {
          include: {
            sponsor: { select: { id: true, username: true } },
          },
        },
        sponsoredMembers: {
          orderBy: { createdAt: 'asc' },
          include: {
            member: { select: { id: true, username: true } },
          },
        },
        binaryPlacement: {
          include: {
            parent: { select: { id: true, username: true } },
          },
        },
        binaryChildren: {
          orderBy: { side: 'asc' },
          include: {
            member: { select: { id: true, username: true } },
          },
        },
        binaryDescendantLinks: {
          orderBy: { depth: 'asc' },
          include: {
            ancestor: { select: { id: true, username: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
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
