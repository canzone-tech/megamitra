import { BadRequestException, Injectable } from '@nestjs/common';
import { UserStatus } from '../generated/prisma/enums';

export type ProgramEligibilityRules = {
  allowedUserStatuses?: UserStatus[];
  requireEmailVerified?: boolean;
  requirePhoneVerified?: boolean;
};

export type ProgramEligibilitySubject = {
  status: UserStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
};

@Injectable()
export class ProgramEligibilityService {
  validateRules(raw: unknown): ProgramEligibilityRules {
    if (raw === null || raw === undefined) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('eligibilityRules must be an object');
    }

    const value = raw as Record<string, unknown>;
    const supported = new Set([
      'allowedUserStatuses',
      'requireEmailVerified',
      'requirePhoneVerified',
    ]);
    for (const key of Object.keys(value)) {
      if (!supported.has(key)) {
        throw new BadRequestException(`Unsupported program eligibility rule: ${key}`);
      }
    }

    const rules: ProgramEligibilityRules = {};
    if (value.allowedUserStatuses !== undefined) {
      if (!Array.isArray(value.allowedUserStatuses) || value.allowedUserStatuses.length === 0) {
        throw new BadRequestException('allowedUserStatuses must be a non-empty array');
      }
      const allowedStatuses = new Set(Object.values(UserStatus));
      const normalized = value.allowedUserStatuses.map((status) => String(status)) as UserStatus[];
      if (normalized.some((status) => !allowedStatuses.has(status))) {
        throw new BadRequestException('allowedUserStatuses contains an unsupported status');
      }
      rules.allowedUserStatuses = [...new Set(normalized)];
    }

    for (const key of ['requireEmailVerified', 'requirePhoneVerified'] as const) {
      if (value[key] !== undefined && typeof value[key] !== 'boolean') {
        throw new BadRequestException(`${key} must be boolean`);
      }
      if (value[key] !== undefined) rules[key] = value[key];
    }

    return rules;
  }

  evaluate(raw: unknown, user: ProgramEligibilitySubject) {
    const rules = this.validateRules(raw);
    const checks = [
      {
        code: 'USER_STATUS',
        configured: Boolean(rules.allowedUserStatuses),
        passed: !rules.allowedUserStatuses || rules.allowedUserStatuses.includes(user.status),
        actual: user.status,
        expected: rules.allowedUserStatuses ?? null,
      },
      {
        code: 'EMAIL_VERIFIED',
        configured: rules.requireEmailVerified === true,
        passed: rules.requireEmailVerified !== true || user.emailVerifiedAt !== null,
        actual: user.emailVerifiedAt !== null,
        expected: rules.requireEmailVerified ?? null,
      },
      {
        code: 'PHONE_VERIFIED',
        configured: rules.requirePhoneVerified === true,
        passed: rules.requirePhoneVerified !== true || user.phoneVerifiedAt !== null,
        actual: user.phoneVerifiedAt !== null,
        expected: rules.requirePhoneVerified ?? null,
      },
    ];
    return {
      rules,
      checks,
      eligible: checks.every((check) => check.passed),
    };
  }
}
