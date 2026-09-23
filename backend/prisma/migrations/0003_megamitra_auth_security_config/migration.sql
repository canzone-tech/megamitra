ALTER TABLE `users`
  ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE `system_security_config` (
  `id` INT NOT NULL DEFAULT 1,
  `idleTimeoutMinutes` INT NOT NULL DEFAULT 30,
  `absoluteSessionTimeoutMinutes` INT NOT NULL DEFAULT 1440,
  `maxActiveSessions` INT NOT NULL DEFAULT 5,
  `maxFailedLoginAttempts` INT NOT NULL DEFAULT 5,
  `lockoutMinutes` INT NOT NULL DEFAULT 15,
  `refreshTokenRotationEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `updatedByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `system_security_config_updatedByUserId_idx` (`updatedByUserId`),

  CONSTRAINT `system_security_config_updatedByUserId_fkey`
    FOREIGN KEY (`updatedByUserId`)
    REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  CONSTRAINT `system_security_config_singleton_check`
    CHECK (`id` = 1),

  CONSTRAINT `system_security_config_idle_timeout_check`
    CHECK (`idleTimeoutMinutes` > 0),

  CONSTRAINT `system_security_config_absolute_timeout_check`
    CHECK (`absoluteSessionTimeoutMinutes` >= `idleTimeoutMinutes`),

  CONSTRAINT `system_security_config_active_sessions_check`
    CHECK (`maxActiveSessions` > 0),

  CONSTRAINT `system_security_config_failed_attempts_check`
    CHECK (`maxFailedLoginAttempts` > 0),

  CONSTRAINT `system_security_config_lockout_check`
    CHECK (`lockoutMinutes` > 0)
)
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;


CREATE TABLE `system_auth_config` (
  `id` INT NOT NULL DEFAULT 1,
  `loginWithUsername` BOOLEAN NOT NULL DEFAULT TRUE,
  `loginWithEmail` BOOLEAN NOT NULL DEFAULT TRUE,
  `loginWithMobile` BOOLEAN NOT NULL DEFAULT TRUE,
  `captchaOnLoginEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `captchaOnRegistrationEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `accessTokenTtlSeconds` INT NOT NULL DEFAULT 900,
  `refreshTokenTtlSeconds` INT NOT NULL DEFAULT 2592000,
  `updatedByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `system_auth_config_updatedByUserId_idx` (`updatedByUserId`),

  CONSTRAINT `system_auth_config_updatedByUserId_fkey`
    FOREIGN KEY (`updatedByUserId`)
    REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  CONSTRAINT `system_auth_config_singleton_check`
    CHECK (`id` = 1),

  CONSTRAINT `system_auth_config_login_method_check`
    CHECK (
      `loginWithUsername` = TRUE OR
      `loginWithEmail` = TRUE OR
      `loginWithMobile` = TRUE
    ),

  CONSTRAINT `system_auth_config_access_ttl_check`
    CHECK (`accessTokenTtlSeconds` > 0),

  CONSTRAINT `system_auth_config_refresh_ttl_check`
    CHECK (`refreshTokenTtlSeconds` > `accessTokenTtlSeconds`)
)
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;


CREATE TABLE `system_registration_config` (
  `id` INT NOT NULL DEFAULT 1,
  `publicRegistrationEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `emailRequired` BOOLEAN NOT NULL DEFAULT TRUE,
  `mobileRequired` BOOLEAN NOT NULL DEFAULT FALSE,
  `passwordMode` ENUM('AUTO', 'MANUAL', 'AUTO_OR_MANUAL')
    NOT NULL DEFAULT 'MANUAL',
  `usernameMode` ENUM('AUTO', 'MANUAL', 'AUTO_OR_MANUAL')
    NOT NULL DEFAULT 'AUTO_OR_MANUAL',
  `usernamePrefixEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `usernamePrefix` VARCHAR(20) NULL,
  `allowMultipleAccountsPerEmail` BOOLEAN NOT NULL DEFAULT FALSE,
  `allowMultipleAccountsPerMobile` BOOLEAN NOT NULL DEFAULT FALSE,
  `updatedByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `system_registration_config_updatedByUserId_idx`
    (`updatedByUserId`),

  CONSTRAINT `system_registration_config_updatedByUserId_fkey`
    FOREIGN KEY (`updatedByUserId`)
    REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  CONSTRAINT `system_registration_config_singleton_check`
    CHECK (`id` = 1),

  CONSTRAINT `system_registration_config_prefix_check`
    CHECK (
      `usernamePrefixEnabled` = FALSE
      OR (
        `usernamePrefix` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`usernamePrefix`)) BETWEEN 1 AND 20
      )
    )
)
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;


INSERT INTO `system_security_config` (`id`)
VALUES (1);

INSERT INTO `system_auth_config` (`id`)
VALUES (1);

INSERT INTO `system_registration_config` (`id`)
VALUES (1);
