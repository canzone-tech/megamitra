import { Injectable } from '@nestjs/common';
import { AuditAction } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    actorUserId?: string | null;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    description?: string;
    metadata?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        description: input.description,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}
