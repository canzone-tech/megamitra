import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinancialDbService } from '../database/financial-db.service';
import { Prisma } from '../generated/prisma/client';
import { MemberPaymentService } from '../member-payments/member-payment.service';
import { printedLuckyDrawTokenReference } from '../lucky-draw/lucky-draw-token.util';
import { ProgramPaymentService } from '../program/program-payment.service';
import type { RecordOwnerPaymentDto } from './owner-portal.dto';
import { OwnerPortalService } from './owner-portal.service';

type SqlValue = string | number | bigint | boolean | Date | null;

type PaymentListRow = {
  id: string;
  occurredAt: Date | string;
  amount: string | number;
  currencyCode: string;
  paymentMode: string | null;
  transactionReference: string | null;
  paymentType: string | null;
  refundedAmount: string | number | null;
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  seasonId: string | null;
  seasonCode: string | null;
  seasonName: string | null;
  recordedByUsername: string | null;
};

type PaymentDrawTokenRow = {
  token: string;
  installmentSequence: number;
  status: string;
};

type PortalSettingsRow = {
  companyName: string;
  currencyCode: string;
};

type WalletTotalsRow = {
  creditTotal: string | number | null;
  debitTotal: string | number | null;
};

type EpinInventoryQuery = {
  status?: string;
  memberUserId?: string;
  seasonId?: string;
  pinType?: string;
  page?: string | number;
  pageSize?: string | number;
};

@Injectable()
export class OwnerPortalFinanceService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly portal: OwnerPortalService,
    private readonly programPayments: ProgramPaymentService,
    private readonly memberPayments: MemberPaymentService,
  ) {}

  async recordPayment(dto: RecordOwnerPaymentDto, actorUserId: string) {
    const result = await this.portal.recordPayment(dto, actorUserId);
    const receipt = await this.paymentReceipt(result.payment.payment.id);
    return { ...result, receipt };
  }

  async listPayments(limit = 100) {
    const rows = await this.rows<PaymentListRow>(
      `SELECT pr.id, pr.occurredAt, pr.amount, pr.currencyCode,
              pr.provider AS paymentMode, pr.providerReference AS transactionReference,
              JSON_UNQUOTE(JSON_EXTRACT(pr.metadata, '$.paymentType')) AS paymentType,
              COALESCE((SELECT SUM(rr.amount) FROM program_refund_records rr WHERE rr.paymentRecordId=pr.id), 0) AS refundedAmount,
              u.id AS userId, u.username, u.firstName, u.lastName,
              s.id AS seasonId, s.code AS seasonCode, s.name AS seasonName,
              creator.username AS recordedByUsername
       FROM program_payment_records pr
       INNER JOIN program_enrollments pe ON pe.id=pr.enrollmentId
       INNER JOIN users u ON u.id=pe.userId
       LEFT JOIN owner_seasons s ON s.programVersionId=pe.programVersionId
       LEFT JOIN users creator ON creator.id=pr.createdByUserId
       ORDER BY pr.occurredAt DESC, pr.createdAt DESC
       LIMIT ?`,
      [Math.max(1, Math.min(500, limit))],
    );
    return rows.map((row) => this.formatPaymentRow(row));
  }

  async paymentReceipt(id: string) {
    const payment = await this.programPayments.getPayment(id);
    const rows = await this.rows<PaymentListRow>(
      `SELECT pr.id, pr.occurredAt, pr.amount, pr.currencyCode,
              pr.provider AS paymentMode, pr.providerReference AS transactionReference,
              JSON_UNQUOTE(JSON_EXTRACT(pr.metadata, '$.paymentType')) AS paymentType,
              COALESCE((SELECT SUM(rr.amount) FROM program_refund_records rr WHERE rr.paymentRecordId=pr.id), 0) AS refundedAmount,
              u.id AS userId, u.username, u.firstName, u.lastName,
              s.id AS seasonId, s.code AS seasonCode, s.name AS seasonName,
              creator.username AS recordedByUsername
       FROM program_payment_records pr
       INNER JOIN program_enrollments pe ON pe.id=pr.enrollmentId
       INNER JOIN users u ON u.id=pe.userId
       LEFT JOIN owner_seasons s ON s.programVersionId=pe.programVersionId
       LEFT JOIN users creator ON creator.id=pr.createdByUserId
       WHERE pr.id=? LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Payment record not found');
    const settings = await this.rows<PortalSettingsRow>(
      'SELECT companyName, currencyCode FROM owner_portal_settings WHERE id=1 LIMIT 1',
    );
    const drawTokens = await this.rows<PaymentDrawTokenRow>(
      `SELECT token, installmentSequence, status
       FROM lucky_draw_tokens
       WHERE paymentRecordId=? AND sourceType='INSTALLMENT'
       ORDER BY installmentSequence ASC, createdAt ASC, token ASC`,
      [id],
    );
    return {
      ...this.formatPaymentRow(row),
      companyName: settings[0]?.companyName ?? 'MegaGoldenClub',
      drawTokens: drawTokens.map((item) => ({
        ...item,
        printedReference: printedLuckyDrawTokenReference(
          row.seasonCode,
          Number(item.installmentSequence),
          item.token,
        ),
      })),
      member: {
        id: row.userId,
        username: row.username,
        fullName: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.username,
      },
      season: row.seasonId
        ? { id: row.seasonId, code: row.seasonCode, name: row.seasonName }
        : null,
      allocations: payment.allocations,
      refunds: payment.refunds,
      attempt: payment.attempt,
    };
  }

  async wallet(memberReference: string, currencyCode?: string) {
    const wallet = await this.portal.wallet(memberReference, currencyCode);
    const balance = new Prisma.Decimal(wallet.balance);
    let runningBalance = balance;
    const recentEntries = wallet.recentEntries.map((entry) => {
      const amount = new Prisma.Decimal(entry.amount);
      const rowBalance = runningBalance;
      runningBalance =
        entry.direction === 'CREDIT'
          ? runningBalance.minus(amount)
          : runningBalance.plus(amount);
      return {
        ...entry,
        amount: amount.toFixed(2),
        runningBalance: rowBalance.toFixed(2),
      };
    });
    const totals = wallet.account
      ? await this.rows<WalletTotalsRow>(
          `SELECT
             COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END), 0) AS creditTotal,
             COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount ELSE 0 END), 0) AS debitTotal
           FROM ledger_entries WHERE accountId=?`,
          [wallet.account.id],
        )
      : [{ creditTotal: 0, debitTotal: 0 }];
    return {
      ...wallet,
      balance: balance.toFixed(2),
      creditTotal: new Prisma.Decimal(totals[0]?.creditTotal ?? 0).toFixed(2),
      debitTotal: new Prisma.Decimal(totals[0]?.debitTotal ?? 0).toFixed(2),
      recentEntries,
    };
  }

  async listEpins() {
    return (await this.listEpinsPage({ status: 'ACTIVE', page: 1, pageSize: 500 })).items;
  }

  async listEpinsPage(query: EpinInventoryQuery = {}) {
    const status = String(query.status ?? 'ACTIVE').trim().toUpperCase();
    const pinType = String(query.pinType ?? 'ALL').trim().toUpperCase();
    if (!['ACTIVE', 'UNUSED', 'USED', 'REVOKED', 'ALL'].includes(status)) throw new BadRequestException('E-PIN status filter is invalid');
    if (!['ALL', 'ACTIVATION', 'INSTALLMENT'].includes(pinType)) throw new BadRequestException('E-PIN type filter is invalid');

    const parsedPage = Number.parseInt(String(query.page ?? '1'), 10);
    const parsedPageSize = Number.parseInt(String(query.pageSize ?? '25'), 10);
    const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize = Number.isFinite(parsedPageSize) ? Math.max(1, Math.min(100, parsedPageSize)) : 25;
    const conditions: string[] = [];
    const values: SqlValue[] = [];
    if (status === 'ACTIVE') conditions.push("e.status='ACTIVE' AND e.expiresAt>CURRENT_TIMESTAMP(3)");
    if (status === 'UNUSED') conditions.push("e.status='ACTIVE' AND e.usedByUserId IS NULL AND e.expiresAt>CURRENT_TIMESTAMP(3)");
    if (status === 'USED') conditions.push("e.status='USED'");
    if (status === 'REVOKED') conditions.push("e.status='REVOKED'");
    if (query.memberUserId?.trim()) {
      conditions.push('(e.assignedUserId=? OR e.usedByUserId=?)');
      values.push(query.memberUserId.trim(), query.memberUserId.trim());
    }
    if (query.seasonId?.trim()) {
      conditions.push('e.seasonId=?');
      values.push(query.seasonId.trim());
    }
    if (pinType !== 'ALL') {
      conditions.push('e.pinType=?');
      values.push(pinType);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totals = await this.rows<{ total: bigint | number | string }>(
      `SELECT COUNT(*) AS total FROM owner_epins e ${where}`,
      values,
    );
    const total = Number(totals[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const rows = await this.rows<Record<string, unknown> & { pinCiphertext: string | null }>(
      `SELECT e.id, e.pinCiphertext, e.displaySuffix, e.pinType,
              CASE WHEN e.status='ACTIVE' AND e.expiresAt<=CURRENT_TIMESTAMP(3) THEN 'EXPIRED' ELSE e.status END AS status,
              e.expiresAt, e.usedAt, e.revokedAt, e.createdAt,
              s.id AS seasonId, s.code AS seasonCode, s.name AS seasonName,
              assigned.username AS assignedUsername, used.username AS usedByUsername,
              COALESCE(assigned.username, used.username) AS assignedToUsername
       FROM owner_epins e
       LEFT JOIN owner_seasons s ON s.id=e.seasonId
       LEFT JOIN users assigned ON assigned.id=e.assignedUserId
       LEFT JOIN users used ON used.id=e.usedByUserId
       ${where}
       ORDER BY e.createdAt DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset],
    );
    const items = rows.map(({ pinCiphertext, ...row }) => ({
      ...row,
      pin: pinCiphertext ? this.memberPayments.decryptPin(pinCiphertext) : null,
    }));
    return { items, total, page, pageSize, totalPages };
  }

  async listAuthCodes() {
    const rows = await this.rows<Record<string, unknown> & { codeCiphertext: string | null }>(
      `SELECT c.id, c.codeCiphertext, c.displaySuffix, c.roleScope, c.purpose,
              CASE
                WHEN c.status='ACTIVE' AND c.expiresAt<=CURRENT_TIMESTAMP(3) THEN 'EXPIRED'
                ELSE c.status
              END AS status,
              c.expiresAt, c.usedAt, c.revokedAt, c.createdAt,
              operator.username AS operatorUsername
       FROM owner_auth_codes c
       LEFT JOIN users operator ON operator.id=c.operatorUserId
       ORDER BY c.createdAt DESC LIMIT 200`,
    );
    return rows.map(({ codeCiphertext, ...row }) => ({
      ...row,
      code: codeCiphertext ? this.portal.decryptAuthCode(codeCiphertext) : null,
    }));
  }

  private formatPaymentRow(row: PaymentListRow) {
    const amount = new Prisma.Decimal(row.amount);
    const refundedAmount = new Prisma.Decimal(row.refundedAmount ?? 0);
    const status = refundedAmount.greaterThanOrEqualTo(amount)
      ? 'REFUNDED'
      : refundedAmount.greaterThan(0)
        ? 'PARTIALLY_REFUNDED'
        : 'RECORDED';
    const occurredAt = this.utcInstant(row.occurredAt);
    return {
      ...row,
      occurredAt,
      receiptNumber: this.receiptNumber(row.id, occurredAt),
      amount: amount.toFixed(2),
      refundedAmount: refundedAmount.toFixed(2),
      netAmount: amount.minus(refundedAmount).toFixed(2),
      paymentType: row.paymentType || 'OTHER',
      status,
    };
  }

  private utcInstant(value: Date | string) {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
    }

    const raw = String(value).trim();
    const naiveUtc = raw.match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)$/,
    );
    const candidate = naiveUtc ? `${naiveUtc[1]}T${naiveUtc[2]}Z` : raw;
    const parsed = new Date(candidate);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
  }

  private receiptNumber(id: string, occurredAt: Date | string) {
    const date = new Date(occurredAt);
    const stamp = Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10).replaceAll('-', '')
      : 'UNKNOWN';
    const suffix = id.replaceAll('-', '').slice(-8).toUpperCase();
    return `MGC-${stamp}-${suffix}`;
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(
      async (connection) => (await connection.query(sql, values)) as T[],
    );
  }
}
