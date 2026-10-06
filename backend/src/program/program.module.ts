import { Module } from '@nestjs/common';
import { BinarySettlementModule } from '../binary-settlement/binary-settlement.module';
import { BinaryUnitModule } from '../binary-unit/binary-unit.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { ReferralRewardModule } from '../referral-reward/referral-reward.module';
import {
  ProgramEnrollmentController,
  ProgramPaymentController,
  ProgramPolicyController,
} from './program.controller';
import {
  ProgramAutomationService,
  ProgramAutomationWorkerService,
} from './program-automation.service';
import { ProgramEligibilityService } from './program-eligibility.service';
import { ProgramEnrollmentService } from './program-enrollment.service';
import { ProgramEntitlementOrchestrationController } from './program-entitlement-orchestration.controller';
import { ProgramEntitlementOrchestrationService } from './program-entitlement-orchestration.service';
import { ProgramOrchestrationController } from './program-orchestration.controller';
import { ProgramOrchestrationService } from './program-orchestration.service';
import { ProgramPaymentService } from './program-payment.service';
import { ProgramPolicyService } from './program-policy.service';
import { ProgramReferralRewardConsumerService } from './program-referral-reward-consumer.service';

@Module({
  imports: [BinaryUnitModule, BinarySettlementModule, ReferralRewardModule, EntitlementModule],
  controllers: [
    ProgramPolicyController,
    ProgramEnrollmentController,
    ProgramPaymentController,
    ProgramOrchestrationController,
    ProgramEntitlementOrchestrationController,
  ],
  providers: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
    ProgramEntitlementOrchestrationService,
    {
      provide: ProgramOrchestrationService,
      useExisting: ProgramEntitlementOrchestrationService,
    },
    ProgramReferralRewardConsumerService,
    ProgramAutomationService,
    ProgramAutomationWorkerService,
  ],
  exports: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
    ProgramOrchestrationService,
    ProgramEntitlementOrchestrationService,
    ProgramReferralRewardConsumerService,
    ProgramAutomationService,
  ],
})
export class ProgramModule {}
