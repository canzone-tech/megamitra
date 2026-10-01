import { ConflictException, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { FinancialDbService } from '../database/financial-db.service';

type SubmissionRow = {
  id: string;
  purpose: string;
  status: string;
  requesterUserId: string;
  enrollmentId: string | null;
  programPaymentRecordId: string | null;
};

type AllocationRow = {
  paymentAllocationId: string;
  paymentRecordId: string;
  enrollmentId: string;
  installmentId: string;
  installmentSequence: number;
  userId: string;
};

type TokenRow = {
  token: string;
  installmentSequence: number | null;
  status: string;
  drawId: string | null;
  entryId: string | null;
};

type DrawEntryRow = {
  entryId: string;
  userId: string;
  drawToken: string | null;
  enrollmentId: string | null;
  monthNumber: number | null;
};

type AffectedRows = { affectedRows?: number };

type TokenInsert = {
  sourceType: 'INSTALLMENT' | 'DRAW_ENTRY';
  userId: string;
  enrollmentId?: string | null;
  installmentId?: string | null;
  installmentSequence?: number | null;
  paymentRecordId?: string | null;
  paymentAllocationId?: string | null;
  paymentSubmissionId?: string | null;
  drawId?: string | null;
  entryId?: string | null;
  status: 'AVAILABLE' | 'USED';
};

@Injectable()
export class LuckyDrawTokenService {
  private readonly tokenSpaceStart = 10_000;
  private readonly tokenSpaceEndExclusive = 100_000;
  private readonly collisionRetries = 128;

  constructor(private readonly db: FinancialDbService) {}

  async ensureConfirmedInstallmentSubmission(submissionId: string) {
    return this.db.transaction(async (connection) => {
      const rows = await connection.query<SubmissionRow[]>(
        `SELECT id, purpose, status, requesterUserId, enrollmentId, programPaymentRecordId
         FROM member_payment_submissions WHERE id=? LIMIT 1 FOR UPDATE`,
        [submissionId],
      );
      const submission = rows[0];
      if (
        !submission ||
        submission.purpose !== 'INSTALLMENT' ||
        submission.status !== 'CONFIRMED' ||
        !submission.enrollmentId ||
        !submission.programPaymentRecordId
      ) {
        return this.loadSubmissionTokens(connection, submissionId);
      }

      const allocations = await connection.query<AllocationRow[]>(
        `SELECT a.id AS paymentAllocationId, a.paymentRecordId, a.enrollmentId,
                a.installmentId, i.sequence AS installmentSequence, e.userId
         FROM program_payment_allocations a
         JOIN program_installments i ON i.id=a.installmentId
         JOIN program_enrollments e ON e.id=a.enrollmentId
         WHERE a.paymentRecordId=? AND a.allocationType='INSTALLMENT'
           AND a.installmentId IS NOT NULL
         ORDER BY i.sequence ASC, a.createdAt ASC, a.id ASC`,
        [submission.programPaymentRecordId],
      );

      for (const allocation of allocations) {
        await this.ensureInstallmentToken(connection, allocation, submission.id);
      }
      return this.loadSubmissionTokens(connection, submission.id);
    });
  }

  async tokensForSubmission(submissionId: string) {
    await this.ensureConfirmedInstallmentSubmission(submissionId);
    return this.db.transaction((connection) => this.loadSubmissionTokens(connection, submissionId));
  }

  async tokensForPublicReceipt(publicToken: string) {
    const rows = await this.db.transaction((connection) =>
      connection.query<Array<{ id: string }>>(
        'SELECT id FROM member_payment_submissions WHERE publicToken=? LIMIT 1',
        [publicToken],
      ),
    );
    const id = rows[0]?.id;
    return id ? this.tokensForSubmission(id) : [];
  }

  async assignDrawTokens(drawId: string) {
    return this.db.transaction(async (connection) => {
      const entries = await connection.query<DrawEntryRow[]>(
        `SELECT e.id AS entryId, e.userId, e.drawToken,
                be.enrollmentId, odr.monthNumber
         FROM lucky_draw_entries e
         LEFT JOIN program_draw_eligibility_hooks h ON h.id=e.sourceHookId
         LEFT JOIN program_business_events be ON be.id=h.businessEventId
         LEFT JOIN owner_draw_runs odr ON odr.drawId=e.drawId
         WHERE e.drawId=? AND e.disposition='ELIGIBLE'
         ORDER BY e.entrySequence ASC, e.id ASC`,
        [drawId],
      );

      for (const entry of entries) {
        if (entry.drawToken) continue;
        let token: string | null = null;
        if (entry.enrollmentId && Number(entry.monthNumber) >= 1) {
          token = await this.consumeInstallmentToken(
            connection,
            entry.enrollmentId,
            Number(entry.monthNumber),
            drawId,
            entry.entryId,
          );
        }
        if (!token) {
          token = await this.ensureDrawEntryToken(connection, entry, drawId);
        }
        await connection.query(
          'UPDATE lucky_draw_entries SET drawToken=? WHERE id=? AND drawToken IS NULL',
          [token, entry.entryId],
        );
      }

      return connection.query<Array<{ entryId: string; drawToken: string }>>(
        `SELECT id AS entryId, drawToken FROM lucky_draw_entries
         WHERE drawId=? AND disposition='ELIGIBLE'
         ORDER BY entrySequence ASC, id ASC`,
        [drawId],
      );
    });
  }

  private async ensureInstallmentToken(
    connection: PoolConnection,
    allocation: AllocationRow,
    submissionId: string,
  ) {
    const existing = await connection.query<Array<{ token: string }>>(
      `SELECT token FROM lucky_draw_tokens
       WHERE paymentAllocationId=? OR (enrollmentId=? AND installmentId=?)
       ORDER BY createdAt ASC LIMIT 1`,
      [allocation.paymentAllocationId, allocation.enrollmentId, allocation.installmentId],
    );
    if (existing[0]) {
      await connection.query(
        `UPDATE lucky_draw_tokens
         SET paymentSubmissionId=COALESCE(paymentSubmissionId, ?),
             paymentRecordId=COALESCE(paymentRecordId, ?),
             paymentAllocationId=COALESCE(paymentAllocationId, ?)
         WHERE token=?`,
        [
          submissionId,
          allocation.paymentRecordId,
          allocation.paymentAllocationId,
          existing[0].token,
        ],
      );
      return existing[0].token;
    }

    return this.insertUniqueToken(connection, {
      sourceType: 'INSTALLMENT',
      userId: allocation.userId,
      enrollmentId: allocation.enrollmentId,
      installmentId: allocation.installmentId,
      installmentSequence: Number(allocation.installmentSequence),
      paymentRecordId: allocation.paymentRecordId,
      paymentAllocationId: allocation.paymentAllocationId,
      paymentSubmissionId: submissionId,
      status: 'AVAILABLE',
    });
  }

  private async consumeInstallmentToken(
    connection: PoolConnection,
    enrollmentId: string,
    installmentSequence: number,
    drawId: string,
    entryId: string,
  ) {
    const rows = await connection.query<Array<{ token: string }>>(
      `SELECT token FROM lucky_draw_tokens
       WHERE enrollmentId=? AND installmentSequence=? AND status='AVAILABLE'
         AND drawId IS NULL AND entryId IS NULL
       ORDER BY createdAt ASC, token ASC LIMIT 1 FOR UPDATE`,
      [enrollmentId, installmentSequence],
    );
    const token = rows[0]?.token;
    if (!token) return null;
    const result = (await connection.query(
      `UPDATE lucky_draw_tokens
       SET status='USED', drawId=?, entryId=?, usedAt=CURRENT_TIMESTAMP(3)
       WHERE token=? AND status='AVAILABLE' AND drawId IS NULL AND entryId IS NULL`,
      [drawId, entryId, token],
    )) as AffectedRows;
    return Number(result.affectedRows ?? 0) === 1 ? token : null;
  }

  private async ensureDrawEntryToken(
    connection: PoolConnection,
    entry: DrawEntryRow,
    drawId: string,
  ) {
    const existing = await connection.query<Array<{ token: string }>>(
      'SELECT token FROM lucky_draw_tokens WHERE entryId=? LIMIT 1',
      [entry.entryId],
    );
    if (existing[0]) return existing[0].token;
    return this.insertUniqueToken(connection, {
      sourceType: 'DRAW_ENTRY',
      userId: entry.userId,
      enrollmentId: entry.enrollmentId,
      drawId,
      entryId: entry.entryId,
      status: 'USED',
    });
  }

  private async insertUniqueToken(connection: PoolConnection, input: TokenInsert) {
    for (let attempt = 0; attempt < this.collisionRetries; attempt += 1) {
      const token = randomInt(this.tokenSpaceStart, this.tokenSpaceEndExclusive).toString();
      try {
        await connection.query(
          `INSERT INTO lucky_draw_tokens
           (token, sourceType, userId, enrollmentId, installmentId, installmentSequence,
            paymentRecordId, paymentAllocationId, paymentSubmissionId, drawId, entryId,
            status, createdAt, usedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)`,
          [
            token,
            input.sourceType,
            input.userId,
            input.enrollmentId ?? null,
            input.installmentId ?? null,
            input.installmentSequence ?? null,
            input.paymentRecordId ?? null,
            input.paymentAllocationId ?? null,
            input.paymentSubmissionId ?? null,
            input.drawId ?? null,
            input.entryId ?? null,
            input.status,
            input.status === 'USED' ? new Date() : null,
          ],
        );
        return token;
      } catch (error) {
        if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
        if (input.paymentAllocationId) {
          const raced = await connection.query<Array<{ token: string }>>(
            'SELECT token FROM lucky_draw_tokens WHERE paymentAllocationId=? LIMIT 1',
            [input.paymentAllocationId],
          );
          if (raced[0]) return raced[0].token;
        }
        if (input.entryId) {
          const raced = await connection.query<Array<{ token: string }>>(
            'SELECT token FROM lucky_draw_tokens WHERE entryId=? LIMIT 1',
            [input.entryId],
          );
          if (raced[0]) return raced[0].token;
        }
      }
    }
    throw new ConflictException(
      'Unable to allocate a unique five-digit lucky draw token; the token namespace may be exhausted',
    );
  }

  private loadSubmissionTokens(connection: PoolConnection, submissionId: string) {
    return connection.query<TokenRow[]>(
      `SELECT token, installmentSequence, status, drawId, entryId
       FROM lucky_draw_tokens
       WHERE paymentSubmissionId=? AND sourceType='INSTALLMENT'
       ORDER BY installmentSequence ASC, createdAt ASC, token ASC`,
      [submissionId],
    );
  }
}
