CREATE TABLE `lucky_draw_tokens` (
  `token` CHAR(5) NOT NULL,
  `sourceType` ENUM('INSTALLMENT','DRAW_ENTRY') NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `enrollmentId` CHAR(36) NULL,
  `installmentId` CHAR(36) NULL,
  `installmentSequence` INT NULL,
  `paymentRecordId` CHAR(36) NULL,
  `paymentAllocationId` CHAR(36) NULL,
  `paymentSubmissionId` CHAR(36) NULL,
  `drawId` CHAR(36) NULL,
  `entryId` CHAR(36) NULL,
  `status` ENUM('AVAILABLE','USED','RETIRED') NOT NULL DEFAULT 'AVAILABLE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `usedAt` DATETIME(3) NULL,
  PRIMARY KEY (`token`),
  UNIQUE INDEX `lucky_draw_tokens_allocation_key` (`paymentAllocationId`),
  UNIQUE INDEX `lucky_draw_tokens_installment_key` (`enrollmentId`, `installmentId`),
  UNIQUE INDEX `lucky_draw_tokens_entry_key` (`entryId`),
  INDEX `lucky_draw_tokens_submission_idx` (`paymentSubmissionId`, `installmentSequence`),
  INDEX `lucky_draw_tokens_enrollment_idx` (`enrollmentId`, `installmentSequence`, `status`),
  INDEX `lucky_draw_tokens_draw_idx` (`drawId`, `status`),
  CONSTRAINT `lucky_draw_tokens_format_check` CHECK (`token` REGEXP '^[1-9][0-9]{4}$'),
  CONSTRAINT `lucky_draw_tokens_installment_sequence_check` CHECK (`installmentSequence` IS NULL OR `installmentSequence` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Related identifiers deliberately have no cascading foreign keys. A token is a permanent
-- historical identifier and must survive cancellation, archival, or cleanup of its source row.
-- The primary key is the global never-reuse guarantee across every session and draw.

ALTER TABLE `lucky_draw_entries`
  ADD COLUMN `drawToken` CHAR(5) NULL AFTER `entrySequence`,
  ADD UNIQUE INDEX `lucky_draw_entries_draw_token_key` (`drawToken`),
  ADD CONSTRAINT `lucky_draw_entries_draw_token_format_check`
    CHECK (`drawToken` IS NULL OR `drawToken` REGEXP '^[1-9][0-9]{4}$');
