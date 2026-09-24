import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';

export type Row = Record<string, unknown>;
export type GrantItem = { productCode: string; quantity: number };
export type PolicyVersionRow = Row & {
  id: string;
  policyId: string;
  policyCode: string;
  policyName: string;
  programId: string | null;
  version: number | bigint;
  lifecycle: string;
  minimumPaidInstallments: number | bigint;
  minimumPaidAmount: string | number | null;
  requireEnrollmentCompleted: number | boolean;
  excludeAnyLuckyDrawWinner: number | boolean;
  claimWindowDays: number | bigint | null;
  grantItems: unknown;
};

export function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return value;
}

export function normalizeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]));
}

export function normalizeJsonFields(row: Row, fields: string[]) {
  const normalized = normalizeRow(row);
  for (const field of fields) {
    if (field in normalized) normalized[field] = jsonValue(normalized[field]);
  }
  return normalized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export async function insertAudit(
  connection: PoolConnection,
  input: {
    actorUserId: string;
    action: 'CREATE' | 'UPDATE';
    entityType: string;
    entityId: string;
    description: string;
    metadata?: Record<string, unknown>;
  },
) {
  await connection.query(
    `INSERT INTO audit_logs
       (id, actorUserId, action, entityType, entityId, description, metadata, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      input.description,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}
