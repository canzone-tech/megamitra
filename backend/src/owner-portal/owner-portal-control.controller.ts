import { Controller, Get, Param, Query } from '@nestjs/common';
import { Permissions } from '../rbac/permissions.decorator';
import { OwnerPortalControlService } from './owner-portal-control.service';

@Controller('admin/owner-portal')
export class OwnerPortalControlController {
  constructor(private readonly control: OwnerPortalControlService) {}

  @Permissions('operations.read')
  @Get('reports/:code/data')
  reportData(@Param('code') code: string, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 500;
    return this.control.reportData(code, Number.isFinite(parsed) ? parsed : 500);
  }

  @Permissions('platform.config.read')
  @Get('governance')
  governance() {
    return this.control.governanceSnapshot();
  }
}
