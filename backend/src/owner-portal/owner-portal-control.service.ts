import { BadRequestException, Injectable } from '@nestjs/common';
import { FinancialDbService } from '../database/financial-db.service';
import { OwnerPortalFinanceService } from './owner-portal-finance.service';
import { OwnerPortalService } from './owner-portal.service';

type SqlValue = string | number | bigint | boolean | Date | null;
type ReportCode = 'MEMBERS' | 'BINARY' | 'INCOME' | 'PAYMENTS' | 'WINNERS' | 'AUDIT';

const REPORT_CODES: ReportCode[] = [
  'MEMBERS',
  'BINARY',
  'INCOME',
  'PAYMENTS',
  'WINNERS',
  'AUDIT',
];

@Injectable()
export class OwnerPortalControlService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly portal: OwnerPortalService,
    private readonly finance: OwnerPortalFinanceService,
  ) {}

  async reportData(rawCode: string, limit = 500) {
    const code = rawCode.trim().toUpperCase() as ReportCode;
    if (!REPORT_CODES.includes(code)) {
      throw new BadRequestException('Unsupported owner report code');
    }
    const take = Math.max(1, Math.min(1000, limit));
    let rows: Array<Record<string, unknown>>;

    if (code === 'MEMBERS') rows = await this.memberRegistrationReport(take);
    else if (code === 'BINARY') rows = await this.binaryPairReport(take);
    else if (code === 'INCOME') rows = await this.incomeLedgerReport(take);
    else if (code === 'PAYMENTS') rows = await this.finance.listPayments(take);
    else if (code === 'WINNERS') rows = await this.winnerReport(take);
    else rows = await this.portal.recentActivity(Math.min(take, 200));

    return {
      code,
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows,
    };
  }

  async governanceSnapshot() {
    const [settings, dashboard] = await Promise.all([
      this.portal.settings(),
      this.portal.dashboard(),
    ]);
    const activeSeason = dashboard.activeSeason as Record<string, unknown> | null;
    return {
      settings,
      activeSeason,
      dailyCap: dashboard.dailyCap,
      openSupportTickets: dashboard.openTickets,
      pendingNotifications: dashboard.pendingNotifications,
      controls: [
        {
          code: 'RBAC',
          label: 'Role-based access',
          status: 'ENFORCED',
          detail: 'Owner routes are protected by permission checks and SuperAdmin policy.',
        },
        {
          code: 'MFA',
          label: 'Two-factor authentication',
          status: 'NOT_CONFIGURED',
          detail: 'The current identity configuration does not publish a dedicated second-factor policy.',
        },
        {
          code: 'AUDIT',
          label: 'Immutable audit logs',
          status: 'ACTIVE',
          detail: 'Administrative and business mutations write audit evidence.',
        },
        {
          code: 'BACKUP',
          label: 'Data backup',
          status: 'RUNBOOK',
          detail: 'Backup and restore remain controlled operational procedures rather than portal data fields.',
        },
        {
          code: 'PAYMENT_RECONCILIATION',
          label: 'Payment reconciliation',
          status: 'ACTIVE',
          detail: 'Payments and refunds retain immutable records and reconciliation visibility.',
        },
        {
          code: 'WINNER_VERIFICATION',
          label: 'Winner verification',
          status: 'ACTIVE',
          detail: 'Eligibility, identity and payment checks are recorded before approval.',
        },
        {
          code: 'PRIVACY',
          label: 'Privacy / consent records',
          status: 'POLICY_REQUIRED',
          detail: 'No dedicated privacy-consent record model is defined in the supplied management workflow.',
        },
        {
          code: 'TERMS',
          label: 'Terms and conditions',
          status: 'POLICY_REQUIRED',
          detail: 'Terms publication belongs to controlled content/policy configuration.',
        },
        {
          code: 'TAX',
          label: 'Tax records',
          status: 'POLICY_REQUIRED',
          detail: 'No tax-record workflow is defined by the supplied management portal source.',
        },
        {
          code: 'COMPLAINTS',
          label: 'Complaint handling',
          status: 'ACTIVE',
          detail: `${dashboard.openTickets} support ticket(s) currently require attention.`,
        },
        {
          code: 'SEASON_ACTIVATION',
          label: 'Controlled season activation',
          status: 'ACTIVE',
          detail: activeSeason
            ? `Current season status: ${String(activeSeason.status ?? 'UNKNOWN')}.`
            : 'No active season is currently published.',
        },
      ],
    };
  }

  private memberRegistrationReport(limit: number) {
    return this.rows<Record<string, unknown>>(
      `SELECT pe.id AS enrollmentId, pe.enrolledAt, pe.status AS enrollmentStatus,
              pe.currencyCode, pe.registrationFeeSnapshot, pe.installmentAmountSnapshot,
              pe.installmentCountSnapshot,
              u.id AS userId, u.username, u.firstName, u.lastName, u.email, u.phone,
              s.id AS seasonId, s.code AS seasonCode, s.name AS seasonName
       FROM program_enrollments pe
       INNER JOIN users u ON u.id=pe.userId
       INNER JOIN owner_seasons s ON s.programVersionId=pe.programVersionId
       WHERE s.status IN ('ACTIVE','PAUSED')
       ORDER BY pe.enrolledAt DESC, pe.createdAt DESC
       LIMIT ?`,
      [limit],
    );
  }

  private binaryPairReport(limit: number) {
    return this.rows<Record<string, unknown>>(
      `SELECT bpm.id, bpm.pairSequence, u.username,
              bpm.leftUnitId, bpm.rightUnitId, bpm.payoutAmount,
              bpm.payable, bpm.createdAt
       FROM binary_pair_matches bpm
       INNER JOIN users u ON u.id=bpm.memberUserId
       WHERE bpm.createdAt >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
       ORDER BY bpm.createdAt DESC
       LIMIT ?`,
      [limit],
    );
  }

  private incomeLedgerReport(limit: number) {
    return this.rows<Record<string, unknown>>(
      `SELECT e.id, u.username, t.sourceKey AS reference, t.type,
              e.direction, e.amount, e.currencyCode,
              t.description, t.occurredAt
       FROM ledger_entries e
       INNER JOIN ledger_accounts a ON a.id=e.accountId
       INNER JOIN users u ON u.id=a.ownerUserId
       INNER JOIN ledger_transactions t ON t.id=e.transactionId
       WHERE a.kind='USER_WALLET'
         AND t.occurredAt >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
       ORDER BY t.occurredAt DESC, e.createdAt DESC
       LIMIT ?`,
      [limit],
    );
  }

  private winnerReport(limit: number) {
    return this.rows<Record<string, unknown>>(
      `SELECT w.id AS winnerId, w.overallRank, w.tierWinnerPosition, w.createdAt,
              u.username, s.code AS seasonCode, s.name AS seasonName,
              dr.monthNumber, dr.status AS drawStatus, d.drawAt,
              pt.code AS prizeCode, pt.name AS prizeName, pt.prizeKind,
              pt.cashAmount, pt.currencyCode,
              COALESCE(v.status, 'PENDING') AS verificationStatus
       FROM lucky_draw_winners w
       INNER JOIN users u ON u.id=w.userId
       INNER JOIN lucky_draw_instances d ON d.id=w.drawId
       INNER JOIN lucky_draw_prize_tiers pt ON pt.id=w.prizeTierId
       LEFT JOIN owner_draw_runs dr ON dr.drawId=w.drawId
       LEFT JOIN owner_seasons s ON s.id=dr.seasonId
       LEFT JOIN owner_winner_verifications v ON v.winnerId=w.id
       ORDER BY w.createdAt DESC, w.overallRank ASC
       LIMIT ?`,
      [limit],
    );
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(
      async (connection) => (await connection.query(sql, values)) as T[],
    );
  }
}
