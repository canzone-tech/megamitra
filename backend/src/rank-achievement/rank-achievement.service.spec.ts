import { RankAchievementService } from './rank-achievement.service';

describe('RankAchievementService joining-date and fresh-member contracts', () => {
  function setup() {
    const service = new RankAchievementService({} as never, {} as never, {} as never);
    const enrollment = {
      id: 'enrollment-1',
      userId: 'member-1',
      programVersionId: 'program-1',
      enrolledAt: new Date('2026-10-01T00:00:00.000Z'),
      currencyCode: 'INR',
      user: { id: 'member-1', username: 'testmember', status: 'ACTIVE' },
      payments: [{ amount: { toString: () => '2000.00' }, refunds: [] }],
    };
    const t = (hours: number) => new Date(enrollment.enrolledAt.getTime() + hours * 3600_000);
    return { service, enrollment, t };
  }

  it('preserves flyer values including both 18-month recurring bonuses', () => {
    const { service } = setup();
    const tiers = service.validateTiers(service.initialFlyerTiers());
    expect(tiers.map((tier) => tier.code)).toEqual(['LIGHTNING', 'BRONZE', 'SILVER', 'GOLD', 'DIAMOND']);
    expect(tiers.map((tier) => tier.hours)).toEqual([4, 480, 720, 1440, 2160]);
    expect(tiers.map((tier) => tier.newDirect)).toEqual([4, 10, 25, 50, 100]);
    expect(tiers.map((tier) => tier.newTeam)).toEqual([0, 40, 100, 250, 500]);
    expect(tiers[3]?.months).toBe(18);
    expect(tiers[4]?.months).toBe(18);
    expect(tiers[4]?.monthly).toBe('5000.00');
  });

  it('rejects overlapping, out-of-order or negative financial policy rules', () => {
    const { service } = setup();
    const invalid = service.initialFlyerTiers();
    invalid[1] = { ...invalid[1]!, hours: 2 };
    expect(() => service.validateTiers(invalid)).toThrow();
    const invalidMoney = service.initialFlyerTiers();
    invalidMoney[0] = { ...invalidMoney[0]!, cash: '-1000.00' };
    expect(() => service.validateTiers(invalidMoney)).toThrow();
  });

  it('counts only new direct/team members for each subsequent level', async () => {
    const { service, enrollment, t } = setup();
    const tiers = service.initialFlyerTiers().slice(0, 3);
    const calls: Array<{ code: string; crossedAt: Date }> = [];
    const prisma = service as unknown as {
      prisma: { rankAchievement: { findMany: () => Promise<never[]> } };
      award: (...args: unknown[]) => Promise<void>;
    };
    prisma.prisma = { rankAchievement: { findMany: async () => [] } };
    jest.spyOn(prisma, 'award').mockImplementation(async (...args: unknown[]) => {
      calls.push({ code: (args[2] as { code: string }).code, crossedAt: args[6] as Date });
    });
    const direct = [...Array.from({ length: 4 }, () => t(1)), ...Array.from({ length: 10 }, () => t(8))];
    const team = [...Array.from({ length: 4 }, () => t(1)), ...Array.from({ length: 40 }, () => t(8))];
    const count = await service['evaluateLevels'](enrollment, 'policy-1', tiers, direct, team, t(10));
    expect(count).toBe(2);
    expect(calls.map((item) => item.code)).toEqual(['LIGHTNING', 'BRONZE']);
    expect(calls[0]?.crossedAt).toEqual(t(1));
    expect(calls[1]?.crossedAt).toEqual(t(8));
  });

  it('allows Bronze if optional Lightning is missed, but keeps its joining-date deadline', async () => {
    const { service, enrollment, t } = setup();
    const spyTarget = service as unknown as {
      prisma: { rankAchievement: { findMany: () => Promise<never[]> } };
      award: (...args: unknown[]) => Promise<void>;
    };
    spyTarget.prisma = { rankAchievement: { findMany: async () => [] } };
    const awarded = jest.spyOn(spyTarget, 'award').mockResolvedValue(undefined);
    const directs = Array.from({ length: 10 }, () => t(19));
    const team = Array.from({ length: 40 }, () => t(19));
    const count = await service['evaluateLevels'](
      enrollment, 'policy-1', service.initialFlyerTiers().slice(0, 2), directs, team, t(21),
    );
    expect(count).toBe(1);
    expect((awarded.mock.calls[0]?.[2] as { code: string }).code).toBe('BRONZE');

    awarded.mockClear();
    const late = await service['evaluateLevels'](
      enrollment, 'policy-1', service.initialFlyerTiers().slice(0, 2),
      Array.from({ length: 10 }, () => t(481)),
      Array.from({ length: 40 }, () => t(481)),
      t(500),
    );
    expect(late).toBe(0);
    expect(awarded).not.toHaveBeenCalled();
  });

  it('keeps recurring rank income exclusive even when Gold and Diamond coincide', () => {
    const { service } = setup();
    const policyTiers = JSON.stringify(service.initialFlyerTiers());
    const at = new Date('2027-01-05T12:00:00.000Z');
    const gold = { id: 'g', tierCode: 'GOLD', achievedAt: at, policyTiers };
    const diamond = { id: 'd', tierCode: 'DIAMOND', achievedAt: at, policyTiers };
    expect(service['activeRecurringRankId']([gold])).toBe('g');
    expect(service['activeRecurringRankId']([gold, diamond])).toBe('d');
    expect(service['activeRecurringRankId']([diamond, gold])).toBe('d');
    expect(service['activeRecurringRankId']([])).toBeNull();
  });

  it('clamps recurring monthly payouts to month end while preserving UTC time', () => {
    const { service } = setup();
    const jan31 = new Date('2027-01-31T12:34:56.000Z');
    expect(service.monthAfter(jan31, 1).toISOString()).toBe('2027-02-28T12:34:56.000Z');
    expect(service.monthAfter(jan31, 2).toISOString()).toBe('2027-03-31T12:34:56.000Z');
  });
});
