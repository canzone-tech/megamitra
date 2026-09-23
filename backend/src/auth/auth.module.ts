import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CaptchaModule } from '../captcha/captcha.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';

@Module({
  imports: [JwtModule.register({}), CaptchaModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard],
  exports: [PasswordService, JwtAuthGuard],
})
export class AuthModule {}
