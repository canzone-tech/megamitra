import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawTokenService } from './lucky-draw-token.service';

@Injectable()
export class TokenizedLuckyDrawExecutionService extends LuckyDrawExecutionService {
  constructor(
    prisma: PrismaService,
    financialDb: FinancialDbService,
    audit: AuditService,
    private readonly drawTokens: LuckyDrawTokenService,
  ) {
    super(prisma, financialDb, audit);
  }

  async snapshotEntrants(drawId: string, actorUserId: string) {
    const result = await super.snapshotEntrants(drawId, actorUserId);
    await this.drawTokens.assignDrawTokens(drawId);
    return {
      ...result,
      draw: await this.getDraw(drawId),
    };
  }
}
