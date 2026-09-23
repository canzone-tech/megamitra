CREATE TABLE `lucky_draw_policies` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_policies_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_policy_versions` (
  `id` CHAR(36) NOT NULL,
  `policyId` CHAR(36) NOT NULL,
  `programVersionId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT','PUBLISHED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `entryMode` ENUM('PER_ELIGIBLE_HOOK','ONE_PER_USER') NOT NULL,
  `priorWinnerMode` ENUM('ALLOW','DISALLOW_WITHIN_POLICY') NOT NULL,
  `allowMultipleWinsPerDraw` BOOLEAN NOT NULL DEFAULT FALSE,
  `insufficientEntrantsMode` ENUM('REQUIRE_FULL','DRAW_AVAILABLE') NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_policy_versions_policy_version_key` (`policyId`, `version`),
  INDEX `lucky_draw_policy_versions_program_idx` (`programVersionId`, `lifecycle`),
  INDEX `lucky_draw_policy_versions_effective_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `lucky_draw_policy_versions_policy_fkey`
    FOREIGN KEY (`policyId`) REFERENCES `lucky_draw_policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_policy_versions_program_fkey`
    FOREIGN KEY (`programVersionId`) REFERENCES `program_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_prize_tiers` (
  `id` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `tierOrder` INT NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `winnerCount` INT NOT NULL,
  `prizeKind` ENUM('CASH','ITEM','BENEFIT','OTHER') NOT NULL,
  `cashAmount` DECIMAL(18,2) NULL,
  `currencyCode` VARCHAR(3) NULL,
  `prizeDefinition` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_prize_tiers_order_key` (`policyVersionId`, `tierOrder`),
  UNIQUE INDEX `lucky_draw_prize_tiers_code_key` (`policyVersionId`, `code`),
  INDEX `lucky_draw_prize_tiers_version_idx` (`policyVersionId`, `tierOrder`),
  CONSTRAINT `lucky_draw_prize_tiers_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `lucky_draw_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_prize_tiers_winner_count_check` CHECK (`winnerCount` >= 1),
  CONSTRAINT `lucky_draw_prize_tiers_order_check` CHECK (`tierOrder` >= 1),
  CONSTRAINT `lucky_draw_prize_tiers_cash_amount_check` CHECK (`cashAmount` IS NULL OR `cashAmount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_instances` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `entryWindowStart` DATETIME(3) NOT NULL,
  `entryWindowEnd` DATETIME(3) NOT NULL,
  `drawAt` DATETIME(3) NOT NULL,
  `seedCommitment` CHAR(64) NOT NULL,
  `status` ENUM('SCHEDULED','SNAPSHOTTED','DRAWN','VOIDED') NOT NULL DEFAULT 'SCHEDULED',
  `snapshotHash` CHAR(64) NULL,
  `candidateCount` INT NOT NULL DEFAULT 0,
  `eligibleEntryCount` INT NOT NULL DEFAULT 0,
  `excludedEntryCount` INT NOT NULL DEFAULT 0,
  `revealedSeed` VARCHAR(191) NULL,
  `selectionAlgorithm` VARCHAR(50) NULL,
  `winnerCount` INT NOT NULL DEFAULT 0,
  `snapshottedAt` DATETIME(3) NULL,
  `drawnAt` DATETIME(3) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_instances_source_key` (`sourceKey`),
  INDEX `lucky_draw_instances_policy_status_idx` (`policyVersionId`, `status`, `drawAt`),
  INDEX `lucky_draw_instances_window_idx` (`entryWindowStart`, `entryWindowEnd`),
  CONSTRAINT `lucky_draw_instances_policy_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `lucky_draw_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_instances_counts_check`
    CHECK (`candidateCount` >= 0 AND `eligibleEntryCount` >= 0 AND `excludedEntryCount` >= 0 AND `winnerCount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_entries` (
  `id` CHAR(36) NOT NULL,
  `drawId` CHAR(36) NOT NULL,
  `sourceHookId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `hookOccurredAt` DATETIME(3) NOT NULL,
  `disposition` ENUM('ELIGIBLE','DUPLICATE_USER','PRIOR_WINNER') NOT NULL,
  `exclusionReason` VARCHAR(100) NULL,
  `entrySequence` INT NULL,
  `selectionScore` CHAR(64) NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_entries_draw_hook_key` (`drawId`, `sourceHookId`),
  UNIQUE INDEX `lucky_draw_entries_draw_sequence_key` (`drawId`, `entrySequence`),
  INDEX `lucky_draw_entries_draw_disposition_idx` (`drawId`, `disposition`, `entrySequence`),
  INDEX `lucky_draw_entries_user_idx` (`userId`, `createdAt`),
  INDEX `lucky_draw_entries_hook_idx` (`sourceHookId`),
  CONSTRAINT `lucky_draw_entries_draw_fkey`
    FOREIGN KEY (`drawId`) REFERENCES `lucky_draw_instances` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_entries_hook_fkey`
    FOREIGN KEY (`sourceHookId`) REFERENCES `program_draw_eligibility_hooks` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_entries_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lucky_draw_winners` (
  `id` CHAR(36) NOT NULL,
  `drawId` CHAR(36) NOT NULL,
  `entryId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `prizeTierId` CHAR(36) NOT NULL,
  `overallRank` INT NOT NULL,
  `tierWinnerPosition` INT NOT NULL,
  `selectionScore` CHAR(64) NOT NULL,
  `outcomeSnapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lucky_draw_winners_entry_key` (`entryId`),
  UNIQUE INDEX `lucky_draw_winners_draw_rank_key` (`drawId`, `overallRank`),
  INDEX `lucky_draw_winners_user_idx` (`userId`, `createdAt`),
  INDEX `lucky_draw_winners_prize_idx` (`prizeTierId`),
  CONSTRAINT `lucky_draw_winners_draw_fkey`
    FOREIGN KEY (`drawId`) REFERENCES `lucky_draw_instances` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_winners_entry_fkey`
    FOREIGN KEY (`entryId`) REFERENCES `lucky_draw_entries` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_winners_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_winners_prize_tier_fkey`
    FOREIGN KEY (`prizeTierId`) REFERENCES `lucky_draw_prize_tiers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lucky_draw_winners_rank_check` CHECK (`overallRank` >= 1 AND `tierWinnerPosition` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'draw.policy.read', 'Read lucky draw policies and prize rules', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'draw.policy.manage', 'Create and manage lucky draw policy versions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'draw.execution.read', 'Read lucky draw entrant snapshots and outcomes', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'draw.execution.manage', 'Create, snapshot and execute lucky draws', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('draw.policy.read', 'draw.policy.manage', 'draw.execution.read', 'draw.execution.manage');
