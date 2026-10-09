import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  IsUUID,
  Min,
} from 'class-validator';

export class UpdatePaymentSettingsDto {
  @IsOptional() @IsString() @MaxLength(191) upiId?: string;
  @IsOptional() @IsString() @MaxLength(160) payeeName?: string;
  @IsOptional() @IsString() @MaxLength(120_000) qrImageDataUrl?: string;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
  @IsBoolean() enabled!: boolean;
}

export class SubmitInstallmentPaymentDto {
  @IsNumberString() amount!: string;
  @IsString() @Length(4, 191) utr!: string;
  @IsString() @MaxLength(120_000) paymentProofDataUrl!: string;
}

export class RedeemInstallmentEpinDto {
  @IsUUID() epinId!: string;
}

export class SubmitEpinPaymentDto {
  @IsString() @Length(36, 36) seasonId!: string;
  @IsOptional() @IsIn(['ACTIVATION', 'INSTALLMENT']) epinType?: 'ACTIVATION' | 'INSTALLMENT';
  @IsInt() @Min(1) @Max(100) quantity!: number;
  @IsString() @Length(4, 191) utr!: string;
  @IsString() @MaxLength(120_000) paymentProofDataUrl!: string;
}

export class ReviewMemberPaymentDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReassignEpinDto {
  @IsString() @Length(1, 191) memberReference!: string;
}

export class CancelUnusedEpinDto {
  @IsNumberString() refundAmount!: string;
  @IsString() @Length(1, 191) refundReference!: string;
  @IsString() @Length(2, 500) reason!: string;
}

export class CancelMemberEnrollmentDto {
  @IsNumberString() refundAmount!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(191) refundReference?: string;
}
