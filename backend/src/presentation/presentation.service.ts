import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import { PresentationDocumentStore } from './presentation-document.store';
import {
  checksum,
  DEFAULT_CMS,
  DEFAULT_TEMPLATE,
  DEFAULT_THEME,
  defaultContent,
  validatePresentationContent,
  type CmsDocument,
  type PresentationContent,
  type PresentationKind,
  type PresentationSurface,
  type TemplateDocument,
  type ThemeDocument,
} from './presentation-schema';

type DefinitionRow = {
  id: string;
  kind: PresentationKind;
  surface: PresentationSurface;
  code: string;
  name: string;
  description: string | null;
  isDefault: number | boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type VersionRow = {
  id: string;
  definitionId: string;
  version: number;
  lifecycle: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  mongoDocumentKey: string;
  contentChecksum: string;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  retiredByUserId: string | null;
  publishedAt: Date | string | null;
  retiredAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type VersionDefinitionRow = VersionRow & Pick<DefinitionRow, 'kind' | 'surface' | 'code' | 'name' | 'description' | 'isDefault'>;

type RuntimeRow = {
  versionId: string;
  definitionId: string;
  kind: PresentationKind;
  surface: PresentationSurface;
  code: string;
  version: number;
  contentChecksum: string;
};

@Injectable()
export class PresentationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PresentationDocumentStore,
    private readonly audit: AuditService,
  ) {}

  async listDefinitions(input: { kind?: PresentationKind; surface?: PresentationSurface }) {
    const clauses: string[] = [];
    const params: string[] = [];
    if (input.kind) {
      clauses.push('kind = ?');
      params.push(input.kind);
    }
    if (input.surface) {
      clauses.push('surface = ?');
      params.push(input.surface);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.prisma.$queryRawUnsafe<DefinitionRow[]>(
      `SELECT id, kind, surface, code, name, description, isDefault, createdAt, updatedAt
       FROM presentation_definitions${where}
       ORDER BY surface ASC, kind ASC, code ASC`,
      ...params,
    );
  }

  async listVersions(definitionId: string) {
    await this.definition(definitionId);
    return this.prisma.$queryRawUnsafe<VersionRow[]>(
      `SELECT id, definitionId, version, lifecycle, mongoDocumentKey, contentChecksum,
              createdByUserId, publishedByUserId, retiredByUserId,
              publishedAt, retiredAt, createdAt, updatedAt
       FROM presentation_versions
       WHERE definitionId = ?
       ORDER BY version DESC`,
      definitionId,
    );
  }

  async getVersion(versionId: string) {
    const version = await this.versionWithDefinition(versionId);
    const document = await this.store.get(version.id);
    if (!document) throw new ServiceUnavailableException('Presentation document is unavailable');
    if (document.contentChecksum !== version.contentChecksum) {
      throw new ConflictException('Presentation document checksum does not match version metadata');
    }
    return { ...version, content: validatePresentationContent(version.kind, document.content) };
  }

  async createVersion(definitionId: string, actorUserId: string, copyFromVersionId?: string) {
    const copied = copyFromVersionId ? await this.getVersion(copyFromVersionId) : null;
    if (copied && copied.definitionId !== definitionId) {
      throw new ConflictException('Source version belongs to another presentation definition');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const definitions = await tx.$queryRawUnsafe<DefinitionRow[]>(
        `SELECT id, kind, surface, code, name, description, isDefault, createdAt, updatedAt
         FROM presentation_definitions WHERE id = ? FOR UPDATE`,
        definitionId,
      );
      const definition = definitions[0];
      if (!definition) throw new NotFoundException('Presentation definition not found');

      const sequence = await tx.$queryRawUnsafe<Array<{ nextVersion: number | string | bigint }>>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
         FROM presentation_versions WHERE definitionId = ?`,
        definitionId,
      );
      const versionNumber = Number(sequence[0]?.nextVersion ?? 1);
      const versionId = randomUUID();
      const documentKey = `presentation:${definition.code}:v${versionNumber}`;
      const content = validatePresentationContent(
        definition.kind,
        copied?.content ?? defaultContent(definition.kind),
      );
      const contentChecksum = checksum(content);

      await this.store.putDraft({
        documentKey,
        definitionId,
        versionId,
        kind: definition.kind,
        surface: definition.surface,
        content,
        contentChecksum,
      });

      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO presentation_versions
            (id, definitionId, version, lifecycle, mongoDocumentKey, contentChecksum, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          versionId,
          definitionId,
          versionNumber,
          documentKey,
          contentChecksum,
          actorUserId,
        );
      } catch (error) {
        await this.store.delete(versionId);
        throw error;
      }
      return { definition, versionId, versionNumber };
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'presentation_version',
      entityId: result.versionId,
      description: `Created ${result.definition.code} draft v${result.versionNumber}`,
      metadata: { definitionId, kind: result.definition.kind, surface: result.definition.surface },
    });
    return this.getVersion(result.versionId);
  }

  async updateDraft(versionId: string, actorUserId: string, rawContent: unknown) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<VersionDefinitionRow[]>(
        `SELECT v.id, v.definitionId, v.version, v.lifecycle, v.mongoDocumentKey, v.contentChecksum,
                v.createdByUserId, v.publishedByUserId, v.retiredByUserId,
                v.publishedAt, v.retiredAt, v.createdAt, v.updatedAt,
                d.kind, d.surface, d.code, d.name, d.description, d.isDefault
         FROM presentation_versions v
         INNER JOIN presentation_definitions d ON d.id = v.definitionId
         WHERE v.id = ? FOR UPDATE`,
        versionId,
      );
      const version = rows[0];
      if (!version) throw new NotFoundException('Presentation version not found');
      if (version.lifecycle !== 'DRAFT') {
        throw new ConflictException('Published or retired presentation versions are immutable');
      }
      const content = validatePresentationContent(version.kind, rawContent);
      const contentChecksum = checksum(content);
      await this.store.putDraft({
        documentKey: version.mongoDocumentKey,
        definitionId: version.definitionId,
        versionId: version.id,
        kind: version.kind,
        surface: version.surface,
        content,
        contentChecksum,
      });
      await tx.$executeRawUnsafe(
        `UPDATE presentation_versions
         SET contentChecksum = ?, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND lifecycle = 'DRAFT'`,
        contentChecksum,
        versionId,
      );
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'presentation_version',
      entityId: versionId,
      description: 'Updated presentation draft content',
    });
    return this.getVersion(versionId);
  }

  async publish(versionId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<VersionDefinitionRow[]>(
        `SELECT v.id, v.definitionId, v.version, v.lifecycle, v.mongoDocumentKey, v.contentChecksum,
                v.createdByUserId, v.publishedByUserId, v.retiredByUserId,
                v.publishedAt, v.retiredAt, v.createdAt, v.updatedAt,
                d.kind, d.surface, d.code, d.name, d.description, d.isDefault
         FROM presentation_versions v
         INNER JOIN presentation_definitions d ON d.id = v.definitionId
         WHERE v.id = ? FOR UPDATE`,
        versionId,
      );
      const version = rows[0];
      if (!version) throw new NotFoundException('Presentation version not found');
      if (version.lifecycle !== 'DRAFT') {
        throw new ConflictException('Only draft presentation versions can be published');
      }
      const document = await this.store.get(versionId);
      if (!document) throw new ServiceUnavailableException('Presentation draft document is unavailable');
      const content = validatePresentationContent(version.kind, document.content);
      if (document.contentChecksum !== version.contentChecksum || checksum(content) !== version.contentChecksum) {
        throw new ConflictException('Presentation draft checksum validation failed');
      }

      await tx.$executeRawUnsafe(
        `UPDATE presentation_versions
         SET lifecycle = 'RETIRED', retiredByUserId = ?, retiredAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
         WHERE definitionId = ? AND lifecycle = 'PUBLISHED'`,
        actorUserId,
        version.definitionId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE presentation_versions
         SET lifecycle = 'PUBLISHED', publishedByUserId = ?, publishedAt = CURRENT_TIMESTAMP(3),
             retiredByUserId = NULL, retiredAt = NULL, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND lifecycle = 'DRAFT'`,
        actorUserId,
        versionId,
      );
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'presentation_version',
      entityId: versionId,
      description: 'Published presentation version',
    });
    return this.getVersion(versionId);
  }

  async retire(versionId: string, actorUserId: string) {
    const changed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<VersionRow[]>(
        `SELECT id, definitionId, version, lifecycle, mongoDocumentKey, contentChecksum,
                createdByUserId, publishedByUserId, retiredByUserId,
                publishedAt, retiredAt, createdAt, updatedAt
         FROM presentation_versions WHERE id = ? FOR UPDATE`,
        versionId,
      );
      const version = rows[0];
      if (!version) throw new NotFoundException('Presentation version not found');
      if (version.lifecycle !== 'PUBLISHED') {
        throw new ConflictException('Only published presentation versions can be retired');
      }
      await tx.$executeRawUnsafe(
        `UPDATE presentation_versions
         SET lifecycle = 'RETIRED', retiredByUserId = ?, retiredAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND lifecycle = 'PUBLISHED'`,
        actorUserId,
        versionId,
      );
      return version;
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'presentation_version',
      entityId: versionId,
      description: `Retired presentation version v${changed.version}`,
    });
    return this.getVersion(versionId);
  }

  async runtime(surface: PresentationSurface) {
    const rows = await this.prisma.$queryRawUnsafe<RuntimeRow[]>(
      `SELECT v.id AS versionId, v.definitionId, d.kind, d.surface, d.code,
              v.version, v.contentChecksum
       FROM presentation_definitions d
       INNER JOIN presentation_versions v ON v.definitionId = d.id AND v.lifecycle = 'PUBLISHED'
       WHERE d.surface = ? AND d.isDefault = TRUE
       ORDER BY d.kind ASC, v.version DESC`,
      surface,
    );

    const theme = await this.runtimeContent<ThemeDocument>('THEME', rows, DEFAULT_THEME);
    const template = await this.runtimeContent<TemplateDocument>('TEMPLATE', rows, DEFAULT_TEMPLATE);
    const cms = await this.runtimeContent<CmsDocument>('CMS', rows, DEFAULT_CMS);
    return { surface, theme, template, cms };
  }

  private async runtimeContent<T extends PresentationContent>(
    kind: PresentationKind,
    rows: RuntimeRow[],
    fallback: T,
  ): Promise<{ source: 'PUBLISHED' | 'DEFAULT'; versionId: string | null; version: number | null; content: T }> {
    const row = rows.find((candidate) => candidate.kind === kind);
    if (!row) return { source: 'DEFAULT', versionId: null, version: null, content: fallback };
    try {
      const document = await this.store.get(row.versionId);
      if (!document || document.contentChecksum !== row.contentChecksum) {
        return { source: 'DEFAULT', versionId: null, version: null, content: fallback };
      }
      const content = validatePresentationContent(kind, document.content) as T;
      if (checksum(content) !== row.contentChecksum) {
        return { source: 'DEFAULT', versionId: null, version: null, content: fallback };
      }
      return { source: 'PUBLISHED', versionId: row.versionId, version: Number(row.version), content };
    } catch {
      return { source: 'DEFAULT', versionId: null, version: null, content: fallback };
    }
  }

  private async definition(id: string): Promise<DefinitionRow> {
    const rows = await this.prisma.$queryRawUnsafe<DefinitionRow[]>(
      `SELECT id, kind, surface, code, name, description, isDefault, createdAt, updatedAt
       FROM presentation_definitions WHERE id = ?`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Presentation definition not found');
    return rows[0];
  }

  private async versionWithDefinition(id: string): Promise<VersionDefinitionRow> {
    const rows = await this.prisma.$queryRawUnsafe<VersionDefinitionRow[]>(
      `SELECT v.id, v.definitionId, v.version, v.lifecycle, v.mongoDocumentKey, v.contentChecksum,
              v.createdByUserId, v.publishedByUserId, v.retiredByUserId,
              v.publishedAt, v.retiredAt, v.createdAt, v.updatedAt,
              d.kind, d.surface, d.code, d.name, d.description, d.isDefault
       FROM presentation_versions v
       INNER JOIN presentation_definitions d ON d.id = v.definitionId
       WHERE v.id = ?`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Presentation version not found');
    return rows[0];
  }
}
