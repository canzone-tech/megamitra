import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateReferralRewardEventDto,
  CreateReferralRewardPolicyDto,
  CreateReferralRewardPolicyVersionDto,
  UpdateReferralRewardPolicyVersionDto,
} from './referral-reward.dto';
import { ReferralRewardPolicyService } from './referral-reward-policy.service';
import { ReferralRewardService } from './referral-reward.service';

@Controller('admin/referral-reward-policies')
export class ReferralRewardPolicyController {
  constructor(private readonly policies: ReferralRewardPolicyService) {}

  @Permissions('referral.policy.manage')
  @Post()
  createPolicy(
    @Body() dto: CreateReferralRewardPolicyDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.createPolicy(dto, actor.id);
  }

  @Permissions('referral.policy.read')
  @Get()
  listPolicies() {
    return this.policies.listPolicies();
  }

  @Permissions('referral.policy.manage')
  @Post(':policyId/versions')
  createVersion(
    @Param('policyId') policyId: string,
    @Body() dto: CreateReferralRewardPolicyVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.createVersion(policyId, dto, actor.id);
  }

  @Permissions('referral.policy.read')
  @Get('versions/:versionId')
  getVersion(@Param('versionId') versionId: string) {
    return this.policies.getVersion(versionId);
  }

  @Permissions('referral.policy.manage')
  @Patch('versions/:versionId')
  updateVersion(
    @Param('versionId') versionId: string,
    @Body() dto: UpdateReferralRewardPolicyVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policies.updateDraft(versionId, dto, actor.id);
  }

  @Permissions('referral.policy.manage')
  @Post('versions/:versionId/publish')
  publish(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.policies.publish(versionId, actor.id);
  }

  @Permissions('referral.policy.manage')
  @Post('versions/:versionId/retire')
  retire(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.policies.retire(versionId, actor.id);
  }
}

@Controller('admin/referral-rewards')
export class ReferralRewardController {
  constructor(private readonly rewards: ReferralRewardService) {}

  @Permissions('referral.reward.manage')
  @Post('events')
  createEvent(
    @Body() dto: CreateReferralRewardEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rewards.createEvent(dto, actor.id);
  }

  @Permissions('referral.reward.read')
  @Get('events/:id')
  getEvent(@Param('id') id: string) {
    return this.rewards.getEvent(id);
  }

  @Permissions('referral.reward.read')
  @Get('sponsors/:userId/history')
  listSponsorHistory(@Param('userId') userId: string) {
    return this.rewards.listSponsorHistory(userId);
  }
}
