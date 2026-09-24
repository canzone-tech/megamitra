import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { CurrentUser } from './current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  AuthEmailTemplatePurposeDto,
  CreateAuthEmailTemplateVersionDto,
  UpdateAuthEmailTemplateVersionDto,
} from './auth-email-template.dto';
import { AuthEmailTemplateService } from './auth-email-template.service';

@Controller('admin/auth-email-templates')
export class AuthEmailTemplateController {
  constructor(private readonly templates: AuthEmailTemplateService) {}

  @Permissions('auth.email-template.read')
  @Get()
  list(@Query('purpose') purpose?: AuthEmailTemplatePurposeDto) {
    return this.templates.list(purpose);
  }

  @Permissions('auth.email-template.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.get(id);
  }

  @Permissions('auth.email-template.manage')
  @Post()
  create(
    @Body() dto: CreateAuthEmailTemplateVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.templates.create(dto, actor.id);
  }

  @Permissions('auth.email-template.manage')
  @Patch(':id')
  updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateAuthEmailTemplateVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.templates.updateDraft(id, dto, actor.id);
  }

  @Permissions('auth.email-template.manage')
  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.templates.publish(id, actor.id);
  }

  @Permissions('auth.email-template.manage')
  @Post(':id/retire')
  retire(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.templates.retire(id, actor.id);
  }
}
