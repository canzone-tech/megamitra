CREATE TABLE `sponsor_relationships` (
  `id` CHAR(36) NOT NULL,
  `memberUserId` CHAR(36) NOT NULL,
  `sponsorUserId` CHAR(36) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sponsor_relationships_memberUserId_key` (`memberUserId`),
  INDEX `sponsor_relationships_sponsorUserId_idx` (`sponsorUserId`),
  CONSTRAINT `sponsor_relationships_memberUserId_fkey`
    FOREIGN KEY (`memberUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sponsor_relationships_sponsorUserId_fkey`
    FOREIGN KEY (`sponsorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sponsor_relationships_not_self_check`
    CHECK (`memberUserId` <> `sponsorUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_placements` (
  `id` CHAR(36) NOT NULL,
  `memberUserId` CHAR(36) NOT NULL,
  `parentUserId` CHAR(36) NOT NULL,
  `side` ENUM('LEFT', 'RIGHT') NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_placements_memberUserId_key` (`memberUserId`),
  UNIQUE INDEX `binary_placements_parentUserId_side_key` (`parentUserId`, `side`),
  INDEX `binary_placements_parentUserId_idx` (`parentUserId`),
  CONSTRAINT `binary_placements_memberUserId_fkey`
    FOREIGN KEY (`memberUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_placements_parentUserId_fkey`
    FOREIGN KEY (`parentUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_placements_not_self_check`
    CHECK (`memberUserId` <> `parentUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_ancestry` (
  `ancestorUserId` CHAR(36) NOT NULL,
  `descendantUserId` CHAR(36) NOT NULL,
  `depth` INT NOT NULL,
  `firstLegSide` ENUM('LEFT', 'RIGHT') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`ancestorUserId`, `descendantUserId`),
  INDEX `binary_ancestry_ancestorUserId_depth_idx` (`ancestorUserId`, `depth`),
  INDEX `binary_ancestry_descendantUserId_depth_idx` (`descendantUserId`, `depth`),
  CONSTRAINT `binary_ancestry_ancestorUserId_fkey`
    FOREIGN KEY (`ancestorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_ancestry_descendantUserId_fkey`
    FOREIGN KEY (`descendantUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_ancestry_depth_check` CHECK (`depth` > 0),
  CONSTRAINT `binary_ancestry_not_self_check` CHECK (`ancestorUserId` <> `descendantUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_plans` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_plans_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_plan_versions` (
  `id` CHAR(36) NOT NULL,
  `planId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `qualifyingUnit` DECIMAL(18,4) NOT NULL,
  `leftVolumePerPair` DECIMAL(18,4) NOT NULL,
  `rightVolumePerPair` DECIMAL(18,4) NOT NULL,
  `pairPayoutAmount` DECIMAL(18,2) NOT NULL,
  `dailyPairCap` INT NULL,
  `monthlyPairCap` INT NULL,
  `carryForwardEnabled` BOOLEAN NOT NULL,
  `carryForwardExpiryDays` INT NULL,
  `qualificationRules` JSON NULL,
  `settlementRules` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_plan_versions_planId_version_key` (`planId`, `version`),
  INDEX `binary_plan_versions_planId_lifecycle_idx` (`planId`, `lifecycle`),
  INDEX `binary_plan_versions_lifecycle_effectiveFrom_effectiveTo_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `binary_plan_versions_planId_fkey`
    FOREIGN KEY (`planId`) REFERENCES `binary_plans` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_plan_versions_effective_window_check`
    CHECK (`effectiveTo` IS NULL OR `effectiveTo` > `effectiveFrom`),
  CONSTRAINT `binary_plan_versions_qualifying_unit_check` CHECK (`qualifyingUnit` > 0),
  CONSTRAINT `binary_plan_versions_left_volume_check` CHECK (`leftVolumePerPair` > 0),
  CONSTRAINT `binary_plan_versions_right_volume_check` CHECK (`rightVolumePerPair` > 0),
  CONSTRAINT `binary_plan_versions_payout_check` CHECK (`pairPayoutAmount` >= 0),
  CONSTRAINT `binary_plan_versions_daily_cap_check` CHECK (`dailyPairCap` IS NULL OR `dailyPairCap` >= 0),
  CONSTRAINT `binary_plan_versions_monthly_cap_check` CHECK (`monthlyPairCap` IS NULL OR `monthlyPairCap` >= 0),
  CONSTRAINT `binary_plan_versions_carry_expiry_check` CHECK (`carryForwardExpiryDays` IS NULL OR `carryForwardExpiryDays` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_volume_events` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `sourceMemberUserId` CHAR(36) NOT NULL,
  `planVersionId` CHAR(36) NOT NULL,
  `eventType` ENUM('CREDIT', 'ADJUSTMENT', 'REVERSAL') NOT NULL,
  `volume` DECIMAL(18,4) NOT NULL,
  `reversalOfEventId` CHAR(36) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_volume_events_sourceKey_key` (`sourceKey`),
  UNIQUE INDEX `binary_volume_events_reversalOfEventId_key` (`reversalOfEventId`),
  INDEX `binary_volume_events_sourceMemberUserId_occurredAt_idx` (`sourceMemberUserId`, `occurredAt`),
  INDEX `binary_volume_events_planVersionId_occurredAt_idx` (`planVersionId`, `occurredAt`),
  INDEX `binary_volume_events_eventType_occurredAt_idx` (`eventType`, `occurredAt`),
  CONSTRAINT `binary_volume_events_sourceMemberUserId_fkey`
    FOREIGN KEY (`sourceMemberUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_volume_events_planVersionId_fkey`
    FOREIGN KEY (`planVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_volume_events_reversalOfEventId_fkey`
    FOREIGN KEY (`reversalOfEventId`) REFERENCES `binary_volume_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_volume_events_nonzero_volume_check` CHECK (`volume` <> 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `binary_upline_volume_credits` (
  `id` CHAR(36) NOT NULL,
  `volumeEventId` CHAR(36) NOT NULL,
  `ancestorUserId` CHAR(36) NOT NULL,
  `planVersionId` CHAR(36) NOT NULL,
  `side` ENUM('LEFT', 'RIGHT') NOT NULL,
  `depth` INT NOT NULL,
  `volume` DECIMAL(18,4) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `binary_upline_volume_credits_volumeEventId_ancestorUserId_key` (`volumeEventId`, `ancestorUserId`),
  INDEX `binary_upline_volume_credits_ancestorUserId_side_createdAt_idx` (`ancestorUserId`, `side`, `createdAt`),
  INDEX `binary_upline_volume_credits_planVersionId_createdAt_idx` (`planVersionId`, `createdAt`),
  CONSTRAINT `binary_upline_volume_credits_volumeEventId_fkey`
    FOREIGN KEY (`volumeEventId`) REFERENCES `binary_volume_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_upline_volume_credits_ancestorUserId_fkey`
    FOREIGN KEY (`ancestorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_upline_volume_credits_planVersionId_fkey`
    FOREIGN KEY (`planVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `binary_upline_volume_credits_depth_check` CHECK (`depth` > 0),
  CONSTRAINT `binary_upline_volume_credits_nonzero_volume_check` CHECK (`volume` <> 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'genealogy.read', 'Read sponsor and binary genealogy', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'genealogy.manage', 'Assign sponsor and binary placement relationships', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'binary.policy.read', 'Read binary plan policies and versions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'binary.policy.manage', 'Create, publish and retire binary plan policy versions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'binary.volume.read', 'Read binary volume events and upline credits', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'binary.volume.manage', 'Create binary volume events, adjustments and reversals', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN (
    'genealogy.read',
    'genealogy.manage',
    'binary.policy.read',
    'binary.policy.manage',
    'binary.volume.read',
    'binary.volume.manage'
  );
