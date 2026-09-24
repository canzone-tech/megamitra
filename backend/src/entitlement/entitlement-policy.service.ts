import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateEntitlementPolicyDto,
  CreateEntitlementPolicyVersionDto,
  UpdateEntitlementPolicyVersionDto,
} from './entitlement.dto';
import {
  insertAudit,
  normalizeCode,
  normalizeJsonFields,
  normalizeRow,
  type GrantItem,
  type Row,
} from './entitlement.support';

@Injectable()
export class EntitlementPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
  ) {}

  async listPolicies() {
    const policies = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT p.id, p.code, p.name, p.description, p.programId, p.isDefault,
              pr.code AS programCode, pr.name AS programName, p.createdAt, p.updatedAt
       FROM entitlement_policies p
       LEFT JOIN programs pr ON pr.id = p.programId
       ORDER BY p.isDefault DESC, p.name ASC, p.code ASC`,
    );
    return Promise.all(policies.map(async (policy) => ({
      ...normalizeRow(policy),
      versions: (await this.prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, policyId, version, lifecycle, effectiveFrom, effectiveTo,
                minimumPaidInstallments, minimumPaidAmount, requireEnrollmentCompleted,
                excludeAnyLuckyDrawWinner, claimWindowDays, grantItems, rules,
                publishedAt, retiredAt, createdAt, updatedAt
         FROM entitlement_policy_versions WHERE policyId = ? ORDER BY version DESC`,
        policy.id,
      )).map((row) => normalizeJsonFields(row, ['grantItems', 'rules'])),
    })));
  }

  async createPolicy(actorUserId: string, dto: CreateEntitlementPolicyDto) {
    const id = randomUUID();
    const code = normalizeCode(dto.code);
    const programId = dto.programId ?? null;
    return this.financialDb.transaction(async (connection) => {
      if (programId) await this.assertProgramExists(connection, programId);
      if (dto.isDefault === true) {
        await connection.query(`UPDATE entitlement_policies SET isDefault = FALSE WHERE programId <=> ?`, [programId]);
      }
      await connection.query(
        `INSERT INTO entitlement_policies
           (id, code, name, description, programId, isDefault, createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [id, code, dto.name.trim(), dto.description?.trim() || null, programId, dto.isDefault === true, actorUserId],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'EntitlementPolicy',
        entityId: id,
        description: 'Entitlement policy created',
        metadata: { code, programId, isDefault: dto.isDefault === true },
      });
      return this.getPolicy(connection, id);
    });
  }

  async setDefaultPolicy(actorUserId: string, policyId: string) {
    return this.financialDb.transaction(async (connection) => {
      const policy = await this.getPolicy(connection, policyId, true);
      const programId = (policy.programId as string | null) ?? null;
      await connection.query(
        `UPDATE entitlement_policies SET isDefault = FALSE, updatedAt = CURRENT_TIMESTAMP(3) WHERE programId <=> ?`,
        [programId],
      );
      await connection.query(
        `UPDATE entitlement_policies SET isDefault = TRUE, updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [policyId],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'EntitlementPolicy',
        entityId: policyId,
        description: 'Entitlement policy marked default',
      });
      return this.getPolicy(connection, policyId);
    });
  }

  async createPolicyVersion(policyId: string, actorUserId: string, dto: CreateEntitlementPolicyVersionDto) {
    const grantItems = this.validateGrantItems(dto.grantItems);
    this.assertDates(dto.effectiveFrom, dto.effectiveTo);
    return this.financialDb.transaction(async (connection) => {
      await this.getPolicy(connection, policyId, true);
      await this.assertGrantProducts(connection, grantItems);
      const versionRows = (await connection.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM entitlement_policy_versions WHERE policyId = ?`,
        [policyId],
      )) as Array<{ nextVersion: number | bigint }>;
      const id = randomUUID();
      const version = Number(versionRows[0]?.nextVersion ?? 1);
      await connection.query(
        `INSERT INTO entitlement_policy_versions (
           id, policyId, version, lifecycle, effectiveFrom, effectiveTo, minimumPaidInstallments,
           minimumPaidAmount, requireEnrollmentCompleted, excludeAnyLuckyDrawWinner, claimWindowDays,
           grantItems, rules, createdByUserId, createdAt, updatedAt
         ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          id, policyId, version, new Date(dto.effectiveFrom), dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          dto.minimumPaidInstallments, dto.minimumPaidAmount ?? null, dto.requireEnrollmentCompleted,
          dto.excludeAnyLuckyDrawWinner, dto.claimWindowDays ?? null, JSON.stringify(grantItems),
          dto.rules ? JSON.stringify(dto.rules) : null, actorUserId,
        ],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'EntitlementPolicyVersion',
        entityId: id,
        description: 'Entitlement policy draft created',
        metadata: { policyId, version },
      });
      return this.getVersion(connection, id);
    });
  }

  async updatePolicyVersion(id: string, actorUserId: string, dto: UpdateEntitlementPolicyVersionDto) {
    return this.financialDb.transaction(async (connection) => {
      const current = await this.getVersion(connection, id, true);
      if (String(current.lifecycle) !== 'DRAFT') {
        throw new ConflictException('Published or retired entitlement policy versions are immutable');
      }
      const effectiveFrom = dto.effectiveFrom ?? String(current.effectiveFrom);
      const effectiveTo = dto.effectiveTo ?? (current.effectiveTo ? String(current.effectiveTo) : undefined);
      if (dto.effectiveFrom !== undefined || dto.effectiveTo !== undefined) this.assertDates(effectiveFrom, effectiveTo);
      const grantItems = dto.grantItems ? this.validateGrantItems(dto.grantItems) : null;
      if (grantItems) await this.assertGrantProducts(connection, grantItems);
      const fields: string[] = [];
      const values: Array<string | number | boolean | Date | null> = [];
      if (dto.effectiveFrom !== undefined) { fields.push('effectiveFrom = ?'); values.push(new Date(dto.effectiveFrom)); }
      if (dto.effectiveTo !== undefined) { fields.push('effectiveTo = ?'); values.push(new Date(dto.effectiveTo)); }
      if (dto.minimumPaidInstallments !== undefined) { fields.push('minimumPaidInstallments = ?'); values.push(dto.minimumPaidInstallments); }
      if (dto.minimumPaidAmount !== undefined) { fields.push('minimumPaidAmount = ?'); values.push(dto.minimumPaidAmount); }
      if (dto.requireEnrollmentCompleted !== undefined) { fields.push('requireEnrollmentCompleted = ?'); values.push(dto.requireEnrollmentCompleted); }
      if (dto.excludeAnyLuckyDrawWinner !== undefined) { fields.push('excludeAnyLuckyDrawWinner = ?'); values.push(dto.excludeAnyLuckyDrawWinner); }
      if (dto.claimWindowDays !== undefined) { fields.push('claimWindowDays = ?'); values.push(dto.claimWindowDays); }
      if (grantItems) { fields.push('grantItems = ?'); values.push(JSON.stringify(grantItems)); }
      if (dto.rules !== undefined) { fields.push('rules = ?'); values.push(JSON.stringify(dto.rules)); }
      if (!fields.length) return current;
      fields.push('updatedAt = CURRENT_TIMESTAMP(3)');
      await connection.query(`UPDATE entitlement_policy_versions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'EntitlementPolicyVersion',
        entityId: id,
        description: 'Entitlement policy draft updated',
      });
      return this.getVersion(connection, id);
    });
  }

  async publishPolicyVersion(id: string, actorUserId: string) {
    return this.transition(id, actorUserId, 'PUBLISHED');
  }

  async retirePolicyVersion(id: string, actorUserId: string) {
    return this.transition(id, actorUserId, 'RETIRED');
  }

  private async transition(id: string, actorUserId: string, target: 'PUBLISHED' | 'RETIRED') {
    return this.financialDb.transaction(async (connection) => {
      const current = await this.getVersion(connection, id, true);
      if (String(current.lifecycle) === target) return current;
      const expected = target === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
      if (String(current.lifecycle) !== expected) {
        throw new ConflictException(`Only ${expected.toLowerCase()} entitlement policy versions can be ${target.toLowerCase()}`);
      }
      if (target === 'PUBLISHED') {
        await connection.query(
          `UPDATE entitlement_policy_versions SET lifecycle = 'PUBLISHED', publishedByUserId = ?,
           publishedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [actorUserId, id],
        );
      } else {
        await connection.query(
          `UPDATE entitlement_policy_versions SET lifecycle = 'RETIRED', retiredByUserId = ?,
           retiredAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [actorUserId, id],
        );
      }
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'EntitlementPolicyVersion',
        entityId: id,
        description: `Entitlement policy version ${target.toLowerCase()}`,
      });
      return this.getVersion(connection, id);
    });
  }

  private validateGrantItems(raw: unknown): GrantItem[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
      throw new BadRequestException('grantItems must be a non-empty array with at most 100 items');
    }
    const seen = new Set<string>();
    return raw.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException(`grantItems[${index}] must be an object`);
      }
      const item = value as Record<string, unknown>;
      const productCode = normalizeCode(String(item.productCode ?? ''));
      const quantity = Number(item.quantity ?? 1);
      if (productCode.length < 2 || productCode.length > 50) throw new BadRequestException(`grantItems[${index}].productCode is invalid`);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new BadRequestException(`grantItems[${index}].quantity is invalid`);
      if (seen.has(productCode)) throw new BadRequestException(`Duplicate grant product code: ${productCode}`);
      seen.add(productCode);
      return { productCode, quantity };
    });
  }

  private async assertGrantProducts(connection: PoolConnection, items: GrantItem[]) {
    for (const item of items) {
      const rows = (await connection.query(
        `SELECT id FROM catalog_products WHERE code = ? AND status = 'ACTIVE' LIMIT 1`,
        [item.productCode],
      )) as Row[];
      if (!rows[0]) throw new BadRequestException(`Active product not found: ${item.productCode}`);
    }
  }

  private assertDates(effectiveFrom: string, effectiveTo?: string) {
    const from = new Date(effectiveFrom);
    const to = effectiveTo ? new Date(effectiveTo) : null;
    if (!Number.isFinite(from.getTime()) || (to && !Number.isFinite(to.getTime()))) throw new BadRequestException('Invalid entitlement policy effective date');
    if (to && to.getTime() <= from.getTime()) throw new BadRequestException('effectiveTo must be later than effectiveFrom');
  }

  private async assertProgramExists(connection: PoolConnection, programId: string) {
    const rows = (await connection.query(`SELECT id FROM programs WHERE id = ? LIMIT 1`, [programId])) as Row[];
    if (!rows[0]) throw new BadRequestException('Program not found');
  }

  private async getPolicy(connection: PoolConnection, id: string, lock = false) {
    const rows = (await connection.query(
      `SELECT p.id, p.code, p.name, p.description, p.programId, p.isDefault,
              pr.code AS programCode, pr.name AS programName, p.createdAt, p.updatedAt
       FROM entitlement_policies p LEFT JOIN programs pr ON pr.id = p.programId
       WHERE p.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Entitlement policy not found');
    return normalizeRow(rows[0]);
  }

  private async getVersion(connection: PoolConnection, id: string, lock = false) {
    const rows = (await connection.query(
      `SELECT v.id, v.policyId, v.version, v.lifecycle, v.effectiveFrom, v.effectiveTo,
              v.minimumPaidInstallments, v.minimumPaidAmount, v.requireEnrollmentCompleted,
              v.excludeAnyLuckyDrawWinner, v.claimWindowDays, v.grantItems, v.rules,
              v.publishedAt, v.retiredAt, v.createdAt, v.updatedAt,
              p.code AS policyCode, p.name AS policyName, p.programId
       FROM entitlement_policy_versions v INNER JOIN entitlement_policies p ON p.id = v.policyId
       WHERE v.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Entitlement policy version not found');
    return normalizeJsonFields(rows[0], ['grantItems', 'rules']);
  }
}
