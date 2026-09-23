import { Module } from '@nestjs/common';
import { BinarySettlementController } from './binary-settlement.controller';
import { BinarySettlementService } from './binary-settlement.service';

@Module({
  controllers: [BinarySettlementController],
  providers: [BinarySettlementService],
  exports: [BinarySettlementService],
})
export class BinarySettlementModule {}
