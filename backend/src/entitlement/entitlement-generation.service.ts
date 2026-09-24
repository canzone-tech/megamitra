import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { GenerateEntitlementsDto } from './entitlement.dto';
import {
  fingerprint,
  insertAudit,
  jsonValue,
  normalizeCode,
  normalizeJsonFields,
  toBoolean,
  type GrantItem,
  type PolicyVersionRow,
  type Row,
} from './entitlement.support';

type GenerationRunRow = Row & {
  id: string;
  requestFingerprint: string;
};

type ProductRow = Row & {
  id: string;
  code: string;
  name: string;
  kind: string;
  nominalValue: string | number | null;
  currencyCode: string | null;
  metadata: unknown;
};

@Injectable()
export class EntitlementGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
  ) {}

  async generate(actorUserId: string, dto: GenerateEntitlementsDto) {
    const sourceKey = dto.sourceKey.trim();
    const requestFingerprint = fingerprint({
      enrollmentId: dto.enrollmentId,
      requestedPolicyVersionId: dto.policyVersionId ?? null,
    });
    const replay = await this.prisma.$queryRawUnsafe<GenerationRunRow[]>(
      `SELECT id, requestFingerprint FROM entitlement_generation_runs WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    if (replay[0]) return this.replayById(replay[0], requestFingerprint);

    return this.financialDb.transaction(async (connection) => {
      const lockedReplay = (await connection.query(
        `SELECT id, requestFingerprint FROM entitlement_generation_runs WHERE sourceKey = ? LIMIT 1 FOR UPDATE`,
        [sourceKey],
      )) as GenerationRunRow[];
      if (lockedReplay[0]) return this.replayWithConnection(connection, lockedReplay[0], requestFingerprint);

      const enrollmentRows = (await connection.query(
        `SELECT e.id, e.userId, e.status, e.currencyCode, pv.programId,
                p.code AS programCode, p.name AS programName
         FROM program_enrollments e
         INNER JOIN program_versions pv ON pv.id = e.programVersionId
         INNER JOIN programs p ON p.id = pv.programId
         WHERE e.id = ? LIMIT 1 FOR UPDATE`,
        [dto.enrollmentId],
      )) as Row[];
      const enrollment = enrollmentRows[0];
      if (!enrollment) throw new NotFoundException('Program enrollment not found');

      const programId = String(enrollment.programId);
      const policy = dto.policyVersionId
        ? await this.getRequestedPolicy(connection, dto.policyVersionId, programId)
        : await this.getDefaultPolicy(connection, programId);
      if (!policy) throw new BadRequestException('No active published entitlement policy for this program');

      const paidInstallments = await this.countPaidInstallments(connection, dto.enrollmentId);
      const netPaidAmount = await this.getNetPaidAmount(connection, dto.enrollmentId);
      const winnerRows = (await connection.query(
        `SELECT COUNT(*) AS count FROM lucky_draw_winners WHERE userId = ?`,
        [String(enrollment.userId)],
      )) as Array<{ count: number | bigint }>;
      const winnerCount = Number(winnerRows[0]?.count ?? 0);
      const requireCompleted = toBoolean(policy.requireEnrollmentCompleted);
      const excludeWinner = toBoolean(policy.excludeAnyLuckyDrawWinner);
      const requiredInstallments = Number(policy.minimumPaidInstallments);
      const requiredAmount = policy.minimumPaidAmount === null ? null : new Prisma.Decimal(policy.minimumPaidAmount);
      const checks = [
        {
          code: 'ENROLLMENT_COMPLETED',
          configured: requireCompleted,
          passed: !requireCompleted || String(enrollment.status) === 'COMPLETED',
          actual: String(enrollment.status),
          expected: requireCompleted ? 'COMPLETED' : null,
        },
        {
          code: 'PAID_INSTALLMENTS',
          configured: requiredInstallments > 0,
          passed: paidInstallments >= requiredInstallments,
          actual: paidInstallments,
          expected: requiredInstallments,
        },
        {
          code: 'PAID_AMOUNT',
          configured: requiredAmount !== null,
          passed: requiredAmount === null || netPaidAmount.greaterThanOrEqualTo(requiredAmount),
          actual: netPaidAmount.toFixed(2),
          expected: requiredAmount?.toFixed(2) ?? null,
        },
        {
          code: 'NO_LUCKY_DRAW_WIN',
          configured: excludeWinner,
          passed: !excludeWinner || winnerCount === 0,
          actual: winnerCount,
          expected: excludeWinner ? 0 : null,
        },
      ];
      const eligible = checks.every((check) => check.passed);
      const eligibilitySnapshot = {
        eligible,
        checks,
        enrollment: {
          id: dto.enrollmentId,
          status: enrollment.status,
          programId,
          programCode: enrollment.programCode,
          programName: enrollment.programName,
        },
        paidInstallments,
        netPaidAmount: netPaidAmount.toFixed(2),
        luckyDrawWinnerCount: winnerCount,
      };
      const runId = randomUUID();

      await connection.query(
        `INSERT INTO entitlement_generation_runs
           (id, sourceKey, requestFingerprint, enrollmentId, userId, policyVersionId, status,
            eligibilitySnapshot, generatedCount, createdByUserId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP(3))`,
        [
          runId,
          sourceKey,
          requestFingerprint,
          dto.enrollmentId,
          String(enrollment.userId),
          policy.id,
          eligible ? 'GENERATED' : 'INELIGIBLE',
          JSON.stringify(eligibilitySnapshot),
          actorUserId,
        ],
      );

      if (!eligible) {
        await insertAudit(connection, {
          actorUserId,
          action: 'CREATE',
          entityType: 'EntitlementGenerationRun',
          entityId: runId,
          description: 'Product entitlement generation evaluated as ineligible',
          metadata: { enrollmentId: dto.enrollmentId, policyVersionId: policy.id },
        });
        return this.getRun(connection, runId);
      }

      const grantItems = this.validateGrantItems(jsonValue(policy.grantItems));
      const products = await this.getProducts(connection, grantItems);
      let generatedCount = 0;
      for (const item of grantItems) {
        const product = products.get(item.productCode)!;
        const existingRows = (await connection.query(
          `SELECT id FROM product_entitlements
           WHERE enrollmentId = ? AND policyVersionId = ? AND productId = ? LIMIT 1 FOR UPDATE`,
          [dto.enrollmentId, policy.id, product.id],
        )) as Row[];
        if (existingRows[0]) continue;
        const entitlementId = randomUUID();
        const grantedAt = new Date();
        const claimWindowDays = policy.claimWindowDays === null ? null : Number(policy.claimWindowDays);
        const claimDeadline = claimWindowDays === null ? null : new Date(grantedAt.getTime() + claimWindowDays * 86400000);
        const productSnapshot = {
          id: product.id,
          code: product.code,
          name: product.name,
          kind: product.kind,
          nominalValue: product.nominalValue,
          currencyCode: product.currencyCode,
          metadata: jsonValue(product.metadata),
        };
        await connection.query(
          `INSERT INTO product_entitlements
             (id, sourceKey, generationRunId, userId, enrollmentId, policyVersionId, productId,
              status, quantity, productSnapshot, eligibilitySnapshot, grantedAt, claimDeadline, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'GRANTED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [
            entitlementId,
            `entitlement:${fingerprint({ enrollmentId: dto.enrollmentId, policyVersionId: policy.id, productId: product.id }).slice(0, 48)}`,
            runId,
            String(enrollment.userId),
            dto.enrollmentId,
            policy.id,
            product.id,
            item.quantity,
            JSON.stringify(productSnapshot),
            JSON.stringify(eligibilitySnapshot),
            grantedAt,
            claimDeadline,
          ],
        );
        generatedCount += 1;
      }
      await connection.query(`UPDATE entitlement_generation_runs SET generatedCount = ? WHERE id = ?`, [generatedCount, runId]);
      await insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'EntitlementGenerationRun',
        entityId: runId,
        description: 'Product entitlements generated',
        metadata: { enrollmentId: dto.enrollmentId, policyVersionId: policy.id, generatedCount },
      });
      return this.getRun(connection, runId);
    });
  }

  private async countPaidInstallments(connection: PoolConnection, enrollmentId: string) {
    const rows = (await connection.query(
      `SELECT COUNT(*) AS count FROM (
         SELECT i.id, i.amount,
                COALESCE(SUM(pa.amount), 0) - COALESCE((
                  SELECT SUM(ra.amount) FROM program_refund_allocations ra
                  INNER JOIN program_payment_allocations rpa ON rpa.id = ra.paymentAllocationId
                  WHERE rpa.installmentId = i.id
                ), 0) AS netPaid
         FROM program_installments i
         LEFT JOIN program_payment_allocations pa ON pa.installmentId = i.id AND pa.allocationType = 'INSTALLMENT'
         WHERE i.enrollmentId = ? GROUP BY i.id, i.amount HAVING netPaid >= i.amount
       ) paid_installments`,
      [enrollmentId],
    )) as Array<{ count: number | bigint }>;
    return Number(rows[0]?.count ?? 0);
  }

  private async getNetPaidAmount(connection: PoolConnection, enrollmentId: string) {
    const rows = (await connection.query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM program_payment_records WHERE enrollmentId = ?), 0) -
         COALESCE((SELECT SUM(amount) FROM program_refund_records WHERE enrollmentId = ?), 0) AS amount`,
      [enrollmentId, enrollmentId],
    )) as Array<{ amount: string | number }>;
    return new Prisma.Decimal(rows[0]?.amount ?? 0);
  }

  private async getRequestedPolicy(connection: PoolConnection, versionId: string, programId: string) {
    const rows = (await connection.query(
      `SELECT v.id, v.policyId, v.version, v.lifecycle, v.minimumPaidInstallments, v.minimumPaidAmount,
              v.requireEnrollmentCompleted, v.excludeAnyLuckyDrawWinner, v.claimWindowDays, v.grantItems,
              p.code AS policyCode, p.name AS policyName, p.programId
       FROM entitlement_policy_versions v INNER JOIN entitlement_policies p ON p.id = v.policyId
       WHERE v.id = ? AND v.lifecycle = 'PUBLISHED' AND v.effectiveFrom <= CURRENT_TIMESTAMP(3)
         AND (v.effectiveTo IS NULL OR v.effectiveTo > CURRENT_TIMESTAMP(3))
         AND (p.programId IS NULL OR p.programId = ?) LIMIT 1`,
      [versionId, programId],
    )) as PolicyVersionRow[];
    return rows[0] ?? null;
  }

  private async getDefaultPolicy(connection: PoolConnection, programId: string) {
    const rows = (await connection.query(
      `SELECT v.id, v.policyId, v.version, v.lifecycle, v.minimumPaidInstallments, v.minimumPaidAmount,
              v.requireEnrollmentCompleted, v.excludeAnyLuckyDrawWinner, v.claimWindowDays, v.grantItems,
              p.code AS policyCode, p.name AS policyName, p.programId
       FROM entitlement_policy_versions v INNER JOIN entitlement_policies p ON p.id = v.policyId
       WHERE p.isDefault = TRUE AND (p.programId = ? OR p.programId IS NULL)
         AND v.lifecycle = 'PUBLISHED' AND v.effectiveFrom <= CURRENT_TIMESTAMP(3)
         AND (v.effectiveTo IS NULL OR v.effectiveTo > CURRENT_TIMESTAMP(3))
       ORDER BY (p.programId IS NULL) ASC, v.effectiveFrom DESC, v.version DESC LIMIT 1`,
      [programId],
    )) as PolicyVersionRow[];
    return rows[0] ?? null;
  }

  private validateGrantItems(raw: unknown): GrantItem[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) throw new BadRequestException('grantItems must be a non-empty array with at most 100 items');
    const seen = new Set<string>();
    return raw.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`grantItems[${index}] must be an object`);
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

  private async getProducts(connection: PoolConnection, items: GrantItem[]) {
    const result = new Map<string, ProductRow>();
    for (const item of items) {
      const rows = (await connection.query(
        `SELECT id, code, name, kind, nominalValue, currencyCode, metadata
         FROM catalog_products WHERE code = ? AND status = 'ACTIVE' LIMIT 1`,
        [item.productCode],
      )) as ProductRow[];
      if (!rows[0]) throw new BadRequestException(`Active product not found: ${item.productCode}`);
      result.set(item.productCode, rows[0]);
    }
    return result;
  }

  private assertReplay(run: GenerationRunRow, requestFingerprint: string) {
    if (run.requestFingerprint !== requestFingerprint) throw new ConflictException('Entitlement generation sourceKey was already used with different input');
  }

  private async replayById(run: GenerationRunRow, requestFingerprint: string) {
    this.assertReplay(run, requestFingerprint);
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM entitlement_generation_runs WHERE id = ? LIMIT 1`, run.id);
    if (!rows[0]) throw new NotFoundException('Entitlement generation run not found');
    const items = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, status, quantity, productSnapshot, grantedAt, claimDeadline
       FROM product_entitlements WHERE generationRunId = ? ORDER BY createdAt ASC`,
      run.id,
    );
    return { ...normalizeJsonFields(rows[0], ['eligibilitySnapshot']), entitlements: items.map((row) => normalizeJsonFields(row, ['productSnapshot'])) };
  }

  private async replayWithConnection(connection: PoolConnection, run: GenerationRunRow, requestFingerprint: string) {
    this.assertReplay(run, requestFingerprint);
    return this.getRun(connection, run.id);
  }

  private async getRun(connection: PoolConnection, id: string) {
    const rows = (await connection.query(
      `SELECT id, sourceKey, enrollmentId, userId, policyVersionId, status, eligibilitySnapshot,
              generatedCount, createdByUserId, createdAt FROM entitlement_generation_runs WHERE id = ? LIMIT 1`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Entitlement generation run not found');
    const items = (await connection.query(
      `SELECT id, status, quantity, productSnapshot, grantedAt, claimDeadline
       FROM product_entitlements WHERE generationRunId = ? ORDER BY createdAt ASC`,
      [id],
    )) as Row[];
    return { ...normalizeJsonFields(rows[0], ['eligibilitySnapshot']), entitlements: items.map((row) => normalizeJsonFields(row, ['productSnapshot'])) };
  }
}
