import { IsISO8601, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateBinaryQualifyingUnitDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  sourceMemberUserId!: string;

  @IsUUID()
  planVersionId!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReverseBinaryQualifyingUnitDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
