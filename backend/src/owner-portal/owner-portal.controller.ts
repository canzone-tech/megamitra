import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  ApproveOwnerDrawDto,
  ConsumeOwnerAuthCodeDto,
  CreateOwnerMemberDto,
  CreateOwnerNotificationDto,
  CreateOwnerSeasonDto,
  CreateSupportTicketDto,
  FinalizeExternalDrawDto,
  FulfillOwnerWinnerDto,
  GenerateEpinsDto,
  GenerateOwnerAuthCodeDto,
  OwnerSeasonStatusDto,
  PrepareOwnerDrawDto,
  RecordExternalDrawWinnerDto,
  RecordOwnerPaymentDto,
  RevokeEpinDto,
  SaveSeasonPrizesDto,
  SendOwnerNotificationDto,
  UpdateOwnerPortalSettingsDto,
  UpdateOwnerSeasonDto,
  UpdateSupportTicketDto,
  VerifyOwnerWinnerDto,
} from './owner-portal.dto';
import { OwnerPortalCoreService } from './owner-portal-core.service';
import { OwnerPortalDrawWorkflowService } from './owner-portal-draw-workflow.service';
import { OwnerPortalFinanceService } from './owner-portal-finance.service';
import { AssignOwnerPlacementDto } from './owner-portal-placement.dto';
import { OwnerPortalService } from './owner-portal.service';
import { OwnerSeasonAdvancedConfigDto } from './owner-season-configuration.dto';
import { OwnerSeasonConfigurationService } from './owner-season-configuration.service';
import {
  MAX_SEASON_DEPLOYMENT_PACKAGE_BYTES,
  OwnerSeasonDeploymentService,
} from './owner-season-deployment.service';

@Controller('admin/owner-portal')
export class OwnerPortalController {
  constructor(
    private readonly portal: OwnerPortalService,
    private readonly core: OwnerPortalCoreService,
    private readonly drawWorkflow: OwnerPortalDrawWorkflowService,
    private readonly finance: OwnerPortalFinanceService,
    private readonly seasonConfiguration: OwnerSeasonConfigurationService,
    private readonly seasonDeployment: OwnerSeasonDeploymentService,
  ) {}

  @Permissions('operations.read')
  @Get('dashboard')
  dashboard() {
    return this.portal.dashboard();
  }

  @Permissions('users.read')
  @Get('members')
  members(@Query('q') q?: string) {
    return this.core.listMembers(q);
  }

  @Permissions('users.manage')
  @Post('members')
  createMember(@Body() dto: CreateOwnerMemberDto, @CurrentUser() actor: AuthUser) {
    return this.core.createMember(dto, actor.id);
  }

  @Permissions('users.read')
  @Get('members/:userId')
  member(@Param('userId') userId: string) {
    return this.portal.memberDetail(userId);
  }

  @Permissions('genealogy.read')
  @Get('binary/:reference')
  binary(@Param('reference') reference: string) {
    return this.portal.binaryMember(reference);
  }

  @Permissions('genealogy.manage')
  @Post('placements')
  placement(@Body() dto: AssignOwnerPlacementDto, @CurrentUser() actor: AuthUser) {
    return this.core.assignPlacement(
      dto.memberReference,
      dto.parentReference,
      dto.slot,
      actor.id,
    );
  }

  @Permissions('binary.settlement.read')
  @Get('pair-ledger')
  pairLedger(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return this.core.listPairLedger(Number.isFinite(parsed) ? parsed : 100);
  }

  @Permissions('program.read')
  @Get('seasons')
  seasons() {
    return this.portal.listSeasons();
  }

  @Permissions('program.read')
  @Get('seasons/:id')
  season(@Param('id') id: string) {
    return this.portal.getSeason(id);
  }

  @Permissions('program.manage')
  @Post('seasons')
  createSeason(@Body() dto: CreateOwnerSeasonDto, @CurrentUser() actor: AuthUser) {
    return this.seasonConfiguration.createSeason(dto, actor.id);
  }

  @Permissions('program.manage')
  @Put('seasons/:id')
  updateSeason(
    @Param('id') id: string,
    @Body() dto: UpdateOwnerSeasonDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.seasonConfiguration.updateSeason(id, dto, actor.id);
  }

  @Permissions('program.read')
  @Get('seasons/:id/advanced-configuration')
  advancedSeasonConfiguration(@Param('id') id: string) {
    return this.seasonConfiguration.getAdvancedConfiguration(id);
  }

  @Permissions('program.manage')
  @Put('seasons/:id/advanced-configuration')
  updateAdvancedSeasonConfiguration(
    @Param('id') id: string,
    @Body() dto: OwnerSeasonAdvancedConfigDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.seasonConfiguration.updateAdvancedConfiguration(id, dto, actor.id);
  }

  @Permissions('program.manage')
  @Patch('seasons/:id/status')
  seasonStatus(
    @Param('id') id: string,
    @Body() dto: OwnerSeasonStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.seasonConfiguration.changeSeasonStatus(id, dto, actor.id);
  }

  @Permissions('program.manage')
  @Get('seasons/:id/deployment-package')
  exportSeasonDeployment(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.seasonDeployment.exportPackage(id, actor.id);
  }

  @Permissions('program.manage')
  @Post('season-deployment/import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: MAX_SEASON_DEPLOYMENT_PACKAGE_BYTES },
    }),
  )
  importSeasonDeployment(
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          originalname: string;
          mimetype: string;
          size: number;
        }
      | undefined,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.seasonDeployment.importPackage(file, actor.id);
  }

  @Permissions('draw.policy.read')
  @Get('seasons/:id/prizes')
  prizes(@Param('id') id: string) {
    return this.portal.listSeasonPrizes(id);
  }

  @Permissions('draw.policy.manage')
  @Put('seasons/:id/prizes')
  savePrizes(
    @Param('id') id: string,
    @Body() dto: SaveSeasonPrizesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.saveSeasonPrizes(id, dto.prizes, actor.id);
  }

  @Permissions('draw.policy.manage')
  @Post('seasons/:id/prize-media')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  uploadPrizeMedia(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.uploadSeasonPrizeMedia(id, file, actor.id);
  }

  @Permissions('draw.policy.read')
  @Get('prize-media/:mediaId')
  async prizeMedia(@Param('mediaId') mediaId: string) {
    const media = await this.portal.openPrizeMedia(mediaId);
    return new StreamableFile(media.stream, {
      type: media.info.contentType,
      length: media.info.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(media.info.filename)}`,
    });
  }

  @Permissions('draw.execution.read')
  @Get('draws')
  drawRuns(@Query('seasonId') seasonId?: string) {
    return this.portal.listDrawRuns(seasonId);
  }

  @Permissions('draw.execution.read')
  @Get('draws/:id')
  drawRun(@Param('id') id: string) {
    return this.portal.drawRun(id);
  }

  @Permissions('draw.execution.manage')
  @Post('seasons/:id/draws')
  prepareDraw(
    @Param('id') id: string,
    @Body() dto: PrepareOwnerDrawDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.prepareDraw(id, dto, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post('draws/:id/lock-eligibility')
  lockEligibility(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.portal.lockDrawEligibility(id, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post('draws/:id/select-winners')
  selectWinners(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.portal.executeDraw(id, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post('draws/:id/external-winners')
  recordExternalWinner(
    @Param('id') id: string,
    @Body() dto: RecordExternalDrawWinnerDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.recordExternalWinner(id, dto, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Delete('draws/:id/external-winners/:winnerId')
  removeExternalWinner(
    @Param('id') id: string,
    @Param('winnerId') winnerId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.removeExternalWinner(id, winnerId, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post('draws/:id/finalize-external-selection')
  finalizeExternalSelection(
    @Param('id') id: string,
    @Body() dto: FinalizeExternalDrawDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.finalizeExternalDraw(id, dto, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Patch('draws/:id/winners/:winnerId/verify')
  verifyWinner(
    @Param('id') id: string,
    @Param('winnerId') winnerId: string,
    @Body() dto: VerifyOwnerWinnerDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.verifyWinner(id, winnerId, dto, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post('draws/:id/approve')
  approveDraw(
    @Param('id') id: string,
    @Body() dto: ApproveOwnerDrawDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.approveDraw(id, dto, actor.id);
  }

  @Permissions('draw.execution.manage')
  @Post('draws/:id/publish')
  publishDraw(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.drawWorkflow.publishDraw(id, actor.id);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('draws/:id/winners/:winnerId/claim')
  claimWinner(
    @Param('id') id: string,
    @Param('winnerId') winnerId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.claimWinner(id, winnerId, actor.id);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('draws/:id/winners/:winnerId/fulfill')
  fulfillWinner(
    @Param('id') id: string,
    @Param('winnerId') winnerId: string,
    @Body() dto: FulfillOwnerWinnerDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.drawWorkflow.fulfillWinner(id, winnerId, dto, actor.id);
  }

  @Permissions('users.manage')
  @Post('epins')
  generateEpins(@Body() dto: GenerateEpinsDto, @CurrentUser() actor: AuthUser) {
    return this.portal.generateEpins(dto, actor.id);
  }

  @Permissions('users.manage')
  @Get('epins')
  epins(
    @Query('status') status?: string,
    @Query('memberUserId') memberUserId?: string,
    @Query('seasonId') seasonId?: string,
    @Query('pinType') pinType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const paged = [status, memberUserId, seasonId, pinType, page, pageSize].some(
      (value) => value !== undefined,
    );
    return paged
      ? this.finance.listEpinsPage({ status, memberUserId, seasonId, pinType, page, pageSize })
      : this.finance.listEpins();
  }

  @Permissions('users.manage')
  @Post('epins/:id/revoke')
  revokeEpin(
    @Param('id') id: string,
    @Body() dto: RevokeEpinDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.revokeEpin(id, dto, actor.id);
  }

  @Permissions('platform.config.read')
  @Get('auth-code-operators')
  authCodeOperators() {
    return this.portal.listAuthCodeOperators();
  }

  @Permissions('platform.config.manage')
  @Post('auth-codes')
  generateAuthCode(
    @Body() dto: GenerateOwnerAuthCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.generateAuthCode(dto, actor.id);
  }

  @Permissions('platform.config.read')
  @Get('auth-codes')
  authCodes() {
    return this.finance.listAuthCodes();
  }

  @Permissions('platform.config.manage')
  @Post('auth-codes/consume')
  consumeAuthCode(
    @Body() dto: ConsumeOwnerAuthCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.consumeAuthCode(dto, actor.id);
  }

  @Permissions('program.read')
  @Get('payments')
  payments(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return this.finance.listPayments(Number.isFinite(parsed) ? parsed : 100);
  }

  @Permissions('program.read')
  @Get('payments/:id')
  paymentReceipt(@Param('id') id: string) {
    return this.finance.paymentReceipt(id);
  }

  @Permissions('program.payment.manage')
  @Post('payments')
  recordPayment(@Body() dto: RecordOwnerPaymentDto, @CurrentUser() actor: AuthUser) {
    return this.finance.recordPayment(dto, actor.id);
  }

  @Permissions('wallet.read')
  @Get('wallet')
  wallet(@Query('member') member: string, @Query('currency') currency?: string) {
    return this.finance.wallet(member, currency);
  }

  @Permissions('platform.config.manage')
  @Post('notifications')
  notification(
    @Body() dto: CreateOwnerNotificationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.createNotification(dto, actor.id);
  }

  @Permissions('platform.config.read')
  @Get('notifications')
  notifications() {
    return this.portal.listNotifications();
  }

  @Permissions('platform.config.manage')
  @Post('notifications/:id/send')
  sendNotification(
    @Param('id') id: string,
    @Body() dto: SendOwnerNotificationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.sendNotification(id, dto, actor.id);
  }

  @Permissions('users.manage')
  @Post('support')
  support(@Body() dto: CreateSupportTicketDto, @CurrentUser() actor: AuthUser) {
    return this.portal.createSupportTicket(dto, actor.id);
  }

  @Permissions('users.read')
  @Get('support')
  supportTickets() {
    return this.portal.listSupportTickets();
  }

  @Permissions('users.manage')
  @Patch('support/:id')
  updateSupport(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.updateSupportTicket(id, dto, actor.id);
  }

  @Permissions('platform.config.read')
  @Get('settings')
  settings() {
    return this.portal.settings();
  }

  @Permissions('platform.config.manage')
  @Put('settings')
  updateSettings(
    @Body() dto: UpdateOwnerPortalSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.updateSettings(dto, actor.id);
  }

  @Permissions('operations.read')
  @Get('activity')
  activity(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    return this.portal.recentActivity(Number.isFinite(parsed) ? parsed : 50);
  }

  @Permissions('operations.read')
  @Get('reports')
  reports() {
    return this.portal.reportCatalogue().map((report) =>
      report.code === 'BINARY' ? { ...report, name: 'Binary 1:4 Pair Ledger' } : report,
    );
  }
}
