import { Module } from '@nestjs/common';
import {
  AdminOperationalReadController,
  MemberOperationalReadController,
} from './operational-read.controller';
import { OperationalJsonSafeInterceptor } from './operational-json-safe.interceptor';
import { OperationalReadService } from './operational-read.service';

@Module({
  controllers: [MemberOperationalReadController, AdminOperationalReadController],
  providers: [OperationalReadService, OperationalJsonSafeInterceptor],
  exports: [OperationalReadService],
})
export class OperationalReadModule {}
