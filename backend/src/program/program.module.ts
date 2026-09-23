import { Module } from '@nestjs/common';
import {
  ProgramEnrollmentController,
  ProgramPaymentController,
  ProgramPolicyController,
} from './program.controller';
import { ProgramEligibilityService } from './program-eligibility.service';
import { ProgramEnrollmentService } from './program-enrollment.service';
import { ProgramPaymentService } from './program-payment.service';
import { ProgramPolicyService } from './program-policy.service';

@Module({
  controllers: [ProgramPolicyController, ProgramEnrollmentController, ProgramPaymentController],
  providers: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
  ],
  exports: [
    ProgramEligibilityService,
    ProgramPolicyService,
    ProgramEnrollmentService,
    ProgramPaymentService,
  ],
})
export class ProgramModule {}
