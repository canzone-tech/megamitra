import { Module } from '@nestjs/common';
import { KycAdminController } from './kyc-admin.controller';
import { KycMemberController } from './kyc-member.controller';
import { KycService } from './kyc.service';

@Module({
  controllers: [KycMemberController, KycAdminController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
