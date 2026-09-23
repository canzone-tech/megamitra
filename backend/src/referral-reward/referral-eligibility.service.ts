import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { UserStatus } from '../generated/prisma/enums';

export type ReferralEligibilityRules = {
  sponsorStatuses?: UserStatus[];
  referredStatuses?: UserStatus[];
  requireSponsorEmailVerified?: boolean;
  requireSponsorPhoneVerified?: boolean;
  requireReferredEmailVerified?: boolean;
  requireReferredPhoneVerified?: boolean;
  minimumBasisAmount?: string;
  maximumBasisAmount?: string;
};

type EligibilityUser = {
  status: UserStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
};

export type ReferralEligibilityResult = {
  eligible: boolean;
  reasonCodes: string[];
  rules: ReferralEligibilityRules;
  observed: {
    sponsorStatus: UserStatus;
    referredStatus: UserStatus;
    sponsorEmailVerified: boolean;
    sponsorPhoneVerified: boolean;
    referredEmailVerified: boolean;
    referredPhoneVerified: boolean;
    basisAmount: string;
  };
};

@Injectable()
export class ReferralEligibilityService {
  private readonly supportedKeys = new Set<keyof ReferralEligibilityRules>([
    'sponsorStatuses',
    'referredStatuses',
    'requireSponsorEmailVerified',
    'requireSponsorPhoneVerified',
    'requireReferredEmailVerified',
    'requireReferredPhoneVerified',
    'minimumBasisAmount',
    'maximumBasisAmount',
  ]);

  validateRules(raw: unknown): ReferralEligibilityRules {
    if (raw === undefined || raw === null) return {};
    if (!this.isPlainObject(raw)) {
      throw new BadRequestException('eligibilityRules must be an object');
    }

    for (const key of Object.keys(raw)) {
      if (!this.supportedKeys.has(key as keyof ReferralEligibilityRules)) {
        throw new BadRequestException(`Unsupported referral eligibility rule: ${key}`);
      }
    }

    const input = raw as Record<string, unknown>;
    const rules: ReferralEligibilityRules = {};
    if (input.sponsorStatuses !== undefined) {
      rules.sponsorStatuses = this.validateStatuses(input.sponsorStatuses, 'sponsorStatuses');
    }
    if (input.referredStatuses !== undefined) {
      rules.referredStatuses = this.validateStatuses(input.referredStatuses, 'referredStatuses');
    }

    for (const key of [
      'requireSponsorEmailVerified',
      'requireSponsorPhoneVerified',
      'requireReferredEmailVerified',
      'requireReferredPhoneVerified',
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        if (typeof value !== 'boolean') {
          throw new BadRequestException(`${key} must be boolean`);
        }
        rules[key] = value;
      }
    }

    if (input.minimumBasisAmount !== undefined) {
      rules.minimumBasisAmount = this.validateAmount(
        input.minimumBasisAmount,
        'minimumBasisAmount',
      );
    }
    if (input.maximumBasisAmount !== undefined) {
      rules.maximumBasisAmount = this.validateAmount(
        input.maximumBasisAmount,
        'maximumBasisAmount',
      );
    }
    if (
      rules.minimumBasisAmount !== undefined &&
      rules.maximumBasisAmount !== undefined &&
      new Prisma.Decimal(rules.maximumBasisAmount).lessThan(rules.minimumBasisAmount)
    ) {
      throw new BadRequestException('maximumBasisAmount must be greater than or equal to minimumBasisAmount');
    }
    return rules;
  }

  evaluate(
    rawRules: unknown,
    sponsor: EligibilityUser,
    referred: EligibilityUser,
    basisAmount: Prisma.Decimal,
  ): ReferralEligibilityResult {
    const rules = this.validateRules(rawRules);
    const reasonCodes: string[] = [];

    if (rules.sponsorStatuses && !rules.sponsorStatuses.includes(sponsor.status)) {
      reasonCodes.push('SPONSOR_STATUS_NOT_ELIGIBLE');
    }
    if (rules.referredStatuses && !rules.referredStatuses.includes(referred.status)) {
      reasonCodes.push('REFERRED_STATUS_NOT_ELIGIBLE');
    }
    if (rules.requireSponsorEmailVerified && !sponsor.emailVerifiedAt) {
      reasonCodes.push('SPONSOR_EMAIL_NOT_VERIFIED');
    }
    if (rules.requireSponsorPhoneVerified && !sponsor.phoneVerifiedAt) {
      reasonCodes.push('SPONSOR_PHONE_NOT_VERIFIED');
    }
    if (rules.requireReferredEmailVerified && !referred.emailVerifiedAt) {
      reasonCodes.push('REFERRED_EMAIL_NOT_VERIFIED');
    }
    if (rules.requireReferredPhoneVerified && !referred.phoneVerifiedAt) {
      reasonCodes.push('REFERRED_PHONE_NOT_VERIFIED');
    }
    if (
      rules.minimumBasisAmount !== undefined &&
      basisAmount.lessThan(rules.minimumBasisAmount)
    ) {
      reasonCodes.push('BASIS_AMOUNT_BELOW_MINIMUM');
    }
    if (
      rules.maximumBasisAmount !== undefined &&
      basisAmount.greaterThan(rules.maximumBasisAmount)
    ) {
      reasonCodes.push('BASIS_AMOUNT_ABOVE_MAXIMUM');
    }

    return {
      eligible: reasonCodes.length === 0,
      reasonCodes,
      rules,
      observed: {
        sponsorStatus: sponsor.status,
        referredStatus: referred.status,
        sponsorEmailVerified: Boolean(sponsor.emailVerifiedAt),
        sponsorPhoneVerified: Boolean(sponsor.phoneVerifiedAt),
        referredEmailVerified: Boolean(referred.emailVerifiedAt),
        referredPhoneVerified: Boolean(referred.phoneVerifiedAt),
        basisAmount: basisAmount.toFixed(2),
      },
    };
  }

  private validateStatuses(raw: unknown, field: string): UserStatus[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException(`${field} must be a non-empty array`);
    }
    const valid = new Set<string>(Object.values(UserStatus));
    const result = raw.map((value) => {
      if (typeof value !== 'string' || !valid.has(value)) {
        throw new BadRequestException(`${field} contains an unsupported user status`);
      }
      return value as UserStatus;
    });
    return [...new Set(result)];
  }

  private validateAmount(raw: unknown, field: string): string {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new BadRequestException(`${field} must be numeric`);
    }
    try {
      const amount = new Prisma.Decimal(raw);
      if (!amount.isFinite() || amount.isNegative()) {
        throw new Error('invalid');
      }
      return amount.toFixed(2);
    } catch {
      throw new BadRequestException(`${field} must be a non-negative number`);
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
