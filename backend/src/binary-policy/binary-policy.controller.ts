import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateBinaryPlanDto,
  CreateBinaryPlanVersionDto,
  UpdateBinaryPlanVersionDto,
} from './binary-policy.dto';
import { BinaryPolicyService } from './binary-policy.service';

@Controller('admin/binary-plans')
export class BinaryPolicyController {
  constructor(private readonly policies: BinaryPolicyService) {}

  @Permissions('binary.policy.read')
  @Get()
  listPlans() {
    return this.policies.listPlans();
  }

  @Permissions('binary.policy.manage')
  @Post()
  createPlan(@Body() dto: CreateBinaryPlanDto, @CurrentUser() actor: AuthUser) {
    return this.policies.createPlan(dto, actor.id);
  }

  @Permissions('binary.policy.manage')
  @Post(':planId/versions')
  createVersion(
    @Param('planId') planId: string,
    @Body() dto: CreateBinaryPlanVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.createVersion(planId, dto, actor.id);
  }

  @Permissions('binary.policy.read')
  @Get('versions/:versionId')
  getVersion(@Param('versionId') versionId: string) {
    return this.policies.getVersion(versionId);
  }

  @Permissions('binary.policy.manage')
  @Patch('versions/:versionId')
  updateDraft(
    @Param('versionId') versionId: string,
    @Body() dto: UpdateBinaryPlanVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.updateDraft(versionId, dto, actor.id);
  }

  @Permissions('binary.policy.manage')
  @Post('versions/:versionId/publish')
  publish(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.policies.publish(versionId, actor.id);
  }

  @Permissions('binary.policy.manage')
  @Post('versions/:versionId/retire')
  retire(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.policies.retire(versionId, actor.id);
  }
}
