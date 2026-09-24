import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { ConfigureProgramEntitlementHookDto } from './program-entitlement-orchestration.dto';
import { ProgramEntitlementOrchestrationService } from './program-entitlement-orchestration.service';

@Controller('admin/program-orchestration')
export class ProgramEntitlementOrchestrationController {
  constructor(private readonly orchestration: ProgramEntitlementOrchestrationService) {}

  @Permissions('program.orchestration.read', 'entitlement.read')
  @Get('policies/:policyId/entitlement-hook')
  getHook(@Param('policyId') policyId: string) {
    return this.orchestration.getEntitlementHook(policyId);
  }

  @Permissions('program.orchestration.manage', 'entitlement.manage')
  @Put('policies/:policyId/entitlement-hook')
  configureHook(
    @Param('policyId') policyId: string,
    @Body() dto: ConfigureProgramEntitlementHookDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orchestration.configureEntitlementHook(
      policyId,
      dto.entitlementPolicyVersionId,
      actor.id,
    );
  }

  @Permissions('program.orchestration.manage', 'entitlement.manage')
  @Delete('policies/:policyId/entitlement-hook')
  removeHook(@Param('policyId') policyId: string, @CurrentUser() actor: AuthUser) {
    return this.orchestration.removeEntitlementHook(policyId, actor.id);
  }
}
