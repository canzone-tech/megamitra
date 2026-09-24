import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CaptchaModule } from '../captcha/captcha.module';
import { AuthController } from './auth.controller';
import { AuthEmailTemplateController } from './auth-email-template.controller';
import { AuthEmailTemplateService } from './auth-email-template.service';
import { AuthRecoveryService } from './auth-recovery.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { SmtpMailService } from './smtp-mail.service';

@Module({
  imports: [JwtModule.register({}), CaptchaModule],
  controllers: [AuthController, AuthEmailTemplateController],
  providers: [
    AuthService,
    AuthRecoveryService,
    AuthEmailTemplateService,
    SmtpMailService,
    PasswordService,
    JwtAuthGuard,
  ],
  exports: [PasswordService, JwtAuthGuard, AuthRecoveryService],
})
export class AuthModule {}
