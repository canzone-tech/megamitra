import { IsIn, IsString, Length } from 'class-validator';

export class AssignOwnerPlacementDto {
  @IsString()
  @Length(1, 191)
  memberReference!: string;

  @IsString()
  @Length(1, 191)
  parentReference!: string;

  @IsIn(['A', 'B', 'C', 'D', 'AUTO'])
  slot!: 'A' | 'B' | 'C' | 'D' | 'AUTO';
}
