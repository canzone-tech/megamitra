import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { SubmitKycDto } from './kyc.dto';
import { KycService } from './kyc.service';

@Controller('kyc')
export class KycMemberController {
  constructor(private readonly kyc: KycService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.kyc.getMemberKyc(user.id);
  }

  @Post('me/submissions')
  submit(@Body() dto: SubmitKycDto, @CurrentUser() user: AuthUser) {
    return this.kyc.submit(user.id, dto);
  }
}
