import { MemberPortalReadService } from './member-portal-read.service';

describe('Member rewards guide visibility and isolation', () => {
  it('uses member-scoped season prizes, draw dates, tokens, wins and PUBLISHED rank policy only', async () => {
    const calls: Array<{ sql: string; userId: string }> = [];
    const values = [
      [{ id: 'season-1', enrollmentId: 'enrollment-1', programVersionId: 'program-1', code: 'MGC2027', name: 'Season 2027', status: 'ACTIVE', enrolledAt: new Date('2026-10-07T00:00:00Z'), currencyCode: 'INR' }],
      [{ seasonId: 'season-1', monthNumber: 1, prizeCode: 'P1', category: 'ITEM', name: 'Configured prize', description: 'Approved schedule', winnerCount: 2, nominalValue: '2000.00', currencyCode: 'INR' }],
      [{ seasonId: 'season-1', monthNumber: 1, status: 'SCHEDULED', drawAt: new Date('2027-01-17T00:00:00Z') }],
      [{ seasonId: 'season-1', installmentSequence: 1, token: '55684', status: 'AVAILABLE' }],
    ];
    const prisma = {
      $queryRawUnsafe: jest.fn(async (sql: string, userId: string) => {
        calls.push({ sql, userId });
        return values[calls.length - 1] ?? [];
      }),
      rankAchievement: { findMany: jest.fn().mockResolvedValue([{
        id: 'ach-1', userId: 'member-1', enrollmentId: 'enrollment-1',
        tierCode: 'LIGHTNING', tierName: 'Lightning Start Bonus',
        achievedAt: new Date('2026-10-07T02:00:00Z'),
        cashAmount: { toString: () => '1000.00' }, monthlyAmount: { toString: () => '0.00' },
        monthlyMonths: 0, monthlyPayouts: [], tripDescription: null, tripStatus: 'NOT_APPLICABLE',
      }]) },
      rankRewardPolicyVersion: { findMany: jest.fn().mockResolvedValue([{
        programVersionId: 'program-1', version: 1,
        tiers: [{ code: 'LIGHTNING', name: 'Lightning Start Bonus', newDirect: 4, newTeam: 0, hours: 4, cash: '1000.00', monthly: '0.00', months: 0, trip: null }],
      }]) },
    };
    const reads = { memberRewards: jest.fn().mockResolvedValue({ wins: { items: [{
      winnerId: 'winner-1', drawId: 'draw-1', prizeTierName: 'Configured prize',
      prizeKind: 'ITEM', claimStatus: 'PENDING', claimDeadline: null, wonAt: '2027-01-17',
      selectionScore: 'SECRET_INTERNAL_SCORE',
    }] } }) };
    const service = new MemberPortalReadService(reads as never, prisma as never, {} as never);
    const guide = await service.rewardGuide('member-1');
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.userId === 'member-1')).toBe(true);
    expect(calls[1].sql).toContain("p.status='ACTIVE'");
    expect(calls[0].sql).toContain('e.userId=?');
    expect(prisma.rankAchievement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'member-1' } }));
    expect(prisma.rankRewardPolicyVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { programVersionId: { in: ['program-1'] }, lifecycle: 'PUBLISHED' },
    }));
    expect(reads.memberRewards).toHaveBeenCalledWith('member-1', { page: '1', limit: '100' });
    expect(guide.seasons[0].achievements[0].tierCode).toBe('LIGHTNING');
    expect(guide.seasons[0].rankPolicy?.tiers).toEqual([expect.objectContaining({ newDirect: 4 })]);
    expect(guide.seasons[0].prizes[0].name).toBe('Configured prize');
    expect(guide.seasons[0].tokens[0].token).toBe('55684');
    expect(guide.wins[0]).toEqual(expect.objectContaining({ claimStatus: 'PENDING' }));
    expect(JSON.stringify(guide)).not.toContain('SECRET_INTERNAL_SCORE');
  });

  it('does not return draft targets or show rewards for a member without an enrolled season', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      rankAchievement: { findMany: jest.fn().mockResolvedValue([]) },
      rankRewardPolicyVersion: { findMany: jest.fn() },
    };
    const reads = { memberRewards: jest.fn().mockResolvedValue({ wins: { items: [] } }) };
    const service = new MemberPortalReadService(reads as never, prisma as never, {} as never);
    expect(await service.rewardGuide('member-without-enrollment')).toEqual({ wins: [], seasons: [] });
    expect(prisma.rankRewardPolicyVersion.findMany).not.toHaveBeenCalled();
  });
});
