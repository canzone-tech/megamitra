import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WithdrawalEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMemberRequestEligible(userId: string, currencyCodeInput: string): Promise<void> {
    const currencyCode = currencyCodeInput.trim().toUpperCase();
    const policyRows = await this.prisma.$queryRawUnsafe<Array<{ kycRequired: number | boolean }>>(
      `SELECT v.kycRequired
       FROM withdrawal_policy_versions v
       INNER JOIN withdrawal_policies p ON p.id = v.policyId
       WHERE p.currencyCode = ? AND p.isDefault = TRUE AND v.lifecycle = 'PUBLISHED'
         AND v.effectiveFrom <= CURRENT_TIMESTAMP(3)
         AND (v.effectiveTo IS NULL OR v.effectiveTo > CURRENT_TIMESTAMP(3))
       ORDER BY v.effectiveFrom DESC, v.version DESC
       LIMIT 1`,
      currencyCode,
    );
    const policy = policyRows[0];
    if (!policy) {
      throw new BadRequestException(`No active withdrawal policy for ${currencyCode}`);
    }
    if (!this.toBoolean(policy.kycRequired)) return;

    const kycRows = await this.prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status FROM kyc_profiles WHERE userId = ? LIMIT 1`,
      userId,
    );
    if ((kycRows[0]?.status ?? 'NOT_STARTED') !== 'APPROVED') {
      throw new ForbiddenException('Approved KYC is required before withdrawal');
    }
  }

  private toBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1';
  }
}
