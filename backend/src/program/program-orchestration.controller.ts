import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateProgramEventPolicyDto,
  ProcessProgramBusinessEventDto,
  UpdateProgramEventPolicyDto,
} from './program-orchestration.dto';
import { ProgramOrchestrationService } from './program-orchestration.service';

@Controller('admin/program-orchestration')
export class ProgramOrchestrationController {
  constructor(private readonly orchestration: ProgramOrchestrationService) {}

  @Permissions('program.orchestration.manage')
  @Post('policies')
  createPolicy(@Body() dto: CreateProgramEventPolicyDto, @CurrentUser() actor: AuthUser) {
    return this.orchestration.createPolicy(dto, actor.id);
  }

  @Permissions('program.orchestration.read')
  @Get('policies')
  listPolicies(@Query('programVersionId') programVersionId?: string) {
    return this.orchestration.listPolicies(programVersionId);
  }

  @Permissions('program.orchestration.read')
  @Get('policies/:id')
  getPolicy(@Param('id') id: string) {
    return this.orchestration.getPolicy(id);
  }

  @Permissions('program.orchestration.manage')
  @Patch('policies/:id')
  updatePolicy(
    @Param('id') id: string,
    @Body() dto: UpdateProgramEventPolicyDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orchestration.updateDraft(id, dto, actor.id);
  }

  @Permissions('program.orchestration.manage')
  @Post('policies/:id/publish')
  publishPolicy(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.orchestration.publish(id, actor.id);
  }

  @Permissions('program.orchestration.manage')
  @Post('policies/:id/retire')
  retirePolicy(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.orchestration.retire(id, actor.id);
  }

  @Permissions('program.orchestration.manage')
  @Post('events/:eventId/process')
  processEvent(
    @Param('eventId') eventId: string,
    @Body() _dto: ProcessProgramBusinessEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orchestration.processEvent(eventId, actor.id);
  }

  @Permissions('program.orchestration.manage')
  @Post('process-pending')
  processPending(@Query('limit') limit: string | undefined, @CurrentUser() actor: AuthUser) {
    const parsed = limit ? Number.parseInt(limit, 10) : 25;
    return this.orchestration.processPending(actor.id, Number.isFinite(parsed) ? parsed : 25);
  }

  @Permissions('program.orchestration.read')
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.orchestration.getRun(id);
  }

  @Permissions('program.orchestration.read')
  @Get('referral-hooks/:id')
  getReferralHook(@Param('id') id: string) {
    return this.orchestration.getReferralHook(id);
  }

  @Permissions('program.orchestration.read')
  @Get('draw-hooks/:id')
  getDrawHook(@Param('id') id: string) {
    return this.orchestration.getDrawHook(id);
  }
}
