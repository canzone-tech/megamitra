import { Module } from '@nestjs/common';
import { ReferralEligibilityService } from './referral-eligibility.service';
import {
  ReferralRewardController,
  ReferralRewardPolicyController,
} from './referral-reward.controller';
import { ReferralRewardPolicyService } from './referral-reward-policy.service';
import { ReferralRewardService } from './referral-reward.service';

@Module({
  controllers: [ReferralRewardPolicyController, ReferralRewardController],
  providers: [ReferralEligibilityService, ReferralRewardPolicyService, ReferralRewardService],
  exports: [ReferralEligibilityService, ReferralRewardPolicyService, ReferralRewardService],
})
export class ReferralRewardModule {}
