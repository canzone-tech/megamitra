import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateKycPolicyDto,
  CreateKycPolicyVersionDto,
  ListKycSubmissionsDto,
  ReviewKycSubmissionDto,
  UpdateKycPolicyVersionDto,
} from './kyc.dto';
import { KycService } from './kyc.service';

@Controller('admin/kyc')
export class KycAdminController {
  constructor(private readonly kyc: KycService) {}

  @Permissions('kyc.read')
  @Get('submissions')
  listSubmissions(@Query() query: ListKycSubmissionsDto) {
    return this.kyc.listSubmissions(query);
  }

  @Permissions('kyc.read')
  @Get('submissions/:id')
  getSubmission(@Param('id') id: string) {
    return this.kyc.getSubmission(id);
  }

  @Permissions('kyc.manage')
  @Post('submissions/:id/start-review')
  startReview(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.startReview(id, actor.id);
  }

  @Permissions('kyc.manage')
  @Patch('submissions/:id/review')
  reviewSubmission(
    @Param('id') id: string,
    @Body() dto: ReviewKycSubmissionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.reviewSubmission(id, dto, actor.id);
  }

  @Permissions('kyc.read')
  @Get('policies')
  listPolicies() {
    return this.kyc.listPolicies();
  }

  @Permissions('kyc.manage')
  @Post('policies')
  createPolicy(
    @Body() dto: CreateKycPolicyDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.createPolicy(dto, actor.id);
  }

  @Permissions('kyc.manage')
  @Post('policies/:policyId/default')
  setDefaultPolicy(
    @Param('policyId') policyId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.setDefaultPolicy(policyId, actor.id);
  }

  @Permissions('kyc.manage')
  @Post('policies/:policyId/versions')
  createPolicyVersion(
    @Param('policyId') policyId: string,
    @Body() dto: CreateKycPolicyVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.createPolicyVersion(policyId, dto, actor.id);
  }

  @Permissions('kyc.read')
  @Get('policy-versions/:versionId')
  getPolicyVersion(@Param('versionId') versionId: string) {
    return this.kyc.getPolicyVersion(versionId);
  }

  @Permissions('kyc.manage')
  @Patch('policy-versions/:versionId')
  updatePolicyDraft(
    @Param('versionId') versionId: string,
    @Body() dto: UpdateKycPolicyVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.updatePolicyDraft(versionId, dto, actor.id);
  }

  @Permissions('kyc.manage')
  @Post('policy-versions/:versionId/publish')
  publishPolicyVersion(
    @Param('versionId') versionId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.publishPolicyVersion(versionId, actor.id);
  }

  @Permissions('kyc.manage')
  @Post('policy-versions/:versionId/retire')
  retirePolicyVersion(
    @Param('versionId') versionId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kyc.retirePolicyVersion(versionId, actor.id);
  }
}
