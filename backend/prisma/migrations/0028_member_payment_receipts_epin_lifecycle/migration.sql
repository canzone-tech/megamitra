-- Member QR/UPI payment submissions, public receipts and paid E-PIN lifecycle.
-- Financial program truth remains in program_payment_* tables after verification.

CREATE TABLE `owner_payment_settings` (
  `id` TINYINT UNSIGNED NOT NULL,
  `upiId` VARCHAR(191) NULL,
  `payeeName` VARCHAR(160) NULL,
  `qrImageDataUrl` MEDIUMTEXT NULL,
  `instructions` VARCHAR(1000) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `updatedByUserId` CHAR(36) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `owner_payment_settings_singleton_check` CHECK (`id` = 1),
  CONSTRAINT `owner_payment_settings_updatedByUserId_fkey`
    FOREIGN KEY (`updatedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `owner_payment_settings` (`id`, `enabled`) VALUES (1, FALSE);

ALTER TABLE `owner_seasons`
  ADD COLUMN `registrationClosesAt` DATETIME(3) NULL AFTER `endDate`;

CREATE TABLE `member_payment_submissions` (
  `id` CHAR(36) NOT NULL,
  `receiptNumber` VARCHAR(40) NOT NULL,
  `publicToken` CHAR(64) NOT NULL,
  `purpose` VARCHAR(30) NOT NULL,
  `requesterUserId` CHAR(36) NOT NULL,
  `seasonId` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NULL,
  `epinQuantity` INT UNSIGNED NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currencyCode` CHAR(3) NOT NULL,
  `provider` VARCHAR(40) NOT NULL DEFAULT 'UPI_MANUAL',
  `providerReference` VARCHAR(191) NOT NULL,
  `paymentProofDataUrl` MEDIUMTEXT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING_VERIFICATION',
  `details` JSON NULL,
  `reviewedByUserId` CHAR(36) NULL,
  `reviewNote` VARCHAR(1000) NULL,
  `programPaymentAttemptId` CHAR(36) NULL,
  `programPaymentRecordId` CHAR(36) NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `member_payment_submissions_receipt_key` (`receiptNumber`),
  UNIQUE INDEX `member_payment_submissions_public_token_key` (`publicToken`),
  UNIQUE INDEX `member_payment_submissions_provider_reference_key` (`providerReference`),
  INDEX `member_payment_submissions_requester_idx` (`requesterUserId`, `submittedAt`),
  INDEX `member_payment_submissions_status_idx` (`status`, `purpose`, `submittedAt`),
  INDEX `member_payment_submissions_season_idx` (`seasonId`, `purpose`, `submittedAt`),
  CONSTRAINT `member_payment_submissions_requester_fkey`
    FOREIGN KEY (`requesterUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submissions_season_fkey`
    FOREIGN KEY (`seasonId`) REFERENCES `owner_seasons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submissions_enrollment_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `program_enrollments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submissions_reviewer_fkey`
    FOREIGN KEY (`reviewedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submissions_attempt_fkey`
    FOREIGN KEY (`programPaymentAttemptId`) REFERENCES `program_payment_attempts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submissions_record_fkey`
    FOREIGN KEY (`programPaymentRecordId`) REFERENCES `program_payment_records` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submissions_amount_check` CHECK (`amount` > 0),
  CONSTRAINT `member_payment_submissions_epin_quantity_check`
    CHECK (`epinQuantity` IS NULL OR `epinQuantity` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `member_payment_submission_events` (
  `id` CHAR(36) NOT NULL,
  `submissionId` CHAR(36) NOT NULL,
  `eventType` VARCHAR(40) NOT NULL,
  `actorUserId` CHAR(36) NULL,
  `metadata` JSON NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `member_payment_submission_events_submission_idx` (`submissionId`, `occurredAt`),
  CONSTRAINT `member_payment_submission_events_submission_fkey`
    FOREIGN KEY (`submissionId`) REFERENCES `member_payment_submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `member_payment_submission_events_actor_fkey`
    FOREIGN KEY (`actorUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `owner_epins`
  ADD COLUMN `paymentSubmissionId` CHAR(36) NULL AFTER `displaySuffix`,
  ADD COLUMN `pinCiphertext` TEXT NULL AFTER `paymentSubmissionId`,
  ADD COLUMN `currencyCodeSnapshot` CHAR(3) NULL AFTER `seasonId`,
  ADD COLUMN `registrationFeeSnapshot` DECIMAL(18,2) NULL AFTER `currencyCodeSnapshot`,
  ADD COLUMN `installmentAmountSnapshot` DECIMAL(18,2) NULL AFTER `registrationFeeSnapshot`,
  ADD COLUMN `assignedAt` DATETIME(3) NULL AFTER `assignedUserId`,
  ADD COLUMN `cancelledAt` DATETIME(3) NULL AFTER `revokedAt`,
  ADD COLUMN `cancelledByUserId` CHAR(36) NULL AFTER `revokedByUserId`,
  ADD COLUMN `cancellationReason` VARCHAR(500) NULL AFTER `cancelledByUserId`,
  ADD COLUMN `refundAmount` DECIMAL(18,2) NULL AFTER `cancellationReason`,
  ADD COLUMN `refundReference` VARCHAR(191) NULL AFTER `refundAmount`,
  ADD INDEX `owner_epins_payment_submission_idx` (`paymentSubmissionId`),
  ADD CONSTRAINT `owner_epins_paymentSubmissionId_fkey`
    FOREIGN KEY (`paymentSubmissionId`) REFERENCES `member_payment_submissions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `owner_epins_cancelledByUserId_fkey`
    FOREIGN KEY (`cancelledByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `owner_epins_refund_amount_check`
    CHECK (`refundAmount` IS NULL OR `refundAmount` >= 0);

CREATE TABLE `owner_income_module_settings` (
  `seasonId` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `config` JSON NULL,
  `updatedByUserId` CHAR(36) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`seasonId`, `code`),
  CONSTRAINT `owner_income_module_settings_season_fkey`
    FOREIGN KEY (`seasonId`) REFERENCES `owner_seasons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `owner_income_module_settings_updatedBy_fkey`
    FOREIGN KEY (`updatedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `owner_income_module_settings` (`seasonId`, `code`, `enabled`, `config`)
SELECT s.id, modules.code, FALSE, JSON_OBJECT('status', 'RULE_PENDING')
FROM `owner_seasons` s
CROSS JOIN (
  SELECT 'LEADERSHIP' AS code
  UNION ALL SELECT 'RECOGNITION'
  UNION ALL SELECT 'RETAIL_SALES'
  UNION ALL SELECT 'COMMUNITY_POOL'
) modules;

CREATE TABLE `owner_nonwinner_product_packages` (
  `seasonId` CHAR(36) NOT NULL,
  `nominalValue` DECIMAL(18,2) NOT NULL DEFAULT 21000.00,
  `currencyCode` CHAR(3) NOT NULL DEFAULT 'INR',
  `packageName` VARCHAR(160) NULL,
  `packageDefinition` JSON NULL,
  `cashAlternativeAllowed` BOOLEAN NOT NULL DEFAULT FALSE,
  `updatedByUserId` CHAR(36) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`seasonId`),
  CONSTRAINT `owner_nonwinner_product_packages_season_fkey`
    FOREIGN KEY (`seasonId`) REFERENCES `owner_seasons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `owner_nonwinner_product_packages_updatedBy_fkey`
    FOREIGN KEY (`updatedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `owner_nonwinner_product_packages_value_check` CHECK (`nominalValue` >= 0),
  CONSTRAINT `owner_nonwinner_product_packages_no_cash_check` CHECK (`cashAlternativeAllowed` = FALSE)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `owner_nonwinner_product_packages` (`seasonId`, `currencyCode`)
SELECT s.id, COALESCE(pv.currencyCode, 'INR')
FROM `owner_seasons` s
LEFT JOIN `program_versions` pv ON pv.id=s.programVersionId;
