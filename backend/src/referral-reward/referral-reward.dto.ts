import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ReferralRewardMode, ReferralRoundingMode } from '../generated/prisma/enums';
import {
  REFERRAL_REFUND_HANDLING_MODES,
  type ReferralRefundHandlingMode,
} from './referral-refund-rule.service';

export class CreateReferralRewardPolicyDto {
  @IsString()
  @Length(2, 50)
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateReferralRewardPolicyVersionDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsEnum(ReferralRewardMode)
  rewardMode!: ReferralRewardMode;

  @IsOptional()
  @IsNumberString()
  fixedAmount?: string;

  @IsOptional()
  @IsNumberString()
  percentageRate?: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsEnum(ReferralRoundingMode)
  roundingMode!: ReferralRoundingMode;

  @IsOptional()
  @IsNumberString()
  minimumRewardAmount?: string;

  @IsOptional()
  @IsNumberString()
  maximumRewardAmount?: string;

  @IsOptional()
  @IsObject()
  eligibilityRules?: Record<string, unknown>;
}

export class UpdateReferralRewardPolicyVersionDto {
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsEnum(ReferralRewardMode) rewardMode?: ReferralRewardMode;
  @IsOptional() @IsNumberString() fixedAmount?: string;
  @IsOptional() @IsNumberString() percentageRate?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currencyCode?: string;
  @IsOptional() @IsEnum(ReferralRoundingMode) roundingMode?: ReferralRoundingMode;
  @IsOptional() @IsNumberString() minimumRewardAmount?: string;
  @IsOptional() @IsNumberString() maximumRewardAmount?: string;
  @IsOptional() @IsObject() eligibilityRules?: Record<string, unknown>;
}

export class ConfigureReferralRefundRuleDto {
  @IsIn(REFERRAL_REFUND_HANDLING_MODES)
  mode!: ReferralRefundHandlingMode;
}

export class CreateReferralRewardEventDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  referredUserId!: string;

  @IsUUID()
  policyVersionId!: string;

  @IsNumberString()
  basisAmount!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
