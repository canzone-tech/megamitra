import { Module } from '@nestjs/common';
import { ProgramModule } from '../program/program.module';
import {
  AdminMemberPaymentController,
  MemberPaymentController,
  PublicReceiptController,
} from './member-payment.controller';
import { MemberPaymentService } from './member-payment.service';

@Module({
  imports: [ProgramModule],
  controllers: [
    MemberPaymentController,
    AdminMemberPaymentController,
    PublicReceiptController,
  ],
  providers: [MemberPaymentService],
  exports: [MemberPaymentService],
})
export class MemberPaymentModule {}
