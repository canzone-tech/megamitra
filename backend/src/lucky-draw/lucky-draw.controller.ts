import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateLuckyDrawInstanceDto,
  CreateLuckyDrawPolicyDto,
  CreateLuckyDrawPolicyVersionDto,
  ExecuteLuckyDrawDto,
  UpdateLuckyDrawPolicyVersionDto,
} from './lucky-draw.dto';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawPolicyService } from './lucky-draw-policy.service';

@Controller('admin/lucky-draw-policies')
export class LuckyDrawPolicyController {
  constructor(private readonly policies: LuckyDrawPolicyService) {}

  @Permissions('draw.policy.manage')
  @Post()
  createPolicy(@Body() dto: CreateLuckyDrawPolicyDto, @CurrentUser() actor: AuthUser) {
    return this.policies.createPolicy(dto, actor.id);
  }

  @Permissions('draw.policy.read')
  @Get()
  listPolicies() {
    return this.policies.listPolicies();
  }

  @Permissions('draw.policy.read')
  @Get(':policyId')
  getPolicy(@Param('policyId') policyId: string) {
    return this.policies.getPolicy(policyId);
  }

  @Permissions('draw.policy.manage')
  @Post(':policyId/versions')
  createVersion(
    @Param('policyId') policyId: string,
    @Body() dto: CreateLuckyDrawPolicyVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.createVersion(policyId, dto, actor.id);
  }

  @Permissions('draw.policy.read')
  @Get('versions/:versionId')
  getVersion(@Param('versionId') versionId: string) {
    return this.policies.getVersion(versionId);
  }

  @Permissions('draw.policy.manage')
  @Patch('versions/:versionId')
  updateVersion(
    @Param('versionId') versionId: string,
    @Body() dto: UpdateLuckyDrawPolicyVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.updateDraft(versionId, dto, actor.id);
  }

  @Permissions('draw.policy.manage')
  @Post('versions/:versionId/publish')
  publish(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.policies.publish(versionId, actor.id);
  }

  @Permissions('draw.policy.manage')
  @Post('versions/:versionId/retire')
  retire(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.policies.retire(versionId, actor.id);
  }
}

@Controller('admin/lucky-draws')
export class LuckyDrawExecutionController {
  constructor(private readonly draws: LuckyDrawExecutionService) {}

  @Permissions('draw.execution.manage')
  @Post()
  createDraw(@Body() dto: CreateLuckyDrawInstanceDto, @CurrentUser() actor: AuthUser) {
    return this.draws.createInstance(dto, actor.id);
  }

  @Permissions('draw.execution.read')
  @Get()
  listDraws(@Query('policyVersionId') policyVersionId?: string) {
    return this.draws.listDraws(policyVersionId);
  }

  @Permissions('draw.execution.read')
  @Get(':drawId')
  getDraw(@Param('drawId') drawId: string) {
    return this.draws.getDraw(drawId);
  }

  @Permissions('draw.execution.manage')
  @Post(':drawId/snapshot')
  snapshot(@Param('drawId') drawId: string, @CurrentUser() actor: AuthUser) {
    return this.draws.snapshotEntrants(drawId, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post(':drawId/execute')
  execute(
    @Param('drawId') drawId: string,
    @Body() dto: ExecuteLuckyDrawDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.draws.execute(drawId, dto, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post(':drawId/void')
  voidScheduled(@Param('drawId') drawId: string, @CurrentUser() actor: AuthUser) {
    return this.draws.voidScheduled(drawId, actor.id);
  }
}
