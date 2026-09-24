ALTER TABLE `ledger_accounts`
  MODIFY COLUMN `kind` ENUM(
    'USER_WALLET',
    'COMMISSION_EXPENSE',
    'REFERRAL_REWARD_EXPENSE',
    'LUCKY_DRAW_PRIZE_EXPENSE',
    'WITHDRAWAL_CLEARING',
    'WITHDRAWAL_FEE_REVENUE'
  ) NOT NULL;

ALTER TABLE `ledger_transactions`
  MODIFY COLUMN `type` ENUM(
    'BINARY_PAIR_COMMISSION',
    'REFERRAL_REWARD',
    'LUCKY_DRAW_PRIZE_PAYOUT',
    'WITHDRAWAL_PAYOUT',
    'ADJUSTMENT',
    'REVERSAL'
  ) NOT NULL;

CREATE TABLE `withdrawal_policies` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `withdrawal_policies_code_key` (`code`),
  INDEX `withdrawal_policies_currency_default_idx` (`currencyCode`, `isDefault`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `withdrawal_policy_versions` (
  `id` CHAR(36) NOT NULL,
  `policyId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT','PUBLISHED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `minAmount` DECIMAL(18,2) NOT NULL,
  `maxAmount` DECIMAL(18,2) NOT NULL,
  `feeMode` ENUM('FIXED','PERCENTAGE') NOT NULL,
  `feeValue` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `minimumFee` DECIMAL(18,2) NULL,
  `maximumFee` DECIMAL(18,2) NULL,
  `kycRequired` BOOLEAN NOT NULL DEFAULT TRUE,
  `maxPendingRequests` INT NOT NULL DEFAULT 1,
  `dailyAmountLimit` DECIMAL(18,2) NULL,
  `monthlyAmountLimit` DECIMAL(18,2) NULL,
  `allowedDestinationTypes` JSON NOT NULL,
  `reviewRules` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `withdrawal_policy_versions_policy_version_key` (`policyId`, `version`),
  INDEX `withdrawal_policy_versions_policy_lifecycle_idx` (`policyId`, `lifecycle`),
  INDEX `withdrawal_policy_versions_effective_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `withdrawal_policy_versions_policy_fkey`
    FOREIGN KEY (`policyId`) REFERENCES `withdrawal_policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_policy_versions_effective_window_check`
    CHECK (`effectiveTo` IS NULL OR `effectiveTo` > `effectiveFrom`),
  CONSTRAINT `withdrawal_policy_versions_amount_check`
    CHECK (`minAmount` > 0 AND `maxAmount` >= `minAmount`),
  CONSTRAINT `withdrawal_policy_versions_fee_value_check`
    CHECK (`feeValue` >= 0),
  CONSTRAINT `withdrawal_policy_versions_minimum_fee_check`
    CHECK (`minimumFee` IS NULL OR `minimumFee` >= 0),
  CONSTRAINT `withdrawal_policy_versions_maximum_fee_check`
    CHECK (`maximumFee` IS NULL OR `maximumFee` >= 0),
  CONSTRAINT `withdrawal_policy_versions_fee_window_check`
    CHECK (`minimumFee` IS NULL OR `maximumFee` IS NULL OR `maximumFee` >= `minimumFee`),
  CONSTRAINT `withdrawal_policy_versions_pending_check`
    CHECK (`maxPendingRequests` >= 1),
  CONSTRAINT `withdrawal_policy_versions_daily_limit_check`
    CHECK (`dailyAmountLimit` IS NULL OR `dailyAmountLimit` > 0),
  CONSTRAINT `withdrawal_policy_versions_monthly_limit_check`
    CHECK (`monthlyAmountLimit` IS NULL OR `monthlyAmountLimit` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `withdrawal_destinations` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `type` ENUM('UPI','BANK_REFERENCE','OTHER') NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `metadata` JSON NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,
  `deactivatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `withdrawal_destinations_user_reference_key` (`userId`, `reference`),
  INDEX `withdrawal_destinations_user_status_idx` (`userId`, `status`, `createdAt`),
  CONSTRAINT `withdrawal_destinations_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `withdrawal_requests` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `destinationId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `status` ENUM(
    'REQUESTED',
    'APPROVED',
    'REJECTED',
    'PROCESSING',
    'PAYOUT_FAILED',
    'PAID',
    'CANCELLED'
  ) NOT NULL DEFAULT 'REQUESTED',
  `amount` DECIMAL(18,2) NOT NULL,
  `feeAmount` DECIMAL(18,2) NOT NULL,
  `netAmount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `kycStatusSnapshot` VARCHAR(40) NOT NULL,
  `balanceSnapshot` DECIMAL(18,2) NOT NULL,
  `reservedBeforeSnapshot` DECIMAL(18,2) NOT NULL,
  `requestedAt` DATETIME(3) NOT NULL,
  `approvedAt` DATETIME(3) NULL,
  `approvedByUserId` CHAR(36) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `rejectedByUserId` CHAR(36) NULL,
  `rejectionReason` VARCHAR(1000) NULL,
  `processingAt` DATETIME(3) NULL,
  `paidAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureReason` VARCHAR(1000) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelledByUserId` CHAR(36) NULL,
  `cancellationReason` VARCHAR(1000) NULL,
  `ledgerTransactionId` CHAR(36) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `withdrawal_requests_source_key` (`sourceKey`),
  UNIQUE INDEX `withdrawal_requests_ledger_key` (`ledgerTransactionId`),
  INDEX `withdrawal_requests_user_status_idx` (`userId`, `status`, `requestedAt`),
  INDEX `withdrawal_requests_status_time_idx` (`status`, `requestedAt`),
  INDEX `withdrawal_requests_policy_time_idx` (`policyVersionId`, `requestedAt`),
  INDEX `withdrawal_requests_currency_time_idx` (`currencyCode`, `requestedAt`),
  CONSTRAINT `withdrawal_requests_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_destination_fkey`
    FOREIGN KEY (`destinationId`) REFERENCES `withdrawal_destinations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_policy_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `withdrawal_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_approved_by_fkey`
    FOREIGN KEY (`approvedByUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_rejected_by_fkey`
    FOREIGN KEY (`rejectedByUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_cancelled_by_fkey`
    FOREIGN KEY (`cancelledByUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_ledger_fkey`
    FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `withdrawal_requests_amount_check`
    CHECK (`amount` > 0 AND `feeAmount` >= 0 AND `netAmount` > 0),
  CONSTRAINT `withdrawal_requests_amount_parts_check`
    CHECK (`amount` = `feeAmount` + `netAmount`),
  CONSTRAINT `withdrawal_requests_snapshot_check`
    CHECK (`balanceSnapshot` >= 0 AND `reservedBeforeSnapshot` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `withdrawal_payout_attempts` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `requestId` CHAR(36) NOT NULL,
  `provider` VARCHAR(100) NOT NULL,
  `providerReference` VARCHAR(191) NULL,
  `status` ENUM('INITIATED','CONFIRMED','FAILED') NOT NULL DEFAULT 'INITIATED',
  `initiatedAt` DATETIME(3) NOT NULL,
  `finalizedAt` DATETIME(3) NULL,
  `failureReason` VARCHAR(1000) NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `withdrawal_payout_attempts_source_key` (`sourceKey`),
  INDEX `withdrawal_payout_attempts_request_status_idx` (`requestId`, `status`, `initiatedAt`),
  INDEX `withdrawal_payout_attempts_provider_reference_idx` (`provider`, `providerReference`),
  CONSTRAINT `withdrawal_payout_attempts_request_fkey`
    FOREIGN KEY (`requestId`) REFERENCES `withdrawal_requests` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'withdrawal.read', 'Read withdrawal policies, destinations and payout queues', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'withdrawal.manage', 'Manage withdrawal policy and payout lifecycle', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('withdrawal.read', 'withdrawal.manage');

INSERT INTO `withdrawal_policies` (
  `id`, `code`, `name`, `description`, `currencyCode`, `isDefault`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  'MEMBER_STANDARD_INR',
  'MegaMitra Member Withdrawal - INR',
  'Default configurable withdrawal policy for INR member wallets',
  'INR',
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `withdrawal_policies` WHERE `code` = 'MEMBER_STANDARD_INR'
);

INSERT INTO `withdrawal_policy_versions` (
  `id`, `policyId`, `version`, `lifecycle`, `effectiveFrom`, `effectiveTo`,
  `minAmount`, `maxAmount`, `feeMode`, `feeValue`, `minimumFee`, `maximumFee`,
  `kycRequired`, `maxPendingRequests`, `dailyAmountLimit`, `monthlyAmountLimit`,
  `allowedDestinationTypes`, `reviewRules`, `publishedAt`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  p.`id`,
  1,
  'PUBLISHED',
  CURRENT_TIMESTAMP(3),
  NULL,
  1.00,
  1000000.00,
  'FIXED',
  0.0000,
  NULL,
  NULL,
  TRUE,
  1,
  NULL,
  NULL,
  JSON_ARRAY('UPI','BANK_REFERENCE','OTHER'),
  JSON_OBJECT('manualApprovalRequired', TRUE, 'providerExecutionMode', 'MANUAL_OR_ADAPTER'),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `withdrawal_policies` p
WHERE p.`code` = 'MEMBER_STANDARD_INR'
  AND NOT EXISTS (
    SELECT 1
    FROM `withdrawal_policy_versions` v
    WHERE v.`policyId` = p.`id` AND v.`version` = 1
  );
