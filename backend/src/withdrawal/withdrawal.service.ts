import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { Prisma } from '../generated/prisma/client';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import type {
  ConfirmWithdrawalPayoutDto,
  CreateWithdrawalDestinationDto,
  CreateWithdrawalPolicyDto,
  CreateWithdrawalPolicyVersionDto,
  CreateWithdrawalRequestDto,
  FailWithdrawalPayoutDto,
  ListWithdrawalRequestsDto,
  StartWithdrawalPayoutDto,
  WithdrawalMemberQueryDto,
  WithdrawalReasonDto,
} from './withdrawal.dto';
import {
  WITHDRAWAL_DESTINATION_TYPES,
  WITHDRAWAL_FEE_MODES,
} from './withdrawal.dto';

type Row = Record<string, unknown>;
type PolicyRow = Row & {
  id: string;
  policyId: string;
  policyCode: string;
  policyName: string;
  currencyCode: string;
  version: number | bigint;
  lifecycle: string;
  minAmount: string | number;
  maxAmount: string | number;
  feeMode: string;
  feeValue: string | number;
  minimumFee: string | number | null;
  maximumFee: string | number | null;
  kycRequired: number | boolean;
  maxPendingRequests: number | bigint;
  dailyAmountLimit: string | number | null;
  monthlyAmountLimit: string | number | null;
  allowedDestinationTypes: unknown;
  reviewRules: unknown;
};
type RequestRow = Row & {
  id: string;
  sourceKey: string;
  requestFingerprint: string;
  userId: string;
  destinationId: string;
  policyVersionId: string;
  status: string;
  amount: string | number;
  feeAmount: string | number;
  netAmount: string | number;
  currencyCode: string;
  ledgerTransactionId: string | null;
};
type AttemptRow = Row & {
  id: string;
  sourceKey: string;
  requestFingerprint: string;
  requestId: string;
  provider: string;
  providerReference: string | null;
  status: string;
};

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
  ) {}

  async getMemberOverview(userId: string, query: WithdrawalMemberQueryDto) {
    const currencyCode = (query.currencyCode ?? 'INR').trim().toUpperCase();
    const [policy, destinations, requests, wallet, kycRows] = await Promise.all([
      this.findActivePolicy(currencyCode),
      this.prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, type, label, reference, metadata, status, isDefault, deactivatedAt, createdAt, updatedAt
         FROM withdrawal_destinations
         WHERE userId = ?
         ORDER BY isDefault DESC, createdAt DESC`,
        userId,
      ),
      this.prisma.$queryRawUnsafe<Row[]>(
        `SELECT r.*, d.type AS destinationType, d.label AS destinationLabel,
                d.reference AS destinationReference,
                p.code AS policyCode, p.name AS policyName, v.version AS policyVersion
         FROM withdrawal_requests r
         INNER JOIN withdrawal_destinations d ON d.id = r.destinationId
         INNER JOIN withdrawal_policy_versions v ON v.id = r.policyVersionId
         INNER JOIN withdrawal_policies p ON p.id = v.policyId
         WHERE r.userId = ? AND r.currencyCode = ?
         ORDER BY r.requestedAt DESC, r.createdAt DESC
         LIMIT 100`,
        userId,
        currencyCode,
      ),
      this.getWalletSnapshot(userId, currencyCode),
      this.prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM kyc_profiles WHERE userId = ? LIMIT 1`,
        userId,
      ),
    ]);

    const reserved = await this.getReservedAmount(userId, currencyCode);
    return {
      currencyCode,
      kycStatus: kycRows[0]?.status ?? 'NOT_STARTED',
      policy,
      wallet: {
        ...wallet,
        reservedAmount: reserved,
        availableBalance: Prisma.Decimal.max(wallet.balance.minus(reserved), 0),
      },
      destinations: destinations.map((row) => this.normalizeRow(row)),
      requests: requests.map((row) => this.normalizeRow(row)),
    };
  }

  async createDestination(userId: string, dto: CreateWithdrawalDestinationDto) {
    const id = randomUUID();
    const label = dto.label.trim();
    const reference = dto.reference.trim();
    const type = dto.type;
    const metadata = dto.metadata ? JSON.stringify(dto.metadata) : null;

    return this.financialDb.transaction(async (connection) => {
      await this.lockUser(connection, userId);
      const duplicateRows = (await connection.query(
        `SELECT id FROM withdrawal_destinations WHERE userId = ? AND reference = ? LIMIT 1`,
        [userId, reference],
      )) as Row[];
      if (duplicateRows[0]) {
        throw new ConflictException('Withdrawal destination reference already exists');
      }

      const activeRows = (await connection.query(
        `SELECT COUNT(*) AS count FROM withdrawal_destinations WHERE userId = ? AND status = 'ACTIVE'`,
        [userId],
      )) as Array<{ count: number | bigint }>;
      const makeDefault = dto.isDefault === true || Number(activeRows[0]?.count ?? 0) === 0;
      if (makeDefault) {
        await connection.query(
          `UPDATE withdrawal_destinations SET isDefault = FALSE WHERE userId = ?`,
          [userId],
        );
      }

      await connection.query(
        `INSERT INTO withdrawal_destinations
           (id, userId, type, label, reference, metadata, status, isDefault, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [id, userId, type, label, reference, metadata, makeDefault],
      );
      await this.insertAudit(connection, {
        actorUserId: userId,
        action: 'CREATE',
        entityType: 'WithdrawalDestination',
        entityId: id,
        description: 'Withdrawal destination created',
        metadata: { type, label, isDefault: makeDefault },
      });

      return this.getDestinationWithConnection(connection, id, userId);
    });
  }

  async deactivateDestination(userId: string, destinationId: string) {
    return this.financialDb.transaction(async (connection) => {
      await this.lockUser(connection, userId);
      const destination = await this.getDestinationWithConnection(connection, destinationId, userId);
      if (String(destination.status) !== 'ACTIVE') return destination;

      await connection.query(
        `UPDATE withdrawal_destinations
         SET status = 'INACTIVE', isDefault = FALSE, deactivatedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND userId = ?`,
        [destinationId, userId],
      );
      await this.insertAudit(connection, {
        actorUserId: userId,
        action: 'UPDATE',
        entityType: 'WithdrawalDestination',
        entityId: destinationId,
        description: 'Withdrawal destination deactivated',
      });
      return this.getDestinationWithConnection(connection, destinationId, userId);
    });
  }

  async createRequest(userId: string, dto: CreateWithdrawalRequestDto) {
    const sourceKey = dto.sourceKey.trim();
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const fingerprint = this.fingerprint({
      userId,
      destinationId: dto.destinationId,
      amount: amount.toFixed(2),
      currencyCode,
      metadata: dto.metadata ?? null,
    });

    const replay = await this.findRequestBySourceKey(sourceKey);
    if (replay) return this.resolveRequestReplay(replay, userId, fingerprint);

    return this.financialDb.transaction(async (connection) => {
      await this.lockUser(connection, userId);
      const replayRows = (await connection.query(
        `SELECT * FROM withdrawal_requests WHERE sourceKey = ? LIMIT 1 FOR UPDATE`,
        [sourceKey],
      )) as RequestRow[];
      if (replayRows[0]) return this.resolveRequestReplay(replayRows[0], userId, fingerprint);

      const destination = await this.getDestinationWithConnection(connection, dto.destinationId, userId);
      if (String(destination.status) !== 'ACTIVE') {
        throw new BadRequestException('Withdrawal destination is inactive');
      }

      const policy = await this.findActivePolicyWithConnection(connection, currencyCode);
      if (!policy) throw new BadRequestException(`No active withdrawal policy for ${currencyCode}`);
      const allowedTypes = this.stringArray(policy.allowedDestinationTypes);
      if (!allowedTypes.includes(String(destination.type))) {
        throw new BadRequestException('Destination type is not allowed by the active withdrawal policy');
      }

      const kycRows = (await connection.query(
        `SELECT status FROM kyc_profiles WHERE userId = ? LIMIT 1`,
        [userId],
      )) as Array<{ status: string }>;
      const kycStatus = kycRows[0]?.status ?? 'NOT_STARTED';
      if (this.toBoolean(policy.kycRequired) && kycStatus !== 'APPROVED') {
        throw new ForbiddenException('Approved KYC is required before withdrawal');
      }

      const minAmount = new Prisma.Decimal(policy.minAmount);
      const maxAmount = new Prisma.Decimal(policy.maxAmount);
      if (amount.lessThan(minAmount) || amount.greaterThan(maxAmount)) {
        throw new BadRequestException(
          `Withdrawal amount must be between ${minAmount.toFixed(2)} and ${maxAmount.toFixed(2)} ${currencyCode}`,
        );
      }

      const pendingRows = (await connection.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS reserved
         FROM withdrawal_requests
         WHERE userId = ? AND currencyCode = ?
           AND status IN ('REQUESTED','APPROVED','PROCESSING','PAYOUT_FAILED')`,
        [userId, currencyCode],
      )) as Array<{ count: number | bigint; reserved: string | number }>;
      const pendingCount = Number(pendingRows[0]?.count ?? 0);
      const reservedBefore = new Prisma.Decimal(pendingRows[0]?.reserved ?? 0);
      if (pendingCount >= Number(policy.maxPendingRequests)) {
        throw new ConflictException('Maximum pending withdrawal requests reached');
      }

      const balance = await this.getWalletBalanceWithConnection(connection, userId, currencyCode);
      const available = balance.minus(reservedBefore);
      if (available.lessThan(amount)) {
        throw new BadRequestException('Insufficient available wallet balance');
      }

      await this.enforcePeriodLimits(connection, userId, currencyCode, amount, policy);

      const fee = this.calculateFee(amount, policy);
      const net = amount.minus(fee);
      if (net.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Withdrawal fee must be lower than the withdrawal amount');
      }

      const requestId = randomUUID();
      await connection.query(
        `INSERT INTO withdrawal_requests (
           id, sourceKey, requestFingerprint, userId, destinationId, policyVersionId, status,
           amount, feeAmount, netAmount, currencyCode, kycStatusSnapshot, balanceSnapshot,
           reservedBeforeSnapshot, requestedAt, metadata, createdAt, updatedAt
         ) VALUES (
           ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
         )`,
        [
          requestId,
          sourceKey,
          fingerprint,
          userId,
          dto.destinationId,
          policy.id,
          amount.toFixed(2),
          fee.toFixed(2),
          net.toFixed(2),
          currencyCode,
          kycStatus,
          balance.toFixed(2),
          reservedBefore.toFixed(2),
          dto.metadata ? JSON.stringify(dto.metadata) : null,
        ],
      );
      await this.insertAudit(connection, {
        actorUserId: userId,
        action: 'CREATE',
        entityType: 'WithdrawalRequest',
        entityId: requestId,
        description: 'Withdrawal request created',
        metadata: {
          amount: amount.toFixed(2),
          feeAmount: fee.toFixed(2),
          netAmount: net.toFixed(2),
          currencyCode,
          policyVersionId: policy.id,
          destinationId: dto.destinationId,
        },
      });
      return this.getRequestWithConnection(connection, requestId);
    });
  }

  async cancelMine(userId: string, requestId: string) {
    return this.financialDb.transaction(async (connection) => {
      await this.lockUser(connection, userId);
      const request = await this.getRequestWithConnection(connection, requestId, true);
      if (String(request.userId) !== userId) throw new NotFoundException('Withdrawal request not found');
      if (String(request.status) === 'CANCELLED') return request;
      if (String(request.status) !== 'REQUESTED') {
        throw new ConflictException('Only requested withdrawals can be cancelled by the member');
      }
      await connection.query(
        `UPDATE withdrawal_requests
         SET status = 'CANCELLED', cancelledAt = CURRENT_TIMESTAMP(3), cancelledByUserId = ?,
             cancellationReason = 'Cancelled by member', updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [userId, requestId],
      );
      await this.insertAudit(connection, {
        actorUserId: userId,
        action: 'UPDATE',
        entityType: 'WithdrawalRequest',
        entityId: requestId,
        description: 'Withdrawal request cancelled by member',
      });
      return this.getRequestWithConnection(connection, requestId);
    });
  }

  async listRequests(query: ListWithdrawalRequestsDto) {
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '25')));
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.status) {
      conditions.push('r.status = ?');
      params.push(query.status);
    }
    if (query.currencyCode) {
      conditions.push('r.currencyCode = ?');
      params.push(query.currencyCode.trim().toUpperCase());
    }
    if (query.q?.trim()) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
      const pattern = `%${query.q.trim()}%`;
      params.push(pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await this.prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS count
       FROM withdrawal_requests r
       INNER JOIN users u ON u.id = r.userId
       ${where}`,
      ...params,
    );
    const items = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT r.*, u.username, u.email, u.phone,
              d.type AS destinationType, d.label AS destinationLabel, d.reference AS destinationReference,
              p.code AS policyCode, p.name AS policyName, v.version AS policyVersion
       FROM withdrawal_requests r
       INNER JOIN users u ON u.id = r.userId
       INNER JOIN withdrawal_destinations d ON d.id = r.destinationId
       INNER JOIN withdrawal_policy_versions v ON v.id = r.policyVersionId
       INNER JOIN withdrawal_policies p ON p.id = v.policyId
       ${where}
       ORDER BY r.requestedAt DESC, r.createdAt DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      (page - 1) * limit,
    );
    const total = Number(countRows[0]?.count ?? 0);
    return {
      items: items.map((row) => this.normalizeRow(row)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getRequest(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT r.*, u.username, u.email, u.phone,
              d.type AS destinationType, d.label AS destinationLabel, d.reference AS destinationReference,
              d.metadata AS destinationMetadata,
              p.code AS policyCode, p.name AS policyName, v.version AS policyVersion,
              v.reviewRules AS policyReviewRules
       FROM withdrawal_requests r
       INNER JOIN users u ON u.id = r.userId
       INNER JOIN withdrawal_destinations d ON d.id = r.destinationId
       INNER JOIN withdrawal_policy_versions v ON v.id = r.policyVersionId
       INNER JOIN withdrawal_policies p ON p.id = v.policyId
       WHERE r.id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Withdrawal request not found');
    const attempts = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM withdrawal_payout_attempts WHERE requestId = ? ORDER BY initiatedAt DESC, createdAt DESC`,
      id,
    );
    return {
      ...this.normalizeRow(rows[0]),
      payoutAttempts: attempts.map((row) => this.normalizeRow(row)),
    };
  }

  async approve(requestId: string, actorUserId: string) {
    return this.transitionSimple(requestId, actorUserId, 'APPROVE');
  }

  async reject(requestId: string, actorUserId: string, dto: WithdrawalReasonDto) {
    return this.financialDb.transaction(async (connection) => {
      const request = await this.getRequestWithConnection(connection, requestId, true);
      if (String(request.status) === 'REJECTED') return request;
      if (String(request.status) !== 'REQUESTED') {
        throw new ConflictException('Only requested withdrawals can be rejected');
      }
      await connection.query(
        `UPDATE withdrawal_requests
         SET status = 'REJECTED', rejectedAt = CURRENT_TIMESTAMP(3), rejectedByUserId = ?,
             rejectionReason = ?, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [actorUserId, dto.reason.trim(), requestId],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalRequest',
        entityId: requestId,
        description: 'Withdrawal request rejected',
        metadata: { reason: dto.reason.trim() },
      });
      return this.getRequestWithConnection(connection, requestId);
    });
  }

  async adminCancel(requestId: string, actorUserId: string, dto: WithdrawalReasonDto) {
    return this.financialDb.transaction(async (connection) => {
      const request = await this.getRequestWithConnection(connection, requestId, true);
      if (String(request.status) === 'CANCELLED') return request;
      if (!['REQUESTED', 'APPROVED', 'PAYOUT_FAILED'].includes(String(request.status))) {
        throw new ConflictException('Withdrawal cannot be cancelled in its current state');
      }
      await connection.query(
        `UPDATE withdrawal_requests
         SET status = 'CANCELLED', cancelledAt = CURRENT_TIMESTAMP(3), cancelledByUserId = ?,
             cancellationReason = ?, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [actorUserId, dto.reason.trim(), requestId],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalRequest',
        entityId: requestId,
        description: 'Withdrawal request cancelled by admin',
        metadata: { reason: dto.reason.trim() },
      });
      return this.getRequestWithConnection(connection, requestId);
    });
  }

  async startPayout(requestId: string, actorUserId: string, dto: StartWithdrawalPayoutDto) {
    const sourceKey = dto.sourceKey.trim();
    const fingerprint = this.fingerprint({
      requestId,
      provider: dto.provider.trim(),
      providerReference: dto.providerReference?.trim() ?? null,
      metadata: dto.metadata ?? null,
    });

    const replayRows = await this.prisma.$queryRawUnsafe<AttemptRow[]>(
      `SELECT * FROM withdrawal_payout_attempts WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    if (replayRows[0]) return this.resolveAttemptReplay(replayRows[0], requestId, fingerprint);

    return this.financialDb.transaction(async (connection) => {
      const request = await this.getRequestWithConnection(connection, requestId, true);
      if (!['APPROVED', 'PAYOUT_FAILED'].includes(String(request.status))) {
        throw new ConflictException('Withdrawal is not ready for payout execution');
      }
      const existing = (await connection.query(
        `SELECT * FROM withdrawal_payout_attempts WHERE sourceKey = ? LIMIT 1 FOR UPDATE`,
        [sourceKey],
      )) as AttemptRow[];
      if (existing[0]) return this.resolveAttemptReplay(existing[0], requestId, fingerprint);

      const attemptId = randomUUID();
      await connection.query(
        `INSERT INTO withdrawal_payout_attempts (
           id, sourceKey, requestFingerprint, requestId, provider, providerReference, status,
           initiatedAt, metadata, createdByUserId, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, 'INITIATED', CURRENT_TIMESTAMP(3), ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          attemptId,
          sourceKey,
          fingerprint,
          requestId,
          dto.provider.trim(),
          dto.providerReference?.trim() ?? null,
          dto.metadata ? JSON.stringify(dto.metadata) : null,
          actorUserId,
        ],
      );
      await connection.query(
        `UPDATE withdrawal_requests
         SET status = 'PROCESSING', processingAt = CURRENT_TIMESTAMP(3), failedAt = NULL,
             failureReason = NULL, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [requestId],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalRequest',
        entityId: requestId,
        description: 'Withdrawal payout initiated',
        metadata: { attemptId, provider: dto.provider.trim() },
      });
      return this.getAttemptWithConnection(connection, attemptId);
    });
  }

  async failPayout(attemptId: string, actorUserId: string, dto: FailWithdrawalPayoutDto) {
    return this.financialDb.transaction(async (connection) => {
      const attempt = await this.getAttemptWithConnection(connection, attemptId, true);
      if (String(attempt.status) === 'FAILED') return attempt;
      if (String(attempt.status) !== 'INITIATED') {
        throw new ConflictException('Payout attempt is already finalized');
      }
      const request = await this.getRequestWithConnection(connection, String(attempt.requestId), true);
      if (String(request.status) !== 'PROCESSING') {
        throw new ConflictException('Withdrawal request is not processing');
      }
      await connection.query(
        `UPDATE withdrawal_payout_attempts
         SET status = 'FAILED', finalizedAt = CURRENT_TIMESTAMP(3), failureReason = ?,
             metadata = COALESCE(?, metadata), updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [dto.reason.trim(), dto.metadata ? JSON.stringify(dto.metadata) : null, attemptId],
      );
      await connection.query(
        `UPDATE withdrawal_requests
         SET status = 'PAYOUT_FAILED', failedAt = CURRENT_TIMESTAMP(3), failureReason = ?,
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [dto.reason.trim(), attempt.requestId],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalRequest',
        entityId: String(attempt.requestId),
        description: 'Withdrawal payout attempt failed',
        metadata: { attemptId, reason: dto.reason.trim() },
      });
      return this.getAttemptWithConnection(connection, attemptId);
    });
  }

  async confirmPayout(attemptId: string, actorUserId: string, dto: ConfirmWithdrawalPayoutDto) {
    return this.financialDb.transaction(async (connection) => {
      const attempt = await this.getAttemptWithConnection(connection, attemptId, true);
      if (String(attempt.status) === 'CONFIRMED') return attempt;
      if (String(attempt.status) !== 'INITIATED') {
        throw new ConflictException('Payout attempt is already finalized');
      }
      const request = await this.getRequestWithConnection(connection, String(attempt.requestId), true);
      if (String(request.status) !== 'PROCESSING') {
        throw new ConflictException('Withdrawal request is not processing');
      }
      if (request.ledgerTransactionId) {
        throw new ConflictException('Withdrawal already has a ledger transaction');
      }

      await this.lockUser(connection, String(request.userId));
      const balance = await this.getWalletBalanceWithConnection(
        connection,
        String(request.userId),
        String(request.currencyCode),
      );
      const amount = new Prisma.Decimal(request.amount);
      const fee = new Prisma.Decimal(request.feeAmount);
      const net = new Prisma.Decimal(request.netAmount);
      if (balance.lessThan(amount)) {
        throw new ConflictException('Wallet balance is no longer sufficient to settle withdrawal');
      }

      const walletRows = (await connection.query(
        `SELECT id FROM ledger_accounts
         WHERE ownerUserId = ? AND kind = 'USER_WALLET' AND currencyCode = ? LIMIT 1 FOR UPDATE`,
        [request.userId, request.currencyCode],
      )) as Array<{ id: string }>;
      const walletAccountId = walletRows[0]?.id;
      if (!walletAccountId) throw new ConflictException('Wallet account not found');

      const clearingId = await this.ensureSystemLedgerAccount(
        connection,
        `SYS:WITHDRAWAL_CLEARING:${request.currencyCode}`,
        `Withdrawal clearing ${request.currencyCode}`,
        'WITHDRAWAL_CLEARING',
        String(request.currencyCode),
      );
      const feeRevenueId = await this.ensureSystemLedgerAccount(
        connection,
        `SYS:WITHDRAWAL_FEE_REVENUE:${request.currencyCode}`,
        `Withdrawal fee revenue ${request.currencyCode}`,
        'WITHDRAWAL_FEE_REVENUE',
        String(request.currencyCode),
      );
      const ledgerTransactionId = randomUUID();
      await connection.query(
        `INSERT INTO ledger_transactions
           (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
         VALUES (?, ?, 'WITHDRAWAL_PAYOUT', ?, CURRENT_TIMESTAMP(3), ?, CURRENT_TIMESTAMP(3))`,
        [
          ledgerTransactionId,
          `withdrawal:${request.id}:paid`,
          `Withdrawal payout ${request.id}`,
          actorUserId,
        ],
      );
      await connection.query(
        `INSERT INTO ledger_entries
           (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
         VALUES (?, ?, ?, 'DEBIT', ?, ?, CURRENT_TIMESTAMP(3)),
                (?, ?, ?, 'CREDIT', ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          randomUUID(),
          ledgerTransactionId,
          walletAccountId,
          amount.toFixed(2),
          request.currencyCode,
          randomUUID(),
          ledgerTransactionId,
          clearingId,
          net.toFixed(2),
          request.currencyCode,
        ],
      );
      if (fee.greaterThan(0)) {
        await connection.query(
          `INSERT INTO ledger_entries
             (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
           VALUES (?, ?, ?, 'CREDIT', ?, ?, CURRENT_TIMESTAMP(3))`,
          [randomUUID(), ledgerTransactionId, feeRevenueId, fee.toFixed(2), request.currencyCode],
        );
      }

      await connection.query(
        `UPDATE withdrawal_payout_attempts
         SET status = 'CONFIRMED', finalizedAt = CURRENT_TIMESTAMP(3),
             providerReference = COALESCE(?, providerReference),
             metadata = COALESCE(?, metadata), updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          dto.providerReference?.trim() ?? null,
          dto.metadata ? JSON.stringify(dto.metadata) : null,
          attemptId,
        ],
      );
      await connection.query(
        `UPDATE withdrawal_requests
         SET status = 'PAID', paidAt = CURRENT_TIMESTAMP(3), ledgerTransactionId = ?,
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [ledgerTransactionId, request.id],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalRequest',
        entityId: String(request.id),
        description: 'Withdrawal payout confirmed and posted to ledger',
        metadata: { attemptId, ledgerTransactionId },
      });
      return this.getAttemptWithConnection(connection, attemptId);
    });
  }

  async listPolicies() {
    const policies = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM withdrawal_policies ORDER BY currencyCode ASC, isDefault DESC, createdAt ASC`,
    );
    const versions = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM withdrawal_policy_versions ORDER BY policyId ASC, version DESC`,
    );
    return policies.map((policy) => ({
      ...this.normalizeRow(policy),
      versions: versions
        .filter((version) => version.policyId === policy.id)
        .map((version) => this.normalizeRow(version)),
    }));
  }

  async createPolicy(actorUserId: string, dto: CreateWithdrawalPolicyDto) {
    const id = randomUUID();
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    return this.financialDb.transaction(async (connection) => {
      if (dto.isDefault) {
        await connection.query(
          `UPDATE withdrawal_policies SET isDefault = FALSE, updatedAt = CURRENT_TIMESTAMP(3) WHERE currencyCode = ?`,
          [currencyCode],
        );
      }
      try {
        await connection.query(
          `INSERT INTO withdrawal_policies
             (id, code, name, description, currencyCode, isDefault, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [
            id,
            dto.code.trim().toUpperCase(),
            dto.name.trim(),
            dto.description?.trim() ?? null,
            currencyCode,
            dto.isDefault === true,
            actorUserId,
          ],
        );
      } catch (error) {
        if (this.isDuplicateError(error)) throw new ConflictException('Withdrawal policy code already exists');
        throw error;
      }
      await this.insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'WithdrawalPolicy',
        entityId: id,
        description: 'Withdrawal policy created',
        metadata: { currencyCode, isDefault: dto.isDefault === true },
      });
      const rows = (await connection.query(`SELECT * FROM withdrawal_policies WHERE id = ? LIMIT 1`, [id])) as Row[];
      return this.normalizeRow(rows[0]);
    });
  }

  async createPolicyVersion(
    policyId: string,
    actorUserId: string,
    dto: CreateWithdrawalPolicyVersionDto,
  ) {
    this.validatePolicyVersion(dto);
    return this.financialDb.transaction(async (connection) => {
      const policyRows = (await connection.query(
        `SELECT * FROM withdrawal_policies WHERE id = ? LIMIT 1 FOR UPDATE`,
        [policyId],
      )) as Row[];
      if (!policyRows[0]) throw new NotFoundException('Withdrawal policy not found');
      const versionRows = (await connection.query(
        `SELECT COALESCE(MAX(version), 0) AS maxVersion FROM withdrawal_policy_versions WHERE policyId = ?`,
        [policyId],
      )) as Array<{ maxVersion: number | bigint }>;
      const version = Number(versionRows[0]?.maxVersion ?? 0) + 1;
      const id = randomUUID();
      await connection.query(
        `INSERT INTO withdrawal_policy_versions (
           id, policyId, version, lifecycle, effectiveFrom, effectiveTo, minAmount, maxAmount,
           feeMode, feeValue, minimumFee, maximumFee, kycRequired, maxPendingRequests,
           dailyAmountLimit, monthlyAmountLimit, allowedDestinationTypes, reviewRules,
           createdByUserId, createdAt, updatedAt
         ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          id,
          policyId,
          version,
          new Date(dto.effectiveFrom),
          dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          new Prisma.Decimal(dto.minAmount).toFixed(2),
          new Prisma.Decimal(dto.maxAmount).toFixed(2),
          dto.feeMode,
          new Prisma.Decimal(dto.feeValue).toFixed(4),
          dto.minimumFee === undefined ? null : new Prisma.Decimal(dto.minimumFee).toFixed(2),
          dto.maximumFee === undefined ? null : new Prisma.Decimal(dto.maximumFee).toFixed(2),
          dto.kycRequired,
          dto.maxPendingRequests,
          dto.dailyAmountLimit === undefined ? null : new Prisma.Decimal(dto.dailyAmountLimit).toFixed(2),
          dto.monthlyAmountLimit === undefined ? null : new Prisma.Decimal(dto.monthlyAmountLimit).toFixed(2),
          JSON.stringify(dto.allowedDestinationTypes),
          dto.reviewRules ? JSON.stringify(dto.reviewRules) : null,
          actorUserId,
        ],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'CREATE',
        entityType: 'WithdrawalPolicyVersion',
        entityId: id,
        description: 'Withdrawal policy version created',
        metadata: { policyId, version },
      });
      const rows = (await connection.query(
        `SELECT * FROM withdrawal_policy_versions WHERE id = ? LIMIT 1`,
        [id],
      )) as Row[];
      return this.normalizeRow(rows[0]);
    });
  }

  async publishPolicyVersion(versionId: string, actorUserId: string) {
    return this.financialDb.transaction(async (connection) => {
      const rows = (await connection.query(
        `SELECT v.*, p.currencyCode
         FROM withdrawal_policy_versions v
         INNER JOIN withdrawal_policies p ON p.id = v.policyId
         WHERE v.id = ? LIMIT 1 FOR UPDATE`,
        [versionId],
      )) as Row[];
      const version = rows[0];
      if (!version) throw new NotFoundException('Withdrawal policy version not found');
      if (String(version.lifecycle) === 'PUBLISHED') return this.normalizeRow(version);
      if (String(version.lifecycle) !== 'DRAFT') {
        throw new ConflictException('Only draft withdrawal policy versions can be published');
      }
      const overlapRows = (await connection.query(
        `SELECT id FROM withdrawal_policy_versions
         WHERE policyId = ? AND lifecycle = 'PUBLISHED' AND id <> ?
           AND (effectiveTo IS NULL OR effectiveTo > ?)
           AND (? IS NULL OR effectiveFrom < ?)
         LIMIT 1`,
        [
          version.policyId,
          versionId,
          version.effectiveFrom,
          version.effectiveTo ?? null,
          version.effectiveTo ?? null,
        ],
      )) as Row[];
      if (overlapRows[0]) {
        throw new ConflictException('Published withdrawal policy effective windows cannot overlap');
      }
      await connection.query(
        `UPDATE withdrawal_policy_versions
         SET lifecycle = 'PUBLISHED', publishedByUserId = ?, publishedAt = CURRENT_TIMESTAMP(3),
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [actorUserId, versionId],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalPolicyVersion',
        entityId: versionId,
        description: 'Withdrawal policy version published',
      });
      const updated = (await connection.query(
        `SELECT * FROM withdrawal_policy_versions WHERE id = ? LIMIT 1`,
        [versionId],
      )) as Row[];
      return this.normalizeRow(updated[0]);
    });
  }

  async retirePolicyVersion(versionId: string, actorUserId: string) {
    return this.financialDb.transaction(async (connection) => {
      const rows = (await connection.query(
        `SELECT * FROM withdrawal_policy_versions WHERE id = ? LIMIT 1 FOR UPDATE`,
        [versionId],
      )) as Row[];
      const version = rows[0];
      if (!version) throw new NotFoundException('Withdrawal policy version not found');
      if (String(version.lifecycle) === 'RETIRED') return this.normalizeRow(version);
      if (String(version.lifecycle) !== 'PUBLISHED') {
        throw new ConflictException('Only published withdrawal policy versions can be retired');
      }
      await connection.query(
        `UPDATE withdrawal_policy_versions
         SET lifecycle = 'RETIRED', retiredByUserId = ?, retiredAt = CURRENT_TIMESTAMP(3),
             updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [actorUserId, versionId],
      );
      await this.insertAudit(connection, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'WithdrawalPolicyVersion',
        entityId: versionId,
        description: 'Withdrawal policy version retired',
      });
      const updated = (await connection.query(
        `SELECT * FROM withdrawal_policy_versions WHERE id = ? LIMIT 1`,
        [versionId],
      )) as Row[];
      return this.normalizeRow(updated[0]);
    });
  }

  private async transitionSimple(requestId: string, actorUserId: string, transition: 'APPROVE') {
    return this.financialDb.transaction(async (connection) => {
      const request = await this.getRequestWithConnection(connection, requestId, true);
      if (transition === 'APPROVE') {
        if (String(request.status) === 'APPROVED') return request;
        if (String(request.status) !== 'REQUESTED') {
          throw new ConflictException('Only requested withdrawals can be approved');
        }
        await connection.query(
          `UPDATE withdrawal_requests
           SET status = 'APPROVED', approvedAt = CURRENT_TIMESTAMP(3), approvedByUserId = ?,
               updatedAt = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [actorUserId, requestId],
        );
        await this.insertAudit(connection, {
          actorUserId,
          action: 'UPDATE',
          entityType: 'WithdrawalRequest',
          entityId: requestId,
          description: 'Withdrawal request approved',
        });
      }
      return this.getRequestWithConnection(connection, requestId);
    });
  }

  private async findActivePolicy(currencyCode: string) {
    const rows = await this.prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT v.*, p.id AS policyId, p.code AS policyCode, p.name AS policyName, p.currencyCode
       FROM withdrawal_policy_versions v
       INNER JOIN withdrawal_policies p ON p.id = v.policyId
       WHERE p.currencyCode = ? AND p.isDefault = TRUE AND v.lifecycle = 'PUBLISHED'
         AND v.effectiveFrom <= CURRENT_TIMESTAMP(3)
         AND (v.effectiveTo IS NULL OR v.effectiveTo > CURRENT_TIMESTAMP(3))
       ORDER BY v.effectiveFrom DESC, v.version DESC
       LIMIT 1`,
      currencyCode,
    );
    return rows[0] ? this.normalizeRow(rows[0]) : null;
  }

  private async findActivePolicyWithConnection(connection: PoolConnection, currencyCode: string) {
    const rows = (await connection.query(
      `SELECT v.*, p.id AS policyId, p.code AS policyCode, p.name AS policyName, p.currencyCode
       FROM withdrawal_policy_versions v
       INNER JOIN withdrawal_policies p ON p.id = v.policyId
       WHERE p.currencyCode = ? AND p.isDefault = TRUE AND v.lifecycle = 'PUBLISHED'
         AND v.effectiveFrom <= CURRENT_TIMESTAMP(3)
         AND (v.effectiveTo IS NULL OR v.effectiveTo > CURRENT_TIMESTAMP(3))
       ORDER BY v.effectiveFrom DESC, v.version DESC
       LIMIT 1`,
      [currencyCode],
    )) as PolicyRow[];
    return rows[0] ?? null;
  }

  private async getWalletSnapshot(userId: string, currencyCode: string) {
    const accountRows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM ledger_accounts
       WHERE ownerUserId = ? AND kind = 'USER_WALLET' AND currencyCode = ? LIMIT 1`,
      userId,
      currencyCode,
    );
    if (!accountRows[0]) return { accountId: null, balance: new Prisma.Decimal(0) };
    const balanceRows = await this.prisma.$queryRawUnsafe<Array<{ balance: string | number }>>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS balance
       FROM ledger_entries WHERE accountId = ?`,
      accountRows[0].id,
    );
    return {
      accountId: accountRows[0].id,
      balance: new Prisma.Decimal(balanceRows[0]?.balance ?? 0),
    };
  }

  private async getReservedAmount(userId: string, currencyCode: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ reserved: string | number }>>(
      `SELECT COALESCE(SUM(amount), 0) AS reserved
       FROM withdrawal_requests
       WHERE userId = ? AND currencyCode = ?
         AND status IN ('REQUESTED','APPROVED','PROCESSING','PAYOUT_FAILED')`,
      userId,
      currencyCode,
    );
    return new Prisma.Decimal(rows[0]?.reserved ?? 0);
  }

  private async getWalletBalanceWithConnection(
    connection: PoolConnection,
    userId: string,
    currencyCode: string,
  ) {
    const rows = (await connection.query(
      `SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END), 0) AS balance
       FROM ledger_accounts a
       LEFT JOIN ledger_entries e ON e.accountId = a.id
       WHERE a.ownerUserId = ? AND a.kind = 'USER_WALLET' AND a.currencyCode = ?`,
      [userId, currencyCode],
    )) as Array<{ balance: string | number }>;
    return new Prisma.Decimal(rows[0]?.balance ?? 0);
  }

  private async enforcePeriodLimits(
    connection: PoolConnection,
    userId: string,
    currencyCode: string,
    amount: Prisma.Decimal,
    policy: PolicyRow,
  ) {
    if (policy.dailyAmountLimit !== null) {
      const dailyRows = (await connection.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM withdrawal_requests
         WHERE userId = ? AND currencyCode = ?
           AND status NOT IN ('REJECTED','CANCELLED')
           AND requestedAt >= CURRENT_DATE()`,
        [userId, currencyCode],
      )) as Array<{ total: string | number }>;
      if (new Prisma.Decimal(dailyRows[0]?.total ?? 0).plus(amount).greaterThan(new Prisma.Decimal(policy.dailyAmountLimit))) {
        throw new BadRequestException('Daily withdrawal amount limit exceeded');
      }
    }
    if (policy.monthlyAmountLimit !== null) {
      const monthlyRows = (await connection.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM withdrawal_requests
         WHERE userId = ? AND currencyCode = ?
           AND status NOT IN ('REJECTED','CANCELLED')
           AND requestedAt >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')`,
        [userId, currencyCode],
      )) as Array<{ total: string | number }>;
      if (new Prisma.Decimal(monthlyRows[0]?.total ?? 0).plus(amount).greaterThan(new Prisma.Decimal(policy.monthlyAmountLimit))) {
        throw new BadRequestException('Monthly withdrawal amount limit exceeded');
      }
    }
  }

  private calculateFee(amount: Prisma.Decimal, policy: PolicyRow) {
    let fee = String(policy.feeMode) === 'PERCENTAGE'
      ? amount.mul(new Prisma.Decimal(policy.feeValue)).div(100)
      : new Prisma.Decimal(policy.feeValue);
    fee = fee.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (policy.minimumFee !== null) fee = Prisma.Decimal.max(fee, new Prisma.Decimal(policy.minimumFee));
    if (policy.maximumFee !== null) fee = Prisma.Decimal.min(fee, new Prisma.Decimal(policy.maximumFee));
    return fee.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private validatePolicyVersion(dto: CreateWithdrawalPolicyVersionDto) {
    const min = new Prisma.Decimal(dto.minAmount);
    const max = new Prisma.Decimal(dto.maxAmount);
    if (max.lessThan(min)) throw new BadRequestException('maxAmount must be greater than or equal to minAmount');
    const allowed = [...new Set(dto.allowedDestinationTypes.map((value) => value.trim().toUpperCase()))];
    if (
      !allowed.length ||
      allowed.some(
        (value) =>
          !WITHDRAWAL_DESTINATION_TYPES.includes(
            value as (typeof WITHDRAWAL_DESTINATION_TYPES)[number],
          ),
      )
    ) {
      throw new BadRequestException('allowedDestinationTypes contains an unsupported destination type');
    }
    if (!WITHDRAWAL_FEE_MODES.includes(dto.feeMode)) {
      throw new BadRequestException('Unsupported withdrawal fee mode');
    }
    if (
      dto.minimumFee !== undefined &&
      dto.maximumFee !== undefined &&
      new Prisma.Decimal(dto.maximumFee).lessThan(new Prisma.Decimal(dto.minimumFee))
    ) {
      throw new BadRequestException('maximumFee must be greater than or equal to minimumFee');
    }
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }
  }

  private async lockUser(connection: PoolConnection, userId: string) {
    const rows = (await connection.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE`,
      [userId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('User not found');
  }

  private async getDestinationWithConnection(
    connection: PoolConnection,
    destinationId: string,
    userId: string,
  ) {
    const rows = (await connection.query(
      `SELECT * FROM withdrawal_destinations WHERE id = ? AND userId = ? LIMIT 1`,
      [destinationId, userId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Withdrawal destination not found');
    return this.normalizeRow(rows[0]);
  }

  private async getRequestWithConnection(connection: PoolConnection, requestId: string, forUpdate = false) {
    const rows = (await connection.query(
      `SELECT * FROM withdrawal_requests WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [requestId],
    )) as RequestRow[];
    if (!rows[0]) throw new NotFoundException('Withdrawal request not found');
    return this.normalizeRow(rows[0]);
  }

  private async getAttemptWithConnection(connection: PoolConnection, attemptId: string, forUpdate = false) {
    const rows = (await connection.query(
      `SELECT * FROM withdrawal_payout_attempts WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [attemptId],
    )) as AttemptRow[];
    if (!rows[0]) throw new NotFoundException('Withdrawal payout attempt not found');
    return this.normalizeRow(rows[0]);
  }

  private async findRequestBySourceKey(sourceKey: string) {
    const rows = await this.prisma.$queryRawUnsafe<RequestRow[]>(
      `SELECT * FROM withdrawal_requests WHERE sourceKey = ? LIMIT 1`,
      sourceKey,
    );
    return rows[0] ?? null;
  }

  private resolveRequestReplay(request: RequestRow | Row, userId: string, fingerprint: string) {
    if (String(request.userId) !== userId || String(request.requestFingerprint) !== fingerprint) {
      throw new ConflictException('Withdrawal sourceKey was already used with different request data');
    }
    return this.normalizeRow(request);
  }

  private resolveAttemptReplay(attempt: AttemptRow | Row, requestId: string, fingerprint: string) {
    if (String(attempt.requestId) !== requestId || String(attempt.requestFingerprint) !== fingerprint) {
      throw new ConflictException('Payout sourceKey was already used with different request data');
    }
    return this.normalizeRow(attempt);
  }

  private async ensureSystemLedgerAccount(
    connection: PoolConnection,
    code: string,
    name: string,
    kind: string,
    currencyCode: string,
  ) {
    const rows = (await connection.query(
      `SELECT id FROM ledger_accounts WHERE code = ? LIMIT 1 FOR UPDATE`,
      [code],
    )) as Array<{ id: string }>;
    if (rows[0]) return rows[0].id;
    const id = randomUUID();
    try {
      await connection.query(
        `INSERT INTO ledger_accounts (id, code, name, kind, ownerUserId, currencyCode, createdAt)
         VALUES (?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP(3))`,
        [id, code, name, kind, currencyCode],
      );
      return id;
    } catch (error) {
      if (!this.isDuplicateError(error)) throw error;
      const replay = (await connection.query(
        `SELECT id FROM ledger_accounts WHERE code = ? LIMIT 1`,
        [code],
      )) as Array<{ id: string }>;
      if (!replay[0]) throw error;
      return replay[0].id;
    }
  }

  private async insertAudit(
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

  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private stringArray(value: unknown): string[] {
    const parsed = this.parseJson(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private normalizeRow<T extends Row>(row: T | undefined): T {
    if (!row) throw new NotFoundException('Expected database row was not found');
    const result = { ...row } as Row;
    for (const key of ['metadata', 'reviewRules', 'allowedDestinationTypes', 'destinationMetadata']) {
      if (key in result) result[key] = this.parseJson(result[key]);
    }
    return result as T;
  }

  private toBoolean(value: unknown) {
    return value === true || value === 1 || value === '1';
  }

  private isDuplicateError(error: unknown) {
    const candidate = error as { code?: string; errno?: number };
    return candidate.code === 'ER_DUP_ENTRY' || candidate.errno === 1062;
  }
}
