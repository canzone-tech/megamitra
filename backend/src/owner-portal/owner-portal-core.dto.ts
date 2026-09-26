import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OWNER_MEMBER_TYPES, OWNER_PLACEMENTS } from './owner-portal.dto';

export class CreateOwnerCoreMemberDto {
  @IsOptional() @IsString() @MinLength(3) username?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MinLength(1) password?: string;
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
