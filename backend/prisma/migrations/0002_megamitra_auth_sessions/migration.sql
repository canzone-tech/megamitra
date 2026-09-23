CREATE TABLE `auth_sessions` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `refreshTokenHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `revocationReason` VARCHAR(100) NULL,
  `rotatedToSessionId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),

  UNIQUE INDEX `auth_sessions_refreshTokenHash_key`
    (`refreshTokenHash`),

  INDEX `auth_sessions_userId_revokedAt_idx`
    (`userId`, `revokedAt`),

  INDEX `auth_sessions_expiresAt_idx`
    (`expiresAt`),

  CONSTRAINT `auth_sessions_userId_fkey`
    FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
)
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
