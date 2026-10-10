import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { calculateWithdrawalDeductions } from './withdrawal-pricing';

describe('versioned withdrawal service charge and TDS snapshots', () => {
  it('separates service charge, tax liability and payable net with decimal rounding', () => {
    const result = calculateWithdrawalDeductions(new Prisma.Decimal('2000.00'), {
      feeMode: 'PERCENTAGE', feeValue: '2.0000', minimumFee: null, maximumFee: null, tdsRatePercent: '5.0000',
    });
    expect(result.serviceCharge.toFixed(2)).toBe('40.00');
    expect(result.tdsAmount.toFixed(2)).toBe('100.00');
    expect(result.netAmount.toFixed(2)).toBe('1860.00');
    expect(result.serviceCharge.plus(result.tdsAmount).plus(result.netAmount).toFixed(2)).toBe('2000.00');
  });

  it('retains historic zero tax and min/max service cap behavior', () => {
    const result = calculateWithdrawalDeductions(new Prisma.Decimal('2000.00'), {
      feeMode: 'FIXED', feeValue: '1.00', minimumFee: '10.00', maximumFee: '20.00', tdsRatePercent: 0,
    });
    expect(result.serviceCharge.toFixed(2)).toBe('10.00');
    expect(result.tdsAmount.toFixed(2)).toBe('0.00');
    expect(result.netAmount.toFixed(2)).toBe('1990.00');
  });

  it('rounds components independently, and rejects deductions that leave no payout', () => {
    const result = calculateWithdrawalDeductions(new Prisma.Decimal('100.05'), {
      feeMode: 'PERCENTAGE', feeValue: '1.005', minimumFee: null, maximumFee: null, tdsRatePercent: '3.335',
    });
    expect(result.serviceCharge.toFixed(2)).toBe('1.01');
    expect(result.tdsAmount.toFixed(2)).toBe('3.34');
    expect(result.netAmount.toFixed(2)).toBe('95.70');
    expect(() => calculateWithdrawalDeductions(new Prisma.Decimal('100'), {
      feeMode: 'FIXED', feeValue: '20', minimumFee: null, maximumFee: null, tdsRatePercent: 80,
    })).toThrow(BadRequestException);
  });
});
