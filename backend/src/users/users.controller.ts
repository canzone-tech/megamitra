import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateManagedUserDto,
  ReplaceUserRolesDto,
  UpdateUserStatusDto,
} from './users.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Permissions('users.read')
  @Get()
  list(@Query('q') q?: string) {
    return this.users.list(q);
  }

  @Permissions('users.manage')
  @Post()
  create(@Body() dto: CreateManagedUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.createManaged(dto, actor.id);
  }

  @Permissions('users.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Permissions('users.manage')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.updateStatus(id, dto.status, actor.id);
  }

  @Permissions('users.roles.manage')
  @Put(':id/roles')
  replaceRoles(
    @Param('id') id: string,
    @Body() dto: ReplaceUserRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.replaceRoles(id, dto.roles, actor.id);
  }
}
