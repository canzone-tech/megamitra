import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  BinaryCapOverflowMode,
  BinaryUnitDispositionType,
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  PolicyLifecycle,
} from '../generated/prisma/enums';
import type { RunBinaryPairSettlementDto } from './binary-settlement.dto';

type BinarySlot = 'A' | 'B' | 'C' | 'D';
type PairLane = 'A:C' | 'B:D';

type SettlementIdentityRow = {
  id: string;
  memberUserId: string;
  planVersionId: string;
  requestFingerprint: string | null;
};

type MemberRow = { id: string; username: string };
type PlanVersionRow = {
  id: string;
  lifecycle: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  qualifyingUnit: string;
  pairPayoutAmount: string;
  currencyCode: string | null;
  settlementTimezone: string | null;
  capOverflowMode: string | null;
  dailyPairCap: number | null;
  monthlyPairCap: number | null;
  carryForwardEnabled: boolean | number;
  carryForwardExpiryDays: number | null;
};
type CountRow = { total: string | number | bigint | null };
type IdRow = { id: string };
type UnitRow = {
  id: string;
  sequence: string | number;
  slot: BinarySlot;
  occurredAt: Date;
  expired: boolean | number;
};
type UnitQueue = { eligible: UnitRow[]; expired: UnitRow[] };
type PairCandidate = {
  lane: PairLane;
  leftUnit: UnitRow;
  rightUnit: UnitRow;
  readyAt: Date;
};

@Injectable()
export class BinarySettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
  ) {}

  async run(dto: RunBinaryPairSettlementDto, actorUserId: string) {
    const settledAt = new Date(dto.settledAt);
    const fingerprint = this.requestFingerprint(dto, settledAt);
    const existing = await this.findSettlement(dto.sourceKey);
    if (existing) {
      this.assertIdempotentMatch(existing, dto, fingerprint);
      return { settlement: existing, idempotent: true };
    }

    const mutexKey = `binary-settlement:${dto.memberUserId}:${dto.planVersionId}`;
    await this.financialDb.execute(
      `INSERT INTO system_sequences (\`key\`, nextValue, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`,
      [mutexKey],
    );

    let outcome: { id: string; idempotent: boolean };
    try {
      outcome = await this.financialDb.transaction((connection) =>
        this.runNativeTransaction(connection, dto, actorUserId, settledAt, fingerprint, mutexKey),
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const duplicate = await this.findSettlement(dto.sourceKey);
        if (duplicate) {
          this.assertIdempotentMatch(duplicate, dto, fingerprint);
          return { settlement: duplicate, idempotent: true };
        }
      }
      throw error;
    }

    const settlement = await this.findSettlement(outcome.id);
    if (!settlement) throw new ConflictException('Settlement committed but could not be reloaded');

    if (!outcome.idempotent) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryPairSettlement',
        entityId: settlement.id,
        description: 'Binary 1:4 A:C / B:D pair settlement completed',
        metadata: {
          sourceKey: settlement.sourceKey,
          planVersionId: settlement.planVersionId,
          pairCountPayable: settlement.pairCountPayable,
          payoutAmount: settlement.payoutAmount.toString(),
          currencyCode: settlement.currencyCode,
          pairLanes: ['A:C', 'B:D'],
        },
      });
    }
    return { settlement, idempotent: outcome.idempotent };
  }

  async getSettlement(id: string) {
    const settlement = await this.findSettlement(id);
    if (!settlement) throw new NotFoundException('Binary pair settlement not found');
    return settlement;
  }

  listMemberSettlements(userId: string) {
    return this.prisma.binaryPairSettlement.findMany({
      where: { memberUserId: userId },
      orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        planVersion: { include: { plan: true } },
        ledgerTransaction: true,
        pairMatches: {
          orderBy: { pairSequence: 'asc' },
          include: {
            leftUnit: {
              include: {
                unitEvent: {
                  include: { sourceMember: { select: { id: true, username: true } } },
                },
              },
            },
            rightUnit: {
              include: {
                unitEvent: {
                  include: { sourceMember: { select: { id: true, username: true } } },
                },
              },
            },
          },
        },
      },
    });
  }

  private async runNativeTransaction(
    connection: PoolConnection,
    dto: RunBinaryPairSettlementDto,
    actorUserId: string,
    settledAt: Date,
    fingerprint: string,
    mutexKey: string,
  ): Promise<{ id: string; idempotent: boolean }> {
    await connection.query(
      `UPDATE system_sequences SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [mutexKey],
    );

    const racedRows = await connection.query<SettlementIdentityRow[]>(
      `SELECT id, memberUserId, planVersionId, requestFingerprint
       FROM binary_pair_settlements WHERE sourceKey = ? LIMIT 1`,
      [dto.sourceKey],
    );
    const raced = racedRows[0];
    if (raced) {
      this.assertIdempotentMatch(raced, dto, fingerprint);
      return { id: raced.id, idempotent: true };
    }

    const memberRows = await connection.query<MemberRow[]>(
      'SELECT id, username FROM users WHERE id = ? LIMIT 1',
      [dto.memberUserId],
    );
    const member = memberRows[0];
    if (!member) throw new NotFoundException('Settlement member not found');

    const versionRows = await connection.query<PlanVersionRow[]>(
      `SELECT id, lifecycle, effectiveFrom, effectiveTo, qualifyingUnit, pairPayoutAmount,
              currencyCode, settlementTimezone, capOverflowMode, dailyPairCap, monthlyPairCap,
              carryForwardEnabled, carryForwardExpiryDays
       FROM binary_plan_versions WHERE id = ? LIMIT 1`,
      [dto.planVersionId],
    );
    const version = versionRows[0];
    if (!version) throw new NotFoundException('Binary plan version not found');
    if (version.lifecycle !== PolicyLifecycle.PUBLISHED) {
      throw new ConflictException('Pair settlement requires a published binary plan version');
    }

    const effectiveFrom = new Date(version.effectiveFrom);
    const effectiveTo = version.effectiveTo ? new Date(version.effectiveTo) : null;
    if (effectiveFrom > settledAt || (effectiveTo && effectiveTo < settledAt)) {
      throw new BadRequestException('Binary plan version is not effective at settlement time');
    }
    if (!version.currencyCode || !version.settlementTimezone || !version.capOverflowMode) {
      throw new ConflictException(
        'Published plan is missing settlement currency, timezone or cap overflow policy',
      );
    }

    const laterRows = await connection.query<IdRow[]>(
      `SELECT id FROM binary_pair_settlements
       WHERE memberUserId = ? AND planVersionId = ? AND settledAt > ? LIMIT 1`,
      [dto.memberUserId, dto.planVersionId, settledAt],
    );
    if (laterRows[0]) {
      throw new ConflictException(
        'Cannot insert a settlement before a later settlement for the same member and plan version',
      );
    }

    await this.assertNoReversedConsumedUnits(connection, dto.memberUserId, dto.planVersionId);

    const local = this.localPeriod(settledAt, version.settlementTimezone);
    const [aQueue, bQueue, cQueue, dQueue] = await Promise.all([
      this.loadUnitQueue(connection, dto.memberUserId, dto.planVersionId, 'A', settledAt, version.carryForwardExpiryDays),
      this.loadUnitQueue(connection, dto.memberUserId, dto.planVersionId, 'B', settledAt, version.carryForwardExpiryDays),
      this.loadUnitQueue(connection, dto.memberUserId, dto.planVersionId, 'C', settledAt, version.carryForwardExpiryDays),
      this.loadUnitQueue(connection, dto.memberUserId, dto.planVersionId, 'D', settledAt, version.carryForwardExpiryDays),
    ]);

    // Fixed client rule: A can pair only with C, and B can pair only with D.
    // No generic LEFT x RIGHT cross matching is permitted.
    const candidates = [
      ...this.buildLaneCandidates('A:C', aQueue.eligible, cQueue.eligible),
      ...this.buildLaneCandidates('B:D', bQueue.eligible, dQueue.eligible),
    ].sort((left, right) => {
      const time = left.readyAt.getTime() - right.readyAt.getTime();
      if (time !== 0) return time;
      if (left.lane !== right.lane) return left.lane === 'A:C' ? -1 : 1;
      return Number(left.leftUnit.sequence) - Number(right.leftUnit.sequence);
    });

    const dailyRows = await connection.query<CountRow[]>(
      `SELECT COALESCE(SUM(pairCountPayable), 0) AS total
       FROM binary_pair_settlements
       WHERE memberUserId = ? AND planVersionId = ? AND settlementLocalDate = ?`,
      [dto.memberUserId, dto.planVersionId, local.date],
    );
    const monthlyRows = await connection.query<CountRow[]>(
      `SELECT COALESCE(SUM(pairCountPayable), 0) AS total
       FROM binary_pair_settlements
       WHERE memberUserId = ? AND planVersionId = ? AND settlementLocalMonth = ?`,
      [dto.memberUserId, dto.planVersionId, local.month],
    );

    const pairCountCalculated = candidates.length;
    let pairCountPayable = pairCountCalculated;
    const dailyUsed = Number(dailyRows[0]?.total ?? 0);
    const monthlyUsed = Number(monthlyRows[0]?.total ?? 0);
    if (version.dailyPairCap !== null) {
      pairCountPayable = Math.min(pairCountPayable, Math.max(0, version.dailyPairCap - dailyUsed));
    }
    if (version.monthlyPairCap !== null) {
      pairCountPayable = Math.min(pairCountPayable, Math.max(0, version.monthlyPairCap - monthlyUsed));
    }

    const capLimitedPairs = pairCountCalculated - pairCountPayable;
    const carryEnabled = version.carryForwardEnabled === true || version.carryForwardEnabled === 1;
    const consumePairCount =
      !carryEnabled || version.capOverflowMode === BinaryCapOverflowMode.FLUSH
        ? pairCountCalculated
        : pairCountPayable;
    const consumedCandidates = candidates.slice(0, consumePairCount);
    const consumedIds = new Set<string>();
    for (const candidate of consumedCandidates) {
      consumedIds.add(candidate.leftUnit.id);
      consumedIds.add(candidate.rightUnit.id);
    }

    const queues = [aQueue, bQueue, cQueue, dQueue];
    const allEligible = queues.flatMap((queue) => queue.eligible);
    const unmatchedToFlush = carryEnabled
      ? []
      : allEligible.filter((unit) => !consumedIds.has(unit.id));
    const flushedIds = new Set(unmatchedToFlush.map((unit) => unit.id));

    const leftEligible = [...aQueue.eligible, ...bQueue.eligible];
    const rightEligible = [...cQueue.eligible, ...dQueue.eligible];
    const leftUnitsConsumed = leftEligible.filter(
      (unit) => consumedIds.has(unit.id) || flushedIds.has(unit.id),
    ).length;
    const rightUnitsConsumed = rightEligible.filter(
      (unit) => consumedIds.has(unit.id) || flushedIds.has(unit.id),
    ).length;
    const leftUnitsCarryAfter = leftEligible.length - leftUnitsConsumed;
    const rightUnitsCarryAfter = rightEligible.length - rightUnitsConsumed;

    const qualifyingUnit = this.decimal(version.qualifyingUnit);
    const pairPayoutAmount = this.decimal(version.pairPayoutAmount);
    const payoutAmount = pairPayoutAmount.mul(pairCountPayable);
    const currencyCode = version.currencyCode.toUpperCase();

    let ledgerTransactionId: string | null = null;
    if (payoutAmount.greaterThan(0)) {
      ledgerTransactionId = await this.postLedgerTransaction(
        connection,
        dto,
        actorUserId,
        settledAt,
        member,
        payoutAmount,
        currencyCode,
      );
    }

    const settlementId = randomUUID();
    await connection.query(
      `INSERT INTO binary_pair_settlements
         (id, sourceKey, requestFingerprint, memberUserId, planVersionId, settledAt,
          settlementLocalDate, settlementLocalMonth,
          leftAvailableBefore, rightAvailableBefore,
          pairCountCalculated, pairCountPayable, capLimitedPairs,
          leftVolumeConsumed, rightVolumeConsumed,
          leftCarryAfter, rightCarryAfter,
          leftUnitsAvailableBefore, rightUnitsAvailableBefore,
          leftUnitsConsumed, rightUnitsConsumed,
          leftUnitsCarryAfter, rightUnitsCarryAfter,
          payoutAmount, currencyCode, ledgerTransactionId,
          createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        settlementId,
        dto.sourceKey,
        fingerprint,
        dto.memberUserId,
        dto.planVersionId,
        settledAt,
        local.date,
        local.month,
        qualifyingUnit.mul(leftEligible.length).toFixed(4),
        qualifyingUnit.mul(rightEligible.length).toFixed(4),
        pairCountCalculated,
        pairCountPayable,
        capLimitedPairs,
        qualifyingUnit.mul(leftUnitsConsumed).toFixed(4),
        qualifyingUnit.mul(rightUnitsConsumed).toFixed(4),
        qualifyingUnit.mul(leftUnitsCarryAfter).toFixed(4),
        qualifyingUnit.mul(rightUnitsCarryAfter).toFixed(4),
        leftEligible.length,
        rightEligible.length,
        leftUnitsConsumed,
        rightUnitsConsumed,
        leftUnitsCarryAfter,
        rightUnitsCarryAfter,
        payoutAmount.toFixed(2),
        currencyCode,
        ledgerTransactionId,
        actorUserId,
      ],
    );

    const pairSequenceRows = await connection.query<CountRow[]>(
      `SELECT COALESCE(MAX(pairSequence), 0) AS total
       FROM binary_pair_matches WHERE memberUserId = ? AND planVersionId = ?`,
      [dto.memberUserId, dto.planVersionId],
    );
    const priorPairSequence = Number(pairSequenceRows[0]?.total ?? 0);

    for (let index = 0; index < consumedCandidates.length; index += 1) {
      const candidate = consumedCandidates[index];
      if (!candidate) throw new ConflictException('Pair lane queue became inconsistent during settlement');
      const payable = index < pairCountPayable;
      await connection.query(
        `INSERT INTO binary_pair_matches
           (id, settlementId, memberUserId, planVersionId, pairSequence,
            leftUnitId, rightUnitId, payable, payoutAmount, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          randomUUID(),
          settlementId,
          dto.memberUserId,
          dto.planVersionId,
          priorPairSequence + index + 1,
          candidate.leftUnit.id,
          candidate.rightUnit.id,
          payable,
          payable ? pairPayoutAmount.toFixed(2) : '0.00',
        ],
      );
    }

    await this.insertDispositions(
      connection,
      settlementId,
      queues.flatMap((queue) => queue.expired),
      BinaryUnitDispositionType.EXPIRED,
      'carry-expiry',
    );
    await this.insertDispositions(
      connection,
      settlementId,
      unmatchedToFlush,
      BinaryUnitDispositionType.FLUSHED,
      'carry-disabled',
    );

    return { id: settlementId, idempotent: false };
  }

  private buildLaneCandidates(
    lane: PairLane,
    left: UnitRow[],
    right: UnitRow[],
  ): PairCandidate[] {
    const count = Math.min(left.length, right.length);
    const candidates: PairCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const leftUnit = left[index];
      const rightUnit = right[index];
      if (!leftUnit || !rightUnit) continue;
      candidates.push({
        lane,
        leftUnit,
        rightUnit,
        readyAt: new Date(Math.max(leftUnit.occurredAt.getTime(), rightUnit.occurredAt.getTime())),
      });
    }
    return candidates;
  }

  private async postLedgerTransaction(
    connection: PoolConnection,
    dto: RunBinaryPairSettlementDto,
    actorUserId: string,
    settledAt: Date,
    member: MemberRow,
    payoutAmount: Prisma.Decimal,
    currencyCode: string,
  ): Promise<string> {
    const walletCode = `USER_WALLET:${dto.memberUserId}:${currencyCode}`;
    const expenseCode = `COMMISSION_EXPENSE:${currencyCode}`;
    await this.ensureLedgerAccount(
      connection,
      walletCode,
      `${member.username} wallet ${currencyCode}`,
      LedgerAccountKind.USER_WALLET,
      dto.memberUserId,
      currencyCode,
    );
    await this.ensureLedgerAccount(
      connection,
      expenseCode,
      `Commission expense ${currencyCode}`,
      LedgerAccountKind.COMMISSION_EXPENSE,
      null,
      currencyCode,
    );

    const walletId = await this.ledgerAccountId(connection, walletCode);
    const expenseId = await this.ledgerAccountId(connection, expenseCode);
    const transactionId = randomUUID();
    await connection.query(
      `INSERT INTO ledger_transactions
         (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        transactionId,
        `BINARY_PAIR:${dto.sourceKey}`,
        LedgerTransactionType.BINARY_PAIR_COMMISSION,
        `Binary 1:4 pair commission for ${member.username}`,
        settledAt,
        actorUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ledger_entries
         (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
       VALUES
         (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3)),
         (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        transactionId,
        expenseId,
        LedgerEntryDirection.DEBIT,
        payoutAmount.toFixed(2),
        currencyCode,
        randomUUID(),
        transactionId,
        walletId,
        LedgerEntryDirection.CREDIT,
        payoutAmount.toFixed(2),
        currencyCode,
      ],
    );
    return transactionId;
  }

  private async loadUnitQueue(
    connection: PoolConnection,
    memberUserId: string,
    planVersionId: string,
    slot: BinarySlot,
    settledAt: Date,
    expiryDays: number | null,
  ): Promise<UnitQueue> {
    const expiryExpression = expiryDays
      ? `CASE WHEN e.occurredAt < DATE_SUB(?, INTERVAL ${Math.trunc(expiryDays)} DAY) THEN 1 ELSE 0 END`
      : '0';
    const values: Array<string | Date> = expiryDays
      ? [settledAt, memberUserId, planVersionId, slot, settledAt]
      : [memberUserId, planVersionId, slot, settledAt];
    const rows = await connection.query<UnitRow[]>(
      `SELECT u.id, u.sequence, u.slot, e.occurredAt, ${expiryExpression} AS expired
       FROM binary_upline_qualifying_units u
       INNER JOIN binary_qualifying_unit_events e ON e.id = u.unitEventId
       LEFT JOIN binary_qualifying_unit_events reversal ON reversal.reversalOfEventId = e.id
       LEFT JOIN binary_pair_matches left_match ON left_match.leftUnitId = u.id
       LEFT JOIN binary_pair_matches right_match ON right_match.rightUnitId = u.id
       LEFT JOIN binary_unit_dispositions disposition ON disposition.uplineUnitId = u.id
       WHERE u.ancestorUserId = ? AND u.planVersionId = ? AND u.slot = ?
         AND e.eventType = 'QUALIFY' AND e.occurredAt <= ?
         AND reversal.id IS NULL AND left_match.id IS NULL AND right_match.id IS NULL
         AND disposition.id IS NULL
       ORDER BY u.sequence ASC`,
      values,
    );
    return {
      eligible: rows.filter((row) => !(row.expired === true || row.expired === 1)),
      expired: rows.filter((row) => row.expired === true || row.expired === 1),
    };
  }

  private async assertNoReversedConsumedUnits(
    connection: PoolConnection,
    memberUserId: string,
    planVersionId: string,
  ): Promise<void> {
    const rows = await connection.query<IdRow[]>(
      `SELECT pair_match.id
       FROM binary_pair_matches pair_match
       INNER JOIN binary_upline_qualifying_units left_unit ON left_unit.id = pair_match.leftUnitId
       INNER JOIN binary_qualifying_unit_events left_event ON left_event.id = left_unit.unitEventId
       LEFT JOIN binary_qualifying_unit_events left_reversal ON left_reversal.reversalOfEventId = left_event.id
       INNER JOIN binary_upline_qualifying_units right_unit ON right_unit.id = pair_match.rightUnitId
       INNER JOIN binary_qualifying_unit_events right_event ON right_event.id = right_unit.unitEventId
       LEFT JOIN binary_qualifying_unit_events right_reversal ON right_reversal.reversalOfEventId = right_event.id
       WHERE pair_match.memberUserId = ? AND pair_match.planVersionId = ?
         AND (left_reversal.id IS NOT NULL OR right_reversal.id IS NOT NULL)
       LIMIT 1`,
      [memberUserId, planVersionId],
    );
    if (rows[0]) {
      throw new ConflictException(
        'A previously paired qualifying unit was reversed; explicit financial reconciliation is required',
      );
    }
  }

  private async insertDispositions(
    connection: PoolConnection,
    settlementId: string,
    units: UnitRow[],
    disposition: BinaryUnitDispositionType,
    reason: string,
  ): Promise<void> {
    for (const unit of units) {
      await connection.query(
        `INSERT INTO binary_unit_dispositions
           (id, uplineUnitId, settlementId, disposition, reason, createdAt)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [randomUUID(), unit.id, settlementId, disposition, reason],
      );
    }
  }

  private async ensureLedgerAccount(
    connection: PoolConnection,
    code: string,
    name: string,
    kind: LedgerAccountKind,
    ownerUserId: string | null,
    currencyCode: string,
  ): Promise<void> {
    await connection.query(
      `INSERT INTO ledger_accounts
         (id, code, name, kind, ownerUserId, currencyCode, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE code = VALUES(code)`,
      [randomUUID(), code, name, kind, ownerUserId, currencyCode],
    );
  }

  private async ledgerAccountId(connection: PoolConnection, code: string): Promise<string> {
    const rows = await connection.query<IdRow[]>(
      'SELECT id FROM ledger_accounts WHERE code = ? LIMIT 1',
      [code],
    );
    if (!rows[0]) throw new ConflictException('Ledger account could not be resolved');
    return rows[0].id;
  }

  private findSettlement(identifier: string) {
    return this.prisma.binaryPairSettlement.findFirst({
      where: { OR: [{ id: identifier }, { sourceKey: identifier }] },
      include: {
        member: { select: { id: true, username: true } },
        planVersion: { include: { plan: true } },
        ledgerTransaction: { include: { entries: { include: { account: true } } } },
        pairMatches: {
          orderBy: { pairSequence: 'asc' },
          include: {
            leftUnit: {
              include: {
                unitEvent: {
                  include: { sourceMember: { select: { id: true, username: true } } },
                },
              },
            },
            rightUnit: {
              include: {
                unitEvent: {
                  include: { sourceMember: { select: { id: true, username: true } } },
                },
              },
            },
          },
        },
        unitDispositions: true,
      },
    });
  }

  private decimal(value: string | number | bigint | Prisma.Decimal): Prisma.Decimal {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value.toString());
  }

  private localPeriod(date: Date, timeZone: string): { date: string; month: string } {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
    } catch {
      throw new BadRequestException('Plan settlement timezone is invalid');
    }
    const read = (type: 'year' | 'month' | 'day') =>
      parts.find((part) => part.type === type)?.value ?? '';
    const year = read('year');
    const month = read('month');
    const day = read('day');
    return { date: `${year}-${month}-${day}`, month: `${year}-${month}` };
  }

  private requestFingerprint(dto: RunBinaryPairSettlementDto, settledAt: Date): string {
    return createHash('sha256')
      .update(`${dto.memberUserId}|${dto.planVersionId}|${settledAt.toISOString()}`)
      .digest('hex');
  }

  private assertIdempotentMatch(
    existing: {
      memberUserId: string;
      planVersionId: string;
      requestFingerprint?: string | null;
    },
    dto: RunBinaryPairSettlementDto,
    fingerprint: string,
  ): void {
    const identityMatches =
      existing.memberUserId === dto.memberUserId && existing.planVersionId === dto.planVersionId;
    const fingerprintMatches =
      existing.requestFingerprint === null ||
      existing.requestFingerprint === undefined ||
      existing.requestFingerprint === fingerprint;
    if (!identityMatches || !fingerprintMatches) {
      throw new ConflictException('Settlement source key already exists with a different payload');
    }
  }
}
