CREATE TABLE `owner_winner_verifications` (
  `winnerId` CHAR(36) NOT NULL,
  `drawRunId` CHAR(36) NOT NULL,
  `eligibilityStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `identityStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `paymentStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `verifiedByUserId` CHAR(36) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`winnerId`),
  INDEX `owner_winner_verifications_run_status_idx` (`drawRunId`, `status`),
  CONSTRAINT `owner_winner_verifications_winnerId_fkey` FOREIGN KEY (`winnerId`) REFERENCES `lucky_draw_winners` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `owner_winner_verifications_drawRunId_fkey` FOREIGN KEY (`drawRunId`) REFERENCES `owner_draw_runs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `owner_winner_verifications_verifiedByUserId_fkey` FOREIGN KEY (`verifiedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
