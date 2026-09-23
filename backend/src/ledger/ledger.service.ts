import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { LedgerAccountKind, LedgerEntryDirection } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async getTransaction(id: string) {
    const transaction = await this.prisma.ledgerTransaction.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { createdAt: 'asc' },
          include: { account: true },
        },
        binarySettlement: true,
      },
    });
    if (!transaction) throw new NotFoundException('Ledger transaction not found');

    const debitTotal = transaction.entries
      .filter((entry) => entry.direction === LedgerEntryDirection.DEBIT)
      .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
    const creditTotal = transaction.entries
      .filter((entry) => entry.direction === LedgerEntryDirection.CREDIT)
      .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));

    return {
      ...transaction,
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

    const [credits, debits, recentEntries] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { accountId: account.id, direction: LedgerEntryDirection.CREDIT },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { accountId: account.id, direction: LedgerEntryDirection.DEBIT },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { transaction: true },
      }),
    ]);

    const creditTotal = credits._sum.amount ?? new Prisma.Decimal(0);
    const debitTotal = debits._sum.amount ?? new Prisma.Decimal(0);
    return {
      user,
      currencyCode,
      balance: creditTotal.minus(debitTotal),
      account,
      recentEntries,
    };
  }
}
