import { Body, Controller, Get, Patch } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { UpdateAuthConfigDto, UpdateRegistrationConfigDto, UpdateSecurityConfigDto } from './platform-config.dto';
import { PlatformConfigService } from './platform-config.service';

@Controller('admin/platform-config')
export class PlatformConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Permissions('platform.config.read')
  @Get()
  getAll() {
    return this.config.getAll();
  }

  @Permissions('platform.config.manage')
  @Patch('auth')
  updateAuth(@Body() dto: UpdateAuthConfigDto, @CurrentUser() actor: AuthUser) {
    return this.config.updateAuth(dto, actor.id);
  }

  @Permissions('platform.config.manage')
  @Patch('security')
  updateSecurity(@Body() dto: UpdateSecurityConfigDto, @CurrentUser() actor: AuthUser) {
    return this.config.updateSecurity(dto, actor.id);
  }

  @Permissions('platform.config.manage')
  @Patch('registration')
  updateRegistration(@Body() dto: UpdateRegistrationConfigDto, @CurrentUser() actor: AuthUser) {
    return this.config.updateRegistration(dto, actor.id);
  }
}
