import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { CreateOwnerCoreMemberDto } from './owner-portal-core.dto';
import { OwnerPortalCoreService } from './owner-portal-core.service';

@Controller('admin/owner-portal/core')
export class OwnerPortalCoreController {
  constructor(private readonly core: OwnerPortalCoreService) {}

  @Permissions('users.read')
  @Get('registration-policy')
  registrationPolicy() {
    return this.core.registrationPolicy();
  }

  @Permissions('users.read')
  @Get('members')
  members(@Query('q') q?: string) {
    return this.core.listMembers(q);
  }

  @Permissions('users.manage')
  @Post('members')
  createMember(
    @Body() dto: CreateOwnerCoreMemberDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.core.createMember(dto, actor.id);
  }

  @Permissions('binary.settlement.read')
  @Get('pair-ledger')
  pairLedger(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return this.core.listPairLedger(Number.isFinite(parsed) ? parsed : 100);
  }
}
