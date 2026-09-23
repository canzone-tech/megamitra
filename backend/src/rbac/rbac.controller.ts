import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from './permissions.decorator';
import { CreateRoleDto, ReplaceRolePermissionsDto } from './rbac.dto';
import { RbacService } from './rbac.service';

@Controller('admin/rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Permissions('rbac.read')
  @Get('permissions')
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Permissions('rbac.read')
  @Get('roles')
  listRoles() {
    return this.rbac.listRoles();
  }

  @Permissions('rbac.manage')
  @Post('roles')
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthUser) {
    return this.rbac.createRole(dto, actor.id);
  }

  @Permissions('rbac.manage')
  @Put('roles/:roleName/permissions')
  replacePermissions(
    @Param('roleName') roleName: string,
    @Body() dto: ReplaceRolePermissionsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rbac.replacePermissions(roleName, dto.permissions, actor.id);
  }
}
