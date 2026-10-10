import { Module } from '@nestjs/common';
import { LuckyDrawModule } from '../lucky-draw/lucky-draw.module';
import { MemberPortalReadController } from './member-portal-read.controller';
import { MemberPortalReadService } from './member-portal-read.service';
import { OperationalCompletionController } from './operational-completion.controller';
import { OperationalCompletionService } from './operational-completion.service';
import {
  AdminOperationalReadController,
  MemberOperationalReadController,
} from './operational-read.controller';
import { OperationalJsonSafeInterceptor } from './operational-json-safe.interceptor';
import { OperationalReadService } from './operational-read.service';

@Module({
  imports: [LuckyDrawModule],
  controllers: [
    MemberPortalReadController,
    MemberOperationalReadController,
    AdminOperationalReadController,
    OperationalCompletionController,
  ],
  providers: [
    MemberPortalReadService,
    OperationalReadService,
    OperationalCompletionService,
    OperationalJsonSafeInterceptor,
  ],
  exports: [OperationalReadService, MemberPortalReadService, OperationalCompletionService],
})
export class OperationalReadModule {}
