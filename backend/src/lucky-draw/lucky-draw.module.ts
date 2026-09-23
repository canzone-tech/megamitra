import { Module } from '@nestjs/common';
import {
  LuckyDrawExecutionController,
  LuckyDrawFulfillmentController,
  LuckyDrawPolicyController,
} from './lucky-draw.controller';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawFulfillmentService } from './lucky-draw-fulfillment.service';
import { LuckyDrawPolicyService } from './lucky-draw-policy.service';

@Module({
  controllers: [
    LuckyDrawPolicyController,
    LuckyDrawExecutionController,
    LuckyDrawFulfillmentController,
  ],
  providers: [
    LuckyDrawPolicyService,
    LuckyDrawExecutionService,
    LuckyDrawFulfillmentService,
  ],
  exports: [
    LuckyDrawPolicyService,
    LuckyDrawExecutionService,
    LuckyDrawFulfillmentService,
  ],
})
export class LuckyDrawModule {}
