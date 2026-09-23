ALTER TABLE `binary_pair_settlements`
  ADD COLUMN `requestFingerprint` CHAR(64) NULL,
  ADD COLUMN `leftUnitsAvailableBefore` INT NOT NULL DEFAULT 0,
  ADD COLUMN `rightUnitsAvailableBefore` INT NOT NULL DEFAULT 0,
  ADD COLUMN `leftUnitsConsumed` INT NOT NULL DEFAULT 0,
  ADD COLUMN `rightUnitsConsumed` INT NOT NULL DEFAULT 0,
  ADD COLUMN `leftUnitsCarryAfter` INT NOT NULL DEFAULT 0,
  ADD COLUMN `rightUnitsCarryAfter` INT NOT NULL DEFAULT 0,
  ADD INDEX `binary_pair_settlements_requestFingerprint_idx` (`requestFingerprint`);

CREATE TABLE `binary_qualifying_unit_events` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `sourceMemberUserId` CHAR(36) NOT NULL,
  `planVersionId` CHAR(36) NOT NULL,
  `eventType` ENUM('QUALIFY', 'REVERSAL') NOT NULL,
  `reversalOfEventId` CHAR(36) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_qualifying_unit_events_sourceKey_key` (`sourceKey`),
  UNIQUE INDEX `binary_qualifying_unit_events_reversalOfEventId_key` (`reversalOfEventId`),
  INDEX `binary_qualifying_unit_events_source_member_time_idx` (`sourceMemberUserId`, `occurredAt`),
  INDEX `binary_qualifying_unit_events_plan_time_idx` (`planVersionId`, `occurredAt`),
  CONSTRAINT `binary_qualifying_unit_events_sourceMemberUserId_fkey`
    FOREIGN KEY (`sourceMemberUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_qualifying_unit_events_planVersionId_fkey`
    FOREIGN KEY (`planVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_qualifying_unit_events_reversalOfEventId_fkey`
    FOREIGN KEY (`reversalOfEventId`) REFERENCES `binary_qualifying_unit_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_upline_qualifying_units` (
  `id` CHAR(36) NOT NULL,
  `unitEventId` CHAR(36) NOT NULL,
  `ancestorUserId` CHAR(36) NOT NULL,
  `planVersionId` CHAR(36) NOT NULL,
  `side` ENUM('LEFT', 'RIGHT') NOT NULL,
  `depth` INT NOT NULL,
  `sequence` BIGINT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_upline_qualifying_units_event_ancestor_key` (`unitEventId`, `ancestorUserId`),
  UNIQUE INDEX `binary_upline_qualifying_units_sequence_key` (`ancestorUserId`, `planVersionId`, `side`, `sequence`),
  INDEX `binary_upline_qualifying_units_queue_idx` (`ancestorUserId`, `planVersionId`, `side`, `sequence`),
  INDEX `binary_upline_qualifying_units_plan_idx` (`planVersionId`, `createdAt`),
  CONSTRAINT `binary_upline_qualifying_units_unitEventId_fkey`
    FOREIGN KEY (`unitEventId`) REFERENCES `binary_qualifying_unit_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_upline_qualifying_units_ancestorUserId_fkey`
    FOREIGN KEY (`ancestorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_upline_qualifying_units_planVersionId_fkey`
    FOREIGN KEY (`planVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_upline_qualifying_units_depth_check` CHECK (`depth` > 0),
  CONSTRAINT `binary_upline_qualifying_units_sequence_check` CHECK (`sequence` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_pair_matches` (
  `id` CHAR(36) NOT NULL,
  `settlementId` CHAR(36) NOT NULL,
  `memberUserId` CHAR(36) NOT NULL,
  `planVersionId` CHAR(36) NOT NULL,
  `pairSequence` BIGINT NOT NULL,
  `leftUnitId` CHAR(36) NOT NULL,
  `rightUnitId` CHAR(36) NOT NULL,
  `payable` BOOLEAN NOT NULL,
  `payoutAmount` DECIMAL(18,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_pair_matches_leftUnitId_key` (`leftUnitId`),
  UNIQUE INDEX `binary_pair_matches_rightUnitId_key` (`rightUnitId`),
  UNIQUE INDEX `binary_pair_matches_member_plan_sequence_key` (`memberUserId`, `planVersionId`, `pairSequence`),
  INDEX `binary_pair_matches_settlementId_idx` (`settlementId`),
  INDEX `binary_pair_matches_member_plan_idx` (`memberUserId`, `planVersionId`, `createdAt`),
  CONSTRAINT `binary_pair_matches_settlementId_fkey`
    FOREIGN KEY (`settlementId`) REFERENCES `binary_pair_settlements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_matches_memberUserId_fkey`
    FOREIGN KEY (`memberUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_matches_planVersionId_fkey`
    FOREIGN KEY (`planVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_matches_leftUnitId_fkey`
    FOREIGN KEY (`leftUnitId`) REFERENCES `binary_upline_qualifying_units` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_matches_rightUnitId_fkey`
    FOREIGN KEY (`rightUnitId`) REFERENCES `binary_upline_qualifying_units` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_pair_matches_sequence_check` CHECK (`pairSequence` > 0),
  CONSTRAINT `binary_pair_matches_payout_check` CHECK (`payoutAmount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_unit_dispositions` (
  `id` CHAR(36) NOT NULL,
  `uplineUnitId` CHAR(36) NOT NULL,
  `settlementId` CHAR(36) NOT NULL,
  `disposition` ENUM('FLUSHED', 'EXPIRED') NOT NULL,
  `reason` VARCHAR(100) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_unit_dispositions_uplineUnitId_key` (`uplineUnitId`),
  INDEX `binary_unit_dispositions_settlementId_idx` (`settlementId`),
  CONSTRAINT `binary_unit_dispositions_uplineUnitId_fkey`
    FOREIGN KEY (`uplineUnitId`) REFERENCES `binary_upline_qualifying_units` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_unit_dispositions_settlementId_fkey`
    FOREIGN KEY (`settlementId`) REFERENCES `binary_pair_settlements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'binary.unit.read', 'Read binary qualifying units and explicit pair queues', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'binary.unit.manage', 'Create and reverse binary qualifying unit events', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('binary.unit.read', 'binary.unit.manage');