import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import {
  ConfirmEmailChangeDto,
  ConfirmEmailVerificationDto,
  ForgotPasswordDto,
  RequestEmailChangeDto,
  RequestEmailVerificationDto,
  ResetPasswordDto,
} from './auth-recovery.dto';
import { AuthRecoveryService } from './auth-recovery.service';
import { AllowPasswordChangeRequired } from './password-change-required.decorator';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: AuthRecoveryService,
  ) {}

  @Public()
  @Get('public-config')
  publicConfig() {
    return this.recovery.publicConfig();
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.recovery.forgotPassword(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.recovery.resetPassword(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email-verification/request')
  requestEmailVerification(@Body() dto: RequestEmailVerificationDto) {
    return this.recovery.requestEmailVerification(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email-verification/confirm')
  confirmEmailVerification(@Body() dto: ConfirmEmailVerificationDto) {
    return this.recovery.confirmEmailVerification(dto);
  }

  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @Post('email-change/request')
  requestEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.recovery.requestEmailChange(user, dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email-change/confirm')
  confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.recovery.confirmEmailChange(dto);
  }

  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto);
  }

  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user);
  }

  @AllowPasswordChangeRequired()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
