import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
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

@Injectable()
export class BinarySettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(dto: RunBinaryPairSettlementDto, actorUserId: string) {
    const settledAt = new Date(dto.settledAt);
    const existing = await this.prisma.binaryPairSettlement.findUnique({
      where: { sourceKey: dto.sourceKey },
      include: { ledgerTransaction: { include: { entries: { include: { account: true } } } } },
    });
    if (existing) {
      this.assertIdempotentMatch(existing, dto, settledAt);
      return { settlement: existing, idempotent: true };
    }

    const mutexKey = `binary-settlement:${dto.memberUserId}:${dto.planVersionId}`;
    await this.prisma.systemSequence.upsert({
      where: { key: mutexKey },
      update: {},
      create: { key: mutexKey, nextValue: 0n },
    });

    const settlement = await this.prisma.$transaction(
      async (tx) => {
        await tx.systemSequence.update({
          where: { key: mutexKey },
          data: { nextValue: { increment: 1 } },
        });

        const raced = await tx.binaryPairSettlement.findUnique({
          where: { sourceKey: dto.sourceKey },
          include: { ledgerTransaction: { include: { entries: { include: { account: true } } } } },
        });
        if (raced) {
          this.assertIdempotentMatch(raced, dto, settledAt);
          return raced;
        }

        const member = await tx.user.findUnique({
          where: { id: dto.memberUserId },
          select: { id: true, username: true, status: true },
        });
        if (!member) throw new NotFoundException('Settlement member not found');

        const version = await tx.binaryPlanVersion.findUnique({
          where: { id: dto.planVersionId },
          include: { plan: true },
        });
        if (!version) throw new NotFoundException('Binary plan version not found');
        if (version.lifecycle !== PolicyLifecycle.PUBLISHED) {
          throw new ConflictException('Pair settlement requires a published binary plan version');
        }
        if (
          version.effectiveFrom > settledAt ||
          (version.effectiveTo && version.effectiveTo < settledAt)
        ) {
          throw new BadRequestException('Binary plan version is not effective at settlement time');
        }
        if (!version.currencyCode || !version.settlementTimezone || !version.capOverflowMode) {
          throw new ConflictException(
            'Published plan is missing settlement currency, timezone or cap overflow policy',
          );
        }
        this.assertSupportedQualificationRules(version.qualificationRules);

        const laterSettlement = await tx.binaryPairSettlement.findFirst({
          where: {
            memberUserId: dto.memberUserId,
            planVersionId: dto.planVersionId,
            settledAt: { gt: settledAt },
          },
          select: { id: true },
        });
        if (laterSettlement) {
          throw new ConflictException(
            'Cannot insert a settlement before a later settlement for the same member and plan version',
          );
        }

        const local = this.localPeriod(settledAt, version.settlementTimezone);
        const leftAvailable = await this.availableVolume(
          tx,
          dto.memberUserId,
          dto.planVersionId,
          BinaryPlacementSide.LEFT,
          settledAt,
          version.carryForwardExpiryDays,
        );
        const rightAvailable = await this.availableVolume(
          tx,
          dto.memberUserId,
          dto.planVersionId,
          BinaryPlacementSide.RIGHT,
          settledAt,
          version.carryForwardExpiryDays,
        );
        const previous = await tx.binaryPairSettlement.aggregate({
          where: {
            memberUserId: dto.memberUserId,
            planVersionId: dto.planVersionId,
            settledAt: { lte: settledAt },
          },
          _sum: { leftVolumeConsumed: true, rightVolumeConsumed: true },
        });
        const dailyUsed = await tx.binaryPairSettlement.aggregate({
          where: {
            memberUserId: dto.memberUserId,
            planVersionId: dto.planVersionId,
            settlementLocalDate: local.date,
          },
          _sum: { pairCountPayable: true },
        });
        const monthlyUsed = await tx.binaryPairSettlement.aggregate({
          where: {
            memberUserId: dto.memberUserId,
            planVersionId: dto.planVersionId,
            settlementLocalMonth: local.month,
          },
          _sum: { pairCountPayable: true },
        });

        const priorLeftConsumed = previous._sum.leftVolumeConsumed ?? new Prisma.Decimal(0);
        const priorRightConsumed = previous._sum.rightVolumeConsumed ?? new Prisma.Decimal(0);
        const left = this.subtractPriorConsumption(leftAvailable, priorLeftConsumed);
        const right = this.subtractPriorConsumption(rightAvailable, priorRightConsumed);

        if (left.lessThan(0) || right.lessThan(0)) {
          throw new ConflictException(
            'Volume reversals exceed remaining carry; explicit reconciliation is required',
          );
        }

        const leftPairs = left.dividedBy(version.leftVolumePerPair).floor().toNumber();
        const rightPairs = right.dividedBy(version.rightVolumePerPair).floor().toNumber();
        const pairCountCalculated = Math.max(0, Math.min(leftPairs, rightPairs));

        let pairCountPayable = pairCountCalculated;
        if (version.dailyPairCap !== null) {
          pairCountPayable = Math.min(
            pairCountPayable,
            Math.max(0, version.dailyPairCap - (dailyUsed._sum.pairCountPayable ?? 0)),
          );
        }
        if (version.monthlyPairCap !== null) {
          pairCountPayable = Math.min(
            pairCountPayable,
            Math.max(0, version.monthlyPairCap - (monthlyUsed._sum.pairCountPayable ?? 0)),
          );
        }

        const capLimitedPairs = pairCountCalculated - pairCountPayable;
        const payableLeft = version.leftVolumePerPair.mul(pairCountPayable);
        const payableRight = version.rightVolumePerPair.mul(pairCountPayable);

        let leftConsumed = payableLeft;
        let rightConsumed = payableRight;
        if (version.carryForwardEnabled) {
          if (version.capOverflowMode === BinaryCapOverflowMode.FLUSH && capLimitedPairs > 0) {
            leftConsumed = leftConsumed.plus(version.leftVolumePerPair.mul(capLimitedPairs));
            rightConsumed = rightConsumed.plus(version.rightVolumePerPair.mul(capLimitedPairs));
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

        const payoutAmount = version.pairPayoutAmount.mul(pairCountPayable);
        let ledgerTransactionId: string | null = null;
        if (payoutAmount.greaterThan(0)) {
          const currencyCode = version.currencyCode.toUpperCase();
          const wallet = await tx.ledgerAccount.upsert({
            where: { code: `USER_WALLET:${dto.memberUserId}:${currencyCode}` },
            update: {},
            create: {
              code: `USER_WALLET:${dto.memberUserId}:${currencyCode}`,
              name: `${member.username} wallet ${currencyCode}`,
              kind: LedgerAccountKind.USER_WALLET,
              ownerUserId: dto.memberUserId,
              currencyCode,
            },
          });
          const expense = await tx.ledgerAccount.upsert({
            where: { code: `COMMISSION_EXPENSE:${currencyCode}` },
            update: {},
            create: {
              code: `COMMISSION_EXPENSE:${currencyCode}`,
              name: `Commission expense ${currencyCode}`,
              kind: LedgerAccountKind.COMMISSION_EXPENSE,
              currencyCode,
            },
          });
          const ledgerTransaction = await tx.ledgerTransaction.create({
            data: {
              sourceKey: `BINARY_PAIR:${dto.sourceKey}`,
              type: LedgerTransactionType.BINARY_PAIR_COMMISSION,
              description: `Binary pair commission for ${member.username}`,
              occurredAt: settledAt,
              createdByUserId: actorUserId,
            },
          });
          await tx.ledgerEntry.createMany({
            data: [
              {
                transactionId: ledgerTransaction.id,
                accountId: expense.id,
                direction: LedgerEntryDirection.DEBIT,
                amount: payoutAmount,
                currencyCode,
              },
              {
                transactionId: ledgerTransaction.id,
                accountId: wallet.id,
                direction: LedgerEntryDirection.CREDIT,
                amount: payoutAmount,
                currencyCode,
              },
            ],
          });
          ledgerTransactionId = ledgerTransaction.id;
        }

        return tx.binaryPairSettlement.create({
          data: {
            sourceKey: dto.sourceKey,
            memberUserId: dto.memberUserId,
            planVersionId: dto.planVersionId,
            settledAt,
            settlementLocalDate: local.date,
            settlementLocalMonth: local.month,
            leftAvailableBefore: left,
            rightAvailableBefore: right,
            pairCountCalculated,
            pairCountPayable,
            capLimitedPairs,
            leftVolumeConsumed: leftConsumed,
            rightVolumeConsumed: rightConsumed,
            leftCarryAfter: leftCarry,
            rightCarryAfter: rightCarry,
            payoutAmount,
            currencyCode: version.currencyCode.toUpperCase(),
            ledgerTransactionId,
            createdByUserId: actorUserId,
          },
          include: {
            ledgerTransaction: { include: { entries: { include: { account: true } } } },
          },
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

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

    return { settlement, idempotent: false };
  }

  async getSettlement(id: string) {
    const settlement = await this.prisma.binaryPairSettlement.findUnique({
      where: { id },
      include: {
        member: { select: { id: true, username: true } },
        planVersion: { include: { plan: true } },
        ledgerTransaction: { include: { entries: { include: { account: true } } } },
      },
    });
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

  private async availableVolume(
    tx: Prisma.TransactionClient,
    memberUserId: string,
    planVersionId: string,
    side: BinaryPlacementSide,
    settledAt: Date,
    expiryDays: number | null,
  ): Promise<{ all: Prisma.Decimal; eligible: Prisma.Decimal }> {
    const allAggregate = await tx.binaryUplineVolumeCredit.aggregate({
      where: {
        ancestorUserId: memberUserId,
        planVersionId,
        side,
        volumeEvent: { occurredAt: { lte: settledAt } },
      },
      _sum: { volume: true },
    });
    const all = allAggregate._sum.volume ?? new Prisma.Decimal(0);
    if (!expiryDays) return { all, eligible: all };

    const cutoff = new Date(settledAt.getTime() - expiryDays * 86_400_000);
    const eligibleAggregate = await tx.binaryUplineVolumeCredit.aggregate({
      where: {
        ancestorUserId: memberUserId,
        planVersionId,
        side,
        volumeEvent: { occurredAt: { gte: cutoff, lte: settledAt } },
      },
      _sum: { volume: true },
    });
    return { all, eligible: eligibleAggregate._sum.volume ?? new Prisma.Decimal(0) };
  }

  private subtractPriorConsumption(
    volume: { all: Prisma.Decimal; eligible: Prisma.Decimal },
    priorConsumed: Prisma.Decimal,
  ): Prisma.Decimal {
    const expired = this.maxZero(volume.all.minus(volume.eligible));
    const consumedAgainstEligible = this.maxZero(priorConsumed.minus(expired));
    return volume.eligible.minus(consumedAgainstEligible);
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

  private assertSupportedQualificationRules(rules: Prisma.JsonValue | null): void {
    if (
      !rules ||
      (typeof rules === 'object' && !Array.isArray(rules) && Object.keys(rules).length === 0)
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
      existing.settledAt.getTime() !== settledAt.getTime()
    ) {
      throw new ConflictException('Settlement source key already exists with a different payload');
    }
  }
}
