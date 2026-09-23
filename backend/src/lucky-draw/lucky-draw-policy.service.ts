import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, PolicyLifecycle } from '../generated/prisma/enums';
import type {
  CreateLuckyDrawPolicyDto,
  CreateLuckyDrawPolicyVersionDto,
  LuckyDrawEntryMode,
  LuckyDrawInsufficientEntrantsMode,
  LuckyDrawPriorWinnerMode,
  LuckyDrawPrizeKind,
  LuckyDrawPrizeTierDto,
  UpdateLuckyDrawPolicyVersionDto,
} from './lucky-draw.dto';

type PolicyRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type VersionRow = {
  id: string;
  policyId: string;
  programVersionId: string;
  version: number;
  lifecycle: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  entryMode: LuckyDrawEntryMode;
  priorWinnerMode: LuckyDrawPriorWinnerMode;
  allowMultipleWinsPerDraw: boolean | number;
  insufficientEntrantsMode: LuckyDrawInsufficientEntrantsMode;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  retiredByUserId: string | null;
  publishedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrizeTierRow = {
  id: string;
  policyVersionId: string;
  tierOrder: number;
  code: string;
  name: string;
  winnerCount: number;
  prizeKind: LuckyDrawPrizeKind;
  cashAmount: string | Prisma.Decimal | null;
  currencyCode: string | null;
  prizeDefinition: unknown;
  createdAt: Date;
};

type NormalizedTier = {
  tierOrder: number;
  code: string;
  name: string;
  winnerCount: number;
  prizeKind: LuckyDrawPrizeKind;
  cashAmount: string | null;
  currencyCode: string | null;
  prizeDefinition: Record<string, unknown> | null;
};

type NormalizedVersion = {
  programVersionId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  entryMode: LuckyDrawEntryMode;
  priorWinnerMode: LuckyDrawPriorWinnerMode;
  allowMultipleWinsPerDraw: boolean;
  insufficientEntrantsMode: LuckyDrawInsufficientEntrantsMode;
  prizeTiers: NormalizedTier[];
};

@Injectable()
export class LuckyDrawPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
  ) {}

  async createPolicy(dto: CreateLuckyDrawPolicyDto, actorUserId: string) {
    const id = randomUUID();
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO lucky_draw_policies
           (id, code, name, description, createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        id,
        dto.code.trim().toUpperCase(),
        dto.name.trim(),
        dto.description?.trim() || null,
        actorUserId,
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2010' || (error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Lucky draw policy code already exists');
      }
      throw error;
    }
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'LuckyDrawPolicy',
      entityId: id,
      description: 'Lucky draw policy created',
      metadata: { code: dto.code.trim().toUpperCase() },
    });
    return this.getPolicy(id);
  }

  async listPolicies() {
    const policies = await this.prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT * FROM lucky_draw_policies ORDER BY createdAt ASC`,
    );
    return Promise.all(
      policies.map(async (policy) => ({
        ...policy,
        versions: await this.listVersions(policy.id),
      })),
    );
  }

  async getPolicy(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT * FROM lucky_draw_policies WHERE id = ? LIMIT 1`,
      id,
    );
    const policy = rows[0];
    if (!policy) throw new NotFoundException('Lucky draw policy not found');
    return { ...policy, versions: await this.listVersions(id) };
  }

  async createVersion(
    policyId: string,
    dto: CreateLuckyDrawPolicyVersionDto,
    actorUserId: string,
  ) {
    const normalized = await this.normalizeVersion(dto);
    const versionId = randomUUID();
    const version = await this.financialDb.transaction(async (connection) => {
      const policyRows = await connection.query<Array<{ id: string }>>(
        `SELECT id FROM lucky_draw_policies WHERE id = ? FOR UPDATE`,
        [policyId],
      );
      if (!policyRows[0]) throw new NotFoundException('Lucky draw policy not found');
      const versionRows = await connection.query<Array<{ nextVersion: number | bigint | string }>>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
         FROM lucky_draw_policy_versions WHERE policyId = ?`,
        [policyId],
      );
      const nextVersion = Number(versionRows[0]?.nextVersion ?? 1);
      await connection.query(
        `INSERT INTO lucky_draw_policy_versions
           (id, policyId, programVersionId, version, lifecycle, effectiveFrom, effectiveTo,
            entryMode, priorWinnerMode, allowMultipleWinsPerDraw, insufficientEntrantsMode,
            createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          versionId,
          policyId,
          normalized.programVersionId,
          nextVersion,
          normalized.effectiveFrom,
          normalized.effectiveTo,
          normalized.entryMode,
          normalized.priorWinnerMode,
          normalized.allowMultipleWinsPerDraw,
          normalized.insufficientEntrantsMode,
          actorUserId,
        ],
      );
      await this.insertPrizeTiers(connection, versionId, normalized.prizeTiers);
      return nextVersion;
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'LuckyDrawPolicyVersion',
      entityId: versionId,
      description: 'Lucky draw policy draft version created',
      metadata: { policyId, version },
    });
    return this.getVersion(versionId);
  }

  async updateDraft(
    versionId: string,
    dto: UpdateLuckyDrawPolicyVersionDto,
    actorUserId: string,
  ) {
    const current = await this.getVersion(versionId);
    if (current.lifecycle !== 'DRAFT') {
      throw new ConflictException('Published or retired lucky draw policy versions are immutable');
    }
    const merged: CreateLuckyDrawPolicyVersionDto = {
      programVersionId: dto.programVersionId ?? current.programVersionId,
      effectiveFrom: dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      effectiveTo:
        dto.effectiveTo !== undefined ? dto.effectiveTo : current.effectiveTo?.toISOString(),
      entryMode: dto.entryMode ?? current.entryMode,
      priorWinnerMode: dto.priorWinnerMode ?? current.priorWinnerMode,
      allowMultipleWinsPerDraw:
        dto.allowMultipleWinsPerDraw ?? this.truthy(current.allowMultipleWinsPerDraw),
      insufficientEntrantsMode:
        dto.insufficientEntrantsMode ?? current.insufficientEntrantsMode,
      prizeTiers:
        dto.prizeTiers ??
        current.prizeTiers.map((tier) => ({
          code: tier.code,
          name: tier.name,
          winnerCount: tier.winnerCount,
          prizeKind: tier.prizeKind,
          cashAmount: tier.cashAmount === null ? undefined : String(tier.cashAmount),
          currencyCode: tier.currencyCode ?? undefined,
          prizeDefinition: this.jsonObject(tier.prizeDefinition) ?? undefined,
        })),
    };
    const normalized = await this.normalizeVersion(merged);
    await this.financialDb.transaction(async (connection) => {
      const rows = await connection.query<Array<{ lifecycle: string }>>(
        `SELECT lifecycle FROM lucky_draw_policy_versions WHERE id = ? FOR UPDATE`,
        [versionId],
      );
      if (!rows[0]) throw new NotFoundException('Lucky draw policy version not found');
      if (rows[0].lifecycle !== 'DRAFT') {
        throw new ConflictException('Published or retired lucky draw policy versions are immutable');
      }
      await connection.query(
        `UPDATE lucky_draw_policy_versions
         SET programVersionId = ?, effectiveFrom = ?, effectiveTo = ?, entryMode = ?,
             priorWinnerMode = ?, allowMultipleWinsPerDraw = ?, insufficientEntrantsMode = ?,
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          normalized.programVersionId,
          normalized.effectiveFrom,
          normalized.effectiveTo,
          normalized.entryMode,
          normalized.priorWinnerMode,
          normalized.allowMultipleWinsPerDraw,
          normalized.insufficientEntrantsMode,
          versionId,
        ],
      );
      await connection.query(`DELETE FROM lucky_draw_prize_tiers WHERE policyVersionId = ?`, [versionId]);
      await this.insertPrizeTiers(connection, versionId, normalized.prizeTiers);
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'LuckyDrawPolicyVersion',
      entityId: versionId,
      description: 'Lucky draw policy draft version updated',
    });
    return this.getVersion(versionId);
  }

  async publish(versionId: string, actorUserId: string) {
    const current = await this.getVersion(versionId);
    if (current.lifecycle !== 'DRAFT') {
      throw new ConflictException('Only draft lucky draw policy versions can be published');
    }
    const programVersion = await this.prisma.programVersion.findUnique({
      where: { id: current.programVersionId },
      select: { lifecycle: true },
    });
    if (!programVersion) throw new NotFoundException('Program version not found');
    if (programVersion.lifecycle !== PolicyLifecycle.PUBLISHED) {
      throw new ConflictException('Lucky draw policy requires a published program version');
    }
    this.assertPrizeTiers(current.prizeTiers);

    await this.financialDb.transaction(async (connection) => {
      const rows = await connection.query<Array<{ policyId: string; lifecycle: string }>>(
        `SELECT policyId, lifecycle FROM lucky_draw_policy_versions WHERE id = ? FOR UPDATE`,
        [versionId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Lucky draw policy version not found');
      if (row.lifecycle !== 'DRAFT') {
        throw new ConflictException('Only draft lucky draw policy versions can be published');
      }
      const published = await connection.query<Array<{ id: string }>>(
        `SELECT id FROM lucky_draw_policy_versions
         WHERE policyId = ? AND lifecycle = 'PUBLISHED' LIMIT 1 FOR UPDATE`,
        [row.policyId],
      );
      if (published[0]) {
        throw new ConflictException('Retire the currently published lucky draw version before publishing another');
      }
      await connection.query(
        `UPDATE lucky_draw_policy_versions
         SET lifecycle = 'PUBLISHED', publishedByUserId = ?, publishedAt = CURRENT_TIMESTAMP(3),
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [actorUserId, versionId],
      );
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'LuckyDrawPolicyVersion',
      entityId: versionId,
      description: 'Lucky draw policy version published',
    });
    return this.getVersion(versionId);
  }

  async retire(versionId: string, actorUserId: string) {
    await this.financialDb.transaction(async (connection) => {
      const rows = await connection.query<Array<{ lifecycle: string; effectiveTo: Date | null }>>(
        `SELECT lifecycle, effectiveTo FROM lucky_draw_policy_versions WHERE id = ? FOR UPDATE`,
        [versionId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Lucky draw policy version not found');
      if (row.lifecycle !== 'PUBLISHED') {
        throw new ConflictException('Only published lucky draw policy versions can be retired');
      }
      const now = new Date();
      const effectiveTo = row.effectiveTo && new Date(row.effectiveTo) < now ? row.effectiveTo : now;
      await connection.query(
        `UPDATE lucky_draw_policy_versions
         SET lifecycle = 'RETIRED', retiredByUserId = ?, retiredAt = ?, effectiveTo = ?,
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [actorUserId, now, effectiveTo, versionId],
      );
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'LuckyDrawPolicyVersion',
      entityId: versionId,
      description: 'Lucky draw policy version retired',
    });
    return this.getVersion(versionId);
  }

  async getVersion(versionId: string) {
    const rows = await this.prisma.$queryRawUnsafe<VersionRow[]>(
      `SELECT * FROM lucky_draw_policy_versions WHERE id = ? LIMIT 1`,
      versionId,
    );
    const version = rows[0];
    if (!version) throw new NotFoundException('Lucky draw policy version not found');
    const prizeTiers = await this.prisma.$queryRawUnsafe<PrizeTierRow[]>(
      `SELECT * FROM lucky_draw_prize_tiers
       WHERE policyVersionId = ? ORDER BY tierOrder ASC`,
      versionId,
    );
    return { ...version, prizeTiers };
  }

  private async listVersions(policyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<VersionRow[]>(
      `SELECT * FROM lucky_draw_policy_versions WHERE policyId = ? ORDER BY version ASC`,
      policyId,
    );
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        prizeTiers: await this.prisma.$queryRawUnsafe<PrizeTierRow[]>(
          `SELECT * FROM lucky_draw_prize_tiers WHERE policyVersionId = ? ORDER BY tierOrder ASC`,
          row.id,
        ),
      })),
    );
  }

  private async normalizeVersion(dto: CreateLuckyDrawPolicyVersionDto): Promise<NormalizedVersion> {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (!Number.isFinite(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid date');
    }
    if (effectiveTo && (!Number.isFinite(effectiveTo.getTime()) || effectiveTo <= effectiveFrom)) {
      throw new BadRequestException('effectiveTo must be later than effectiveFrom');
    }
    const programVersion = await this.prisma.programVersion.findUnique({
      where: { id: dto.programVersionId },
      select: { id: true },
    });
    if (!programVersion) throw new NotFoundException('Program version not found');
    const prizeTiers = this.normalizePrizeTiers(dto.prizeTiers);
    return {
      programVersionId: dto.programVersionId,
      effectiveFrom,
      effectiveTo,
      entryMode: dto.entryMode,
      priorWinnerMode: dto.priorWinnerMode,
      allowMultipleWinsPerDraw: dto.allowMultipleWinsPerDraw,
      insufficientEntrantsMode: dto.insufficientEntrantsMode,
      prizeTiers,
    };
  }

  private normalizePrizeTiers(tiers: LuckyDrawPrizeTierDto[]): NormalizedTier[] {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new BadRequestException('At least one prize tier is required');
    }
    const codes = new Set<string>();
    let totalSlots = 0;
    return tiers.map((tier, index) => {
      if (!tier || typeof tier !== 'object') {
        throw new BadRequestException('Each prize tier must be an object');
      }
      const code = String(tier.code ?? '').trim().toUpperCase();
      const name = String(tier.name ?? '').trim();
      if (!code || code.length > 50) throw new BadRequestException('Prize tier code is invalid');
      if (!name || name.length > 120) throw new BadRequestException('Prize tier name is invalid');
      if (codes.has(code)) throw new BadRequestException('Prize tier codes must be unique');
      codes.add(code);
      if (!Number.isInteger(tier.winnerCount) || tier.winnerCount < 1 || tier.winnerCount > 2_147_483_647) {
        throw new BadRequestException('Prize tier winnerCount must be a positive integer');
      }
      totalSlots += tier.winnerCount;
      if (!Number.isSafeInteger(totalSlots) || totalSlots > 2_147_483_647) {
        throw new BadRequestException('Total configured winner slots exceed supported range');
      }

      let cashAmount: string | null = null;
      let currencyCode: string | null = null;
      if (tier.prizeKind === 'CASH') {
        if (!tier.cashAmount || !tier.currencyCode) {
          throw new BadRequestException('Cash prize tiers require cashAmount and currencyCode');
        }
        try {
          const amount = new Prisma.Decimal(tier.cashAmount);
          if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) throw new Error('invalid');
          cashAmount = amount.toFixed(2);
        } catch {
          throw new BadRequestException('cashAmount must be greater than zero');
        }
        currencyCode = tier.currencyCode.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currencyCode)) {
          throw new BadRequestException('Cash prize currencyCode must be a three-letter code');
        }
      } else if (tier.cashAmount !== undefined || tier.currencyCode !== undefined) {
        throw new BadRequestException('cashAmount and currencyCode are only valid for CASH prize tiers');
      }

      return {
        tierOrder: index + 1,
        code,
        name,
        winnerCount: tier.winnerCount,
        prizeKind: tier.prizeKind,
        cashAmount,
        currencyCode,
        prizeDefinition: tier.prizeDefinition ?? null,
      };
    });
  }

  private assertPrizeTiers(tiers: PrizeTierRow[]): void {
    if (tiers.length === 0) throw new ConflictException('Lucky draw policy version has no prize tiers');
    for (const tier of tiers) {
      if (!Number.isInteger(Number(tier.winnerCount)) || Number(tier.winnerCount) < 1) {
        throw new ConflictException('Lucky draw policy version contains an invalid winner count');
      }
      if (tier.prizeKind === 'CASH' && (!tier.cashAmount || !tier.currencyCode)) {
        throw new ConflictException('Published cash prize tier is incomplete');
      }
    }
  }

  private async insertPrizeTiers(
    connection: PoolConnection,
    versionId: string,
    tiers: NormalizedTier[],
  ): Promise<void> {
    for (const tier of tiers) {
      await connection.query(
        `INSERT INTO lucky_draw_prize_tiers
           (id, policyVersionId, tierOrder, code, name, winnerCount, prizeKind,
            cashAmount, currencyCode, prizeDefinition, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          randomUUID(),
          versionId,
          tier.tierOrder,
          tier.code,
          tier.name,
          tier.winnerCount,
          tier.prizeKind,
          tier.cashAmount,
          tier.currencyCode,
          tier.prizeDefinition ? JSON.stringify(tier.prizeDefinition) : null,
        ],
      );
    }
  }

  private truthy(value: boolean | number): boolean {
    return value === true || value === 1;
  }

  private jsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }
}
