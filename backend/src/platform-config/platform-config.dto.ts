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
