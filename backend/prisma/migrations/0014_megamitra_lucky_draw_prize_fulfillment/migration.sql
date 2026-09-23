ALTER TABLE `ledger_accounts`
  MODIFY COLUMN `kind` ENUM(
    'USER_WALLET',
    'COMMISSION_EXPENSE',
    'REFERRAL_REWARD_EXPENSE',
    'LUCKY_DRAW_PRIZE_EXPENSE'
  ) NOT NULL;

ALTER TABLE `ledger_transactions`
  MODIFY COLUMN `type` ENUM(
    'BINARY_PAIR_COMMISSION',
    'REFERRAL_REWARD',
    'LUCKY_DRAW_PRIZE_PAYOUT',
    'ADJUSTMENT',
    'REVERSAL'
  ) NOT NULL;

CREATE TABLE `lucky_draw_fulfillment_rules` (
  `id` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `claimWindowDays` INT NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_fulfillment_rules_policy_version_key` (`policyVersionId`),
  CONSTRAINT `lucky_draw_fulfillment_rules_policy_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `lucky_draw_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_fulfillment_rules_claim_window_check`
    CHECK (`claimWindowDays` >= 0 AND `claimWindowDays` <= 36500)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_prize_claims` (
  `id` CHAR(36) NOT NULL,
  `winnerId` CHAR(36) NOT NULL,
  `drawId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `prizeTierId` CHAR(36) NOT NULL,
  `fulfillmentRuleId` CHAR(36) NOT NULL,
  `status` ENUM('PENDING','CLAIMED','FULFILLED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `claimWindowDaysSnapshot` INT NOT NULL,
  `claimDeadline` DATETIME(3) NOT NULL,
  `prizeKind` ENUM('CASH','ITEM','BENEFIT','OTHER') NOT NULL,
  `cashAmount` DECIMAL(18,2) NULL,
  `currencyCode` VARCHAR(3) NULL,
  `prizeSnapshot` JSON NOT NULL,
  `claimedAt` DATETIME(3) NULL,
  `claimedByUserId` CHAR(36) NULL,
  `claimMetadata` JSON NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelledByUserId` CHAR(36) NULL,
  `cancellationReason` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_prize_claims_winner_key` (`winnerId`),
  INDEX `lucky_draw_prize_claims_draw_status_idx` (`drawId`, `status`, `claimDeadline`),
  INDEX `lucky_draw_prize_claims_user_status_idx` (`userId`, `status`, `claimDeadline`),
  INDEX `lucky_draw_prize_claims_policy_status_idx` (`policyVersionId`, `status`, `claimDeadline`),
  CONSTRAINT `lucky_draw_prize_claims_winner_fkey`
    FOREIGN KEY (`winnerId`) REFERENCES `lucky_draw_winners` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_claims_draw_fkey`
    FOREIGN KEY (`drawId`) REFERENCES `lucky_draw_instances` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_claims_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_claims_policy_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `lucky_draw_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_claims_prize_tier_fkey`
    FOREIGN KEY (`prizeTierId`) REFERENCES `lucky_draw_prize_tiers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_claims_rule_fkey`
    FOREIGN KEY (`fulfillmentRuleId`) REFERENCES `lucky_draw_fulfillment_rules` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_claims_window_check`
    CHECK (`claimWindowDaysSnapshot` >= 0 AND `claimWindowDaysSnapshot` <= 36500),
  CONSTRAINT `lucky_draw_prize_claims_cash_amount_check`
    CHECK (`cashAmount` IS NULL OR `cashAmount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_prize_fulfillments` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `claimId` CHAR(36) NOT NULL,
  `winnerId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `fulfillmentType` ENUM('CASH_LEDGER','NON_CASH') NOT NULL,
  `prizeKind` ENUM('CASH','ITEM','BENEFIT','OTHER') NOT NULL,
  `cashAmount` DECIMAL(18,2) NULL,
  `currencyCode` VARCHAR(3) NULL,
  `ledgerTransactionId` CHAR(36) NULL,
  `externalReference` VARCHAR(191) NULL,
  `fulfillmentSnapshot` JSON NOT NULL,
  `metadata` JSON NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_prize_fulfillments_source_key` (`sourceKey`),
  UNIQUE INDEX `lucky_draw_prize_fulfillments_claim_key` (`claimId`),
  UNIQUE INDEX `lucky_draw_prize_fulfillments_winner_key` (`winnerId`),
  UNIQUE INDEX `lucky_draw_prize_fulfillments_ledger_key` (`ledgerTransactionId`),
  INDEX `lucky_draw_prize_fulfillments_user_idx` (`userId`, `occurredAt`),
  CONSTRAINT `lucky_draw_prize_fulfillments_claim_fkey`
    FOREIGN KEY (`claimId`) REFERENCES `lucky_draw_prize_claims` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_fulfillments_winner_fkey`
    FOREIGN KEY (`winnerId`) REFERENCES `lucky_draw_winners` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_fulfillments_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_fulfillments_ledger_fkey`
    FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_fulfillments_cash_amount_check`
    CHECK (`cashAmount` IS NULL OR `cashAmount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_prize_fulfillment_reversals` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `fulfillmentId` CHAR(36) NOT NULL,
  `ledgerTransactionId` CHAR(36) NULL,
  `reason` VARCHAR(500) NOT NULL,
  `metadata` JSON NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_prize_fulfillment_reversals_source_key` (`sourceKey`),
  UNIQUE INDEX `lucky_draw_prize_fulfillment_reversals_fulfillment_key` (`fulfillmentId`),
  UNIQUE INDEX `lucky_draw_prize_fulfillment_reversals_ledger_key` (`ledgerTransactionId`),
  CONSTRAINT `lucky_draw_prize_fulfillment_reversals_fulfillment_fkey`
    FOREIGN KEY (`fulfillmentId`) REFERENCES `lucky_draw_prize_fulfillments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_fulfillment_reversals_ledger_fkey`
    FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_prize_claim_events` (
  `id` CHAR(36) NOT NULL,
  `claimId` CHAR(36) NOT NULL,
  `eventType` ENUM('CREATED','CLAIMED','FULFILLED','EXPIRED','CANCELLED','FULFILLMENT_REVERSED') NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `actorUserId` CHAR(36) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `lucky_draw_prize_claim_events_claim_time_idx` (`claimId`, `occurredAt`, `createdAt`),
  INDEX `lucky_draw_prize_claim_events_type_time_idx` (`eventType`, `occurredAt`),
  CONSTRAINT `lucky_draw_prize_claim_events_claim_fkey`
    FOREIGN KEY (`claimId`) REFERENCES `lucky_draw_prize_claims` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'draw.fulfillment.read', 'Read lucky draw claim and fulfillment history', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'draw.fulfillment.manage', 'Manage lucky draw claims, fulfillment and reversals', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('draw.fulfillment.read', 'draw.fulfillment.manage');
