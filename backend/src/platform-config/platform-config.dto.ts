import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PasswordCreationMode,
  UsernameCreationMode,
} from '../generated/prisma/enums';

export class UpdateAuthConfigDto {
  @IsOptional() @IsBoolean() loginWithUsername?: boolean;
  @IsOptional() @IsBoolean() loginWithEmail?: boolean;
  @IsOptional() @IsBoolean() loginWithMobile?: boolean;
  @IsOptional() @IsBoolean() captchaOnLoginEnabled?: boolean;
  @IsOptional() @IsBoolean() captchaOnRegistrationEnabled?: boolean;
  @IsOptional() @IsInt() @Min(30) captchaTtlSeconds?: number;
  @IsOptional() @IsInt() @Min(60) accessTokenTtlSeconds?: number;
  @IsOptional() @IsInt() @Min(300) refreshTokenTtlSeconds?: number;

  @IsOptional() @IsBoolean() passwordResetEnabled?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(1440) passwordResetTokenTtlMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) passwordResetRequestWindowMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) passwordResetMaxRequestsPerWindow?: number;

  @IsOptional() @IsBoolean() emailVerificationEnabled?: boolean;
  @IsOptional() @IsBoolean() emailVerificationRequiredForLogin?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(10080) emailVerificationTokenTtlMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) emailVerificationRequestWindowMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) emailVerificationMaxRequestsPerWindow?: number;
  @IsOptional() @IsBoolean() emailChangeEnabled?: boolean;
}

export class UpdateSecurityConfigDto {
  @IsOptional() @IsInt() @Min(1) idleTimeoutMinutes?: number;
  @IsOptional() @IsInt() @Min(1) absoluteSessionTimeoutMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxActiveSessions?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxFailedLoginAttempts?: number;
  @IsOptional() @IsInt() @Min(1) lockoutMinutes?: number;
  @IsOptional() @IsInt() @Min(8) @Max(256) passwordMinLength?: number;
  @IsOptional() @IsInt() @Min(8) @Max(256) passwordMaxLength?: number;
  @IsOptional() @IsBoolean() refreshTokenRotationEnabled?: boolean;
}

export class UpdateRegistrationConfigDto {
  @IsOptional() @IsBoolean() publicRegistrationEnabled?: boolean;
  @IsOptional() @IsBoolean() emailRequired?: boolean;
  @IsOptional() @IsBoolean() mobileRequired?: boolean;
  @IsOptional() @IsEnum(PasswordCreationMode) passwordMode?: PasswordCreationMode;
  @IsOptional() @IsEnum(UsernameCreationMode) usernameMode?: UsernameCreationMode;
  @IsOptional() @IsBoolean() usernamePrefixEnabled?: boolean;
  @IsOptional() @IsString() usernamePrefix?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) defaultRoleName?: string;
  @IsOptional() @IsBoolean() allowMultipleAccountsPerEmail?: boolean;
  @IsOptional() @IsBoolean() allowMultipleAccountsPerMobile?: boolean;
}
