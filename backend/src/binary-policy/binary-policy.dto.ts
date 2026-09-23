import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBinaryPlanDto {
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

export class CreateBinaryPlanVersionDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsNumberString()
  qualifyingUnit!: string;

  @IsNumberString()
  leftVolumePerPair!: string;

  @IsNumberString()
  rightVolumePerPair!: string;

  @IsNumberString()
  pairPayoutAmount!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyPairCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPairCap?: number;

  @IsBoolean()
  carryForwardEnabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  carryForwardExpiryDays?: number;

  @IsOptional()
  @IsObject()
  qualificationRules?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  settlementRules?: Record<string, unknown>;
}

export class UpdateBinaryPlanVersionDto {
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsNumberString() qualifyingUnit?: string;
  @IsOptional() @IsNumberString() leftVolumePerPair?: string;
  @IsOptional() @IsNumberString() rightVolumePerPair?: string;
  @IsOptional() @IsNumberString() pairPayoutAmount?: string;
  @IsOptional() @IsInt() @Min(0) dailyPairCap?: number;
  @IsOptional() @IsInt() @Min(0) monthlyPairCap?: number;
  @IsOptional() @IsBoolean() carryForwardEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) carryForwardExpiryDays?: number;
  @IsOptional() @IsObject() qualificationRules?: Record<string, unknown>;
  @IsOptional() @IsObject() settlementRules?: Record<string, unknown>;
}
