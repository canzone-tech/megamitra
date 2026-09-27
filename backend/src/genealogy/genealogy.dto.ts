import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { BinaryPlacementSide } from '../generated/prisma/enums';

export const BINARY_PLACEMENT_SLOTS = ['A', 'B', 'C', 'D'] as const;
export type BinaryPlacementSlot = (typeof BINARY_PLACEMENT_SLOTS)[number];

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

  /** Revised authoritative placement slot. A/B = LEFT, C/D = RIGHT. */
  @IsOptional()
  @IsIn(BINARY_PLACEMENT_SLOTS)
  slot?: BinaryPlacementSlot;

  /** Legacy API compatibility only: LEFT maps to A and RIGHT maps to C. */
  @IsOptional()
  @IsEnum(BinaryPlacementSide)
  side?: BinaryPlacementSide;
}
