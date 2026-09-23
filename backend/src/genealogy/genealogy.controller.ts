import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { AssignPlacementDto, AssignSponsorDto } from './genealogy.dto';
import { GenealogyService } from './genealogy.service';

@Controller('admin/genealogy')
export class GenealogyController {
  constructor(private readonly genealogy: GenealogyService) {}

  @Permissions('genealogy.manage')
  @Post('sponsors')
  assignSponsor(@Body() dto: AssignSponsorDto, @CurrentUser() actor: AuthUser) {
    return this.genealogy.assignSponsor(dto, actor.id);
  }

  @Permissions('genealogy.manage')
  @Post('placements')
  assignPlacement(@Body() dto: AssignPlacementDto, @CurrentUser() actor: AuthUser) {
    return this.genealogy.assignPlacement(dto, actor.id);
  }

  @Permissions('genealogy.read')
  @Get('members/:userId')
  getMember(@Param('userId') userId: string) {
    return this.genealogy.getMember(userId);
  }
}
