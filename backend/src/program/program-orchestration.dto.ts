import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export const PROGRAM_EVENT_TRIGGER_TYPES = [
  'ENROLLMENT_CREATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_FAILED',
  'REFUND_CONFIRMED',
  'ENROLLMENT_COMPLETED',
  'ENROLLMENT_REOPENED',
] as const;

export const REFERRAL_BASIS_MODES = [
  'PAYMENT_AMOUNT',
  'REGISTRATION_ALLOCATION',
  'INSTALLMENT_ALLOCATION',
  'TOTAL_APPLIED_AMOUNT',
] as const;

export type ProgramEventTriggerType = (typeof PROGRAM_EVENT_TRIGGER_TYPES)[number];
export type ReferralBasisMode = (typeof REFERRAL_BASIS_MODES)[number];

export class CreateProgramEventPolicyDto {
  @IsUUID()
  programVersionId!: string;

  @IsIn(PROGRAM_EVENT_TRIGGER_TYPES)
  triggerType!: ProgramEventTriggerType;

  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsUUID()
  binaryPlanVersionId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  binaryUnitsPerEvent?: number;

  @IsOptional()
  @IsBoolean()
  referralHookEnabled?: boolean;

  @IsOptional()
  @IsUUID()
  referralPolicyVersionId?: string;

  @IsOptional()
  @IsIn(REFERRAL_BASIS_MODES)
  referralBasisMode?: ReferralBasisMode;

  @IsOptional()
  @IsBoolean()
  drawEligibilityHookEnabled?: boolean;

  @IsOptional()
  @IsObject()
  eligibilityRules?: Record<string, unknown> | null;
}

export class UpdateProgramEventPolicyDto {
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsUUID() binaryPlanVersionId?: string;
  @IsOptional() @IsInt() @Min(0) binaryUnitsPerEvent?: number;
  @IsOptional() @IsBoolean() referralHookEnabled?: boolean;
  @IsOptional() @IsUUID() referralPolicyVersionId?: string;
  @IsOptional() @IsIn(REFERRAL_BASIS_MODES) referralBasisMode?: ReferralBasisMode;
  @IsOptional() @IsBoolean() drawEligibilityHookEnabled?: boolean;
  @IsOptional() @IsObject() eligibilityRules?: Record<string, unknown> | null;
}

export class ProcessProgramBusinessEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
