import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { Permissions } from '../rbac/permissions.decorator';
import { RankAchievementService } from './rank-achievement.service';

@Controller('admin/rank-achievements')
export class RankAchievementController {
  constructor(private readonly ranks: RankAchievementService) {}

  @Permissions('program.read')
  @Get('overview')
  overview() {
    return this.ranks.overview();
  }

  @Permissions('program.read')
  @Get('policies')
  policies() {
    return this.ranks.listPolicies();
  }

  @Permissions('program.manage')
  @Post('policies')
  createDraft(
    @Body() body: { programVersionId?: string; tiers?: unknown },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ranks.createDraft(String(body.programVersionId ?? ''), body.tiers, actor.id);
  }

  @Permissions('program.manage')
  @Patch('policies/:policyId')
  updateDraft(@Param('policyId') policyId: string, @Body() body: { tiers?: unknown }) {
    return this.ranks.updateDraft(policyId, body.tiers);
  }

  @Permissions('program.manage')
  @Post('policies/:policyId/publish')
  publish(@Param('policyId') policyId: string, @CurrentUser() actor: AuthUser) {
    return this.ranks.publish(policyId, actor.id);
  }

  @Permissions('program.read')
  @Get('members/:userId')
  memberHistory(@Param('userId') userId: string) {
    return this.ranks.history(userId);
  }

  @Permissions('draw.fulfillment.manage')
  @Post('trips/:achievementId/fulfill')
  fulfillTrip(
    @Param('achievementId') achievementId: string,
    @Body() body: { reference?: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ranks.fulfillTrip(achievementId, String(body.reference ?? ''), actor.id);
  }
}
