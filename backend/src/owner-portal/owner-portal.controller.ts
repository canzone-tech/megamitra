import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
  FulfillOwnerWinnerDto,
  GenerateEpinsDto,
  GenerateOwnerAuthCodeDto,
  OwnerSeasonStatusDto,
  PrepareOwnerDrawDto,
  RecordOwnerPaymentDto,
  RevokeEpinDto,
  SaveSeasonPrizesDto,
  SendOwnerNotificationDto,
  UpdateOwnerPortalSettingsDto,
  UpdateOwnerSeasonDto,
  UpdateSupportTicketDto,
  VerifyOwnerWinnerDto,
} from './owner-portal.dto';
import { OwnerPortalDrawWorkflowService } from './owner-portal-draw-workflow.service';
import { AssignOwnerPlacementDto } from './owner-portal-placement.dto';
import { OwnerPortalService } from './owner-portal.service';

@Controller('admin/owner-portal')
export class OwnerPortalController {
  constructor(
    private readonly portal: OwnerPortalService,
    private readonly drawWorkflow: OwnerPortalDrawWorkflowService,
  ) {}

  @Permissions('operations.read')
  @Get('dashboard')
  dashboard() {
    return this.portal.dashboard();
  }

  @Permissions('users.read')
  @Get('members')
  members(@Query('q') q?: string) {
    return this.portal.listMembers(q);
  }

  @Permissions('users.manage')
  @Post('members')
  createMember(@Body() dto: CreateOwnerMemberDto, @CurrentUser() actor: AuthUser) {
    return this.portal.createMember(dto, actor.id);
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
    return this.portal.assignPlacement(
      dto.memberReference,
      dto.parentReference,
      dto.side,
      actor.id,
    );
  }

  @Permissions('binary.settlement.read')
  @Get('pair-ledger')
  pairLedger(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return this.portal.listPairLedger(Number.isFinite(parsed) ? parsed : 100);
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
    return this.portal.createSeason(dto, actor.id);
  }

  @Permissions('program.manage')
  @Put('seasons/:id')
  updateSeason(
    @Param('id') id: string,
    @Body() dto: UpdateOwnerSeasonDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.updateSeason(id, dto, actor.id);
  }

  @Permissions('program.manage')
  @Patch('seasons/:id/status')
  seasonStatus(
    @Param('id') id: string,
    @Body() dto: OwnerSeasonStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.changeSeasonStatus(id, dto, actor.id);
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
  @Patch('draws/:id/winners/:winnerId/verify')
  verifyWinner(
    @Param('id') id: string,
    @Param('winnerId') winnerId: string,
    @Body() dto: VerifyOwnerWinnerDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.verifyWinner(id, winnerId, dto, actor.id);
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

  @Permissions('users.read')
  @Get('epins')
  epins() {
    return this.portal.listEpins();
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
    return this.portal.listAuthCodes();
  }

  @Permissions('platform.config.manage')
  @Post('auth-codes/consume')
  consumeAuthCode(
    @Body() dto: ConsumeOwnerAuthCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.portal.consumeAuthCode(dto, actor.id);
  }

  @Permissions('program.payment.manage')
  @Post('payments')
  recordPayment(@Body() dto: RecordOwnerPaymentDto, @CurrentUser() actor: AuthUser) {
    return this.portal.recordPayment(dto, actor.id);
  }

  @Permissions('wallet.read')
  @Get('wallet')
  wallet(@Query('member') member: string, @Query('currency') currency?: string) {
    return this.portal.wallet(member, currency ?? 'INR');
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
    return this.portal.reportCatalogue();
  }
}
