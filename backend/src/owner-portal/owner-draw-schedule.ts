export const OWNER_DRAW_WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export type OwnerDrawWeekday = (typeof OWNER_DRAW_WEEKDAYS)[number];

export type OwnerDrawSchedule = {
  seasonStartDate: Date | string;
  startMonth: number;
  weekOfMonth: number;
  weekday: OwnerDrawWeekday | string;
  timezone: string;
};

export type OwnerDrawScheduleEvaluation = {
  matches: boolean;
  expectedYear: number;
  expectedMonth: number;
  actualYear: number;
  actualMonth: number;
  actualDay: number;
  actualWeekOfMonth: number;
  actualWeekday: OwnerDrawWeekday;
  timezone: string;
};

export function validateOwnerDrawScheduleConfig(
  schedule: Omit<OwnerDrawSchedule, 'seasonStartDate'>,
) {
  if (!Number.isInteger(schedule.startMonth) || schedule.startMonth < 1 || schedule.startMonth > 12) {
    throw new Error('draw start month must be between 1 and 12');
  }
  if (!Number.isInteger(schedule.weekOfMonth) || schedule.weekOfMonth < 1 || schedule.weekOfMonth > 5) {
    throw new Error('draw week of month must be between 1 and 5');
  }
  if (!OWNER_DRAW_WEEKDAYS.includes(schedule.weekday as OwnerDrawWeekday)) {
    throw new Error('draw weekday is invalid');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone }).format(new Date(0));
  } catch {
    throw new Error(`draw timezone is invalid: ${schedule.timezone}`);
  }
}

export function evaluateOwnerDrawSchedule(
  schedule: OwnerDrawSchedule,
  monthNumber: number,
  drawAt: Date | string,
): OwnerDrawScheduleEvaluation {
  validateOwnerDrawScheduleConfig(schedule);
  if (!Number.isInteger(monthNumber) || monthNumber < 1) {
    throw new Error('draw month number must be a positive integer');
  }

  const seasonStart = schedule.seasonStartDate instanceof Date
    ? schedule.seasonStartDate
    : new Date(schedule.seasonStartDate);
  const drawDate = drawAt instanceof Date ? drawAt : new Date(drawAt);
  if (Number.isNaN(seasonStart.getTime())) throw new Error('season start date is invalid');
  if (Number.isNaN(drawDate.getTime())) throw new Error('draw date is invalid');

  // Season start is persisted as a date-only business boundary. UTC accessors
  // preserve that calendar date instead of reinterpreting it through a runtime timezone.
  const seasonYear = seasonStart.getUTCFullYear();
  const seasonMonth = seasonStart.getUTCMonth() + 1;
  const firstDrawYear = seasonMonth <= schedule.startMonth ? seasonYear : seasonYear + 1;
  const targetMonthIndex = firstDrawYear * 12 + (schedule.startMonth - 1) + (monthNumber - 1);
  const expectedYear = Math.floor(targetMonthIndex / 12);
  const expectedMonth = (targetMonthIndex % 12) + 1;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(drawDate)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const actualYear = Number(parts.year);
  const actualMonth = Number(parts.month);
  const actualDay = Number(parts.day);
  const actualWeekday = String(parts.weekday).toUpperCase() as OwnerDrawWeekday;
  const actualWeekOfMonth = Math.floor((actualDay - 1) / 7) + 1;

  return {
    matches:
      actualYear === expectedYear &&
      actualMonth === expectedMonth &&
      actualWeekOfMonth === schedule.weekOfMonth &&
      actualWeekday === schedule.weekday,
    expectedYear,
    expectedMonth,
    actualYear,
    actualMonth,
    actualDay,
    actualWeekOfMonth,
    actualWeekday,
    timezone: schedule.timezone,
  };
}

export function ownerDrawScheduleLabel(
  startMonth: number,
  weekOfMonth: number,
  weekday: OwnerDrawWeekday | string,
) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const ordinal = weekOfMonth === 1 ? '1st' : weekOfMonth === 2 ? '2nd' : weekOfMonth === 3 ? '3rd' : `${weekOfMonth}th`;
  const normalizedWeekday = weekday.charAt(0) + weekday.slice(1).toLowerCase();
  return `${ordinal} ${normalizedWeekday} monthly, starting ${months[startMonth - 1] ?? `month ${startMonth}`}`;
}
