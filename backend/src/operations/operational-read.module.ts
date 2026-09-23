import { Module } from '@nestjs/common';
import {
  AdminOperationalReadController,
  MemberOperationalReadController,
} from './operational-read.controller';
import { OperationalReadService } from './operational-read.service';

@Module({
  controllers: [MemberOperationalReadController, AdminOperationalReadController],
  providers: [OperationalReadService],
  exports: [OperationalReadService],
})
export class OperationalReadModule {}
