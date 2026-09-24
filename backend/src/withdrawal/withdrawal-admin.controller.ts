import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  ConfirmWithdrawalPayoutDto,
  CreateWithdrawalPolicyDto,
  CreateWithdrawalPolicyVersionDto,
  FailWithdrawalPayoutDto,
  ListWithdrawalRequestsDto,
  StartWithdrawalPayoutDto,
  WithdrawalReasonDto,
} from './withdrawal.dto';
import { WithdrawalService } from './withdrawal.service';

@Controller('admin/withdrawals')
export class WithdrawalAdminController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Permissions('withdrawal.read')
  @Get('requests')
  listRequests(@Query() query: ListWithdrawalRequestsDto) {
    return this.withdrawals.listRequests(query);
  }

  @Permissions('withdrawal.read')
  @Get('requests/:id')
  getRequest(@Param('id') id: string) {
    return this.withdrawals.getRequest(id);
  }

  @Permissions('withdrawal.manage')
  @Post('requests/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.withdrawals.approve(id, user.id);
  }

  @Permissions('withdrawal.manage')
  @Post('requests/:id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: WithdrawalReasonDto,
  ) {
    return this.withdrawals.reject(id, user.id, dto);
  }

  @Permissions('withdrawal.manage')
  @Post('requests/:id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: WithdrawalReasonDto,
  ) {
    return this.withdrawals.adminCancel(id, user.id, dto);
  }

  @Permissions('withdrawal.manage')
  @Post('requests/:id/payout-attempts')
  startPayout(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: StartWithdrawalPayoutDto,
  ) {
    return this.withdrawals.startPayout(id, user.id, dto);
  }

  @Permissions('withdrawal.manage')
  @Patch('payout-attempts/:id/confirm')
  confirmPayout(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmWithdrawalPayoutDto,
  ) {
    return this.withdrawals.confirmPayout(id, user.id, dto);
  }

  @Permissions('withdrawal.manage')
  @Patch('payout-attempts/:id/fail')
  failPayout(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: FailWithdrawalPayoutDto,
  ) {
    return this.withdrawals.failPayout(id, user.id, dto);
  }

  @Permissions('withdrawal.read')
  @Get('policies')
  listPolicies() {
    return this.withdrawals.listPolicies();
  }

  @Permissions('withdrawal.manage')
  @Post('policies')
  createPolicy(@CurrentUser() user: AuthUser, @Body() dto: CreateWithdrawalPolicyDto) {
    return this.withdrawals.createPolicy(user.id, dto);
  }

  @Permissions('withdrawal.manage')
  @Post('policies/:id/versions')
  createPolicyVersion(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWithdrawalPolicyVersionDto,
  ) {
    return this.withdrawals.createPolicyVersion(id, user.id, dto);
  }

  @Permissions('withdrawal.manage')
  @Post('policy-versions/:id/publish')
  publishPolicyVersion(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.withdrawals.publishPolicyVersion(id, user.id);
  }

  @Permissions('withdrawal.manage')
  @Post('policy-versions/:id/retire')
  retirePolicyVersion(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.withdrawals.retirePolicyVersion(id, user.id);
  }
}
