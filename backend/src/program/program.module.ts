import { Module } from '@nestjs/common';
import { BinaryUnitModule } from '../binary-unit/binary-unit.module';
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

@Module({
  imports: [BinaryUnitModule],
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
  ],
  exports: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
    ProgramOrchestrationService,
  ],
})
export class ProgramModule {}
