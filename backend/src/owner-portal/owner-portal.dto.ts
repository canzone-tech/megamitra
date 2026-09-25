import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const OWNER_SEASON_STATUSES = ['DRAFT', 'REVIEW', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED'] as const;
export const OWNER_MEMBER_TYPES = ['PARTNER', 'CUSTOMER'] as const;
export const OWNER_PLACEMENTS = ['AUTO', 'LEFT', 'RIGHT'] as const;
export const OWNER_ELIGIBILITY_CUTOFFS = ['BEFORE_DRAW_DATE', 'PAYMENT_DUE_DATE', 'ADMIN_DEFINED'] as const;
export const OWNER_NOTIFICATION_CHANNELS = ['PORTAL', 'SMS', 'EMAIL', 'PUSH'] as const;
export const OWNER_NOTIFICATION_AUDIENCES = ['ALL_ACTIVE_MEMBERS', 'SEASON_MEMBERS', 'AGENTS', 'ADMINS'] as const;
export const OWNER_SUPPORT_PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'] as const;
export const OWNER_SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const OWNER_AUTH_PURPOSES = ['PAYMENT_AUTHORIZATION', 'WINNER_APPROVAL', 'SEASON_CHANGE', 'EPIN_OPERATION'] as const;

export class CreateOwnerMemberDto {
  @IsOptional() @IsString() @MinLength(3) username?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @MinLength(1) password!: string;
  @IsString() @Length(2, 160) fullName!: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsIn(OWNER_MEMBER_TYPES) memberType!: (typeof OWNER_MEMBER_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(191) sponsorReference?: string;
  @IsIn(OWNER_PLACEMENTS) placement!: (typeof OWNER_PLACEMENTS)[number];
  @IsOptional() @IsString() @MaxLength(191) placementReference?: string;
  @IsOptional() @IsString() @MaxLength(80) epin?: string;
}

export class OwnerSeasonPrizeDto {
  @IsInt() @Min(1) @Max(60) monthNumber!: number;
  @IsString() @Length(1, 50) prizeCode!: string;
  @IsString() @Length(1, 80) category!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsInt() @Min(1) winnerCount!: number;
  @IsOptional() @IsNumberString() nominalValue?: string;
}

export class CreateOwnerSeasonDto {
  @IsOptional() @IsString() @Length(2, 50) code?: string;
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsISO8601() startDate!: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsNumberString() monthlyEmi!: string;
  @IsNumberString() registrationFee!: string;
  @IsInt() @Min(1) @Max(60) totalMonths!: number;
  @IsInt() @Min(1) @Max(31) drawDay!: number;
  @IsNumberString() pairValue!: string;
  @IsNumberString() directReferral!: string;
  @IsInt() @Min(0) dailyCap!: number;
  @IsBoolean() carryForward!: boolean;
  @IsIn(OWNER_ELIGIBILITY_CUTOFFS) eligibilityCutoff!: (typeof OWNER_ELIGIBILITY_CUTOFFS)[number];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OwnerSeasonPrizeDto) prizes?: OwnerSeasonPrizeDto[];
}

export class UpdateOwnerSeasonDto extends CreateOwnerSeasonDto {}

export class OwnerSeasonStatusDto {
  @IsIn(OWNER_SEASON_STATUSES) status!: (typeof OWNER_SEASON_STATUSES)[number];
}

export class SaveSeasonPrizesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OwnerSeasonPrizeDto) prizes!: OwnerSeasonPrizeDto[];
}

export class PrepareOwnerDrawDto {
  @IsInt() @Min(1) @Max(60) monthNumber!: number;
  @IsISO8601() entryWindowStart!: string;
  @IsISO8601() entryWindowEnd!: string;
  @IsISO8601() drawAt!: string;
}

export class VerifyOwnerWinnerDto {
  @IsIn(['PASS', 'FAIL']) eligibilityStatus!: 'PASS' | 'FAIL';
  @IsIn(['PASS', 'FAIL']) identityStatus!: 'PASS' | 'FAIL';
  @IsIn(['PASS', 'FAIL']) paymentStatus!: 'PASS' | 'FAIL';
}

export class ApproveOwnerDrawDto {
  @IsString() @Length(1, 120) approvalReference!: string;
  @IsOptional() @IsString() @MaxLength(1000) approvalNote?: string;
  @IsOptional() @IsString() @MaxLength(80) authorizationCode?: string;
}

export class GenerateEpinsDto {
  @IsOptional() @IsString() seasonId?: string;
  @IsInt() @Min(1) @Max(500) quantity!: number;
  @IsOptional() @IsString() @MaxLength(191) assignUserReference?: string;
  @IsISO8601() expiresAt!: string;
}

export class RevokeEpinDto {
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class GenerateOwnerAuthCodeDto {
  @IsString() @Length(2, 40) roleScope!: string;
  @IsIn(OWNER_AUTH_PURPOSES) purpose!: (typeof OWNER_AUTH_PURPOSES)[number];
  @IsInt() @Min(1) @Max(1440) validityMinutes!: number;
}

export class ConsumeOwnerAuthCodeDto {
  @IsString() @MinLength(6) code!: string;
  @IsIn(OWNER_AUTH_PURPOSES) purpose!: (typeof OWNER_AUTH_PURPOSES)[number];
}

export class CreateOwnerNotificationDto {
  @IsIn(OWNER_NOTIFICATION_AUDIENCES) audience!: (typeof OWNER_NOTIFICATION_AUDIENCES)[number];
  @IsIn(OWNER_NOTIFICATION_CHANNELS) channel!: (typeof OWNER_NOTIFICATION_CHANNELS)[number];
  @IsString() @Length(1, 160) title!: string;
  @IsString() @Length(1, 5000) message!: string;
  @IsOptional() @IsISO8601() scheduledAt?: string;
}

export class SendOwnerNotificationDto {
  @IsOptional() @IsISO8601() scheduledAt?: string;
}

export class CreateSupportTicketDto {
  @IsOptional() @IsString() @MaxLength(191) memberReference?: string;
  @IsString() @Length(2, 50) category!: string;
  @IsIn(OWNER_SUPPORT_PRIORITIES) priority!: (typeof OWNER_SUPPORT_PRIORITIES)[number];
  @IsOptional() @IsString() @MaxLength(191) contact?: string;
  @IsString() @Length(3, 5000) description!: string;
}

export class UpdateSupportTicketDto {
  @IsIn(OWNER_SUPPORT_STATUSES) status!: (typeof OWNER_SUPPORT_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(191) assignedUserReference?: string;
}

export class UpdateOwnerPortalSettingsDto {
  @IsString() @Length(2, 160) companyName!: string;
  @IsString() @Length(1, 100) timezone!: string;
  @IsString() @Matches(/^[A-Za-z]{3}$/) currencyCode!: string;
  @IsString() @Length(2, 20) defaultLanguage!: string;
}

export class RecordOwnerPaymentDto {
  @IsString() @Length(1, 191) memberReference!: string;
  @IsNumberString() amount!: string;
  @IsIn(['MONTHLY_EMI', 'REGISTRATION', 'OTHER']) paymentType!: 'MONTHLY_EMI' | 'REGISTRATION' | 'OTHER';
  @IsIn(['CASH', 'UPI_ONLINE', 'BANK_TRANSFER']) paymentMode!: 'CASH' | 'UPI_ONLINE' | 'BANK_TRANSFER';
  @IsOptional() @IsString() @MaxLength(191) transactionReference?: string;
  @IsOptional() @IsString() @MaxLength(80) authorizationCode?: string;
}
