ALTER TABLE `binary_plan_versions`
  ADD COLUMN `currencyCode` VARCHAR(3) NULL,
  ADD COLUMN `settlementTimezone` VARCHAR(100) NULL,
  ADD COLUMN `capOverflowMode` ENUM('CARRY', 'FLUSH') NULL;

CREATE TABLE `ledger_accounts` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(120) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `kind` ENUM('USER_WALLET', 'COMMISSION_EXPENSE') NOT NULL,
  `ownerUserId` CHAR(36) NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ledger_accounts_code_key` (`code`),
  INDEX `ledger_accounts_ownerUserId_kind_currencyCode_idx` (`ownerUserId`, `kind`, `currencyCode`),
  INDEX `ledger_accounts_kind_currencyCode_idx` (`kind`, `currencyCode`),
  CONSTRAINT `ledger_accounts_ownerUserId_fkey`
    FOREIGN KEY (`ownerUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ledger_transactions` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `type` ENUM('BINARY_PAIR_COMMISSION', 'ADJUSTMENT', 'REVERSAL') NOT NULL,
  `description` VARCHAR(500) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ledger_transactions_sourceKey_key` (`sourceKey`),
  INDEX `ledger_transactions_type_occurredAt_idx` (`type`, `occurredAt`),
  INDEX `ledger_transactions_createdAt_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_pair_settlements` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `memberUserId` CHAR(36) NOT NULL,
  `planVersionId` CHAR(36) NOT NULL,
  `settledAt` DATETIME(3) NOT NULL,
  `settlementLocalDate` CHAR(10) NOT NULL,
  `settlementLocalMonth` CHAR(7) NOT NULL,
  `leftAvailableBefore` DECIMAL(18,4) NOT NULL,
  `rightAvailableBefore` DECIMAL(18,4) NOT NULL,
  `pairCountCalculated` INT NOT NULL,
  `pairCountPayable` INT NOT NULL,
  `capLimitedPairs` INT NOT NULL,
  `leftVolumeConsumed` DECIMAL(18,4) NOT NULL,
  `rightVolumeConsumed` DECIMAL(18,4) NOT NULL,
  `leftCarryAfter` DECIMAL(18,4) NOT NULL,
  `rightCarryAfter` DECIMAL(18,4) NOT NULL,
  `payoutAmount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `ledgerTransactionId` CHAR(36) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_pair_settlements_sourceKey_key` (`sourceKey`),
  UNIQUE INDEX `binary_pair_settlements_ledgerTransactionId_key` (`ledgerTransactionId`),
  INDEX `binary_pair_settlements_member_plan_settled_idx` (`memberUserId`, `planVersionId`, `settledAt`),
  INDEX `binary_pair_settlements_member_plan_date_idx` (`memberUserId`, `planVersionId`, `settlementLocalDate`),
  INDEX `binary_pair_settlements_member_plan_month_idx` (`memberUserId`, `planVersionId`, `settlementLocalMonth`),
  CONSTRAINT `binary_pair_settlements_memberUserId_fkey`
    FOREIGN KEY (`memberUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_settlements_planVersionId_fkey`
    FOREIGN KEY (`planVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_settlements_ledgerTransactionId_fkey`
    FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_settlements_pair_count_check`
    CHECK (`pairCountCalculated` >= 0 AND `pairCountPayable` >= 0 AND `capLimitedPairs` >= 0),
  CONSTRAINT `binary_pair_settlements_payout_check` CHECK (`payoutAmount` >= 0),
  CONSTRAINT `binary_pair_settlements_consumed_check`
    CHECK (`leftVolumeConsumed` >= 0 AND `rightVolumeConsumed` >= 0),
  CONSTRAINT `binary_pair_settlements_carry_check`
    CHECK (`leftCarryAfter` >= 0 AND `rightCarryAfter` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ledger_entries` (
  `id` CHAR(36) NOT NULL,
  `transactionId` CHAR(36) NOT NULL,
  `accountId` CHAR(36) NOT NULL,
  `direction` ENUM('DEBIT', 'CREDIT') NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ledger_entries_transactionId_idx` (`transactionId`),
  INDEX `ledger_entries_accountId_createdAt_idx` (`accountId`, `createdAt`),
  CONSTRAINT `ledger_entries_transactionId_fkey`
    FOREIGN KEY (`transactionId`) REFERENCES `ledger_transactions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ledger_entries_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `ledger_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ledger_entries_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'binary.settlement.read', 'Read binary pair settlements', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'binary.settlement.manage', 'Run binary pair settlements', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'ledger.read', 'Read immutable ledger transactions and entries', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'wallet.read', 'Read derived member wallet balances', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN (
    'binary.settlement.read',
    'binary.settlement.manage',
    'ledger.read',
    'wallet.read'
  );
