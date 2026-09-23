ALTER TABLE `users`
  ADD COLUMN `failedLoginAttempts` INT NOT NULL DEFAULT 0,
  ADD COLUMN `lockedUntil` DATETIME(3) NULL;

ALTER TABLE `system_auth_config`
  ADD COLUMN `captchaTtlSeconds` INT NOT NULL DEFAULT 300,
  ADD CONSTRAINT `system_auth_config_captcha_ttl_check`
    CHECK (`captchaTtlSeconds` > 0);

CREATE TABLE `user_identifier_claims` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `type` ENUM('EMAIL', 'MOBILE') NOT NULL,
  `normalizedValue` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_identifier_claims_type_normalizedValue_key` (`type`, `normalizedValue`),
  INDEX `user_identifier_claims_userId_type_idx` (`userId`, `type`),
  CONSTRAINT `user_identifier_claims_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_sequences` (
  `key` VARCHAR(100) NOT NULL,
  `nextValue` BIGINT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  CONSTRAINT `system_sequences_next_value_check` CHECK (`nextValue` >= 0)
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `system_sequences` (`key`, `nextValue`, `updatedAt`)
VALUES ('username', 100000, CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);

INSERT INTO `roles` (`id`, `name`, `description`, `status`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'SUPER_ADMIN', 'MegaMitra unrestricted platform administration', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'ADMIN', 'MegaMitra delegated administration', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'MEMBER', 'MegaMitra member account', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'users.read', 'Read users', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'users.manage', 'Manage user account state', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'users.roles.manage', 'Manage user role assignments', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'rbac.read', 'Read roles and permissions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'rbac.manage', 'Manage roles and role permissions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform.config.read', 'Read platform authentication and security configuration', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform.config.manage', 'Manage platform authentication and security configuration', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'audit.read', 'Read audit history', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'auth.sessions.manage', 'Manage authentication sessions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN';
