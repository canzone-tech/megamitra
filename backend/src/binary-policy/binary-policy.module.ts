import { Module } from '@nestjs/common';
import { BinaryPolicyController } from './binary-policy.controller';
import { BinaryPolicyService } from './binary-policy.service';

@Module({
  controllers: [BinaryPolicyController],
  providers: [BinaryPolicyService],
  exports: [BinaryPolicyService],
})
export class BinaryPolicyModule {}
