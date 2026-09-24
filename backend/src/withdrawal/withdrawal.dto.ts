import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const WITHDRAWAL_DESTINATION_TYPES = ['UPI', 'BANK_REFERENCE', 'OTHER'] as const;
export const WITHDRAWAL_REQUEST_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'PAYOUT_FAILED',
  'PAID',
  'CANCELLED',
] as const;
export const WITHDRAWAL_FEE_MODES = ['FIXED', 'PERCENTAGE'] as const;

export type WithdrawalDestinationType = (typeof WITHDRAWAL_DESTINATION_TYPES)[number];
export type WithdrawalRequestStatus = (typeof WITHDRAWAL_REQUEST_STATUSES)[number];
export type WithdrawalFeeMode = (typeof WITHDRAWAL_FEE_MODES)[number];

export class CreateWithdrawalDestinationDto {
  @IsIn(WITHDRAWAL_DESTINATION_TYPES)
  type!: WithdrawalDestinationType;

  @IsString()
  @Length(2, 120)
  label!: string;

  @IsString()
  @Length(2, 191)
  reference!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateWithdrawalRequestDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  destinationId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class WithdrawalMemberQueryDto {
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode?: string;
}

export class ListWithdrawalRequestsDto {
  @IsOptional()
  @Matches(/^\d+$/)
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;

  @IsOptional()
  @IsIn(WITHDRAWAL_REQUEST_STATUSES)
  status?: WithdrawalRequestStatus;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class WithdrawalReasonDto {
  @IsString()
  @Length(2, 1000)
  reason!: string;
}

export class StartWithdrawalPayoutDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsString()
  @Length(2, 100)
  provider!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  providerReference?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ConfirmWithdrawalPayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  providerReference?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class FailWithdrawalPayoutDto {
  @IsString()
  @Length(2, 1000)
  reason!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateWithdrawalPolicyDto {
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

  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateWithdrawalPolicyVersionDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  minAmount!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxAmount!: number;

  @IsIn(WITHDRAWAL_FEE_MODES)
  feeMode!: WithdrawalFeeMode;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  feeValue!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumFee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumFee?: number;

  @IsBoolean()
  kycRequired!: boolean;

  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  @Max(100)
  maxPendingRequests!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  dailyAmountLimit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monthlyAmountLimit?: number;

  @IsArray()
  @ArrayMaxSize(10)
  allowedDestinationTypes!: string[];

  @IsOptional()
  @IsObject()
  reviewRules?: Record<string, unknown>;
}

export class UpdateWithdrawalPolicyVersionDto {
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  minAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxAmount?: number;

  @IsOptional()
  @IsIn(WITHDRAWAL_FEE_MODES)
  feeMode?: WithdrawalFeeMode;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  feeValue?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumFee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumFee?: number;

  @IsOptional()
  @IsBoolean()
  kycRequired?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  @Max(100)
  maxPendingRequests?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  dailyAmountLimit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monthlyAmountLimit?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  allowedDestinationTypes?: string[];

  @IsOptional()
  @IsObject()
  reviewRules?: Record<string, unknown>;
}
