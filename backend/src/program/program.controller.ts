import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  ConfirmProgramPaymentAttemptDto,
  CreateProgramDto,
  CreateProgramEnrollmentDto,
  CreateProgramPaymentAttemptDto,
  CreateProgramRefundDto,
  CreateProgramVersionDto,
  FailProgramPaymentAttemptDto,
  UpdateProgramVersionDto,
} from './program.dto';
import { ProgramEnrollmentService } from './program-enrollment.service';
import { ProgramPaymentService } from './program-payment.service';
import { ProgramPolicyService } from './program-policy.service';

@Controller('admin/programs')
export class ProgramPolicyController {
  constructor(private readonly programs: ProgramPolicyService) {}

  @Permissions('program.manage')
  @Post()
  createProgram(@Body() dto: CreateProgramDto, @CurrentUser() actor: AuthUser) {
    return this.programs.createProgram(dto, actor.id);
  }

  @Permissions('program.read')
  @Get()
  listPrograms() {
    return this.programs.listPrograms();
  }

  @Permissions('program.manage')
  @Post(':programId/versions')
  createVersion(
    @Param('programId') programId: string,
    @Body() dto: CreateProgramVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.programs.createVersion(programId, dto, actor.id);
  }

  @Permissions('program.read')
  @Get('versions/:versionId')
  getVersion(@Param('versionId') versionId: string) {
    return this.programs.getVersion(versionId);
  }

  @Permissions('program.manage')
  @Patch('versions/:versionId')
  updateVersion(
    @Param('versionId') versionId: string,
    @Body() dto: UpdateProgramVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.programs.updateDraft(versionId, dto, actor.id);
  }

  @Permissions('program.manage')
  @Post('versions/:versionId/publish')
  publish(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.programs.publish(versionId, actor.id);
  }

  @Permissions('program.manage')
  @Post('versions/:versionId/retire')
  retire(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.programs.retire(versionId, actor.id);
  }
}

@Controller('admin/program-enrollments')
export class ProgramEnrollmentController {
  constructor(private readonly enrollments: ProgramEnrollmentService) {}

  @Permissions('program.enrollment.manage')
  @Post()
  createEnrollment(
    @Body() dto: CreateProgramEnrollmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.enrollments.createEnrollment(dto, actor.id);
  }

  @Permissions('program.enrollment.read')
  @Get(':id')
  getEnrollment(@Param('id') id: string) {
    return this.enrollments.getEnrollment(id);
  }

  @Permissions('program.enrollment.read')
  @Get('users/:userId/history')
  listUserEnrollments(@Param('userId') userId: string) {
    return this.enrollments.listUserEnrollments(userId);
  }
}

@Controller('admin/program-payments')
export class ProgramPaymentController {
  constructor(private readonly payments: ProgramPaymentService) {}

  @Permissions('program.payment.manage')
  @Post('attempts')
  createAttempt(
    @Body() dto: CreateProgramPaymentAttemptDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.createAttempt(dto, actor.id);
  }

  @Permissions('program.payment.manage')
  @Post('attempts/:attemptId/confirm')
  confirmAttempt(
    @Param('attemptId') attemptId: string,
    @Body() dto: ConfirmProgramPaymentAttemptDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.confirmAttempt(attemptId, dto, actor.id);
  }

  @Permissions('program.payment.manage')
  @Post('attempts/:attemptId/fail')
  failAttempt(
    @Param('attemptId') attemptId: string,
    @Body() dto: FailProgramPaymentAttemptDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payments.failAttempt(attemptId, dto, actor.id);
  }

  @Permissions('program.payment.read')
  @Get('attempts/:id')
  getAttempt(@Param('id') id: string) {
    return this.payments.getAttempt(id);
  }

  @Permissions('program.payment.read')
  @Get('records/:id')
  getPayment(@Param('id') id: string) {
    return this.payments.getPayment(id);
  }

  @Permissions('program.refund.manage')
  @Post('refunds')
  createRefund(@Body() dto: CreateProgramRefundDto, @CurrentUser() actor: AuthUser) {
    return this.payments.createRefund(dto, actor.id);
  }

  @Permissions('program.refund.read')
  @Get('refunds/:id')
  getRefund(@Param('id') id: string) {
    return this.payments.getRefund(id);
  }
}
