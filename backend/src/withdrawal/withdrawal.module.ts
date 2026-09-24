import { Module } from '@nestjs/common';
import { WithdrawalAdminController } from './withdrawal-admin.controller';
import { WithdrawalMemberController } from './withdrawal-member.controller';
import { WithdrawalService } from './withdrawal.service';

@Module({
  controllers: [WithdrawalMemberController, WithdrawalAdminController],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
