import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BinaryPolicyModule } from './binary-policy/binary-policy.module';
import { BinarySettlementModule } from './binary-settlement/binary-settlement.module';
import { BinaryUnitModule } from './binary-unit/binary-unit.module';
import { BinaryVolumeModule } from './binary-volume/binary-volume.module';
import { CaptchaModule } from './captcha/captcha.module';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { GenealogyModule } from './genealogy/genealogy.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { LuckyDrawModule } from './lucky-draw/lucky-draw.module';
import { OperationalReadModule } from './operations/operational-read.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { ProgramModule } from './program/program.module';
import { RbacModule } from './rbac/rbac.module';
import { RedisModule } from './redis/redis.module';
import { ReferralRewardModule } from './referral-reward/referral-reward.module';
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
    BinaryUnitModule,
    BinarySettlementModule,
    ReferralRewardModule,
    ProgramModule,
    LuckyDrawModule,
    OperationalReadModule,
    LedgerModule,
    HealthModule,
  ],
})
export class AppModule {}
