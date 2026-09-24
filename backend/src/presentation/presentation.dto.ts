import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import type { PresentationKind, PresentationSurface } from './presentation-schema';

const KINDS: PresentationKind[] = ['THEME', 'TEMPLATE', 'CMS'];
const SURFACES: PresentationSurface[] = ['PUBLIC', 'AUTH', 'MEMBER', 'ADMIN'];

export class PresentationListQueryDto {
  @IsOptional()
  @IsIn(KINDS)
  kind?: PresentationKind;

  @IsOptional()
  @IsIn(SURFACES)
  surface?: PresentationSurface;
}

export class PresentationRuntimeQueryDto {
  @IsIn(SURFACES)
  surface!: PresentationSurface;
}

export class CreatePresentationVersionDto {
  @IsOptional()
  @IsUUID()
  copyFromVersionId?: string;
}

export class UpdatePresentationVersionDto {
  @IsObject()
  content!: Record<string, unknown>;
}
