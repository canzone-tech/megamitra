import { ConflictException } from '@nestjs/common';
import { MemberPaymentService } from './member-payment.service';
import type { AuditService } from '../audit/audit.service';
import type { FinancialDbService } from '../database/financial-db.service';
import type { PrismaService } from '../database/prisma.service';
import type { ProgramPaymentService } from '../program/program-payment.service';
import type { ConfigService } from '@nestjs/config';

const enrollment = {
  id: 'enrollment-1', currencyCode: 'INR', installmentAmountSnapshot: '1000.00',
  seasonId: 'season-1',
};
const pin = {
  id: 'pin-1', status: 'ACTIVE', pinType: 'INSTALLMENT', seasonId: 'season-1',
  currencyCodeSnapshot: 'INR', registrationFeeSnapshot: '0.00',
  installmentAmountSnapshot: '1000.00',
  expiresAt: new Date('2035-01-01T00:00:00.000Z'), usedByUserId: null,
};

function setup(overrides: {
  pin?: Partial<typeof pin>;
  pending?: number;
  enrollment?: boolean;
  firstPaid?: number;
} = {}) {
  const executed: string[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    executed.push(sql);
    if (sql.includes('FROM program_enrollments e')) return overrides.enrollment === false ? [] : [enrollment];
    if (sql.includes('FROM owner_epins')) return [{ ...pin, ...overrides.pin }];
    if (sql.includes('COUNT(*) AS total FROM member_payment_submissions')) return [{ total: overrides.pending ?? 0 }];
    if (sql.includes('FROM program_installments')) return [
      { id: 'emi-1', sequence: 1, amount: '1000.00' },
      { id: 'emi-2', sequence: 2, amount: '1000.00' },
      { id: 'emi-3', sequence: 3, amount: '1000.00' },
    ];
    if (sql.includes('FROM program_payment_allocations')) {
      const installmentId = params[0];
      return [{ paid: installmentId === 'emi-3' ? overrides.firstPaid ?? 0 : 1000 }];
    }
    if (sql.startsWith('UPDATE owner_epins')) return { affectedRows: 1 };
    return [];
  });
  const transaction = jest.fn(async (callback: (connection: { query: typeof query }) => Promise<unknown>) =>
    callback({ query }),
  );
  const log = jest.fn(async () => ({}));
  const service = new MemberPaymentService(
    {} as PrismaService,
    { transaction } as unknown as FinancialDbService,
    {} as ProgramPaymentService,
    {} as ConfigService,
    { log } as unknown as AuditService,
  );
  return { service, query, executed, transaction, log };
}

describe('MemberPaymentService installment E-PIN redemption', () => {
  it('consumes an assigned prepaid installment pin, allocates next unpaid EMI once, and emits an event', async () => {
    const { service, query, executed, log } = setup();
    const result = await service.redeemInstallmentEpin('member-1', 'pin-1');
    expect(result.status).toBe('CONFIRMED');
    expect(result.installmentSequence).toBe(3);
    expect(result.amount).toBe('1000.00');
    expect(executed.some((sql) => sql.startsWith('INSERT INTO program_payment_attempts'))).toBe(true);
    expect(executed.some((sql) => sql.startsWith('INSERT INTO program_payment_records'))).toBe(true);
    expect(executed.some((sql) => sql.startsWith('INSERT INTO program_payment_allocations'))).toBe(true);
    expect(executed.some((sql) => sql.startsWith('INSERT INTO program_business_events'))).toBe(true);
    expect(executed.some((sql) => sql.startsWith('UPDATE program_enrollments'))).toBe(true);
    const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE owner_epins'));
    expect(update?.[1]).toContain('member-1');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['used', { pin: { status: 'USED' } }],
    ['expired', { pin: { expiresAt: new Date('2020-01-01T00:00:00.000Z') } }],
    ['wrong session', { pin: { seasonId: 'other-season' } }],
    ['activation pin', { pin: { pinType: 'ACTIVATION' } }],
    ['wrong amount', { pin: { installmentAmountSnapshot: '2000.00' } }],
    ['pending UPI proof', { pending: 1 }],
    ['no enrollment', { enrollment: false }],
    ['part-paid EMI', { firstPaid: 500 }],
  ] as const)('rejects %s without posting money or consuming a pin', async (_label, options) => {
    const { service, executed, log } = setup(options);
    await expect(service.redeemInstallmentEpin('member-1', 'pin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(executed.some((sql) => sql.startsWith('INSERT INTO program_payment_records'))).toBe(false);
    expect(executed.some((sql) => sql.startsWith('UPDATE owner_epins'))).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
