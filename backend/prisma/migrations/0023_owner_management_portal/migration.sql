-- Owner-facing management portal support for the final client reference workflow.
-- Financial truth remains in the existing program, binary, referral, draw and ledger tables.

CREATE TABLE `owner_seasons` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `startDate` DATE NOT NULL,
  `endDate` DATE NULL,
  `drawDay` TINYINT UNSIGNED NOT NULL,
  `eligibilityCutoff` VARCHAR(40) NOT NULL DEFAULT 'BEFORE_DRAW_DATE',
  `programId` CHAR(36) NULL,
  `programVersionId` CHAR(36) NULL,
  `binaryPlanId` CHAR(36) NULL,
  `binaryPlanVersionId` CHAR(36) NULL,
  `referralPolicyId` CHAR(36) NULL,
  `referralPolicyVersionId` CHAR(36) NULL,
  `drawPolicyId` CHAR(36) NULL,
  `drawPolicyVersionId` CHAR(36) NULL,
  `createdByUserId` CHAR(36) NULL,
  `reviewedByUserId` CHAR(36) NULL,
  `activatedByUserId` CHAR(36) NULL,
  `closedByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `owner_seasons_code_key` (`code`),
  INDEX `owner_seasons_status_idx` (`status`, `startDate`),
  CONSTRAINT `owner_seasons_draw_day_check` CHECK (`drawDay` BETWEEN 1 AND 31)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_season_prizes` (
  `id` CHAR(36) NOT NULL,
  `seasonId` CHAR(36) NOT NULL,
  `monthNumber` INT UNSIGNED NOT NULL,
  `prizeCode` VARCHAR(50) NOT NULL,
  `category` VARCHAR(80) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(255) NULL,
  `winnerCount` INT UNSIGNED NOT NULL DEFAULT 1,
  `nominalValue` DECIMAL(18,2) NULL,
  `currencyCode` CHAR(3) NOT NULL DEFAULT 'INR',
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `owner_season_prizes_month_code_key` (`seasonId`, `monthNumber`, `prizeCode`),
  INDEX `owner_season_prizes_season_month_idx` (`seasonId`, `monthNumber`),
  CONSTRAINT `owner_season_prizes_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `owner_seasons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `member_profiles` (
  `userId` CHAR(36) NOT NULL,
  `dateOfBirth` DATE NULL,
  `state` VARCHAR(100) NULL,
  `city` VARCHAR(100) NULL,
  `memberType` VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `member_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_epins` (
  `id` CHAR(36) NOT NULL,
  `pinHash` CHAR(64) NOT NULL,
  `displaySuffix` VARCHAR(6) NOT NULL,
  `seasonId` CHAR(36) NULL,
  `assignedUserId` CHAR(36) NULL,
  `usedByUserId` CHAR(36) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdByUserId` CHAR(36) NULL,
  `revokedByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `owner_epins_pinHash_key` (`pinHash`),
  INDEX `owner_epins_status_expiry_idx` (`status`, `expiresAt`),
  INDEX `owner_epins_assigned_idx` (`assignedUserId`, `status`),
  CONSTRAINT `owner_epins_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `owner_seasons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `owner_epins_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `owner_epins_usedByUserId_fkey` FOREIGN KEY (`usedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_auth_codes` (
  `id` CHAR(36) NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `displaySuffix` VARCHAR(6) NOT NULL,
  `roleScope` VARCHAR(40) NOT NULL,
  `purpose` VARCHAR(60) NOT NULL,
  `operatorUserId` CHAR(36) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `owner_auth_codes_codeHash_key` (`codeHash`),
  INDEX `owner_auth_codes_lookup_idx` (`purpose`, `status`, `expiresAt`),
  CONSTRAINT `owner_auth_codes_operatorUserId_fkey` FOREIGN KEY (`operatorUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_notifications` (
  `id` CHAR(36) NOT NULL,
  `audience` VARCHAR(60) NOT NULL,
  `channel` VARCHAR(30) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `message` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `scheduledAt` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `owner_notifications_status_idx` (`status`, `scheduledAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_support_tickets` (
  `id` CHAR(36) NOT NULL,
  `ticketNumber` VARCHAR(32) NOT NULL,
  `memberUserId` CHAR(36) NULL,
  `memberReference` VARCHAR(191) NULL,
  `category` VARCHAR(50) NOT NULL,
  `priority` VARCHAR(20) NOT NULL,
  `contact` VARCHAR(191) NULL,
  `description` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `assignedUserId` CHAR(36) NULL,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `owner_support_tickets_number_key` (`ticketNumber`),
  INDEX `owner_support_tickets_status_priority_idx` (`status`, `priority`, `createdAt`),
  CONSTRAINT `owner_support_tickets_memberUserId_fkey` FOREIGN KEY (`memberUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `owner_support_tickets_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_portal_settings` (
  `id` TINYINT UNSIGNED NOT NULL,
  `companyName` VARCHAR(160) NOT NULL,
  `timezone` VARCHAR(100) NOT NULL,
  `currencyCode` CHAR(3) NOT NULL,
  `defaultLanguage` VARCHAR(20) NOT NULL,
  `updatedByUserId` CHAR(36) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `owner_portal_settings_singleton_check` CHECK (`id` = 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `owner_portal_settings` (`id`, `companyName`, `timezone`, `currencyCode`, `defaultLanguage`)
VALUES (1, 'MegaGoldenClub', 'Asia/Kolkata', 'INR', 'English');
