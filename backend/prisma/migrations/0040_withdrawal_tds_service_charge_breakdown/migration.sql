-- A withdrawal can carry a policy-configured service charge and a separate TDS withholding.
-- Existing published policies and historical requests keep TDS=0 without back-calculation.
ALTER TABLE `withdrawal_policy_versions`
  ADD COLUMN `tdsRatePercent` DECIMAL(7,4) NOT NULL DEFAULT 0 AFTER `maximumFee`,
  ADD CONSTRAINT `withdrawal_policy_versions_tds_rate_check`
    CHECK (`tdsRatePercent` >= 0 AND `tdsRatePercent` <= 100);

ALTER TABLE `withdrawal_requests`
  ADD COLUMN `tdsAmount` DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `feeAmount`;

ALTER TABLE `withdrawal_requests`
  DROP CHECK `withdrawal_requests_amount_parts_check`,
  ADD CONSTRAINT `withdrawal_requests_amount_parts_check`
    CHECK (`amount` = `feeAmount` + `tdsAmount` + `netAmount`),
  ADD CONSTRAINT `withdrawal_requests_tds_amount_check` CHECK (`tdsAmount` >= 0);

-- Tax withholding must never be booked as platform fee revenue.
ALTER TABLE `ledger_accounts`
  MODIFY COLUMN `kind` ENUM(
    'USER_WALLET',
    'COMMISSION_EXPENSE',
    'REFERRAL_REWARD_EXPENSE',
    'LUCKY_DRAW_PRIZE_EXPENSE',
    'WITHDRAWAL_CLEARING',
    'WITHDRAWAL_FEE_REVENUE',
    'WITHDRAWAL_TDS_PAYABLE',
    'RANK_REWARD_EXPENSE'
  ) NOT NULL;
