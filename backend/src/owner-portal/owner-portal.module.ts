import { Module } from '@nestjs/common';
import { BinaryPolicyModule } from '../binary-policy/binary-policy.module';
import { GenealogyModule } from '../genealogy/genealogy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LuckyDrawModule } from '../lucky-draw/lucky-draw.module';
import { ProgramModule } from '../program/program.module';
import { ReferralRewardModule } from '../referral-reward/referral-reward.module';
import { UsersModule } from '../users/users.module';
import { OwnerPortalController } from './owner-portal.controller';
import { OwnerPortalDrawWorkflowService } from './owner-portal-draw-workflow.service';
import { OwnerPortalFinanceService } from './owner-portal-finance.service';
import { OwnerPortalService } from './owner-portal.service';

@Module({
  imports: [
    UsersModule,
    GenealogyModule,
    ProgramModule,
    BinaryPolicyModule,
    ReferralRewardModule,
    LuckyDrawModule,
    LedgerModule,
  ],
  controllers: [OwnerPortalController],
  providers: [OwnerPortalService, OwnerPortalDrawWorkflowService, OwnerPortalFinanceService],
  exports: [OwnerPortalService],
})
export class OwnerPortalModule {}
