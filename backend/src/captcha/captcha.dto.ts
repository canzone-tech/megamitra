import { IsString, MinLength } from 'class-validator';

export class VerifyCaptchaDto {
  @IsString()
  @MinLength(1)
  captchaId!: string;

  @IsString()
  @MinLength(1)
  captchaAnswer!: string;
}
