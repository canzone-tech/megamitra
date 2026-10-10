import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RegistrationEpinPreviewDto,
} from './auth.dto';
import {
  ConfirmEmailChangeDto,
  ConfirmEmailVerificationDto,
  ForgotPasswordDto,
  RequestEmailChangeDto,
  RequestEmailVerificationDto,
  ResetPasswordDto,
} from './auth-recovery.dto';
import { AuthRecoveryService } from './auth-recovery.service';
import { MemberRegistrationService } from './member-registration.service';
import { Roles } from '../rbac/roles.decorator';
import { AllowPasswordChangeRequired } from './password-change-required.decorator';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: AuthRecoveryService,
    private readonly memberRegistration: MemberRegistrationService,
  ) {}

  @Public()
  @Get('public-config')
  publicConfig() {
    return this.recovery.publicConfig();
  }

  @Public()
  @Get('registration-config')
  registrationConfig() {
    return this.memberRegistration.registrationConfig();
  }

  @Public()
  @Get('sponsor')
  sponsor(@Query('reference') reference?: string) {
    return this.memberRegistration.sponsor(reference ?? '');
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('registration-epin-preview')
  registrationEpinPreview(@Body() dto: RegistrationEpinPreviewDto) {
    return this.memberRegistration.registrationEpinPreview(dto.epin);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.memberRegistration.register(dto);
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

  @Roles('SUPER_ADMIN')
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
