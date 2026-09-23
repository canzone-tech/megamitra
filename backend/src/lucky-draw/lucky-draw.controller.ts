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
import {
  CancelLuckyDrawPrizeClaimDto,
  ClaimLuckyDrawPrizeDto,
  ConfigureLuckyDrawFulfillmentRuleDto,
  FulfillLuckyDrawPrizeDto,
  ReverseLuckyDrawPrizeFulfillmentDto,
} from './lucky-draw-fulfillment.dto';
import { LuckyDrawExecutionService } from './lucky-draw-execution.service';
import { LuckyDrawFulfillmentService } from './lucky-draw-fulfillment.service';
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

@Controller('admin/lucky-draw-fulfillment')
export class LuckyDrawFulfillmentController {
  constructor(private readonly fulfillment: LuckyDrawFulfillmentService) {}

  @Permissions('draw.fulfillment.manage')
  @Post('policy-versions/:versionId/rule')
  configureRule(
    @Param('versionId') versionId: string,
    @Body() dto: ConfigureLuckyDrawFulfillmentRuleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fulfillment.configureRule(versionId, dto, actor.id);
  }

  @Permissions('draw.fulfillment.read')
  @Get('policy-versions/:versionId/rule')
  getRule(@Param('versionId') versionId: string) {
    return this.fulfillment.getRule(versionId);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('draws/:drawId/claims/initialize')
  initializeClaims(@Param('drawId') drawId: string, @CurrentUser() actor: AuthUser) {
    return this.fulfillment.initializeClaims(drawId, actor.id);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('claims/expire-pending')
  expirePending(@Query('limit') limit: string | undefined, @CurrentUser() actor: AuthUser) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return this.fulfillment.expirePending(actor.id, Number.isFinite(parsed) ? parsed : 100);
  }

  @Permissions('draw.fulfillment.read')
  @Get('claims')
  listClaims(
    @Query('drawId') drawId?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    return this.fulfillment.listClaims({ drawId, userId, status });
  }

  @Permissions('draw.fulfillment.read')
  @Get('claims/:claimId')
  getClaim(@Param('claimId') claimId: string) {
    return this.fulfillment.getClaim(claimId);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('claims/:claimId/claim')
  claim(
    @Param('claimId') claimId: string,
    @Body() dto: ClaimLuckyDrawPrizeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fulfillment.claim(claimId, dto, actor.id);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('claims/:claimId/fulfill')
  fulfill(
    @Param('claimId') claimId: string,
    @Body() dto: FulfillLuckyDrawPrizeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fulfillment.fulfill(claimId, dto, actor.id);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('claims/:claimId/cancel')
  cancelClaim(
    @Param('claimId') claimId: string,
    @Body() dto: CancelLuckyDrawPrizeClaimDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fulfillment.cancelClaim(claimId, dto, actor.id);
  }

  @Permissions('draw.fulfillment.read')
  @Get('fulfillments/:fulfillmentId')
  getFulfillment(@Param('fulfillmentId') fulfillmentId: string) {
    return this.fulfillment.getFulfillment(fulfillmentId);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('fulfillments/:fulfillmentId/reverse')
  reverseFulfillment(
    @Param('fulfillmentId') fulfillmentId: string,
    @Body() dto: ReverseLuckyDrawPrizeFulfillmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fulfillment.reverseFulfillment(fulfillmentId, dto, actor.id);
  }
}
