import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ClaimEntitlementDto } from './entitlement.dto';
import { EntitlementService } from './entitlement.service';

@Controller('entitlements')
export class EntitlementMemberController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.entitlements.getMine(user.id);
  }

  @Post('me/:id/claim')
  claim(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ClaimEntitlementDto,
  ) {
    return this.entitlements.claimMine(user.id, id, dto);
  }
}
