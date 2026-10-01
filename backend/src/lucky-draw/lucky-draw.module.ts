import { Module } from '@nestjs/common';
import {
  LuckyDrawExecutionController,
  LuckyDrawFulfillmentController,
  LuckyDrawPolicyController,
} from './lucky-draw.controller';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawFulfillmentService } from './lucky-draw-fulfillment.service';
import { LuckyDrawPolicyService } from './lucky-draw-policy.service';
import { LuckyDrawTokenService } from './lucky-draw-token.service';
import { TokenizedLuckyDrawExecutionService } from './tokenized-lucky-draw-execution.service';

@Module({
  controllers: [
    LuckyDrawPolicyController,
    LuckyDrawExecutionController,
    LuckyDrawFulfillmentController,
  ],
  providers: [
    LuckyDrawPolicyService,
    LuckyDrawTokenService,
    TokenizedLuckyDrawExecutionService,
    {
      provide: LuckyDrawExecutionService,
      useExisting: TokenizedLuckyDrawExecutionService,
    },
    LuckyDrawFulfillmentService,
  ],
  exports: [
    LuckyDrawPolicyService,
    LuckyDrawExecutionService,
    LuckyDrawFulfillmentService,
    LuckyDrawTokenService,
  ],
})
export class LuckyDrawModule {}
