import { Controller, Get, Query } from '@nestjs/common';
import { Permissions } from '../rbac/permissions.decorator';
import { OwnerPortalCoreService } from './owner-portal-core.service';

@Controller('admin/owner-portal/core')
export class OwnerPortalCoreController {
  constructor(private readonly core: OwnerPortalCoreService) {}

  @Permissions('users.read')
  @Get('members')
  members(@Query('q') q?: string) {
    return this.core.listMembers(q);
  }

  @Permissions('binary.settlement.read')
  @Get('pair-ledger')
  pairLedger(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return this.core.listPairLedger(Number.isFinite(parsed) ? parsed : 100);
  }
}
