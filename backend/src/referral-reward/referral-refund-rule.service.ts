import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, PolicyLifecycle } from '../generated/prisma/enums';

export const REFERRAL_REFUND_HANDLING_MODES = [
  'MANUAL_REVIEW',
  'FULL_BASIS_REVERSAL',
  'PRO_RATA',
] as const;

export type ReferralRefundHandlingMode = (typeof REFERRAL_REFUND_HANDLING_MODES)[number];

type RefundRuleRow = {
  referralPolicyVersionId: string;
  mode: ReferralRefundHandlingMode;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ReferralRefundRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async configure(
    referralPolicyVersionId: string,
    mode: ReferralRefundHandlingMode,
    actorUserId: string,
  ) {
    const version = await this.prisma.referralRewardPolicyVersion.findUnique({
      where: { id: referralPolicyVersionId },
      select: { id: true, lifecycle: true },
    });
    if (!version) throw new NotFoundException('Referral reward policy version not found');
    if (version.lifecycle !== PolicyLifecycle.DRAFT) {
      throw new ConflictException('Referral refund handling is immutable after policy publication');
    }

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO referral_reward_refund_rules
         (referralPolicyVersionId, mode, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         mode = VALUES(mode), createdByUserId = VALUES(createdByUserId), updatedAt = CURRENT_TIMESTAMP(3)`,
      referralPolicyVersionId,
      mode,
      actorUserId,
    );

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ReferralRewardRefundRule',
      entityId: referralPolicyVersionId,
      description: 'Referral reward refund handling configured',
      metadata: { mode },
    });
    return this.get(referralPolicyVersionId);
  }

  async get(referralPolicyVersionId: string) {
    const version = await this.prisma.referralRewardPolicyVersion.findUnique({
      where: { id: referralPolicyVersionId },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('Referral reward policy version not found');
    const rows = await this.prisma.$queryRawUnsafe<RefundRuleRow[]>(
      `SELECT * FROM referral_reward_refund_rules WHERE referralPolicyVersionId = ? LIMIT 1`,
      referralPolicyVersionId,
    );
    return rows[0] ?? null;
  }
}
