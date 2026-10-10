import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export type WithdrawalPricePolicy = {
  feeMode: string;
  feeValue: string | number;
  minimumFee: string | number | null;
  maximumFee: string | number | null;
  tdsRatePercent: string | number;
};

/** Decimal-only, half-up rounding. Never infer statutory eligibility from these settings. */
export function calculateWithdrawalDeductions(amount: Prisma.Decimal, policy: WithdrawalPricePolicy) {
  let serviceCharge = String(policy.feeMode) === 'PERCENTAGE'
    ? amount.mul(new Prisma.Decimal(policy.feeValue)).div(100)
    : new Prisma.Decimal(policy.feeValue);
  serviceCharge = serviceCharge.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (policy.minimumFee !== null) serviceCharge = Prisma.Decimal.max(serviceCharge, new Prisma.Decimal(policy.minimumFee));
  if (policy.maximumFee !== null) serviceCharge = Prisma.Decimal.min(serviceCharge, new Prisma.Decimal(policy.maximumFee));
  serviceCharge = serviceCharge.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const tdsAmount = amount.mul(new Prisma.Decimal(policy.tdsRatePercent)).div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const netAmount = amount.minus(serviceCharge).minus(tdsAmount);
  if (netAmount.lessThanOrEqualTo(0)) {
    throw new BadRequestException('Service charge and TDS total must be lower than the withdrawal amount');
  }
  return { serviceCharge, tdsAmount, netAmount };
}
