import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../rbac/roles.decorator';
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

/** Member-only genealogy; navigation roots are constrained in the service. */
@Controller('member/genealogy')
@Roles('MEMBER')
export class MemberGenealogyController {
  constructor(private readonly genealogy: GenealogyService) {}

  @Get()
  ownTree(
    @CurrentUser() member: AuthUser,
    @Query('rootUserId', new ParseUUIDPipe({ optional: true })) rootUserId?: string,
  ) {
    return this.genealogy.memberSubtree(member.id, rootUserId);
  }
}
