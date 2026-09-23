CREATE TABLE `program_event_policy_versions` (
  `id` CHAR(36) NOT NULL,
  `programVersionId` CHAR(36) NOT NULL,
  `triggerType` ENUM('ENROLLMENT_CREATED','PAYMENT_CONFIRMED','PAYMENT_FAILED','REFUND_CONFIRMED','ENROLLMENT_COMPLETED','ENROLLMENT_REOPENED') NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT','PUBLISHED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `binaryPlanVersionId` CHAR(36) NULL,
  `binaryUnitsPerEvent` INT NOT NULL DEFAULT 0,
  `referralHookEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `referralPolicyVersionId` CHAR(36) NULL,
  `referralBasisMode` ENUM('PAYMENT_AMOUNT','REGISTRATION_ALLOCATION','INSTALLMENT_ALLOCATION','TOTAL_APPLIED_AMOUNT') NULL,
  `drawEligibilityHookEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `eligibilityRules` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_event_policy_versions_scope_version_key` (`programVersionId`, `triggerType`, `version`),
  INDEX `program_event_policy_versions_effective_idx` (`programVersionId`, `triggerType`, `lifecycle`, `effectiveFrom`, `effectiveTo`),
  INDEX `program_event_policy_versions_binary_idx` (`binaryPlanVersionId`),
  INDEX `program_event_policy_versions_referral_idx` (`referralPolicyVersionId`),
  CONSTRAINT `program_event_policy_versions_programVersionId_fkey`
    FOREIGN KEY (`programVersionId`) REFERENCES `program_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_event_policy_versions_binaryPlanVersionId_fkey`
    FOREIGN KEY (`binaryPlanVersionId`) REFERENCES `binary_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_event_policy_versions_referralPolicyVersionId_fkey`
    FOREIGN KEY (`referralPolicyVersionId`) REFERENCES `referral_reward_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_event_policy_versions_binary_units_check` CHECK (`binaryUnitsPerEvent` >= 0),
  CONSTRAINT `program_event_policy_versions_effective_window_check` CHECK (`effectiveTo` IS NULL OR `effectiveTo` >= `effectiveFrom`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_event_processing_runs` (
  `id` CHAR(36) NOT NULL,
  `businessEventId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NULL,
  `status` ENUM('PENDING','PROCESSED','SKIPPED','FAILED','RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'PENDING',
  `eligible` BOOLEAN NOT NULL DEFAULT FALSE,
  `eligibilitySnapshot` JSON NOT NULL,
  `attempts` INT NOT NULL DEFAULT 1,
  `errorMessage` VARCHAR(1000) NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_event_processing_runs_event_key` (`businessEventId`),
  INDEX `program_event_processing_runs_status_idx` (`status`, `updatedAt`),
  INDEX `program_event_processing_runs_policy_idx` (`policyVersionId`, `createdAt`),
  CONSTRAINT `program_event_processing_runs_businessEventId_fkey`
    FOREIGN KEY (`businessEventId`) REFERENCES `program_business_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_event_processing_runs_policyVersionId_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `program_event_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_event_processing_runs_attempts_check` CHECK (`attempts` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_binary_qualification_links` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `runId` CHAR(36) NOT NULL,
  `businessEventId` CHAR(36) NOT NULL,
  `qualifyingUnitEventId` CHAR(36) NOT NULL,
  `unitSequence` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_binary_qualification_links_source_key` (`sourceKey`),
  UNIQUE INDEX `program_binary_qualification_links_event_sequence_key` (`businessEventId`, `unitSequence`),
  UNIQUE INDEX `program_binary_qualification_links_unit_event_key` (`qualifyingUnitEventId`),
  INDEX `program_binary_qualification_links_run_idx` (`runId`),
  CONSTRAINT `program_binary_qualification_links_runId_fkey`
    FOREIGN KEY (`runId`) REFERENCES `program_event_processing_runs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_binary_qualification_links_businessEventId_fkey`
    FOREIGN KEY (`businessEventId`) REFERENCES `program_business_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_binary_qualification_links_qualifyingUnitEventId_fkey`
    FOREIGN KEY (`qualifyingUnitEventId`) REFERENCES `binary_qualifying_unit_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_binary_qualification_links_sequence_check` CHECK (`unitSequence` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_referral_reward_hooks` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `runId` CHAR(36) NOT NULL,
  `businessEventId` CHAR(36) NOT NULL,
  `referredUserId` CHAR(36) NOT NULL,
  `sponsorUserId` CHAR(36) NULL,
  `referralPolicyVersionId` CHAR(36) NOT NULL,
  `basisAmount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `status` ENUM('READY','INELIGIBLE','CANCELLED','CONSUMED') NOT NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `consumedRewardEventId` CHAR(36) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_referral_reward_hooks_source_key` (`sourceKey`),
  UNIQUE INDEX `program_referral_reward_hooks_event_key` (`businessEventId`),
  UNIQUE INDEX `program_referral_reward_hooks_consumed_event_key` (`consumedRewardEventId`),
  INDEX `program_referral_reward_hooks_status_idx` (`status`, `occurredAt`),
  INDEX `program_referral_reward_hooks_referred_idx` (`referredUserId`, `occurredAt`),
  INDEX `program_referral_reward_hooks_sponsor_idx` (`sponsorUserId`, `occurredAt`),
  CONSTRAINT `program_referral_reward_hooks_runId_fkey`
    FOREIGN KEY (`runId`) REFERENCES `program_event_processing_runs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_reward_hooks_businessEventId_fkey`
    FOREIGN KEY (`businessEventId`) REFERENCES `program_business_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_reward_hooks_referredUserId_fkey`
    FOREIGN KEY (`referredUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_reward_hooks_sponsorUserId_fkey`
    FOREIGN KEY (`sponsorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_reward_hooks_policyVersionId_fkey`
    FOREIGN KEY (`referralPolicyVersionId`) REFERENCES `referral_reward_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_reward_hooks_consumedRewardEventId_fkey`
    FOREIGN KEY (`consumedRewardEventId`) REFERENCES `referral_reward_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_referral_reward_hooks_basis_check` CHECK (`basisAmount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_draw_eligibility_hooks` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `runId` CHAR(36) NOT NULL,
  `businessEventId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `programVersionId` CHAR(36) NOT NULL,
  `status` ENUM('ELIGIBLE','INELIGIBLE','CANCELLED','CONSUMED') NOT NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_draw_eligibility_hooks_source_key` (`sourceKey`),
  UNIQUE INDEX `program_draw_eligibility_hooks_event_key` (`businessEventId`),
  INDEX `program_draw_eligibility_hooks_status_idx` (`status`, `occurredAt`),
  INDEX `program_draw_eligibility_hooks_user_idx` (`userId`, `occurredAt`),
  CONSTRAINT `program_draw_eligibility_hooks_runId_fkey`
    FOREIGN KEY (`runId`) REFERENCES `program_event_processing_runs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_draw_eligibility_hooks_businessEventId_fkey`
    FOREIGN KEY (`businessEventId`) REFERENCES `program_business_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_draw_eligibility_hooks_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_draw_eligibility_hooks_programVersionId_fkey`
    FOREIGN KEY (`programVersionId`) REFERENCES `program_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'program.orchestration.read', 'Read program event orchestration policies, runs and eligibility hooks', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.orchestration.manage', 'Manage program event orchestration policies and process business events', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('program.orchestration.read', 'program.orchestration.manage');
