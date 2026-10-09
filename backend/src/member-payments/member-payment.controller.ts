import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../rbac/roles.decorator';
import {
  CancelMemberEnrollmentDto,
  CancelUnusedEpinDto,
  ReassignEpinDto,
  ReviewMemberPaymentDto,
  SubmitEpinPaymentDto,
  RedeemInstallmentEpinDto,
  SubmitInstallmentPaymentDto,
  UpdatePaymentSettingsDto,
} from './member-payment.dto';
import { MemberPaymentService } from './member-payment.service';

@Controller('member/payments')
@Roles('MEMBER')
export class MemberPaymentController {
  constructor(private readonly payments: MemberPaymentService) {}

  @Get('config')
  config(@CurrentUser() actor: AuthUser) {
    return this.payments.memberPaymentConfig(actor.id);
  }

  @Get()
  history(@CurrentUser() actor: AuthUser) {
    return this.payments.memberSubmissions(actor.id);
  }

  @Post('installments')
  submitInstallment(
    @Body() dto: SubmitInstallmentPaymentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.submitInstallment(actor.id, dto);
  }

  @Post('installments/redeem-epin')
  redeemInstallmentEpin(
    @Body() dto: RedeemInstallmentEpinDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.redeemInstallmentEpin(actor.id, dto.epinId);
  }

  @Post('epins')
  submitEpinPurchase(
    @Body() dto: SubmitEpinPaymentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.submitEpinPurchase(actor.id, dto);
  }

  @Get('epins')
  epins(@CurrentUser() actor: AuthUser) {
    return this.payments.memberEpins(actor.id);
  }
}

@Controller('admin/member-payments')
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminMemberPaymentController {
  constructor(private readonly payments: MemberPaymentService) {}

  @Get('settings')
  settings() {
    return this.payments.paymentSettings();
  }

  @Put('settings')
  @Roles('SUPER_ADMIN')
  updateSettings(
    @Body() dto: UpdatePaymentSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.updatePaymentSettings(dto, actor.id);
  }

  @Get('submissions')
  submissions(@Query('status') status?: string, @Query('purpose') purpose?: string) {
    return this.payments.adminSubmissions(status, purpose);
  }

  @Get('submissions/:id')
  submission(@Param('id') id: string) {
    return this.payments.adminReceipt(id);
  }

  @Patch('submissions/:id/review')
  @Roles('SUPER_ADMIN')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewMemberPaymentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.reviewSubmission(id, dto, actor);
  }

  @Patch('epins/:id/reassign')
  reassignEpin(
    @Param('id') id: string,
    @Body() dto: ReassignEpinDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.reassignUnusedEpin(id, dto, actor.id);
  }

  @Post('epins/:id/cancel')
  cancelEpin(
    @Param('id') id: string,
    @Body() dto: CancelUnusedEpinDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.cancelUnusedEpin(id, dto, actor.id);
  }

  @Post('members/:id/cancel')
  cancelMember(
    @Param('id') id: string,
    @Body() dto: CancelMemberEnrollmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.cancelMember(id, dto, actor.id);
  }
}

@Controller('receipts')
export class PublicReceiptController {
  constructor(private readonly payments: MemberPaymentService) {}

  @Public()
  @Get(':token')
  receipt(@Param('token') token: string) {
    return this.payments.publicReceipt(token);
  }
}
