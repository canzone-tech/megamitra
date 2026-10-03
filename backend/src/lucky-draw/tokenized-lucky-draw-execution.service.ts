import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawTokenService } from './lucky-draw-token.service';

@Injectable()
export class TokenizedLuckyDrawExecutionService extends LuckyDrawExecutionService {
  constructor(
    prisma: PrismaService,
    financialDb: FinancialDbService,
    private readonly tokenAudit: AuditService,
    private readonly drawTokens: LuckyDrawTokenService,
  ) {
    super(prisma, financialDb, tokenAudit);
  }

  async snapshotEntrants(drawId: string, actorUserId: string) {
    const ownerSnapshot = await this.drawTokens.snapshotOwnerMonthlyDrawEntrants(drawId);
    if (ownerSnapshot) {
      if (!ownerSnapshot.idempotent) {
        await this.tokenAudit.log({
          actorUserId,
          action: AuditAction.CREATE,
          entityType: 'LuckyDrawEntrantSnapshot',
          entityId: drawId,
          description: 'Owner monthly draw entrant snapshot frozen from installment tokens',
          metadata: {
            source: 'INSTALLMENT_TOKEN_REGISTRY',
            snapshotHash: ownerSnapshot.snapshotHash,
            candidateCount: ownerSnapshot.candidateCount,
            eligibleEntryCount: ownerSnapshot.eligibleEntryCount,
            excludedEntryCount: ownerSnapshot.excludedEntryCount,
          },
        });
      }
      return {
        draw: await this.getDraw(drawId),
        idempotent: ownerSnapshot.idempotent,
      };
    }

    const result = await super.snapshotEntrants(drawId, actorUserId);
    await this.drawTokens.assignDrawTokens(drawId);
    return {
      ...result,
      draw: await this.getDraw(drawId),
    };
  }
}
