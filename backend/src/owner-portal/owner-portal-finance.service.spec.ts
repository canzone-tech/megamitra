import { Prisma } from '../generated/prisma/client';
import { OwnerPortalFinanceService } from './owner-portal-finance.service';

describe('OwnerPortalFinanceService', () => {
  it('adds exact running balances to recent wallet entries', async () => {
    const portal = {
      wallet: jest.fn().mockResolvedValue({
        user: { id: 'u1', username: 'member1' },
        currencyCode: 'INR',
        balance: new Prisma.Decimal('125.00'),
        account: { id: 'wallet-1' },
        recentEntries: [
          { id: 'e2', direction: 'CREDIT', amount: new Prisma.Decimal('25.00') },
          { id: 'e1', direction: 'DEBIT', amount: new Prisma.Decimal('10.00') },
        ],
      }),
    };
    const db = {
      transaction: jest.fn(async (work: (connection: { query: jest.Mock }) => unknown) =>
        work({ query: jest.fn().mockResolvedValue([{ creditTotal: '150.00', debitTotal: '25.00' }]) }),
      ),
    };
    const service = new OwnerPortalFinanceService(
      db as never,
      portal as never,
      {} as never,
    );

    const result = await service.wallet('member1', 'INR');

    expect(result.balance).toBe('125.00');
    expect(result.creditTotal).toBe('150.00');
    expect(result.debitTotal).toBe('25.00');
    expect(result.recentEntries.map((entry) => entry.runningBalance)).toEqual(['125.00', '100.00']);
  });
});
