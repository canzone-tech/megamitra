import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreatePresentationVersionDto,
  PresentationListQueryDto,
  PresentationRuntimeQueryDto,
  UpdatePresentationVersionDto,
} from './presentation.dto';
import { PresentationService } from './presentation.service';

@Controller('presentation')
export class PresentationRuntimeController {
  constructor(private readonly presentation: PresentationService) {}

  @Public()
  @Get('runtime')
  runtime(@Query() query: PresentationRuntimeQueryDto) {
    return this.presentation.runtime(query.surface);
  }
}

@Controller('admin/presentation')
export class PresentationAdminController {
  constructor(private readonly presentation: PresentationService) {}

  @Permissions('presentation.read')
  @Get('definitions')
  definitions(@Query() query: PresentationListQueryDto) {
    return this.presentation.listDefinitions(query);
  }

  @Permissions('presentation.read')
  @Get('definitions/:definitionId/versions')
  versions(@Param('definitionId') definitionId: string) {
    return this.presentation.listVersions(definitionId);
  }

  @Permissions('presentation.read')
  @Get('versions/:versionId')
  version(@Param('versionId') versionId: string) {
    return this.presentation.getVersion(versionId);
  }

  @Permissions('presentation.manage')
  @Post('definitions/:definitionId/versions')
  createVersion(
    @Param('definitionId') definitionId: string,
    @Body() dto: CreatePresentationVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.presentation.createVersion(definitionId, actor.id, dto.copyFromVersionId);
  }

  @Permissions('presentation.manage')
  @Put('versions/:versionId')
  updateVersion(
    @Param('versionId') versionId: string,
    @Body() dto: UpdatePresentationVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.presentation.updateDraft(versionId, actor.id, dto.content);
  }

  @Permissions('presentation.manage')
  @Post('versions/:versionId/publish')
  publish(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.presentation.publish(versionId, actor.id);
  }

  @Permissions('presentation.manage')
  @Post('versions/:versionId/retire')
  retire(@Param('versionId') versionId: string, @CurrentUser() actor: AuthUser) {
    return this.presentation.retire(versionId, actor.id);
  }
}
