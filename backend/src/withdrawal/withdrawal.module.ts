import { Module } from '@nestjs/common';
import { WithdrawalAdminController } from './withdrawal-admin.controller';
import { WithdrawalEligibilityService } from './withdrawal-eligibility.service';
import { WithdrawalMemberController } from './withdrawal-member.controller';
import { WithdrawalService } from './withdrawal.service';

@Module({
  controllers: [WithdrawalMemberController, WithdrawalAdminController],
  providers: [WithdrawalService, WithdrawalEligibilityService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
