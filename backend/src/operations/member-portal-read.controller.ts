import { Controller, Get, UseInterceptors } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../rbac/roles.decorator';
import { MemberPortalReadService } from './member-portal-read.service';
import { OperationalJsonSafeInterceptor } from './operational-json-safe.interceptor';

@Controller('member')
@Roles('MEMBER')
@UseInterceptors(OperationalJsonSafeInterceptor)
export class MemberPortalReadController {
  constructor(private readonly portal: MemberPortalReadService) {}

  @Get('portal-overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.portal.overview(user.id);
  }
}
