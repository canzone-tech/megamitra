CREATE TABLE `referral_reward_refund_rules` (
  `referralPolicyVersionId` CHAR(36) NOT NULL,
  `mode` ENUM('MANUAL_REVIEW','FULL_BASIS_REVERSAL','PRO_RATA') NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`referralPolicyVersionId`),
  CONSTRAINT `referral_reward_refund_rules_policyVersionId_fkey`
    FOREIGN KEY (`referralPolicyVersionId`) REFERENCES `referral_reward_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referral_reward_refund_rules_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `program_referral_reward_hooks`
  MODIFY `status` ENUM('READY','INELIGIBLE','CANCELLED','CONSUMED','RECONCILIATION_REQUIRED') NOT NULL;

CREATE TABLE `program_referral_refund_evaluations` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `refundRecordId` CHAR(36) NOT NULL,
  `paymentRecordId` CHAR(36) NOT NULL,
  `originalBusinessEventId` CHAR(36) NULL,
  `hookId` CHAR(36) NULL,
  `rewardEventId` CHAR(36) NULL,
  `refundRuleMode` ENUM('MANUAL_REVIEW','FULL_BASIS_REVERSAL','PRO_RATA') NULL,
  `basisMode` ENUM('PAYMENT_AMOUNT','REGISTRATION_ALLOCATION','INSTALLMENT_ALLOCATION','TOTAL_APPLIED_AMOUNT') NULL,
  `refundAmount` DECIMAL(18,2) NOT NULL,
  `refundedBasisAmount` DECIMAL(18,2) NOT NULL,
  `cumulativeRefundedBasis` DECIMAL(18,2) NOT NULL,
  `reversalAmount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `status` ENUM('POSTED','NO_REVERSAL','SKIPPED','RECONCILIATION_REQUIRED') NOT NULL,
  `reasonCode` VARCHAR(100) NOT NULL,
  `ledgerTransactionId` CHAR(36) NULL,
  `snapshot` JSON NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_referral_refund_evaluations_source_key` (`sourceKey`),
  UNIQUE INDEX `program_referral_refund_evaluations_refund_key` (`refundRecordId`),
  UNIQUE INDEX `program_referral_refund_evaluations_ledger_key` (`ledgerTransactionId`),
  INDEX `program_referral_refund_evaluations_reward_idx` (`rewardEventId`, `occurredAt`),
  INDEX `program_referral_refund_evaluations_status_idx` (`status`, `occurredAt`),
  CONSTRAINT `program_referral_refund_evaluations_refundRecordId_fkey`
    FOREIGN KEY (`refundRecordId`) REFERENCES `program_refund_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_paymentRecordId_fkey`
    FOREIGN KEY (`paymentRecordId`) REFERENCES `program_payment_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_originalBusinessEventId_fkey`
    FOREIGN KEY (`originalBusinessEventId`) REFERENCES `program_business_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_hookId_fkey`
    FOREIGN KEY (`hookId`) REFERENCES `program_referral_reward_hooks` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_rewardEventId_fkey`
    FOREIGN KEY (`rewardEventId`) REFERENCES `referral_reward_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_ledgerTransactionId_fkey`
    FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `program_referral_refund_evaluations_amounts_check`
    CHECK (`refundAmount` >= 0 AND `refundedBasisAmount` >= 0 AND `cumulativeRefundedBasis` >= 0 AND `reversalAmount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
