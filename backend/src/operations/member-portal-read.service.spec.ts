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
});
