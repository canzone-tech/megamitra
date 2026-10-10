import { Prisma } from '../generated/prisma/client';
import { OwnerPortalFinanceService } from './owner-portal-finance.service';

describe('OwnerPortalFinanceService', () => {
  it('serializes zone-less database payment timestamps as explicit UTC instants', async () => {
    const query = jest.fn().mockResolvedValue([{
      id: 'payment-1',
      occurredAt: '2026-10-06 11:43:43',
      amount: '2000.00',
      currencyCode: 'INR',
      paymentMode: 'EPIN_PREPAID',
      transactionReference: 'ref-1',
      paymentType: 'OTHER',
      refundedAmount: '0.00',
      userId: 'member-1',
      username: 'MGC855889',
      firstName: 'Demo',
      lastName: 'User C',
      seasonId: 'season-1',
      seasonCode: 'MGC_202610_3FC2',
      seasonName: 'MegaGoldenClub 2027',
      recordedByUsername: 'MGC855889',
    }]);
    const db = {
      transaction: jest.fn(async (work: (connection: { query: typeof query }) => unknown) =>
        work({ query }),
      ),
    };
    const service = new OwnerPortalFinanceService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const [payment] = await service.listPayments(10);

    expect(payment?.occurredAt).toBe('2026-10-06T11:43:43.000Z');
    expect(payment?.receiptNumber).toBe('MGC-20261006-PAYMENT1');
  });

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
      {} as never,
      {} as never,
    );

    const result = await service.wallet('member1', 'INR');

    expect(result.balance).toBe('125.00');
    expect(result.creditTotal).toBe('150.00');
    expect(result.debitTotal).toBe('25.00');
    expect(result.recentEntries.map((entry) => entry.runningBalance)).toEqual(['125.00', '100.00']);
  });

  it('returns stored installment tokens and permanent season references and automatically repairs any missing token', async () => {
    const payment = { allocations: [{ allocationType: 'INSTALLMENT', installmentId: 'emi-1' }], refunds: [], attempt: null };
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
    const drawTokens = { ensurePaymentRecordInstallmentTokens: jest.fn().mockResolvedValue([{ token: '58321' }]) };
    const service = new OwnerPortalFinanceService(
      db as never,
      {} as never,
      programPayments as never,
      {} as never,
      drawTokens as never,
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
    expect(drawTokens.ensurePaymentRecordInstallmentTokens).toHaveBeenCalledWith('payment-1');
    expect(query.mock.calls.filter(([sql]) => sql.includes('FROM lucky_draw_tokens'))).toHaveLength(1);
  });


  it('provisions installment draw tokens after cash/Auth Code payment and returns them on its receipt', async () => {
    const record = { payment: { payment: { id: 'cash-payment-1' } } };
    const receipt = { id: 'cash-payment-1', drawTokens: [{ token: '58321' }] };
    const portal = { recordPayment: jest.fn().mockResolvedValue(record) };
    const tokens = { ensurePaymentRecordInstallmentTokens: jest.fn().mockResolvedValue([{ token: '58321' }]) };
    const service = new OwnerPortalFinanceService(
      {} as never, portal as never, {} as never, {} as never, tokens as never, {} as never,
    );
    jest.spyOn(service, 'paymentReceipt').mockResolvedValue(receipt as never);
    const result = await service.recordPayment({} as never, 'admin-1');
    expect(tokens.ensurePaymentRecordInstallmentTokens).toHaveBeenCalledWith('cash-payment-1');
    expect(result.receipt).toEqual(receipt);
    expect(result.tokenReconciliationPending).toBe(false);
  });

  it('never claims a committed payment rolled back when token provisioning fails', async () => {
    const portal = { recordPayment: jest.fn().mockResolvedValue({ payment: { payment: { id: 'cash-1' } } }) };
    const tokens = { ensurePaymentRecordInstallmentTokens: jest.fn().mockRejectedValue(new Error('token collision exhausted')) };
    const service = new OwnerPortalFinanceService(
      {} as never, portal as never, {} as never, {} as never, tokens as never, {} as never,
    );
    jest.spyOn(service, 'paymentReceipt').mockResolvedValue({ id: 'cash-1', drawTokens: [] } as never);
    const result = await service.recordPayment({} as never, 'admin-1');
    expect(result.tokenReconciliationPending).toBe(true);
  });

  it('only reconciles confirmed installment allocations and logs the explicit repair action', async () => {
    const program = { getPayment: jest.fn().mockResolvedValue({ allocations: [
      { allocationType: 'INSTALLMENT', installmentId: 'emi-2' },
    ] }) };
    const tokens = { ensurePaymentRecordInstallmentTokens: jest.fn().mockResolvedValue([{ token: '58321' }]) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new OwnerPortalFinanceService(
      {} as never, {} as never, program as never, {} as never, tokens as never, audit as never,
    );
    jest.spyOn(service, 'paymentReceipt').mockResolvedValue({ id: 'cash-1', drawTokens: [{ token: '58321' }] } as never);
    await service.reconcilePaymentDrawTokens('cash-1', 'admin-1');
    await service.reconcilePaymentDrawTokens('cash-1', 'admin-1');
    expect(tokens.ensurePaymentRecordInstallmentTokens).toHaveBeenCalledTimes(2);
    expect(tokens.ensurePaymentRecordInstallmentTokens).toHaveBeenCalledWith('cash-1');
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[0][0].entityId).toBe('cash-1');
    program.getPayment.mockResolvedValueOnce({ allocations: [] });
    await expect(service.reconcilePaymentDrawTokens('registration-only', 'admin-1'))
      .rejects.toThrow('Only recorded installment payments qualify');
    expect(tokens.ensurePaymentRecordInstallmentTokens).toHaveBeenCalledTimes(2);
  });

});
