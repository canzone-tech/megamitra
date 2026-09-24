import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum AuthEmailTemplatePurposeDto {
  PASSWORD_RESET = 'PASSWORD_RESET',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  EMAIL_CHANGE = 'EMAIL_CHANGE',
}

export class CreateAuthEmailTemplateVersionDto {
  @IsEnum(AuthEmailTemplatePurposeDto)
  purpose!: AuthEmailTemplatePurposeDto;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subjectTemplate!: string;

  @IsString()
  @MinLength(1)
  textTemplate!: string;

  @IsOptional()
  @IsString()
  htmlTemplate?: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class UpdateAuthEmailTemplateVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  textTemplate?: string;

  @IsOptional()
  @IsString()
  htmlTemplate?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}
