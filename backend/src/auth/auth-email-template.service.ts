import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import {
  AuthEmailTemplatePurposeDto,
  CreateAuthEmailTemplateVersionDto,
  UpdateAuthEmailTemplateVersionDto,
} from './auth-email-template.dto';

type TemplateLifecycle = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export type AuthEmailTemplateRow = {
  id: string;
  purpose: AuthEmailTemplatePurposeDto;
  version: number;
  lifecycle: TemplateLifecycle;
  subjectTemplate: string;
  textTemplate: string;
  htmlTemplate: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  retiredByUserId: string | null;
  publishedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RenderedAuthEmail = {
  templateVersionId: string;
  purpose: AuthEmailTemplatePurposeDto;
  subject: string;
  text: string;
  html: string | null;
};

@Injectable()
export class AuthEmailTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(purpose?: AuthEmailTemplatePurposeDto) {
    if (purpose) {
      return this.prisma.$queryRawUnsafe<AuthEmailTemplateRow[]>(
        `SELECT *
         FROM auth_email_template_versions
         WHERE purpose = ?
         ORDER BY purpose ASC, version DESC`,
        purpose,
      );
    }
    return this.prisma.$queryRawUnsafe<AuthEmailTemplateRow[]>(
      `SELECT *
       FROM auth_email_template_versions
       ORDER BY purpose ASC, version DESC`,
    );
  }

  async get(id: string): Promise<AuthEmailTemplateRow> {
    const rows = await this.prisma.$queryRawUnsafe<AuthEmailTemplateRow[]>(
      `SELECT * FROM auth_email_template_versions WHERE id = ? LIMIT 1`,
      id,
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Authentication email template version not found');
    return row;
  }

  async create(dto: CreateAuthEmailTemplateVersionDto, actorUserId: string) {
    this.validateWindow(dto.effectiveFrom, dto.effectiveTo);
    this.validateTemplate(dto.purpose, dto.subjectTemplate, dto.textTemplate, dto.htmlTemplate ?? null);

    const versions = await this.prisma.$queryRawUnsafe<Array<{ maxVersion: bigint | number | null }>>(
      `SELECT MAX(version) AS maxVersion
       FROM auth_email_template_versions
       WHERE purpose = ?`,
      dto.purpose,
    );
    const maxVersion = Number(versions[0]?.maxVersion ?? 0);
    const id = randomUUID();

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO auth_email_template_versions (
         id, purpose, version, lifecycle, subjectTemplate, textTemplate, htmlTemplate,
         effectiveFrom, effectiveTo, createdByUserId, createdAt, updatedAt
       ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      id,
      dto.purpose,
      maxVersion + 1,
      dto.subjectTemplate.trim(),
      dto.textTemplate,
      dto.htmlTemplate ?? null,
      new Date(dto.effectiveFrom),
      dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      actorUserId,
    );

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'AuthEmailTemplateVersion',
      entityId: id,
      description: 'Authentication email template draft created',
      metadata: { purpose: dto.purpose, version: maxVersion + 1 },
    });
    return this.get(id);
  }

  async updateDraft(
    id: string,
    dto: UpdateAuthEmailTemplateVersionDto,
    actorUserId: string,
  ) {
    const current = await this.get(id);
    if (current.lifecycle !== 'DRAFT') {
      throw new ConflictException('Published or retired email template versions are immutable');
    }

    const effectiveFrom = dto.effectiveFrom ?? current.effectiveFrom.toISOString();
    const effectiveTo = dto.effectiveTo === undefined
      ? current.effectiveTo?.toISOString()
      : dto.effectiveTo;
    const subjectTemplate = dto.subjectTemplate ?? current.subjectTemplate;
    const textTemplate = dto.textTemplate ?? current.textTemplate;
    const htmlTemplate = dto.htmlTemplate === undefined ? current.htmlTemplate : dto.htmlTemplate;

    this.validateWindow(effectiveFrom, effectiveTo);
    this.validateTemplate(current.purpose, subjectTemplate, textTemplate, htmlTemplate ?? null);

    await this.prisma.$executeRawUnsafe(
      `UPDATE auth_email_template_versions
       SET subjectTemplate = ?, textTemplate = ?, htmlTemplate = ?, effectiveFrom = ?, effectiveTo = ?,
           updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND lifecycle = 'DRAFT'`,
      subjectTemplate.trim(),
      textTemplate,
      htmlTemplate ?? null,
      new Date(effectiveFrom),
      effectiveTo ? new Date(effectiveTo) : null,
      id,
    );

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'AuthEmailTemplateVersion',
      entityId: id,
      description: 'Authentication email template draft updated',
    });
    return this.get(id);
  }

  async publish(id: string, actorUserId: string) {
    const current = await this.get(id);
    if (current.lifecycle !== 'DRAFT') {
      throw new ConflictException('Only draft email template versions can be published');
    }

    const overlaps = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM auth_email_template_versions
       WHERE purpose = ?
         AND lifecycle = 'PUBLISHED'
         AND id <> ?
         AND effectiveFrom < COALESCE(?, '9999-12-31 23:59:59.999')
         AND COALESCE(effectiveTo, '9999-12-31 23:59:59.999') > ?
       LIMIT 1`,
      current.purpose,
      id,
      current.effectiveTo,
      current.effectiveFrom,
    );
    if (overlaps.length) {
      throw new ConflictException('Published email template effective windows cannot overlap');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE auth_email_template_versions
       SET lifecycle = 'PUBLISHED', publishedByUserId = ?, publishedAt = CURRENT_TIMESTAMP(3),
           updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND lifecycle = 'DRAFT'`,
      actorUserId,
      id,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'AuthEmailTemplateVersion',
      entityId: id,
      description: 'Authentication email template version published',
      metadata: { purpose: current.purpose, version: current.version },
    });
    return this.get(id);
  }

  async retire(id: string, actorUserId: string) {
    const current = await this.get(id);
    if (current.lifecycle !== 'PUBLISHED') {
      throw new ConflictException('Only published email template versions can be retired');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE auth_email_template_versions
       SET lifecycle = 'RETIRED', retiredByUserId = ?, retiredAt = CURRENT_TIMESTAMP(3),
           updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND lifecycle = 'PUBLISHED'`,
      actorUserId,
      id,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'AuthEmailTemplateVersion',
      entityId: id,
      description: 'Authentication email template version retired',
      metadata: { purpose: current.purpose, version: current.version },
    });
    return this.get(id);
  }

  async renderPublished(
    purpose: AuthEmailTemplatePurposeDto,
    variables: Record<string, string>,
    at = new Date(),
  ): Promise<RenderedAuthEmail> {
    const rows = await this.prisma.$queryRawUnsafe<AuthEmailTemplateRow[]>(
      `SELECT *
       FROM auth_email_template_versions
       WHERE purpose = ?
         AND lifecycle = 'PUBLISHED'
         AND effectiveFrom <= ?
         AND (effectiveTo IS NULL OR effectiveTo > ?)
       ORDER BY version DESC
       LIMIT 2`,
      purpose,
      at,
      at,
    );
    if (rows.length === 0) {
      throw new NotFoundException(`No published ${purpose} email template is effective`);
    }
    if (rows.length > 1) {
      throw new ConflictException(`Multiple published ${purpose} email templates are effective`);
    }
    const template = rows[0];
    return {
      templateVersionId: template.id,
      purpose,
      subject: this.renderString(template.subjectTemplate, variables, false),
      text: this.renderString(template.textTemplate, variables, false),
      html: template.htmlTemplate
        ? this.renderString(template.htmlTemplate, variables, true)
        : null,
    };
  }

  private validateWindow(from: string, to?: string | null) {
    const start = new Date(from);
    const end = to ? new Date(to) : null;
    if (!Number.isFinite(start.getTime())) {
      throw new BadRequestException('Invalid effectiveFrom');
    }
    if (end && (!Number.isFinite(end.getTime()) || end <= start)) {
      throw new BadRequestException('effectiveTo must be later than effectiveFrom');
    }
  }

  private validateTemplate(
    purpose: AuthEmailTemplatePurposeDto,
    subject: string,
    text: string,
    html: string | null,
  ) {
    if (!subject.trim() || !text.trim()) {
      throw new BadRequestException('Email subject and text template are required');
    }
    const combined = `${subject}\n${text}\n${html ?? ''}`;
    if (!combined.includes('{{actionUrl}}')) {
      throw new BadRequestException(`${purpose} template must include {{actionUrl}}`);
    }
    const allowed = new Set(['actionUrl', 'expiresInMinutes', 'username', 'pendingEmail']);
    const matches = combined.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g);
    for (const match of matches) {
      if (!allowed.has(match[1])) {
        throw new BadRequestException(`Unsupported email template variable: ${match[1]}`);
      }
    }
  }

  private renderString(
    template: string,
    variables: Record<string, string>,
    html: boolean,
  ): string {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
      const value = variables[key] ?? '';
      return html ? this.escapeHtml(value) : value;
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
