import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import type { CreateCatalogProductDto, UpdateCatalogProductDto } from './entitlement.dto';
import { insertAudit, normalizeCode, normalizeJsonFields, type Row } from './entitlement.support';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
  ) {}

  async listProducts() {
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, code, name, description, kind, nominalValue, currencyCode, status, metadata, createdAt, updatedAt
       FROM catalog_products ORDER BY status = 'ACTIVE' DESC, name ASC, code ASC`,
    );
    return rows.map((row) => normalizeJsonFields(row, ['metadata']));
  }

  async createProduct(actorUserId: string, dto: CreateCatalogProductDto) {
    const id = randomUUID();
    const code = normalizeCode(dto.code);
    const currencyCode = dto.currencyCode?.trim().toUpperCase() ?? null;
    this.assertValueCurrencyPair(dto.nominalValue ?? null, currencyCode);
    return this.financialDb.transaction(async (connection) => {
      await connection.query(
        `INSERT INTO catalog_products
           (id, code, name, description, kind, nominalValue, currencyCode, status, metadata, createdByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          id,
          code,
          dto.name.trim(),
          dto.description?.trim() || null,
          dto.kind,
          dto.nominalValue ?? null,
          currencyCode,
          dto.metadata ? JSON.stringify(dto.metadata) : null,
          actorUserId,
        ],
      );
      await insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'CatalogProduct',
        entityId: id,
        description: 'Product catalog item created',
        metadata: { code, kind: dto.kind },
      });
      return this.getProduct(connection, id);
    });
  }

  async updateProduct(actorUserId: string, id: string, dto: UpdateCatalogProductDto) {
    return this.financialDb.transaction(async (connection) => {
      const current = await this.getProduct(connection, id, true);
      const nextValue = dto.nominalValue ?? (current.nominalValue as string | number | null);
      const nextCurrency = dto.currencyCode?.trim().toUpperCase() ?? (current.currencyCode as string | null);
      this.assertValueCurrencyPair(nextValue, nextCurrency);
      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      if (dto.name !== undefined) { fields.push('name = ?'); values.push(dto.name.trim()); }
      if (dto.description !== undefined) { fields.push('description = ?'); values.push(dto.description.trim() || null); }
      if (dto.kind !== undefined) { fields.push('kind = ?'); values.push(dto.kind); }
      if (dto.status !== undefined) { fields.push('status = ?'); values.push(dto.status); }
      if (dto.nominalValue !== undefined) { fields.push('nominalValue = ?'); values.push(dto.nominalValue); }
      if (dto.currencyCode !== undefined) { fields.push('currencyCode = ?'); values.push(nextCurrency); }
      if (dto.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(dto.metadata)); }
      if (!fields.length) return current;
      fields.push('updatedAt = CURRENT_TIMESTAMP(3)');
      await connection.query(`UPDATE catalog_products SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
      await insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'CatalogProduct',
        entityId: id,
        description: 'Product catalog item updated',
      });
      return this.getProduct(connection, id);
    });
  }

  private assertValueCurrencyPair(value: string | number | null, currencyCode: string | null) {
    if ((value !== null) !== Boolean(currencyCode)) {
      throw new BadRequestException('nominalValue and currencyCode must be supplied together');
    }
  }

  private async getProduct(connection: PoolConnection, id: string, lock = false) {
    const rows = (await connection.query(
      `SELECT id, code, name, description, kind, nominalValue, currencyCode, status, metadata, createdAt, updatedAt
       FROM catalog_products WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Catalog product not found');
    return normalizeJsonFields(rows[0], ['metadata']);
  }
}
