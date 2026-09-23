import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { OperationalJsonSafeInterceptor } from './operational-json-safe.interceptor';
import { OperationalListQueryDto } from './operational-read.dto';
import { OperationalReadService } from './operational-read.service';

@Controller('member')
@UseInterceptors(OperationalJsonSafeInterceptor)
export class MemberOperationalReadController {
  constructor(private readonly reads: OperationalReadService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.reads.memberDashboard(user.id);
  }

  @Get('enrollments')
  enrollments(@CurrentUser() user: AuthUser, @Query() query: OperationalListQueryDto) {
    return this.reads.memberEnrollments(user.id, query);
  }

  @Get('wallet-history')
  walletHistory(@CurrentUser() user: AuthUser, @Query() query: OperationalListQueryDto) {
    return this.reads.memberWalletHistory(user.id, query);
  }

  @Get('referral-rewards')
  referralRewards(@CurrentUser() user: AuthUser, @Query() query: OperationalListQueryDto) {
    return this.reads.memberReferralRewards(user.id, query);
  }

  @Get('binary')
  binary(@CurrentUser() user: AuthUser, @Query() query: OperationalListQueryDto) {
    return this.reads.memberBinary(user.id, query);
  }

  @Get('rewards')
  rewards(@CurrentUser() user: AuthUser, @Query() query: OperationalListQueryDto) {
    return this.reads.memberRewards(user.id, query);
  }
}

@Controller('admin/operations')
@Permissions('operations.read')
@UseInterceptors(OperationalJsonSafeInterceptor)
export class AdminOperationalReadController {
  constructor(private readonly reads: OperationalReadService) {}

  @Get('summary')
  summary() {
    return this.reads.adminSummary();
  }

  @Get('orchestration')
  orchestration(@Query() query: OperationalListQueryDto) {
    return this.reads.adminOrchestration(query);
  }

  @Get('referral-handoffs')
  referralHandoffs(@Query() query: OperationalListQueryDto) {
    return this.reads.adminReferralHandoffs(query);
  }

  @Get('draws')
  draws(@Query() query: OperationalListQueryDto) {
    return this.reads.adminDraws(query);
  }

  @Get('prize-claims')
  prizeClaims(@Query() query: OperationalListQueryDto) {
    return this.reads.adminPrizeClaims(query);
  }
}
