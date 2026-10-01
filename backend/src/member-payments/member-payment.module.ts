import { Module } from '@nestjs/common';
import { LuckyDrawModule } from '../lucky-draw/lucky-draw.module';
import { ProgramModule } from '../program/program.module';
import {
  AdminMemberPaymentController,
  MemberPaymentController,
  PublicReceiptController,
} from './member-payment.controller';
import { MemberPaymentService } from './member-payment.service';
import { TokenizedMemberPaymentService } from './tokenized-member-payment.service';

@Module({
  imports: [ProgramModule, LuckyDrawModule],
  controllers: [
    MemberPaymentController,
    AdminMemberPaymentController,
    PublicReceiptController,
  ],
  providers: [
    TokenizedMemberPaymentService,
    {
      provide: MemberPaymentService,
      useExisting: TokenizedMemberPaymentService,
    },
  ],
  exports: [MemberPaymentService],
})
export class MemberPaymentModule {}
