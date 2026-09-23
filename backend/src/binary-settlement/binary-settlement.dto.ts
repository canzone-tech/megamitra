import { IsISO8601, IsString, IsUUID, Length } from 'class-validator';

export class RunBinaryPairSettlementDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  memberUserId!: string;

  @IsUUID()
  planVersionId!: string;

  @IsISO8601()
  settledAt!: string;
}
