import { PrismaService } from '../database/prisma.service';
import { MemberPortalReadService } from './member-portal-read.service';
import { OperationalReadService } from './operational-read.service';

describe('MemberPortalReadService', () => {
  it('composes authoritative member read models with portal-only progress context', async () => {
    const reads = {
      memberDashboard: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, wallets: [] }),
      memberEnrollments: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }),
      memberWalletHistory: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }),
      memberReferralRewards: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }),
      memberBinary: jest.fn().mockResolvedValue({ queueSummary: [], settlements: { items: [] }, pairMatches: { items: [] } }),
      memberRewards: jest.fn().mockResolvedValue({ wins: { items: [] }, eligibility: { items: [] } }),
    };
    const prisma = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ total: 3 }])
        .mockResolvedValueOnce([
          {
            enrollmentId: 'enrollment-1',
            installmentCount: 18,
            scheduledInstallments: 18,
            paidInstallments: 7,
            nextUnpaidDueDate: '2026-10-01',
          },
        ])
        .mockResolvedValueOnce([
          {
            planVersionId: 'plan-version-1',
            qualifyingUnit: '1.0000',
            pairPayoutAmount: '200.00',
            currencyCode: 'INR',
            dailyPairCap: 25,
            carryForwardEnabled: true,
          },
        ]),
    };

    const service = new MemberPortalReadService(
      reads as unknown as OperationalReadService,
      prisma as unknown as PrismaService,
      { ensureMemberConfirmedInstallmentTokens: jest.fn().mockResolvedValue({ reconciledInstallments: 0 }) } as never,
    );

    const result = await service.overview('user-1');

    expect(result.directReferralCount).toBe(3);
    expect(result.enrollmentProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enrollmentId: 'enrollment-1', paidInstallments: 7 }),
      ]),
    );
    expect(result.binaryPlanContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planVersionId: 'plan-version-1', dailyPairCap: 25 }),
      ]),
    );
    expect(reads.memberDashboard).toHaveBeenCalledWith('user-1');
    for (const method of [
      reads.memberEnrollments,
      reads.memberWalletHistory,
      reads.memberReferralRewards,
      reads.memberBinary,
      reads.memberRewards,
    ]) {
      expect(method).toHaveBeenCalledWith('user-1', { page: '1', limit: '10' });
    }
  });

  it('automatically repairs confirmed months then returns net payment, receipt mode and stored token', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{
          id: 'enrollment-1', seasonId: 'season-1',
          seasonCode: 'MGC_202610_3FC2', seasonName: 'MegaGoldenClub 2027',
          status: 'ACTIVE', currencyCode: 'INR', installmentCountSnapshot: 2,
          installmentAmountSnapshot: '1000.00', registrationFeeSnapshot: '1000.00',
        }])
        .mockResolvedValueOnce([
          { id: 'emi-1', enrollmentId: 'enrollment-1', sequence: 1, dueDate: '2027-01-01', amount: '1000.00', applied: '1000.00', refunded: '0.00' },
          { id: 'emi-2', enrollmentId: 'enrollment-1', sequence: 2, dueDate: '2027-02-01', amount: '1000.00', applied: '1000.00', refunded: '250.00' },
        ])
        .mockResolvedValueOnce([
          { installmentId: 'emi-1', id: '2afb0b51-a56d-4f15-bf63-6c246a721234', allocatedAmount: '1000.00', refundedAmount: '0.00', occurredAt: '2026-10-09 05:00:00', mode: 'CASH', reference: 'cash-auth' },
          { installmentId: 'emi-2', id: '2afb0b51-a56d-4f15-bf63-6c246a725678', allocatedAmount: '1000.00', refundedAmount: '250.00', occurredAt: '2026-10-09 05:10:00', mode: 'CASH', reference: 'cash-auth-2' },
        ])
        .mockResolvedValueOnce([
          { installmentId: 'emi-1', token: '58321', installmentSequence: 1, status: 'AVAILABLE' },
        ]),
    };
    const tokens = { ensureMemberConfirmedInstallmentTokens: jest.fn().mockResolvedValue({ reconciledInstallments: 1 }) };
    const service = new MemberPortalReadService(
      {} as OperationalReadService, prisma as unknown as PrismaService, tokens as never,
    );
    const result = await service.installmentHistory('member-1');
    expect(tokens.ensureMemberConfirmedInstallmentTokens).toHaveBeenCalledWith('member-1');
    expect(result.tokenSyncPending).toBe(false);
    expect(result.enrollments).toHaveLength(1);
    const months = result.enrollments[0].installments;
    expect(months.map((m) => m.status)).toEqual(['PAID', 'PARTIAL']);
    expect(months[0].payments[0].mode).toBe('CASH');
    expect(months[0].payments[0].receiptNumber).toBe('MGC-20261009-6A721234');
    expect(months[0].drawTokens).toEqual([
      { token: '58321', status: 'AVAILABLE', printedReference: 'MGC_202610_3FC2-M01-58321' },
    ]);
    expect(months[1].netPaid).toBe('750.00');
    expect(months[1].balance).toBe('250.00');
    expect(result.enrollments[0].outstanding).toBe('250.00');
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(4);
    for (const call of prisma.$queryRawUnsafe.mock.calls) {
      expect(call[1]).toBe('member-1');
    }
  });

});
