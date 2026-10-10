import { afterDrawDay } from './installment-recovery.engine';

describe('After-draw installment recovery calendar boundary', () => {
  it('does not reserve on the draw calendar day, regardless of draw clock time', () => {
    const draw = new Date('2027-01-17T10:00:00.000Z');
    expect(afterDrawDay(draw,new Date('2027-01-17T18:29:59.000Z'),'Asia/Kolkata')).toBe(false);
    expect(afterDrawDay(draw,new Date('2027-01-17T18:30:00.000Z'),'Asia/Kolkata')).toBe(true);
  });

  it('uses each season draw timezone, not host calendar or a hard-coded day', () => {
    const draw = new Date('2027-01-17T21:00:00.000Z');
    expect(afterDrawDay(draw,new Date('2027-01-18T03:00:00.000Z'),'Asia/Kolkata')).toBe(false);
    expect(afterDrawDay(draw,new Date('2027-01-18T18:30:00.000Z'),'Asia/Kolkata')).toBe(true);
    expect(afterDrawDay(draw,new Date('2027-01-18T06:00:00.000Z'),'America/New_York')).toBe(true);
  });
});
