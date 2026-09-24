CREATE TABLE `kyc_policies` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `kyc_policies_code_key` (`code`),
  INDEX `kyc_policies_isDefault_idx` (`isDefault`)
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kyc_policy_versions` (
  `id` CHAR(36) NOT NULL,
  `policyId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `requirements` JSON NOT NULL,
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
  UNIQUE INDEX `kyc_policy_versions_policy_version_key` (`policyId`, `version`),
  INDEX `kyc_policy_versions_policy_lifecycle_idx` (`policyId`, `lifecycle`),
  INDEX `kyc_policy_versions_effective_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `kyc_policy_versions_policyId_fkey`
    FOREIGN KEY (`policyId`) REFERENCES `kyc_policies` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `kyc_policy_versions_effective_window_check`
    CHECK (`effectiveTo` IS NULL OR `effectiveTo` > `effectiveFrom`)
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kyc_profiles` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `status` ENUM(
    'NOT_STARTED',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'RESUBMISSION_REQUIRED'
  ) NOT NULL DEFAULT 'NOT_STARTED',
  `approvedAt` DATETIME(3) NULL,
  `lastSubmittedAt` DATETIME(3) NULL,
  `lastReviewedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `kyc_profiles_userId_key` (`userId`),
  INDEX `kyc_profiles_status_updatedAt_idx` (`status`, `updatedAt`),
  CONSTRAINT `kyc_profiles_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kyc_submissions` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `profileId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `status` ENUM(
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'RESUBMISSION_REQUIRED',
    'SUPERSEDED'
  ) NOT NULL DEFAULT 'SUBMITTED',
  `data` JSON NOT NULL,
  `documents` JSON NOT NULL,
  `submittedAt` DATETIME(3) NOT NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewedByUserId` CHAR(36) NULL,
  `reviewReason` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `kyc_submissions_sourceKey_key` (`sourceKey`),
  INDEX `kyc_submissions_user_status_submitted_idx` (`userId`, `status`, `submittedAt`),
  INDEX `kyc_submissions_profile_submitted_idx` (`profileId`, `submittedAt`),
  INDEX `kyc_submissions_policy_submitted_idx` (`policyVersionId`, `submittedAt`),
  INDEX `kyc_submissions_status_submitted_idx` (`status`, `submittedAt`),
  INDEX `kyc_submissions_reviewer_idx` (`reviewedByUserId`),
  CONSTRAINT `kyc_submissions_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `kyc_submissions_profileId_fkey`
    FOREIGN KEY (`profileId`) REFERENCES `kyc_profiles` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `kyc_submissions_policyVersionId_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `kyc_policy_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `kyc_submissions_reviewedByUserId_fkey`
    FOREIGN KEY (`reviewedByUserId`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'kyc.read', 'Read KYC policies and review queue', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'kyc.manage', 'Manage KYC policies and review submissions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('kyc.read', 'kyc.manage');

INSERT INTO `kyc_policies` (
  `id`, `code`, `name`, `description`, `isDefault`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  'MEMBER_STANDARD',
  'MegaMitra Member KYC',
  'Default versioned KYC requirements for MegaMitra members',
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `kyc_policies` WHERE `code` = 'MEMBER_STANDARD'
);

INSERT INTO `kyc_policy_versions` (
  `id`, `policyId`, `version`, `lifecycle`, `effectiveFrom`, `effectiveTo`,
  `requirements`, `reviewRules`, `publishedAt`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  p.`id`,
  1,
  'PUBLISHED',
  CURRENT_TIMESTAMP(3),
  NULL,
  JSON_OBJECT(
    'fields', JSON_ARRAY('legalName', 'dateOfBirth', 'address'),
    'documents', JSON_ARRAY('identity', 'address')
  ),
  JSON_OBJECT('manualReviewRequired', TRUE),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `kyc_policies` p
WHERE p.`code` = 'MEMBER_STANDARD'
  AND NOT EXISTS (
    SELECT 1
    FROM `kyc_policy_versions` v
    WHERE v.`policyId` = p.`id` AND v.`version` = 1
  );
