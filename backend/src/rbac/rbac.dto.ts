import { ArrayMinSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(255)
  description!: string;
}

export class ReplaceRolePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissions!: string[];
}
