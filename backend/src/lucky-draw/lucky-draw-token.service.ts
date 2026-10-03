import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { FinancialDbService } from '../database/financial-db.service';
import {
  generateLuckyDrawToken,
  LUCKY_DRAW_TOKEN_COLLISION_RETRIES,
} from './lucky-draw-token.util';

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
  seasonId: string;
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
  seasonId: string | null;
};

type AffectedRows = { affectedRows?: number };

type OwnerDrawSnapshotRow = {
  drawStatus: 'SCHEDULED' | 'SNAPSHOTTED' | 'DRAWN' | 'VOIDED';
  snapshotHash: string | null;
  candidateCount: number;
  eligibleEntryCount: number;
  excludedEntryCount: number;
  entryWindowEnd: Date;
  policyLifecycle: string;
  programVersionId: string;
  seasonId: string | null;
  monthNumber: number | null;
};

type OwnerDrawTokenCandidateRow = {
  token: string;
  userId: string;
  enrollmentId: string;
  installmentSequence: number;
  tokenCreatedAt: Date;
  enrollmentStatus: 'ACTIVE' | 'COMPLETED';
};

type OwnerDrawSnapshotResult = {
  idempotent: boolean;
  snapshotHash: string | null;
  candidateCount: number;
  eligibleEntryCount: number;
  excludedEntryCount: number;
};

type TokenInsert = {
  sourceType: 'INSTALLMENT' | 'DRAW_ENTRY';
  seasonId?: string | null;
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
                a.installmentId, i.sequence AS installmentSequence, e.userId,
                s.id AS seasonId
         FROM program_payment_allocations a
         JOIN program_installments i ON i.id=a.installmentId
         JOIN program_enrollments e ON e.id=a.enrollmentId
         JOIN owner_seasons s ON s.programVersionId=e.programVersionId
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

  async ensurePaymentRecordInstallmentTokens(paymentRecordId: string) {
    return this.db.transaction(async (connection) => {
      const allocations = await connection.query<AllocationRow[]>(
        `SELECT a.id AS paymentAllocationId, a.paymentRecordId, a.enrollmentId,
                a.installmentId, i.sequence AS installmentSequence, e.userId,
                s.id AS seasonId
         FROM program_payment_allocations a
         JOIN program_installments i ON i.id=a.installmentId
         JOIN program_enrollments e ON e.id=a.enrollmentId
         JOIN owner_seasons s ON s.programVersionId=e.programVersionId
         WHERE a.paymentRecordId=? AND a.allocationType='INSTALLMENT'
           AND a.installmentId IS NOT NULL
         ORDER BY i.sequence ASC, a.createdAt ASC, a.id ASC`,
        [paymentRecordId],
      );
      for (const allocation of allocations) {
        await this.ensureInstallmentToken(connection, allocation, null);
      }
      return connection.query<TokenRow[]>(
        `SELECT token, installmentSequence, status, drawId, entryId
         FROM lucky_draw_tokens
         WHERE paymentRecordId=? AND sourceType='INSTALLMENT'
         ORDER BY installmentSequence ASC, createdAt ASC, token ASC`,
        [paymentRecordId],
      );
    });
  }


  async snapshotOwnerMonthlyDrawEntrants(
    drawId: string,
  ): Promise<OwnerDrawSnapshotResult | null> {
    return this.db.transaction(async (connection) => {
      const rows = await connection.query<OwnerDrawSnapshotRow[]>(
        `SELECT d.status AS drawStatus, d.snapshotHash, d.candidateCount,
                d.eligibleEntryCount, d.excludedEntryCount, d.entryWindowEnd,
                v.lifecycle AS policyLifecycle, v.programVersionId,
                odr.seasonId, odr.monthNumber
         FROM lucky_draw_instances d
         JOIN lucky_draw_policy_versions v ON v.id=d.policyVersionId
         LEFT JOIN owner_draw_runs odr ON odr.drawId=d.id
         WHERE d.id=? LIMIT 1 FOR UPDATE`,
        [drawId],
      );
      const draw = rows[0];
      if (!draw) throw new ConflictException('Lucky draw instance was not found');
      if (!draw.seasonId || !draw.monthNumber) return null;
      if (draw.drawStatus === 'SNAPSHOTTED' || draw.drawStatus === 'DRAWN') {
        return {
          idempotent: true,
          snapshotHash: draw.snapshotHash,
          candidateCount: Number(draw.candidateCount),
          eligibleEntryCount: Number(draw.eligibleEntryCount),
          excludedEntryCount: Number(draw.excludedEntryCount),
        };
      }
      if (draw.drawStatus === 'VOIDED') {
        throw new ConflictException('Voided lucky draw cannot be snapshotted');
      }
      if (new Date(draw.entryWindowEnd).getTime() > Date.now()) {
        throw new ConflictException('Lucky draw entry window has not closed yet');
      }
      if (draw.policyLifecycle !== 'PUBLISHED') {
        throw new ConflictException('Lucky draw policy version is no longer published');
      }

      const missingTokenAllocations = await connection.query<AllocationRow[]>(
        `SELECT a.id AS paymentAllocationId, a.paymentRecordId, a.enrollmentId,
                a.installmentId, i.sequence AS installmentSequence, e.userId,
                s.id AS seasonId
         FROM program_payment_allocations a
         JOIN program_installments i ON i.id=a.installmentId
         JOIN program_enrollments e ON e.id=a.enrollmentId
         JOIN owner_seasons s ON s.programVersionId=e.programVersionId
         LEFT JOIN lucky_draw_tokens t
           ON t.paymentAllocationId=a.id OR (t.enrollmentId=a.enrollmentId AND t.installmentId=a.installmentId)
         WHERE e.programVersionId=? AND i.sequence=?
           AND a.allocationType='INSTALLMENT' AND a.installmentId IS NOT NULL
           AND a.amount>=i.amount AND t.token IS NULL
         ORDER BY a.createdAt ASC, a.id ASC
         FOR UPDATE`,
        [draw.programVersionId, Number(draw.monthNumber)],
      );
      for (const allocation of missingTokenAllocations) {
        await this.ensureInstallmentToken(connection, allocation, null);
      }

      const candidates = await connection.query<OwnerDrawTokenCandidateRow[]>(
        `SELECT t.token, t.userId, t.enrollmentId,
                t.installmentSequence, t.createdAt AS tokenCreatedAt,
                e.status AS enrollmentStatus
         FROM lucky_draw_tokens t
         JOIN program_enrollments e ON e.id=t.enrollmentId
         JOIN users u ON u.id=t.userId
         WHERE t.sourceType='INSTALLMENT'
           AND t.seasonId=?
           AND t.installmentSequence=?
           AND t.status='AVAILABLE'
           AND t.drawId IS NULL
           AND t.entryId IS NULL
           AND t.createdAt<=?
           AND e.programVersionId=?
           AND e.status IN ('ACTIVE','COMPLETED')
           AND u.status='ACTIVE'
         ORDER BY t.createdAt ASC, t.token ASC
         FOR UPDATE`,
        [draw.seasonId, Number(draw.monthNumber), draw.entryWindowEnd, draw.programVersionId],
      );

      const priorWinnerRows = await connection.query<Array<{ userId: string }>>(
        `SELECT DISTINCT w.userId
         FROM lucky_draw_winners w
         JOIN owner_draw_runs priorRun ON priorRun.drawId=w.drawId
         WHERE priorRun.seasonId=? AND priorRun.monthNumber<?`,
        [draw.seasonId, Number(draw.monthNumber)],
      );
      const priorWinners = new Set(priorWinnerRows.map((row) => row.userId));
      const seenUsers = new Set<string>();
      let sequence = 0;
      const snapshotRows = candidates.map((candidate) => {
        let disposition: 'ELIGIBLE' | 'DUPLICATE_USER' | 'PRIOR_WINNER' = 'ELIGIBLE';
        let exclusionReason: string | null = null;
        if (priorWinners.has(candidate.userId)) {
          disposition = 'PRIOR_WINNER';
          exclusionReason = 'PRIOR_SEASON_WINNER';
        } else if (seenUsers.has(candidate.userId)) {
          disposition = 'DUPLICATE_USER';
          exclusionReason = 'ONE_ENTRY_PER_USER_POLICY';
        }
        seenUsers.add(candidate.userId);
        const entrySequence = disposition === 'ELIGIBLE' ? ++sequence : null;
        const eligibilitySnapshot = {
          source: 'INSTALLMENT_TOKEN_REGISTRY',
          seasonId: draw.seasonId,
          monthNumber: Number(draw.monthNumber),
          token: candidate.token,
          installmentSequence: Number(candidate.installmentSequence),
          enrollmentId: candidate.enrollmentId,
          enrollmentStatus: candidate.enrollmentStatus,
          tokenCreatedAt: new Date(candidate.tokenCreatedAt).toISOString(),
        };
        return {
          candidate,
          disposition,
          exclusionReason,
          entrySequence,
          eligibilitySnapshot,
        };
      });

      const snapshotHash = createHash('sha256')
        .update(
          snapshotRows
            .map((row) =>
              [
                row.candidate.token,
                row.candidate.userId,
                row.candidate.enrollmentId,
                String(row.candidate.installmentSequence),
                new Date(row.candidate.tokenCreatedAt).toISOString(),
                row.disposition,
                row.entrySequence ?? '',
                JSON.stringify(row.eligibilitySnapshot),
              ].join('|'),
            )
            .join('\n'),
        )
        .digest('hex');

      for (const row of snapshotRows) {
        const entryId = randomUUID();
        const drawToken = row.disposition === 'ELIGIBLE' ? row.candidate.token : null;
        await connection.query(
          `INSERT INTO lucky_draw_entries
             (id, drawId, sourceHookId, userId, hookOccurredAt, disposition, exclusionReason,
              entrySequence, drawToken, selectionScore, eligibilitySnapshot, createdAt)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP(3))`,
          [
            entryId,
            drawId,
            row.candidate.userId,
            row.candidate.tokenCreatedAt,
            row.disposition,
            row.exclusionReason,
            row.entrySequence,
            drawToken,
            JSON.stringify(row.eligibilitySnapshot),
          ],
        );
        if (drawToken) {
          const used = (await connection.query(
            `UPDATE lucky_draw_tokens
             SET status='USED', drawId=?, entryId=?, usedAt=CURRENT_TIMESTAMP(3)
             WHERE seasonId=? AND token=? AND status='AVAILABLE'
               AND drawId IS NULL AND entryId IS NULL`,
            [drawId, entryId, draw.seasonId, drawToken],
          )) as AffectedRows;
          if (Number(used.affectedRows ?? 0) !== 1) {
            throw new ConflictException(
              `Installment draw token ${drawToken} was consumed concurrently`,
            );
          }
        }
      }

      const candidateCount = snapshotRows.length;
      const eligibleEntryCount = snapshotRows.filter(
        (row) => row.disposition === 'ELIGIBLE',
      ).length;
      const excludedEntryCount = candidateCount - eligibleEntryCount;
      await connection.query(
        `UPDATE lucky_draw_instances
         SET status='SNAPSHOTTED', snapshotHash=?, candidateCount=?, eligibleEntryCount=?,
             excludedEntryCount=?, snapshottedAt=CURRENT_TIMESTAMP(3), updatedAt=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [
          snapshotHash,
          candidateCount,
          eligibleEntryCount,
          excludedEntryCount,
          drawId,
        ],
      );

      return {
        idempotent: false,
        snapshotHash,
        candidateCount,
        eligibleEntryCount,
        excludedEntryCount,
      };
    });
  }

  async assignDrawTokens(drawId: string) {
    return this.db.transaction(async (connection) => {
      const entries = await connection.query<DrawEntryRow[]>(
        `SELECT e.id AS entryId, e.userId, e.drawToken,
                be.enrollmentId, odr.monthNumber, odr.seasonId
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
    submissionId: string | null,
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
             paymentAllocationId=COALESCE(paymentAllocationId, ?),
             seasonId=COALESCE(seasonId, ?)
         WHERE seasonId=? AND token=?`,
        [
          submissionId,
          allocation.paymentRecordId,
          allocation.paymentAllocationId,
          allocation.seasonId,
          allocation.seasonId,
          existing[0].token,
        ],
      );
      return existing[0].token;
    }

    return this.insertUniqueToken(connection, {
      sourceType: 'INSTALLMENT',
      seasonId: allocation.seasonId,
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
       WHERE enrollmentId=? AND token=? AND status='AVAILABLE'
         AND drawId IS NULL AND entryId IS NULL`,
      [drawId, entryId, enrollmentId, token],
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
      seasonId: entry.seasonId,
      userId: entry.userId,
      enrollmentId: entry.enrollmentId,
      drawId,
      entryId: entry.entryId,
      status: 'USED',
    });
  }

  private async insertUniqueToken(connection: PoolConnection, input: TokenInsert) {
    for (let attempt = 0; attempt < LUCKY_DRAW_TOKEN_COLLISION_RETRIES; attempt += 1) {
      const token = generateLuckyDrawToken();
      try {
        await connection.query(
          `INSERT INTO lucky_draw_tokens
           (token, seasonId, sourceType, userId, enrollmentId, installmentId, installmentSequence,
            paymentRecordId, paymentAllocationId, paymentSubmissionId, drawId, entryId,
            status, createdAt, usedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)`,
          [
            token,
            input.seasonId ?? null,
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
