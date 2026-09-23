import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class OperationalListQueryDto {
  @IsOptional()
  @Matches(/^\d+$/)
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode?: string;
}
