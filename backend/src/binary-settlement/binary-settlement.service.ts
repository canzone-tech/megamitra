import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  BinaryCapOverflowMode,
  BinaryPlacementSide,
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
  settledAt: Date;
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
  leftVolumePerPair: string;
  rightVolumePerPair: string;
  pairPayoutAmount: string;
  currencyCode: string | null;
  settlementTimezone: string | null;
  capOverflowMode: string | null;
  dailyPairCap: number | null;
  monthlyPairCap: number | null;
  carryForwardEnabled: boolean | number;
  carryForwardExpiryDays: number | null;
  qualificationRules: unknown;
};

type DecimalTotalRow = { total: string | number | bigint | null };
type ConsumptionRow = {
  leftConsumed: string | number | bigint | null;
  rightConsumed: string | number | bigint | null;
};
type CountRow = { total: string | number | bigint | null };
type IdRow = { id: string };

type AvailableVolume = {
  all: Prisma.Decimal;
  eligible: Prisma.Decimal;
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
    const existing = await this.findSettlement(dto.sourceKey);
    if (existing) {
      this.assertIdempotentMatch(existing, dto, settledAt);
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
        this.runNativeTransaction(connection, dto, actorUserId, settledAt, mutexKey),
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const duplicate = await this.findSettlement(dto.sourceKey);
        if (duplicate) {
          this.assertIdempotentMatch(duplicate, dto, settledAt);
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
        description: 'Binary pair settlement completed',
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
      include: { planVersion: { include: { plan: true } }, ledgerTransaction: true },
    });
  }

  private async runNativeTransaction(
    connection: PoolConnection,
    dto: RunBinaryPairSettlementDto,
    actorUserId: string,
    settledAt: Date,
    mutexKey: string,
  ): Promise<{ id: string; idempotent: boolean }> {
    await connection.query(
      `UPDATE system_sequences
       SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [mutexKey],
    );

    const racedRows = await connection.query<SettlementIdentityRow[]>(
      `SELECT id, memberUserId, planVersionId, settledAt
       FROM binary_pair_settlements
       WHERE sourceKey = ?
       LIMIT 1`,
      [dto.sourceKey],
    );
    const raced = racedRows[0];
    if (raced) {
      this.assertIdempotentMatch(raced, dto, settledAt);
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
              leftVolumePerPair, rightVolumePerPair, pairPayoutAmount,
              currencyCode, settlementTimezone, capOverflowMode,
              dailyPairCap, monthlyPairCap, carryForwardEnabled,
              carryForwardExpiryDays, qualificationRules
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
    this.assertSupportedQualificationRules(version.qualificationRules);

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

    const local = this.localPeriod(settledAt, version.settlementTimezone);
    const leftAvailable = await this.availableVolumeNative(
      connection,
      dto.memberUserId,
      dto.planVersionId,
      BinaryPlacementSide.LEFT,
      settledAt,
      version.carryForwardExpiryDays,
    );
    const rightAvailable = await this.availableVolumeNative(
      connection,
      dto.memberUserId,
      dto.planVersionId,
      BinaryPlacementSide.RIGHT,
      settledAt,
      version.carryForwardExpiryDays,
    );

    const consumptionRows = await connection.query<ConsumptionRow[]>(
      `SELECT COALESCE(SUM(leftVolumeConsumed), 0) AS leftConsumed,
              COALESCE(SUM(rightVolumeConsumed), 0) AS rightConsumed
       FROM binary_pair_settlements
       WHERE memberUserId = ? AND planVersionId = ? AND settledAt <= ?`,
      [dto.memberUserId, dto.planVersionId, settledAt],
    );
    const consumption = consumptionRows[0] ?? { leftConsumed: 0, rightConsumed: 0 };

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

    const priorLeftConsumed = this.decimal(consumption.leftConsumed);
    const priorRightConsumed = this.decimal(consumption.rightConsumed);
    const left = this.subtractPriorConsumption(leftAvailable, priorLeftConsumed);
    const right = this.subtractPriorConsumption(rightAvailable, priorRightConsumed);
    if (left.lessThan(0) || right.lessThan(0)) {
      throw new ConflictException(
        'Volume reversals exceed remaining carry; explicit reconciliation is required',
      );
    }

    const leftPerPair = this.decimal(version.leftVolumePerPair);
    const rightPerPair = this.decimal(version.rightVolumePerPair);
    const pairPayoutAmount = this.decimal(version.pairPayoutAmount);
    const leftPairs = left.dividedBy(leftPerPair).floor().toNumber();
    const rightPairs = right.dividedBy(rightPerPair).floor().toNumber();
    const pairCountCalculated = Math.max(0, Math.min(leftPairs, rightPairs));

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
    let leftConsumed = leftPerPair.mul(pairCountPayable);
    let rightConsumed = rightPerPair.mul(pairCountPayable);
    if (Boolean(version.carryForwardEnabled)) {
      if (version.capOverflowMode === BinaryCapOverflowMode.FLUSH && capLimitedPairs > 0) {
        leftConsumed = leftConsumed.plus(leftPerPair.mul(capLimitedPairs));
        rightConsumed = rightConsumed.plus(rightPerPair.mul(capLimitedPairs));
      }
    } else {
      leftConsumed = left;
      rightConsumed = right;
    }

    const leftCarry = left.minus(leftConsumed);
    const rightCarry = right.minus(rightConsumed);
    if (leftCarry.lessThan(0) || rightCarry.lessThan(0)) {
      throw new ConflictException('Settlement consumption exceeds available volume');
    }

    const currencyCode = version.currencyCode.toUpperCase();
    const payoutAmount = pairPayoutAmount.mul(pairCountPayable);
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
         (id, sourceKey, memberUserId, planVersionId, settledAt,
          settlementLocalDate, settlementLocalMonth,
          leftAvailableBefore, rightAvailableBefore,
          pairCountCalculated, pairCountPayable, capLimitedPairs,
          leftVolumeConsumed, rightVolumeConsumed,
          leftCarryAfter, rightCarryAfter,
          payoutAmount, currencyCode, ledgerTransactionId,
          createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        settlementId,
        dto.sourceKey,
        dto.memberUserId,
        dto.planVersionId,
        settledAt,
        local.date,
        local.month,
        left.toFixed(4),
        right.toFixed(4),
        pairCountCalculated,
        pairCountPayable,
        capLimitedPairs,
        leftConsumed.toFixed(4),
        rightConsumed.toFixed(4),
        leftCarry.toFixed(4),
        rightCarry.toFixed(4),
        payoutAmount.toFixed(2),
        currencyCode,
        ledgerTransactionId,
        actorUserId,
      ],
    );

    return { id: settlementId, idempotent: false };
  }

  private async availableVolumeNative(
    connection: PoolConnection,
    memberUserId: string,
    planVersionId: string,
    side: BinaryPlacementSide,
    settledAt: Date,
    expiryDays: number | null,
  ): Promise<AvailableVolume> {
    const allRows = await connection.query<DecimalTotalRow[]>(
      `SELECT COALESCE(SUM(c.volume), 0) AS total
       FROM binary_upline_volume_credits c
       INNER JOIN binary_volume_events e ON e.id = c.volumeEventId
       WHERE c.ancestorUserId = ? AND c.planVersionId = ? AND c.side = ?
         AND e.occurredAt <= ?`,
      [memberUserId, planVersionId, side, settledAt],
    );
    const all = this.decimal(allRows[0]?.total ?? 0);
    if (!expiryDays) return { all, eligible: all };

    const cutoff = new Date(settledAt.getTime() - expiryDays * 86_400_000);
    const eligibleRows = await connection.query<DecimalTotalRow[]>(
      `SELECT COALESCE(SUM(c.volume), 0) AS total
       FROM binary_upline_volume_credits c
       INNER JOIN binary_volume_events e ON e.id = c.volumeEventId
       WHERE c.ancestorUserId = ? AND c.planVersionId = ? AND c.side = ?
         AND e.occurredAt >= ? AND e.occurredAt <= ?`,
      [memberUserId, planVersionId, side, cutoff, settledAt],
    );
    return { all, eligible: this.decimal(eligibleRows[0]?.total ?? 0) };
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
      },
    });
  }

  private subtractPriorConsumption(
    volume: AvailableVolume,
    priorConsumed: Prisma.Decimal,
  ): Prisma.Decimal {
    const expired = this.maxZero(volume.all.minus(volume.eligible));
    const consumedAgainstEligible = this.maxZero(priorConsumed.minus(expired));
    return volume.eligible.minus(consumedAgainstEligible);
  }

  private decimal(value: string | number | bigint | Prisma.Decimal): Prisma.Decimal {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value.toString());
  }

  private maxZero(value: Prisma.Decimal): Prisma.Decimal {
    return value.lessThan(0) ? new Prisma.Decimal(0) : value;
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

  private assertSupportedQualificationRules(rules: unknown): void {
    if (rules === null || rules === undefined) return;
    let parsed = rules;
    if (typeof rules === 'string') {
      try {
        parsed = JSON.parse(rules) as unknown;
      } catch {
        throw new ConflictException('Plan qualification rules are invalid JSON');
      }
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    ) {
      return;
    }
    throw new ConflictException(
      'This plan has qualification rules that require the eligibility engine before settlement',
    );
  }

  private assertIdempotentMatch(
    existing: { memberUserId: string; planVersionId: string; settledAt: Date },
    dto: RunBinaryPairSettlementDto,
    settledAt: Date,
  ): void {
    if (
      existing.memberUserId !== dto.memberUserId ||
      existing.planVersionId !== dto.planVersionId ||
      new Date(existing.settledAt).getTime() !== settledAt.getTime()
    ) {
      throw new ConflictException('Settlement source key already exists with a different payload');
    }
  }
}
