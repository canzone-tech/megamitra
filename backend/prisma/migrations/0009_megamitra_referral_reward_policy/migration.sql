ALTER TABLE `ledger_accounts`
  MODIFY COLUMN `kind` ENUM('USER_WALLET', 'COMMISSION_EXPENSE', 'REFERRAL_REWARD_EXPENSE') NOT NULL;

ALTER TABLE `ledger_transactions`
  MODIFY COLUMN `type` ENUM('BINARY_PAIR_COMMISSION', 'REFERRAL_REWARD', 'ADJUSTMENT', 'REVERSAL') NOT NULL;

CREATE TABLE `referral_reward_policies` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `referral_reward_policies_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referral_reward_policy_versions` (
  `id` CHAR(36) NOT NULL,
  `policyId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `rewardMode` ENUM('FIXED', 'PERCENTAGE') NOT NULL,
  `fixedAmount` DECIMAL(18,2) NULL,
  `percentageRate` DECIMAL(9,4) NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `roundingMode` ENUM('HALF_UP', 'DOWN', 'UP') NOT NULL,
  `minimumRewardAmount` DECIMAL(18,2) NULL,
  `maximumRewardAmount` DECIMAL(18,2) NULL,
  `eligibilityRules` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `referral_reward_policy_versions_policy_version_key` (`policyId`, `version`),
  INDEX `referral_reward_policy_versions_policy_lifecycle_idx` (`policyId`, `lifecycle`),
  INDEX `referral_reward_policy_versions_effective_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `referral_reward_policy_versions_policyId_fkey`
    FOREIGN KEY (`policyId`) REFERENCES `referral_reward_policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referral_reward_policy_versions_effective_check`
    CHECK (`effectiveTo` IS NULL OR `effectiveTo` > `effectiveFrom`),
  CONSTRAINT `referral_reward_policy_versions_fixed_check`
    CHECK (`fixedAmount` IS NULL OR `fixedAmount` >= 0),
  CONSTRAINT `referral_reward_policy_versions_percentage_check`
    CHECK (`percentageRate` IS NULL OR `percentageRate` >= 0),
  CONSTRAINT `referral_reward_policy_versions_min_check`
    CHECK (`minimumRewardAmount` IS NULL OR `minimumRewardAmount` >= 0),
  CONSTRAINT `referral_reward_policy_versions_max_check`
    CHECK (`maximumRewardAmount` IS NULL OR `maximumRewardAmount` >= 0),
  CONSTRAINT `referral_reward_policy_versions_bounds_check`
    CHECK (`minimumRewardAmount` IS NULL OR `maximumRewardAmount` IS NULL OR `maximumRewardAmount` >= `minimumRewardAmount`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referral_reward_events` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `referredUserId` CHAR(36) NOT NULL,
  `sponsorUserId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `basisAmount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `eligible` BOOLEAN NOT NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `rewardAmount` DECIMAL(18,2) NOT NULL,
  `status` ENUM('POSTED', 'INELIGIBLE', 'NO_PAYOUT') NOT NULL,
  `ledgerTransactionId` CHAR(36) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `referral_reward_events_sourceKey_key` (`sourceKey`),
  UNIQUE INDEX `referral_reward_events_ledgerTransactionId_key` (`ledgerTransactionId`),
  INDEX `referral_reward_events_sponsor_time_idx` (`sponsorUserId`, `occurredAt`),
  INDEX `referral_reward_events_referred_time_idx` (`referredUserId`, `occurredAt`),
  INDEX `referral_reward_events_policy_time_idx` (`policyVersionId`, `occurredAt`),
  INDEX `referral_reward_events_status_time_idx` (`status`, `occurredAt`),
  CONSTRAINT `referral_reward_events_referredUserId_fkey`
    FOREIGN KEY (`referredUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referral_reward_events_sponsorUserId_fkey`
    FOREIGN KEY (`sponsorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referral_reward_events_policyVersionId_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `referral_reward_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referral_reward_events_ledgerTransactionId_fkey`
    FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referral_reward_events_basis_check` CHECK (`basisAmount` >= 0),
  CONSTRAINT `referral_reward_events_reward_check` CHECK (`rewardAmount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'referral.policy.read', 'Read referral reward policies and versions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'referral.policy.manage', 'Create, publish and retire referral reward policies', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'referral.reward.read', 'Read referral reward evaluations and ledger links', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'referral.reward.manage', 'Evaluate and post referral rewards', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN (
    'referral.policy.read',
    'referral.policy.manage',
    'referral.reward.read',
    'referral.reward.manage'
  );
