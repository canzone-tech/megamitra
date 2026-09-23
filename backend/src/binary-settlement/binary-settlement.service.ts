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
  BinaryPlacementSide,
  BinaryUnitDispositionType,
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  PolicyLifecycle,
} from '../generated/prisma/enums';
import type { RunBinaryPairSettlementDto } from './binary-settlement.dto';

type SettlementIdentityRow = {
  id: string;
  memberUserId: string;
  planVersionId: string;
  requestFingerprint: string | null;
};

type MemberRow = {
  id: string;
  username: string;
};

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
type PairSequenceRow = { total: string | number | bigint | null };
type UnitRow = {
  id: string;
  sequence: string | number | bigint;
  sourceMemberUserId: string;
  sourceUsername: string;
  expired: boolean | number;
};

type UnitQueue = {
  eligible: UnitRow[];
  expired: UnitRow[];
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
        this.runNativeTransaction(
          connection,
          dto,
          actorUserId,
          settledAt,
          fingerprint,
          mutexKey,
        ),
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
    if (!settlement) {
      throw new ConflictException('Settlement committed but could not be reloaded');
    }

    if (!outcome.idempotent) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'BinaryPairSettlement',
        entityId: settlement.id,
        description: 'Binary sequential unit pair settlement completed',
        metadata: {
          sourceKey: settlement.sourceKey,
          planVersionId: settlement.planVersionId,
          pairCountPayable: settlement.pairCountPayable,
          payoutAmount: settlement.payoutAmount.toString(),
          currencyCode: settlement.currencyCode,
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
              include: { unitEvent: { include: { sourceMember: { select: { id: true, username: true } } } } },
            },
            rightUnit: {
              include: { unitEvent: { include: { sourceMember: { select: { id: true, username: true } } } } },
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
      `UPDATE system_sequences
       SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [mutexKey],
    );

    const racedRows = await connection.query<SettlementIdentityRow[]>(
      `SELECT id, memberUserId, planVersionId, requestFingerprint
       FROM binary_pair_settlements
       WHERE sourceKey = ?
       LIMIT 1`,
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
      `SELECT id, lifecycle, effectiveFrom, effectiveTo,
              qualifyingUnit, pairPayoutAmount,
              currencyCode, settlementTimezone, capOverflowMode,
              dailyPairCap, monthlyPairCap, carryForwardEnabled,
              carryForwardExpiryDays
       FROM binary_plan_versions
       WHERE id = ?
       LIMIT 1`,
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
      `SELECT id
       FROM binary_pair_settlements
       WHERE memberUserId = ? AND planVersionId = ? AND settledAt > ?
       LIMIT 1`,
      [dto.memberUserId, dto.planVersionId, settledAt],
    );
    if (laterRows[0]) {
      throw new ConflictException(
        'Cannot insert a settlement before a later settlement for the same member and plan version',
      );
    }

    await this.assertNoReversedConsumedUnits(connection, dto.memberUserId, dto.planVersionId);

    const local = this.localPeriod(settledAt, version.settlementTimezone);
    const [leftQueue, rightQueue] = await Promise.all([
      this.loadUnitQueue(
        connection,
        dto.memberUserId,
        dto.planVersionId,
        BinaryPlacementSide.LEFT,
        settledAt,
        version.carryForwardExpiryDays,
      ),
      this.loadUnitQueue(
        connection,
        dto.memberUserId,
        dto.planVersionId,
        BinaryPlacementSide.RIGHT,
        settledAt,
        version.carryForwardExpiryDays,
      ),
    ]);

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

    const pairCountCalculated = Math.min(leftQueue.eligible.length, rightQueue.eligible.length);
    let pairCountPayable = pairCountCalculated;
    const dailyUsed = Number(dailyRows[0]?.total ?? 0);
    const monthlyUsed = Number(monthlyRows[0]?.total ?? 0);
    if (version.dailyPairCap !== null) {
      pairCountPayable = Math.min(
        pairCountPayable,
        Math.max(0, version.dailyPairCap - dailyUsed),
      );
    }
    if (version.monthlyPairCap !== null) {
      pairCountPayable = Math.min(
        pairCountPayable,
        Math.max(0, version.monthlyPairCap - monthlyUsed),
      );
    }

    const capLimitedPairs = pairCountCalculated - pairCountPayable;
    const carryEnabled = Boolean(version.carryForwardEnabled);
    const consumePairCount =
      !carryEnabled || version.capOverflowMode === BinaryCapOverflowMode.FLUSH
        ? pairCountCalculated
        : pairCountPayable;

    const pairedLeftIds = new Set(
      leftQueue.eligible.slice(0, consumePairCount).map((unit) => unit.id),
    );
    const pairedRightIds = new Set(
      rightQueue.eligible.slice(0, consumePairCount).map((unit) => unit.id),
    );
    const leftToFlush = carryEnabled
      ? []
      : leftQueue.eligible.filter((unit) => !pairedLeftIds.has(unit.id));
    const rightToFlush = carryEnabled
      ? []
      : rightQueue.eligible.filter((unit) => !pairedRightIds.has(unit.id));

    const leftUnitsConsumed = consumePairCount + leftToFlush.length;
    const rightUnitsConsumed = consumePairCount + rightToFlush.length;
    const leftUnitsCarryAfter = leftQueue.eligible.length - leftUnitsConsumed;
    const rightUnitsCarryAfter = rightQueue.eligible.length - rightUnitsConsumed;

    const qualifyingUnit = this.decimal(version.qualifyingUnit);
    const pairPayoutAmount = this.decimal(version.pairPayoutAmount);
    const payoutAmount = pairPayoutAmount.mul(pairCountPayable);
    const currencyCode = version.currencyCode.toUpperCase();

    let ledgerTransactionId: string | null = null;
    if (payoutAmount.greaterThan(0)) {
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
      ledgerTransactionId = randomUUID();
      await connection.query(
        `INSERT INTO ledger_transactions
           (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          ledgerTransactionId,
          `BINARY_PAIR:${dto.sourceKey}`,
          LedgerTransactionType.BINARY_PAIR_COMMISSION,
          `Binary pair commission for ${member.username}`,
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
          ledgerTransactionId,
          expenseId,
          LedgerEntryDirection.DEBIT,
          payoutAmount.toFixed(2),
          currencyCode,
          randomUUID(),
          ledgerTransactionId,
          walletId,
          LedgerEntryDirection.CREDIT,
          payoutAmount.toFixed(2),
          currencyCode,
        ],
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
        qualifyingUnit.mul(leftQueue.eligible.length).toFixed(4),
        qualifyingUnit.mul(rightQueue.eligible.length).toFixed(4),
        pairCountCalculated,
        pairCountPayable,
        capLimitedPairs,
        qualifyingUnit.mul(leftUnitsConsumed).toFixed(4),
        qualifyingUnit.mul(rightUnitsConsumed).toFixed(4),
        qualifyingUnit.mul(leftUnitsCarryAfter).toFixed(4),
        qualifyingUnit.mul(rightUnitsCarryAfter).toFixed(4),
        leftQueue.eligible.length,
        rightQueue.eligible.length,
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

    const pairSequenceRows = await connection.query<PairSequenceRow[]>(
      `SELECT COALESCE(MAX(pairSequence), 0) AS total
       FROM binary_pair_matches
       WHERE memberUserId = ? AND planVersionId = ?`,
      [dto.memberUserId, dto.planVersionId],
    );
    const priorPairSequence = BigInt(pairSequenceRows[0]?.total ?? 0);

    for (let index = 0; index < consumePairCount; index += 1) {
      const leftUnit = leftQueue.eligible[index];
      const rightUnit = rightQueue.eligible[index];
      if (!leftUnit || !rightUnit) {
        throw new ConflictException('Sequential pair queue became inconsistent during settlement');
      }
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
          priorPairSequence + BigInt(index + 1),
          leftUnit.id,
          rightUnit.id,
          payable,
          payable ? pairPayoutAmount.toFixed(2) : '0.00',
        ],
      );
    }

    await this.insertDispositions(
      connection,
      settlementId,
      [...leftQueue.expired, ...rightQueue.expired],
      BinaryUnitDispositionType.EXPIRED,
      'carry-expiry',
    );
    await this.insertDispositions(
      connection,
      settlementId,
      [...leftToFlush, ...rightToFlush],
      BinaryUnitDispositionType.FLUSHED,
      'carry-disabled',
    );

    return { id: settlementId, idempotent: false };
  }

  private async loadUnitQueue(
    connection: PoolConnection,
    memberUserId: string,
    planVersionId: string,
    side: BinaryPlacementSide,
    settledAt: Date,
    expiryDays: number | null,
  ): Promise<UnitQueue> {
    const expiryExpression = expiryDays
      ? `CASE WHEN e.occurredAt < DATE_SUB(?, INTERVAL ${Math.trunc(expiryDays)} DAY) THEN 1 ELSE 0 END`
      : '0';
    const values: Array<string | Date> = expiryDays
      ? [settledAt, memberUserId, planVersionId, side, settledAt]
      : [memberUserId, planVersionId, side, settledAt];
    const rows = await connection.query<UnitRow[]>(
      `SELECT u.id, u.sequence, e.sourceMemberUserId, source.username AS sourceUsername,
              ${expiryExpression} AS expired
       FROM binary_upline_qualifying_units u
       INNER JOIN binary_qualifying_unit_events e ON e.id = u.unitEventId
       INNER JOIN users source ON source.id = e.sourceMemberUserId
       LEFT JOIN binary_qualifying_unit_events reversal ON reversal.reversalOfEventId = e.id
       LEFT JOIN binary_pair_matches left_match ON left_match.leftUnitId = u.id
       LEFT JOIN binary_pair_matches right_match ON right_match.rightUnitId = u.id
       LEFT JOIN binary_unit_dispositions disposition ON disposition.uplineUnitId = u.id
       WHERE u.ancestorUserId = ? AND u.planVersionId = ? AND u.side = ?
         AND e.eventType = 'QUALIFY'
         AND e.occurredAt <= ?
         AND reversal.id IS NULL
         AND left_match.id IS NULL
         AND right_match.id IS NULL
         AND disposition.id IS NULL
       ORDER BY u.sequence ASC`,
      values,
    );
    return {
      eligible: rows.filter((row) => !Boolean(row.expired)),
      expired: rows.filter((row) => Boolean(row.expired)),
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
