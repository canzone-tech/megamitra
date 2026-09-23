import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { LedgerAccountKind, LedgerEntryDirection } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

type LedgerTransactionRow = {
  id: string;
  sourceKey: string;
  type: string;
  description: string | null;
  occurredAt: Date;
  createdByUserId: string | null;
  createdAt: Date;
};

type LedgerEntryRow = {
  id: string;
  transactionId: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string | number | Prisma.Decimal;
  currencyCode: string;
  createdAt: Date;
  accountCode: string;
  accountName: string;
  accountKind: string;
  accountOwnerUserId: string | null;
  accountCurrencyCode: string;
};

type RecentEntryRow = {
  id: string;
  transactionId: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string | number | Prisma.Decimal;
  currencyCode: string;
  createdAt: Date;
  transactionSourceKey: string;
  transactionType: string;
  transactionDescription: string | null;
  transactionOccurredAt: Date;
  transactionCreatedByUserId: string | null;
  transactionCreatedAt: Date;
};

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async getTransaction(id: string) {
    const transactions = await this.prisma.$queryRawUnsafe<LedgerTransactionRow[]>(
      `SELECT * FROM ledger_transactions WHERE id = ? LIMIT 1`,
      id,
    );
    const transaction = transactions[0];
    if (!transaction) throw new NotFoundException('Ledger transaction not found');

    const rows = await this.prisma.$queryRawUnsafe<LedgerEntryRow[]>(
      `SELECT e.id, e.transactionId, e.accountId, e.direction, e.amount, e.currencyCode, e.createdAt,
              a.code AS accountCode, a.name AS accountName, a.kind AS accountKind,
              a.ownerUserId AS accountOwnerUserId, a.currencyCode AS accountCurrencyCode
       FROM ledger_entries e
       INNER JOIN ledger_accounts a ON a.id = e.accountId
       WHERE e.transactionId = ?
       ORDER BY e.createdAt ASC, e.id ASC`,
      id,
    );
    const entries = rows.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      accountId: entry.accountId,
      direction: entry.direction,
      amount: new Prisma.Decimal(entry.amount),
      currencyCode: entry.currencyCode,
      createdAt: entry.createdAt,
      account: {
        id: entry.accountId,
        code: entry.accountCode,
        name: entry.accountName,
        kind: entry.accountKind,
        ownerUserId: entry.accountOwnerUserId,
        currencyCode: entry.accountCurrencyCode,
      },
    }));

    const debitTotal = entries
      .filter((entry) => entry.direction === LedgerEntryDirection.DEBIT)
      .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
    const creditTotal = entries
      .filter((entry) => entry.direction === LedgerEntryDirection.CREDIT)
      .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));

    const [binaryRows, referralRows, prizeRows, prizeReversalRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM binary_pair_settlements WHERE ledgerTransactionId = ? LIMIT 1`,
        id,
      ),
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM referral_reward_events WHERE ledgerTransactionId = ? LIMIT 1`,
        id,
      ),
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM lucky_draw_prize_fulfillments WHERE ledgerTransactionId = ? LIMIT 1`,
        id,
      ),
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM lucky_draw_prize_fulfillment_reversals WHERE ledgerTransactionId = ? LIMIT 1`,
        id,
      ),
    ]);

    return {
      ...transaction,
      entries,
      binarySettlement: binaryRows[0] ?? null,
      referralRewardEvent: referralRows[0] ?? null,
      luckyDrawPrizeFulfillment: prizeRows[0] ?? null,
      luckyDrawPrizeFulfillmentReversal: prizeReversalRows[0] ?? null,
      balanced: debitTotal.equals(creditTotal),
      debitTotal,
      creditTotal,
    };
  }

  async getUserWallet(userId: string, rawCurrencyCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const currencyCode = rawCurrencyCode.trim().toUpperCase();
    const account = await this.prisma.ledgerAccount.findFirst({
      where: {
        ownerUserId: userId,
        kind: LedgerAccountKind.USER_WALLET,
        currencyCode,
      },
    });
    if (!account) {
      return {
        user,
        currencyCode,
        balance: new Prisma.Decimal(0),
        account: null,
        recentEntries: [],
      };
    }

    const [credits, debits, recentRows] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { accountId: account.id, direction: LedgerEntryDirection.CREDIT },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { accountId: account.id, direction: LedgerEntryDirection.DEBIT },
        _sum: { amount: true },
      }),
      this.prisma.$queryRawUnsafe<RecentEntryRow[]>(
        `SELECT e.id, e.transactionId, e.accountId, e.direction, e.amount, e.currencyCode, e.createdAt,
                t.sourceKey AS transactionSourceKey, t.type AS transactionType,
                t.description AS transactionDescription, t.occurredAt AS transactionOccurredAt,
                t.createdByUserId AS transactionCreatedByUserId, t.createdAt AS transactionCreatedAt
         FROM ledger_entries e
         INNER JOIN ledger_transactions t ON t.id = e.transactionId
         WHERE e.accountId = ?
         ORDER BY e.createdAt DESC, e.id DESC
         LIMIT 100`,
        account.id,
      ),
    ]);

    const creditTotal = credits._sum.amount ?? new Prisma.Decimal(0);
    const debitTotal = debits._sum.amount ?? new Prisma.Decimal(0);
    const recentEntries = recentRows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      accountId: row.accountId,
      direction: row.direction,
      amount: new Prisma.Decimal(row.amount),
      currencyCode: row.currencyCode,
      createdAt: row.createdAt,
      transaction: {
        id: row.transactionId,
        sourceKey: row.transactionSourceKey,
        type: row.transactionType,
        description: row.transactionDescription,
        occurredAt: row.transactionOccurredAt,
        createdByUserId: row.transactionCreatedByUserId,
        createdAt: row.transactionCreatedAt,
      },
    }));
    return {
      user,
      currencyCode,
      balance: creditTotal.minus(debitTotal),
      account,
      recentEntries,
    };
  }
}
