import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CaptchaModule } from '../captcha/captcha.module';
import { GenealogyModule } from '../genealogy/genealogy.module';
import { RolesGuard } from '../rbac/roles.guard';
import { AuthController } from './auth.controller';
import { AuthEmailTemplateController } from './auth-email-template.controller';
import { AuthEmailTemplateService } from './auth-email-template.service';
import { AuthRecoveryService } from './auth-recovery.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MemberRegistrationService } from './member-registration.service';
import { PasswordService } from './password.service';
import { SmtpMailService } from './smtp-mail.service';
import { SuperAdminLifecycleService } from './super-admin-lifecycle.service';

@Module({
  imports: [JwtModule.register({}), CaptchaModule, GenealogyModule],
  controllers: [AuthController, AuthEmailTemplateController],
  providers: [
    AuthService,
    AuthRecoveryService,
    AuthEmailTemplateService,
    SmtpMailService,
    PasswordService,
    SuperAdminLifecycleService,
    JwtAuthGuard,
    RolesGuard,
    MemberRegistrationService,
  ],
  exports: [
    PasswordService,
    SuperAdminLifecycleService,
    JwtAuthGuard,
    RolesGuard,
    AuthRecoveryService,
  ],
})
export class AuthModule {}
