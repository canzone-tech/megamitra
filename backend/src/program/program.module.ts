import { Module } from '@nestjs/common';
import { BinaryUnitModule } from '../binary-unit/binary-unit.module';
import { ReferralRewardModule } from '../referral-reward/referral-reward.module';
import {
  ProgramEnrollmentController,
  ProgramPaymentController,
  ProgramPolicyController,
} from './program.controller';
import { ProgramEligibilityService } from './program-eligibility.service';
import { ProgramEnrollmentService } from './program-enrollment.service';
import { ProgramOrchestrationController } from './program-orchestration.controller';
import { ProgramOrchestrationService } from './program-orchestration.service';
import { ProgramPaymentService } from './program-payment.service';
import { ProgramPolicyService } from './program-policy.service';
import { ProgramReferralRewardConsumerService } from './program-referral-reward-consumer.service';

@Module({
  imports: [BinaryUnitModule, ReferralRewardModule],
  controllers: [
    ProgramPolicyController,
    ProgramEnrollmentController,
    ProgramPaymentController,
    ProgramOrchestrationController,
  ],
  providers: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
    ProgramOrchestrationService,
    ProgramReferralRewardConsumerService,
  ],
  exports: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
    ProgramOrchestrationService,
    ProgramReferralRewardConsumerService,
  ],
})
export class ProgramModule {}
