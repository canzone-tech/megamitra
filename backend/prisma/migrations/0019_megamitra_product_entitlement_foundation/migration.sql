CREATE TABLE `catalog_products` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `kind` ENUM('GOODS','SERVICE','BENEFIT','BUNDLE','OTHER') NOT NULL DEFAULT 'GOODS',
  `nominalValue` DECIMAL(18,2) NULL,
  `currencyCode` VARCHAR(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `catalog_products_code_key` (`code`),
  INDEX `catalog_products_status_kind_idx` (`status`, `kind`, `createdAt`),
  CONSTRAINT `catalog_products_value_check`
    CHECK (`nominalValue` IS NULL OR `nominalValue` >= 0),
  CONSTRAINT `catalog_products_currency_pair_check`
    CHECK ((`nominalValue` IS NULL AND `currencyCode` IS NULL) OR (`nominalValue` IS NOT NULL AND `currencyCode` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `entitlement_policies` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `programId` CHAR(36) NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `entitlement_policies_code_key` (`code`),
  INDEX `entitlement_policies_program_default_idx` (`programId`, `isDefault`),
  CONSTRAINT `entitlement_policies_program_fkey`
    FOREIGN KEY (`programId`) REFERENCES `programs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `entitlement_policy_versions` (
  `id` CHAR(36) NOT NULL,
  `policyId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT','PUBLISHED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `minimumPaidInstallments` INT NOT NULL DEFAULT 0,
  `minimumPaidAmount` DECIMAL(18,2) NULL,
  `requireEnrollmentCompleted` BOOLEAN NOT NULL DEFAULT FALSE,
  `excludeAnyLuckyDrawWinner` BOOLEAN NOT NULL DEFAULT FALSE,
  `claimWindowDays` INT NULL,
  `grantItems` JSON NOT NULL,
  `rules` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `entitlement_policy_versions_policy_version_key` (`policyId`, `version`),
  INDEX `entitlement_policy_versions_policy_lifecycle_idx` (`policyId`, `lifecycle`),
  INDEX `entitlement_policy_versions_effective_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `entitlement_policy_versions_policy_fkey`
    FOREIGN KEY (`policyId`) REFERENCES `entitlement_policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `entitlement_policy_versions_effective_window_check`
    CHECK (`effectiveTo` IS NULL OR `effectiveTo` > `effectiveFrom`),
  CONSTRAINT `entitlement_policy_versions_installments_check`
    CHECK (`minimumPaidInstallments` >= 0),
  CONSTRAINT `entitlement_policy_versions_amount_check`
    CHECK (`minimumPaidAmount` IS NULL OR `minimumPaidAmount` >= 0),
  CONSTRAINT `entitlement_policy_versions_claim_window_check`
    CHECK (`claimWindowDays` IS NULL OR (`claimWindowDays` >= 0 AND `claimWindowDays` <= 36500))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `entitlement_generation_runs` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `status` ENUM('GENERATED','INELIGIBLE') NOT NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `generatedCount` INT NOT NULL DEFAULT 0,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `entitlement_generation_runs_source_key` (`sourceKey`),
  INDEX `entitlement_generation_runs_enrollment_time_idx` (`enrollmentId`, `createdAt`),
  INDEX `entitlement_generation_runs_user_time_idx` (`userId`, `createdAt`),
  CONSTRAINT `entitlement_generation_runs_enrollment_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `entitlement_generation_runs_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `entitlement_generation_runs_policy_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `entitlement_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `entitlement_generation_runs_count_check`
    CHECK (`generatedCount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_entitlements` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `generationRunId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `policyVersionId` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `status` ENUM('GRANTED','CLAIMED','FULFILLED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'GRANTED',
  `quantity` INT NOT NULL,
  `productSnapshot` JSON NOT NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `grantedAt` DATETIME(3) NOT NULL,
  `claimDeadline` DATETIME(3) NULL,
  `claimedAt` DATETIME(3) NULL,
  `claimMetadata` JSON NULL,
  `fulfilledAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelledByUserId` CHAR(36) NULL,
  `cancellationReason` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `product_entitlements_source_key` (`sourceKey`),
  UNIQUE INDEX `product_entitlements_enrollment_policy_product_key` (`enrollmentId`, `policyVersionId`, `productId`),
  INDEX `product_entitlements_user_status_idx` (`userId`, `status`, `grantedAt`),
  INDEX `product_entitlements_claim_deadline_idx` (`status`, `claimDeadline`),
  INDEX `product_entitlements_policy_time_idx` (`policyVersionId`, `grantedAt`),
  CONSTRAINT `product_entitlements_generation_run_fkey`
    FOREIGN KEY (`generationRunId`) REFERENCES `entitlement_generation_runs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_entitlements_user_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_entitlements_enrollment_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_entitlements_policy_version_fkey`
    FOREIGN KEY (`policyVersionId`) REFERENCES `entitlement_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_entitlements_product_fkey`
    FOREIGN KEY (`productId`) REFERENCES `catalog_products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_entitlements_cancelled_by_fkey`
    FOREIGN KEY (`cancelledByUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_entitlements_quantity_check`
    CHECK (`quantity` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_fulfillment_attempts` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `entitlementId` CHAR(36) NOT NULL,
  `status` ENUM('INITIATED','FULFILLED','FAILED') NOT NULL DEFAULT 'INITIATED',
  `provider` VARCHAR(100) NOT NULL,
  `providerReference` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `initiatedAt` DATETIME(3) NOT NULL,
  `finalizedAt` DATETIME(3) NULL,
  `failureReason` VARCHAR(1000) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `product_fulfillment_attempts_source_key` (`sourceKey`),
  INDEX `product_fulfillment_attempts_entitlement_status_idx` (`entitlementId`, `status`, `initiatedAt`),
  INDEX `product_fulfillment_attempts_provider_reference_idx` (`provider`, `providerReference`),
  CONSTRAINT `product_fulfillment_attempts_entitlement_fkey`
    FOREIGN KEY (`entitlementId`) REFERENCES `product_entitlements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'product.read', 'Read product catalog and entitlement policy configuration', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'product.manage', 'Manage product catalog and entitlement policy configuration', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'entitlement.read', 'Read member product entitlement and fulfillment queues', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'entitlement.manage', 'Generate, cancel and fulfill member product entitlements', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('product.read', 'product.manage', 'entitlement.read', 'entitlement.manage');

INSERT INTO `catalog_products` (
  `id`, `code`, `name`, `description`, `kind`, `nominalValue`, `currencyCode`, `status`, `metadata`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  'CONSUMER_PRODUCT_BENEFIT',
  'MegaMitra Consumer Product Benefit',
  'Configurable consumer-product benefit used by the initial MegaMitra plan.',
  'BENEFIT',
  21000.00,
  'INR',
  'ACTIVE',
  JSON_OBJECT('sourcePlan', 'initial-flyer', 'configurable', TRUE),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `catalog_products` WHERE `code` = 'CONSUMER_PRODUCT_BENEFIT'
);

INSERT INTO `entitlement_policies` (
  `id`, `code`, `name`, `description`, `programId`, `isDefault`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  'NON_WINNER_CONSUMER_PRODUCTS',
  'Non-winner Consumer Product Benefit',
  'Initial configurable rule for the plan consumer-product benefit. Administrators can version or replace it.',
  NULL,
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `entitlement_policies` WHERE `code` = 'NON_WINNER_CONSUMER_PRODUCTS'
);

INSERT INTO `entitlement_policy_versions` (
  `id`, `policyId`, `version`, `lifecycle`, `effectiveFrom`, `effectiveTo`,
  `minimumPaidInstallments`, `minimumPaidAmount`, `requireEnrollmentCompleted`,
  `excludeAnyLuckyDrawWinner`, `claimWindowDays`, `grantItems`, `rules`,
  `publishedAt`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  p.`id`,
  1,
  'PUBLISHED',
  CURRENT_TIMESTAMP(3),
  NULL,
  18,
  19000.00,
  TRUE,
  TRUE,
  90,
  JSON_ARRAY(JSON_OBJECT('productCode', 'CONSUMER_PRODUCT_BENEFIT', 'quantity', 1)),
  JSON_OBJECT('note', 'Initial flyer configuration; all values are versioned and replaceable'),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `entitlement_policies` p
WHERE p.`code` = 'NON_WINNER_CONSUMER_PRODUCTS'
  AND NOT EXISTS (
    SELECT 1 FROM `entitlement_policy_versions` v
    WHERE v.`policyId` = p.`id` AND v.`version` = 1
  );
