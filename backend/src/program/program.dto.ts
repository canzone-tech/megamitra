import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ProgramIntervalUnit } from '../generated/prisma/enums';

export class CreateProgramDto {
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

export class CreateProgramVersionDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsNumberString()
  registrationFee!: string;

  @IsNumberString()
  installmentAmount!: string;

  @IsInt()
  @Min(0)
  installmentCount!: number;

  @IsEnum(ProgramIntervalUnit)
  installmentIntervalUnit!: ProgramIntervalUnit;

  @IsInt()
  @Min(1)
  installmentIntervalCount!: number;

  @IsInt()
  @Min(0)
  firstInstallmentOffsetDays!: number;

  @IsInt()
  @Min(0)
  gracePeriodDays!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveEnrollmentsPerUser?: number;

  @IsBoolean()
  partialPaymentsAllowed!: boolean;

  @IsBoolean()
  overpaymentsAllowed!: boolean;

  @IsOptional()
  @IsObject()
  eligibilityRules?: Record<string, unknown>;
}

export class UpdateProgramVersionDto {
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currencyCode?: string;
  @IsOptional() @IsNumberString() registrationFee?: string;
  @IsOptional() @IsNumberString() installmentAmount?: string;
  @IsOptional() @IsInt() @Min(0) installmentCount?: number;
  @IsOptional() @IsEnum(ProgramIntervalUnit) installmentIntervalUnit?: ProgramIntervalUnit;
  @IsOptional() @IsInt() @Min(1) installmentIntervalCount?: number;
  @IsOptional() @IsInt() @Min(0) firstInstallmentOffsetDays?: number;
  @IsOptional() @IsInt() @Min(0) gracePeriodDays?: number;
  @IsOptional() @IsInt() @Min(1) maxActiveEnrollmentsPerUser?: number;
  @IsOptional() @IsBoolean() partialPaymentsAllowed?: boolean;
  @IsOptional() @IsBoolean() overpaymentsAllowed?: boolean;
  @IsOptional() @IsObject() eligibilityRules?: Record<string, unknown>;
}

export class CreateProgramEnrollmentDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  userId!: string;

  @IsUUID()
  programVersionId!: string;

  @IsISO8601()
  enrolledAt!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  enrollmentDate!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateProgramPaymentAttemptDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  enrollmentId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsISO8601()
  initiatedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  providerReference?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ConfirmProgramPaymentAttemptDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class FailProgramPaymentAttemptDto {
  @IsISO8601()
  finalizedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateProgramRefundDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  paymentRecordId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
