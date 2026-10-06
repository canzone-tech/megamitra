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

  it('returns stored installment tokens and permanent season references without minting replacements', async () => {
    const payment = { allocations: [], refunds: [], attempt: null };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM program_payment_records pr')) {
        return [{
          id: 'payment-1',
          occurredAt: '2026-10-06T07:00:00Z',
          amount: '2000.00',
          currencyCode: 'INR',
          paymentMode: 'EPIN_PREPAID',
          transactionReference: 'not-a-token',
          paymentType: 'OTHER',
          refundedAmount: '0.00',
          userId: 'member-1',
          username: 'MGC585499',
          firstName: 'Demo',
          lastName: 'User for A',
          seasonId: 'season-1',
          seasonCode: 'MGC_202610_3FC2',
          seasonName: 'MegaGoldenClub 2027',
          recordedByUsername: null,
        }];
      }
      if (sql.includes('FROM owner_portal_settings')) {
        return [{ companyName: 'MegaGoldenClub', currencyCode: 'INR' }];
      }
      if (sql.includes('FROM lucky_draw_tokens')) {
        return [
          { token: '58321', installmentSequence: 1, status: 'AVAILABLE' },
          { token: '69412', installmentSequence: 7, status: 'AVAILABLE' },
        ];
      }
      throw new Error(`Unexpected receipt query: ${sql}`);
    });
    const db = {
      transaction: jest.fn(async (work: (connection: { query: typeof query }) => unknown) =>
        work({ query }),
      ),
    };
    const programPayments = { getPayment: jest.fn().mockResolvedValue(payment) };
    const service = new OwnerPortalFinanceService(
      db as never,
      {} as never,
      programPayments as never,
      {} as never,
    );

    const receipt = await service.paymentReceipt('payment-1');

    expect(receipt.drawTokens).toEqual([
      {
        token: '58321',
        installmentSequence: 1,
        status: 'AVAILABLE',
        printedReference: 'MGC_202610_3FC2-M01-58321',
      },
      {
        token: '69412',
        installmentSequence: 7,
        status: 'AVAILABLE',
        printedReference: 'MGC_202610_3FC2-M07-69412',
      },
    ]);
    expect(programPayments.getPayment).toHaveBeenCalledWith('payment-1');
    expect(query.mock.calls.filter(([sql]) => sql.includes('FROM lucky_draw_tokens'))).toHaveLength(1);
  });

});
