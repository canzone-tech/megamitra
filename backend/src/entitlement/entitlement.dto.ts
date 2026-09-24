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

export const PRODUCT_KINDS = ['GOODS', 'SERVICE', 'BENEFIT', 'BUNDLE', 'OTHER'] as const;
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const ENTITLEMENT_STATUSES = [
  'GRANTED',
  'CLAIMED',
  'FULFILLED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export class CreateCatalogProductDto {
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

  @IsIn(PRODUCT_KINDS)
  kind!: ProductKind;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  nominalValue?: number;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCatalogProductDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(PRODUCT_KINDS)
  kind?: ProductKind;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  nominalValue?: number;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateEntitlementPolicyDto {
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

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateEntitlementPolicyVersionDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(1000)
  minimumPaidInstallments!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumPaidAmount?: number;

  @IsBoolean()
  requireEnrollmentCompleted!: boolean;

  @IsBoolean()
  excludeAnyLuckyDrawWinner!: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(36500)
  claimWindowDays?: number;

  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  grantItems!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}

export class UpdateEntitlementPolicyVersionDto {
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(1000)
  minimumPaidInstallments?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumPaidAmount?: number;

  @IsOptional()
  @IsBoolean()
  requireEnrollmentCompleted?: boolean;

  @IsOptional()
  @IsBoolean()
  excludeAnyLuckyDrawWinner?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(36500)
  claimWindowDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  grantItems?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}

export class GenerateEntitlementsDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  enrollmentId!: string;

  @IsOptional()
  @IsUUID()
  policyVersionId?: string;
}

export class ClaimEntitlementDto {
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ListEntitlementsDto {
  @IsOptional()
  @Matches(/^\d+$/)
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;

  @IsOptional()
  @IsIn(ENTITLEMENT_STATUSES)
  status?: EntitlementStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class StartProductFulfillmentDto {
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

export class CompleteProductFulfillmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  providerReference?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class FailProductFulfillmentDto {
  @IsString()
  @Length(2, 1000)
  reason!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CancelEntitlementDto {
  @IsString()
  @Length(2, 1000)
  reason!: string;
}
