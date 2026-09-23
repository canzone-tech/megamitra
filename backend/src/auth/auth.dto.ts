import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaAnswer?: string;
}

export class LoginDto {
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaAnswer?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
