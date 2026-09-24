import { IsEmail, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  newPassword!: string;
}

export class RequestEmailVerificationDto {
  @IsEmail()
  email!: string;
}

export class ConfirmEmailVerificationDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

export class RequestEmailChangeDto {
  @IsEmail()
  newEmail!: string;

  @IsString()
  currentPassword!: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @MinLength(20)
  token!: string;
}
