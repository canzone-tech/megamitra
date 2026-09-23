import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BinaryPolicyModule } from './binary-policy/binary-policy.module';
import { BinaryVolumeModule } from './binary-volume/binary-volume.module';
import { CaptchaModule } from './captcha/captcha.module';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { GenealogyModule } from './genealogy/genealogy.module';
import { HealthModule } from './health/health.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { RbacModule } from './rbac/rbac.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: false,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    PrismaModule,
    RedisModule,
    AuditModule,
    CaptchaModule,
    AuthModule,
    RbacModule,
    UsersModule,
    PlatformConfigModule,
    GenealogyModule,
    BinaryPolicyModule,
    BinaryVolumeModule,
    HealthModule,
  ],
})
export class AppModule {}
