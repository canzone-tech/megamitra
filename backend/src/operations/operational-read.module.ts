import { Module } from '@nestjs/common';
import { MemberPortalReadController } from './member-portal-read.controller';
import { MemberPortalReadService } from './member-portal-read.service';
import {
  AdminOperationalReadController,
  MemberOperationalReadController,
} from './operational-read.controller';
import { OperationalJsonSafeInterceptor } from './operational-json-safe.interceptor';
import { OperationalReadService } from './operational-read.service';

@Module({
  controllers: [
    MemberPortalReadController,
    MemberOperationalReadController,
    AdminOperationalReadController,
  ],
  providers: [
    MemberPortalReadService,
    OperationalReadService,
    OperationalJsonSafeInterceptor,
  ],
  exports: [OperationalReadService, MemberPortalReadService],
})
export class OperationalReadModule {}
