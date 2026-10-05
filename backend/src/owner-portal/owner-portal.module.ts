import { Module } from '@nestjs/common';
import { BinaryPolicyModule } from '../binary-policy/binary-policy.module';
import { GenealogyModule } from '../genealogy/genealogy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LuckyDrawModule } from '../lucky-draw/lucky-draw.module';
import { MemberPaymentModule } from '../member-payments/member-payment.module';
import { ProgramModule } from '../program/program.module';
import { ReferralRewardModule } from '../referral-reward/referral-reward.module';
import { UsersModule } from '../users/users.module';
import { OwnerPortalControlController } from './owner-portal-control.controller';
import { OwnerPortalControlService } from './owner-portal-control.service';
import { OwnerPortalCoreController } from './owner-portal-core.controller';
import { OwnerPortalCoreService } from './owner-portal-core.service';
import { OwnerPortalController } from './owner-portal.controller';
import { OwnerPortalDrawWorkflowService } from './owner-portal-draw-workflow.service';
import { OwnerPortalFinanceService } from './owner-portal-finance.service';
import { OwnerPortalService } from './owner-portal.service';
import { OwnerPrizeMediaStore } from './owner-prize-media.store';
import { OwnerSeasonBinaryV14ConfigurationService } from './owner-season-binary-v14-configuration.service';
import { OwnerSeasonConfigurationService } from './owner-season-configuration.service';
import { OwnerSeasonDeploymentService } from './owner-season-deployment.service';

@Module({
  imports: [
    UsersModule,
    GenealogyModule,
    ProgramModule,
    BinaryPolicyModule,
    ReferralRewardModule,
    LuckyDrawModule,
    LedgerModule,
    MemberPaymentModule,
  ],
  controllers: [
    OwnerPortalController,
    OwnerPortalCoreController,
    OwnerPortalControlController,
  ],
  providers: [
    OwnerPortalService,
    OwnerPrizeMediaStore,
    OwnerPortalDrawWorkflowService,
    OwnerPortalFinanceService,
    OwnerPortalCoreService,
    OwnerPortalControlService,
    OwnerSeasonDeploymentService,
    OwnerSeasonBinaryV14ConfigurationService,
    {
      provide: OwnerSeasonConfigurationService,
      useExisting: OwnerSeasonBinaryV14ConfigurationService,
    },
  ],
  exports: [OwnerPortalService],
})
export class OwnerPortalModule {}
