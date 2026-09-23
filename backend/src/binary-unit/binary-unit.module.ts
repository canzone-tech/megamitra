import { Module } from '@nestjs/common';
import { BinaryUnitController } from './binary-unit.controller';
import { BinaryUnitService } from './binary-unit.service';

@Module({
  controllers: [BinaryUnitController],
  providers: [BinaryUnitService],
  exports: [BinaryUnitService],
})
export class BinaryUnitModule {}
