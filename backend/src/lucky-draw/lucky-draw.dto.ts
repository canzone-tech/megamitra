import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export const LUCKY_DRAW_ENTRY_MODES = ['PER_ELIGIBLE_HOOK', 'ONE_PER_USER'] as const;
export type LuckyDrawEntryMode = (typeof LUCKY_DRAW_ENTRY_MODES)[number];

export const LUCKY_DRAW_PRIOR_WINNER_MODES = ['ALLOW', 'DISALLOW_WITHIN_POLICY'] as const;
export type LuckyDrawPriorWinnerMode = (typeof LUCKY_DRAW_PRIOR_WINNER_MODES)[number];

export const LUCKY_DRAW_INSUFFICIENT_ENTRANTS_MODES = ['REQUIRE_FULL', 'DRAW_AVAILABLE'] as const;
export type LuckyDrawInsufficientEntrantsMode = (typeof LUCKY_DRAW_INSUFFICIENT_ENTRANTS_MODES)[number];

export const LUCKY_DRAW_PRIZE_KINDS = ['CASH', 'ITEM', 'BENEFIT', 'OTHER'] as const;
export type LuckyDrawPrizeKind = (typeof LUCKY_DRAW_PRIZE_KINDS)[number];

export class CreateLuckyDrawPolicyDto {
  @IsString()
  @Length(2, 50)
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class LuckyDrawPrizeTierDto {
  @IsString()
  @Length(1, 50)
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  winnerCount!: number;

  @IsIn(LUCKY_DRAW_PRIZE_KINDS)
  prizeKind!: LuckyDrawPrizeKind;

  @IsOptional()
  @IsNumberString()
  cashAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsObject()
  prizeDefinition?: Record<string, unknown>;
}

export class CreateLuckyDrawPolicyVersionDto {
  @IsUUID()
  programVersionId!: string;

  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsIn(LUCKY_DRAW_ENTRY_MODES)
  entryMode!: LuckyDrawEntryMode;

  @IsIn(LUCKY_DRAW_PRIOR_WINNER_MODES)
  priorWinnerMode!: LuckyDrawPriorWinnerMode;

  @IsBoolean()
  allowMultipleWinsPerDraw!: boolean;

  @IsIn(LUCKY_DRAW_INSUFFICIENT_ENTRANTS_MODES)
  insufficientEntrantsMode!: LuckyDrawInsufficientEntrantsMode;

  @IsArray()
  @ArrayMinSize(1)
  prizeTiers!: LuckyDrawPrizeTierDto[];
}

export class UpdateLuckyDrawPolicyVersionDto {
  @IsOptional() @IsUUID() programVersionId?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsIn(LUCKY_DRAW_ENTRY_MODES) entryMode?: LuckyDrawEntryMode;
  @IsOptional() @IsIn(LUCKY_DRAW_PRIOR_WINNER_MODES) priorWinnerMode?: LuckyDrawPriorWinnerMode;
  @IsOptional() @IsBoolean() allowMultipleWinsPerDraw?: boolean;
  @IsOptional()
  @IsIn(LUCKY_DRAW_INSUFFICIENT_ENTRANTS_MODES)
  insufficientEntrantsMode?: LuckyDrawInsufficientEntrantsMode;
  @IsOptional() @IsArray() @ArrayMinSize(1) prizeTiers?: LuckyDrawPrizeTierDto[];
}

export class CreateLuckyDrawInstanceDto {
  @IsString()
  @Length(1, 191)
  sourceKey!: string;

  @IsUUID()
  policyVersionId!: string;

  @IsISO8601()
  entryWindowStart!: string;

  @IsISO8601()
  entryWindowEnd!: string;

  @IsISO8601()
  drawAt!: string;

  @IsString()
  @Matches(/^[A-Fa-f0-9]{64}$/)
  seedCommitment!: string;
}

export class ExecuteLuckyDrawDto {
  @IsString()
  @Length(8, 191)
  selectionSeed!: string;
}
