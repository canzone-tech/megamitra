import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { KycSubmissionStatus } from '../generated/prisma/enums';

export enum KycReviewDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RESUBMISSION_REQUIRED = 'RESUBMISSION_REQUIRED',
}

export class CreateKycPolicyDto {
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
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateKycPolicyVersionDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsObject()
  requirements!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  reviewRules?: Record<string, unknown>;
}

export class UpdateKycPolicyVersionDto {
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsObject()
  requirements?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  reviewRules?: Record<string, unknown>;
}

export class SubmitKycDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  documents?: Record<string, unknown>[];
}

export class ListKycSubmissionsDto {
  @IsOptional()
  @Matches(/^\d+$/)
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;

  @IsOptional()
  @IsEnum(KycSubmissionStatus)
  status?: KycSubmissionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ReviewKycSubmissionDto {
  @IsEnum(KycReviewDecision)
  decision!: KycReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
