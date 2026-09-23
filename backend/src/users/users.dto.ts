import { ArrayMinSize, IsArray, IsEnum, IsString } from 'class-validator';
import { UserStatus } from '../generated/prisma/enums';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}

export class ReplaceUserRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roles!: string[];
}
