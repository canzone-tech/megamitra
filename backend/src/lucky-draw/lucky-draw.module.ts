import { Module } from '@nestjs/common';
import {
  LuckyDrawExecutionController,
  LuckyDrawPolicyController,
} from './lucky-draw.controller';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawPolicyService } from './lucky-draw-policy.service';

@Module({
  controllers: [LuckyDrawPolicyController, LuckyDrawExecutionController],
  providers: [LuckyDrawPolicyService, LuckyDrawExecutionService],
  exports: [LuckyDrawPolicyService, LuckyDrawExecutionService],
})
export class LuckyDrawModule {}
