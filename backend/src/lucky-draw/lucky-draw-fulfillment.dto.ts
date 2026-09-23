import {
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ConfigureLuckyDrawFulfillmentRuleDto {
  @IsInt()
  @Min(0)
  @Max(36500)
  claimWindowDays!: number;
}

export class ClaimLuckyDrawPrizeDto {
  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class FulfillLuckyDrawPrizeDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  externalReference?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CancelLuckyDrawPrizeClaimDto {
  @IsISO8601()
  occurredAt!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReverseLuckyDrawPrizeFulfillmentDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
