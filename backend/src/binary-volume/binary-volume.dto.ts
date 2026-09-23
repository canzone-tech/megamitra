import {
  IsEnum,
  IsISO8601,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { BinaryVolumeEventType } from '../generated/prisma/enums';

export class CreateBinaryVolumeEventDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  sourceMemberUserId!: string;

  @IsUUID()
  planVersionId!: string;

  @IsEnum(BinaryVolumeEventType)
  eventType!: BinaryVolumeEventType;

  @IsNumberString()
  volume!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReverseBinaryVolumeEventDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
