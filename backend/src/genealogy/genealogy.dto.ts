import { IsEnum, IsUUID } from 'class-validator';
import { BinaryPlacementSide } from '../generated/prisma/enums';

export class AssignSponsorDto {
  @IsUUID()
  memberUserId!: string;

  @IsUUID()
  sponsorUserId!: string;
}

export class AssignPlacementDto {
  @IsUUID()
  memberUserId!: string;

  @IsUUID()
  parentUserId!: string;

  @IsEnum(BinaryPlacementSide)
  side!: BinaryPlacementSide;
}
