import { LuckyDrawTokenService } from './lucky-draw-token.service';

describe('LuckyDrawTokenService automatic member token repair', () => {
  const allocation = {
    paymentAllocationId: 'allocation-3', paymentRecordId: 'payment-3',
    enrollmentId: 'enrollment-1', installmentId: 'emi-3', installmentSequence: 3,
    userId: 'member-1', seasonId: 'season-2027',
  };

  it('scopes a fully paid read-repair to the authenticated member and inserts one token per installment', async () => {
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM program_payment_allocations a') && sql.includes('FOR UPDATE')) {
        expect(params).toEqual(['member-1']);
        expect(sql).toContain('e.userId=?');
        expect(sql).toContain('FROM program_refund_allocations ra');
        expect(sql).toContain('>= i.amount');
        return [allocation, { ...allocation, paymentAllocationId: 'allocation-2' }];
      }
      if (sql.includes('SELECT token FROM lucky_draw_tokens')) return [];
      if (sql.includes('INSERT INTO lucky_draw_tokens')) return { affectedRows: 1 };
      return [];
    });
    const db = { transaction: jest.fn(async (run: (conn: { query: typeof query }) => Promise<unknown>) =>
      run({ query }),
    ) };
    const service = new LuckyDrawTokenService(db as never);
    const response = await service.ensureMemberConfirmedInstallmentTokens('member-1');
    expect(response).toEqual({ reconciledInstallments: 1 });
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO lucky_draw_tokens'))).toHaveLength(1);
  });

  it('does not create a new token when no qualifying missing paid installment exists', async () => {
    const query = jest.fn(async () => []);
    const db = { transaction: jest.fn(async (run: (conn: { query: typeof query }) => Promise<unknown>) =>
      run({ query }),
    ) };
    const service = new LuckyDrawTokenService(db as never);
    await expect(service.ensureMemberConfirmedInstallmentTokens('member-1'))
      .resolves.toEqual({ reconciledInstallments: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
