import { Injectable, NotFoundException } from '@nestjs/common';
import { FinancialDbService } from '../database/financial-db.service';
import { Prisma } from '../generated/prisma/client';
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

type PortalSettingsRow = {
  companyName: string;
  currencyCode: string;
};

type WalletTotalsRow = {
  creditTotal: string | number | null;
  debitTotal: string | number | null;
};

@Injectable()
export class OwnerPortalFinanceService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly portal: OwnerPortalService,
    private readonly programPayments: ProgramPaymentService,
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
    return {
      ...this.formatPaymentRow(row),
      companyName: settings[0]?.companyName ?? 'MegaGoldenClub',
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
    return this.rows<Record<string, unknown>>(
      `SELECT e.id, e.displaySuffix,
              CASE
                WHEN e.status='ACTIVE' AND e.expiresAt<=CURRENT_TIMESTAMP(3) THEN 'EXPIRED'
                ELSE e.status
              END AS status,
              e.expiresAt, e.usedAt, e.revokedAt, e.createdAt,
              s.id AS seasonId, s.code AS seasonCode, s.name AS seasonName,
              assigned.username AS assignedUsername, used.username AS usedByUsername
       FROM owner_epins e
       LEFT JOIN owner_seasons s ON s.id=e.seasonId
       LEFT JOIN users assigned ON assigned.id=e.assignedUserId
       LEFT JOIN users used ON used.id=e.usedByUserId
       ORDER BY e.createdAt DESC LIMIT 500`,
    );
  }

  async listAuthCodes() {
    return this.rows<Record<string, unknown>>(
      `SELECT c.id, c.displaySuffix, c.roleScope, c.purpose,
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
  }

  private formatPaymentRow(row: PaymentListRow) {
    const amount = new Prisma.Decimal(row.amount);
    const refundedAmount = new Prisma.Decimal(row.refundedAmount ?? 0);
    const status = refundedAmount.greaterThanOrEqualTo(amount)
      ? 'REFUNDED'
      : refundedAmount.greaterThan(0)
        ? 'PARTIALLY_REFUNDED'
        : 'RECORDED';
    return {
      ...row,
      receiptNumber: this.receiptNumber(row.id, row.occurredAt),
      amount: amount.toFixed(2),
      refundedAmount: refundedAmount.toFixed(2),
      netAmount: amount.minus(refundedAmount).toFixed(2),
      paymentType: row.paymentType || 'OTHER',
      status,
    };
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
