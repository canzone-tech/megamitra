import {
  evaluateOwnerDrawSchedule,
  ownerDrawScheduleLabel,
} from './owner-draw-schedule';

describe('owner draw schedule', () => {
  const defaultSchedule = {
    seasonStartDate: '2027-01-01T00:00:00.000Z',
    startMonth: 1,
    weekOfMonth: 3,
    weekday: 'SUNDAY' as const,
    timezone: 'Asia/Kolkata',
  };

  it('accepts the third Sunday of January as month one', () => {
    expect(
      evaluateOwnerDrawSchedule(defaultSchedule, 1, '2027-01-17T12:30:00.000Z'),
    ).toMatchObject({ matches: true, expectedYear: 2027, expectedMonth: 1 });
  });

  it('advances every month while retaining the third-Sunday rule', () => {
    expect(
      evaluateOwnerDrawSchedule(defaultSchedule, 2, '2027-02-21T12:30:00.000Z'),
    ).toMatchObject({ matches: true, expectedYear: 2027, expectedMonth: 2 });
  });

  it('rejects a second Sunday', () => {
    expect(
      evaluateOwnerDrawSchedule(defaultSchedule, 1, '2027-01-10T12:30:00.000Z'),
    ).toMatchObject({ matches: false, actualWeekOfMonth: 2, actualWeekday: 'SUNDAY' });
  });

  it('starts at the next configured January when the season begins later in the year', () => {
    expect(
      evaluateOwnerDrawSchedule(
        { ...defaultSchedule, seasonStartDate: '2026-09-01T00:00:00.000Z' },
        1,
        '2027-01-17T12:30:00.000Z',
      ),
    ).toMatchObject({ matches: true, expectedYear: 2027, expectedMonth: 1 });
  });

  it('supports a configured month, week and weekday without hardcoding Sunday', () => {
    const configured = {
      seasonStartDate: '2027-01-01T00:00:00.000Z',
      startMonth: 4,
      weekOfMonth: 2,
      weekday: 'SATURDAY' as const,
      timezone: 'Asia/Kolkata',
    };
    expect(
      evaluateOwnerDrawSchedule(configured, 1, '2027-04-10T12:00:00.000Z'),
    ).toMatchObject({ matches: true, expectedMonth: 4, actualWeekOfMonth: 2 });
    expect(ownerDrawScheduleLabel(4, 2, 'SATURDAY')).toBe(
      '2nd Saturday monthly, starting April',
    );
  });
});
