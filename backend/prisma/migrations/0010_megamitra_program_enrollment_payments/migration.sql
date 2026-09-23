CREATE TABLE `programs` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `programs_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_versions` (
  `id` CHAR(36) NOT NULL,
  `programId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `registrationFee` DECIMAL(18,2) NOT NULL,
  `installmentAmount` DECIMAL(18,2) NOT NULL,
  `installmentCount` INT NOT NULL,
  `installmentIntervalUnit` ENUM('DAY', 'WEEK', 'MONTH') NOT NULL,
  `installmentIntervalCount` INT NOT NULL,
  `firstInstallmentOffsetDays` INT NOT NULL,
  `gracePeriodDays` INT NOT NULL,
  `maxActiveEnrollmentsPerUser` INT NULL,
  `partialPaymentsAllowed` BOOLEAN NOT NULL,
  `overpaymentsAllowed` BOOLEAN NOT NULL,
  `eligibilityRules` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_versions_program_version_key` (`programId`, `version`),
  INDEX `program_versions_program_lifecycle_idx` (`programId`, `lifecycle`),
  INDEX `program_versions_effective_idx` (`lifecycle`, `effectiveFrom`, `effectiveTo`),
  CONSTRAINT `program_versions_programId_fkey`
    FOREIGN KEY (`programId`) REFERENCES `programs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_versions_amount_check`
    CHECK (`registrationFee` >= 0 AND `installmentAmount` >= 0),
  CONSTRAINT `program_versions_installment_check`
    CHECK (`installmentCount` >= 0 AND `installmentIntervalCount` >= 1),
  CONSTRAINT `program_versions_offset_grace_check`
    CHECK (`firstInstallmentOffsetDays` >= 0 AND `gracePeriodDays` >= 0),
  CONSTRAINT `program_versions_max_active_check`
    CHECK (`maxActiveEnrollmentsPerUser` IS NULL OR `maxActiveEnrollmentsPerUser` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_enrollments` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `programVersionId` CHAR(36) NOT NULL,
  `enrolledAt` DATETIME(3) NOT NULL,
  `enrollmentDate` CHAR(10) NOT NULL,
  `status` ENUM('ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `eligibilitySnapshot` JSON NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `registrationFeeSnapshot` DECIMAL(18,2) NOT NULL,
  `installmentAmountSnapshot` DECIMAL(18,2) NOT NULL,
  `installmentCountSnapshot` INT NOT NULL,
  `gracePeriodDaysSnapshot` INT NOT NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_enrollments_sourceKey_key` (`sourceKey`),
  INDEX `program_enrollments_user_status_idx` (`userId`, `status`, `enrolledAt`),
  INDEX `program_enrollments_version_status_idx` (`programVersionId`, `status`, `enrolledAt`),
  CONSTRAINT `program_enrollments_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_enrollments_programVersionId_fkey`
    FOREIGN KEY (`programVersionId`) REFERENCES `program_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_enrollments_snapshot_amount_check`
    CHECK (`registrationFeeSnapshot` >= 0 AND `installmentAmountSnapshot` >= 0),
  CONSTRAINT `program_enrollments_snapshot_count_check`
    CHECK (`installmentCountSnapshot` >= 0 AND `gracePeriodDaysSnapshot` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_installments` (
  `id` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `sequence` INT NOT NULL,
  `dueDate` CHAR(10) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_installments_enrollment_sequence_key` (`enrollmentId`, `sequence`),
  INDEX `program_installments_dueDate_idx` (`dueDate`),
  CONSTRAINT `program_installments_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_installments_sequence_amount_check`
    CHECK (`sequence` >= 1 AND `amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_payment_attempts` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `provider` VARCHAR(100) NULL,
  `providerReference` VARCHAR(191) NULL,
  `status` ENUM('INITIATED', 'CONFIRMED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'INITIATED',
  `initiatedAt` DATETIME(3) NOT NULL,
  `finalizedAt` DATETIME(3) NULL,
  `failureReason` VARCHAR(500) NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_payment_attempts_sourceKey_key` (`sourceKey`),
  INDEX `program_payment_attempts_enrollment_status_idx` (`enrollmentId`, `status`, `initiatedAt`),
  INDEX `program_payment_attempts_provider_reference_idx` (`provider`, `providerReference`),
  CONSTRAINT `program_payment_attempts_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_payment_attempts_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_payment_records` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `paymentAttemptId` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `provider` VARCHAR(100) NULL,
  `providerReference` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_payment_records_sourceKey_key` (`sourceKey`),
  UNIQUE INDEX `program_payment_records_paymentAttemptId_key` (`paymentAttemptId`),
  INDEX `program_payment_records_enrollment_time_idx` (`enrollmentId`, `occurredAt`),
  INDEX `program_payment_records_provider_reference_idx` (`provider`, `providerReference`),
  CONSTRAINT `program_payment_records_paymentAttemptId_fkey`
    FOREIGN KEY (`paymentAttemptId`) REFERENCES `program_payment_attempts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_payment_records_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_payment_records_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_payment_allocations` (
  `id` CHAR(36) NOT NULL,
  `paymentRecordId` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `allocationType` ENUM('REGISTRATION_FEE', 'INSTALLMENT', 'UNAPPLIED') NOT NULL,
  `installmentId` CHAR(36) NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `program_payment_allocations_payment_idx` (`paymentRecordId`, `createdAt`),
  INDEX `program_payment_allocations_enrollment_idx` (`enrollmentId`, `allocationType`, `createdAt`),
  INDEX `program_payment_allocations_installment_idx` (`installmentId`),
  CONSTRAINT `program_payment_allocations_paymentRecordId_fkey`
    FOREIGN KEY (`paymentRecordId`) REFERENCES `program_payment_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_payment_allocations_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_payment_allocations_installmentId_fkey`
    FOREIGN KEY (`installmentId`) REFERENCES `program_installments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_payment_allocations_amount_check` CHECK (`amount` > 0),
  CONSTRAINT `program_payment_allocations_target_check`
    CHECK ((`allocationType` = 'INSTALLMENT' AND `installmentId` IS NOT NULL) OR (`allocationType` <> 'INSTALLMENT' AND `installmentId` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_refund_records` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `paymentRecordId` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currencyCode` VARCHAR(3) NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `metadata` JSON NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_refund_records_sourceKey_key` (`sourceKey`),
  INDEX `program_refund_records_payment_time_idx` (`paymentRecordId`, `occurredAt`),
  INDEX `program_refund_records_enrollment_time_idx` (`enrollmentId`, `occurredAt`),
  CONSTRAINT `program_refund_records_paymentRecordId_fkey`
    FOREIGN KEY (`paymentRecordId`) REFERENCES `program_payment_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_refund_records_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_refund_records_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_refund_allocations` (
  `id` CHAR(36) NOT NULL,
  `refundRecordId` CHAR(36) NOT NULL,
  `paymentAllocationId` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `program_refund_allocations_refund_idx` (`refundRecordId`, `createdAt`),
  INDEX `program_refund_allocations_payment_allocation_idx` (`paymentAllocationId`, `createdAt`),
  CONSTRAINT `program_refund_allocations_refundRecordId_fkey`
    FOREIGN KEY (`refundRecordId`) REFERENCES `program_refund_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_refund_allocations_paymentAllocationId_fkey`
    FOREIGN KEY (`paymentAllocationId`) REFERENCES `program_payment_allocations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_refund_allocations_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_business_events` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `type` ENUM('ENROLLMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_CONFIRMED', 'ENROLLMENT_COMPLETED', 'ENROLLMENT_REOPENED') NOT NULL,
  `enrollmentId` CHAR(36) NOT NULL,
  `paymentRecordId` CHAR(36) NULL,
  `refundRecordId` CHAR(36) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_business_events_sourceKey_key` (`sourceKey`),
  INDEX `program_business_events_enrollment_time_idx` (`enrollmentId`, `occurredAt`),
  INDEX `program_business_events_type_time_idx` (`type`, `occurredAt`),
  INDEX `program_business_events_payment_idx` (`paymentRecordId`),
  INDEX `program_business_events_refund_idx` (`refundRecordId`),
  CONSTRAINT `program_business_events_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_business_events_paymentRecordId_fkey`
    FOREIGN KEY (`paymentRecordId`) REFERENCES `program_payment_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_business_events_refundRecordId_fkey`
    FOREIGN KEY (`refundRecordId`) REFERENCES `program_refund_records` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'program.read', 'Read programs and published commercial versions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.manage', 'Create and manage program commercial versions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.enrollment.read', 'Read program enrollments and installment schedules', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.enrollment.manage', 'Create and manage program enrollments', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.payment.read', 'Read program payment attempts and immutable payment records', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.payment.manage', 'Create and finalize program payment attempts', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.refund.read', 'Read immutable program refund records', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'program.refund.manage', 'Create program refund records and reversal allocations', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN (
    'program.read',
    'program.manage',
    'program.enrollment.read',
    'program.enrollment.manage',
    'program.payment.read',
    'program.payment.manage',
    'program.refund.read',
    'program.refund.manage'
  );
