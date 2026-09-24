import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateWithdrawalDestinationDto,
  CreateWithdrawalRequestDto,
  WithdrawalMemberQueryDto,
} from './withdrawal.dto';
import { WithdrawalEligibilityService } from './withdrawal-eligibility.service';
import { WithdrawalService } from './withdrawal.service';

@Controller('withdrawals')
export class WithdrawalMemberController {
  constructor(
    private readonly withdrawals: WithdrawalService,
    private readonly eligibility: WithdrawalEligibilityService,
  ) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthUser, @Query() query: WithdrawalMemberQueryDto) {
    return this.withdrawals.getMemberOverview(user.id, query);
  }

  @Post('me/destinations')
  createDestination(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWithdrawalDestinationDto,
  ) {
    return this.withdrawals.createDestination(user.id, dto);
  }

  @Delete('me/destinations/:id')
  deactivateDestination(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.withdrawals.deactivateDestination(user.id, id);
  }

  @Post('me/requests')
  async createRequest(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWithdrawalRequestDto,
  ) {
    await this.eligibility.assertMemberRequestEligible(user.id, dto.currencyCode);
    return this.withdrawals.createRequest(user.id, dto);
  }

  @Post('me/requests/:id/cancel')
  cancelRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.withdrawals.cancelMine(user.id, id);
  }
}
