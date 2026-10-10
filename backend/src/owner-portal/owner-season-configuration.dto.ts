import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const OWNER_REFERRAL_BASIS_MODES = [
  'PAYMENT_AMOUNT',
  'REGISTRATION_ALLOCATION',
  'INSTALLMENT_ALLOCATION',
  'TOTAL_APPLIED_AMOUNT',
] as const;

export const OWNER_ALLOCATION_TYPES = [
  'REGISTRATION_FEE',
  'INSTALLMENT',
  'UNAPPLIED',
] as const;

export const OWNER_DRAW_WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export class OwnerSeasonAdvancedConfigDto {
  @IsNumberString()
  qualifyingUnit!: string;

  @IsNumberString()
  leftVolumePerPair!: string;

  @IsNumberString()
  rightVolumePerPair!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPairCap?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  carryForwardExpiryDays?: number;

  @IsInt()
  @Min(0)
  binaryUnitsPerEvent!: number;

  @IsBoolean()
  referralHookEnabled!: boolean;

  @IsIn(OWNER_REFERRAL_BASIS_MODES)
  referralBasisMode!: (typeof OWNER_REFERRAL_BASIS_MODES)[number];

  @IsBoolean()
  drawEligibilityHookEnabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  drawStartMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  drawWeekOfMonth?: number;

  @IsOptional()
  @IsIn(OWNER_DRAW_WEEKDAYS)
  drawWeekday?: (typeof OWNER_DRAW_WEEKDAYS)[number];

  @IsOptional()
  @IsNumberString()
  minimumPaymentAmount?: string;

  @IsOptional()
  @IsNumberString()
  minimumRegistrationAllocation?: string;

  @IsOptional()
  @IsNumberString()
  minimumInstallmentAllocation?: string;

  @IsArray()
  @IsIn(OWNER_ALLOCATION_TYPES, { each: true })
  requiredAllocationTypes!: Array<(typeof OWNER_ALLOCATION_TYPES)[number]>;
}

export class OwnerInstallmentRecoveryPolicyDto {
  @IsBoolean()
  enabled!: boolean;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  reservePercent!: number;
}
