ALTER TABLE `system_security_config`
  ADD COLUMN `passwordMinLength` INT NOT NULL DEFAULT 12,
  ADD COLUMN `passwordMaxLength` INT NOT NULL DEFAULT 128,
  ADD CONSTRAINT `system_security_config_password_min_check`
    CHECK (`passwordMinLength` >= 8),
  ADD CONSTRAINT `system_security_config_password_max_check`
    CHECK (`passwordMaxLength` <= 256),
  ADD CONSTRAINT `system_security_config_password_range_check`
    CHECK (`passwordMaxLength` >= `passwordMinLength`);

ALTER TABLE `system_registration_config`
  ADD COLUMN `defaultRoleName` VARCHAR(100) NOT NULL DEFAULT 'MEMBER',
  ADD INDEX `system_registration_config_defaultRoleName_idx` (`defaultRoleName`),
  ADD CONSTRAINT `system_registration_config_defaultRoleName_fkey`
    FOREIGN KEY (`defaultRoleName`)
    REFERENCES `roles` (`name`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE `auth_sessions`
  ADD COLUMN `lastSeenAt` DATETIME(3) NULL,
  ADD COLUMN `absoluteExpiresAt` DATETIME(3) NULL;

-- Sessions created before this migration did not carry enough information to
-- enforce the new idle/absolute policy reliably. Revoke them rather than
-- silently extending their lifetime.
UPDATE `auth_sessions`
SET `revocationReason` = COALESCE(`revocationReason`, 'security_policy_upgrade')
WHERE `revokedAt` IS NULL;

UPDATE `auth_sessions`
SET
  `revokedAt` = COALESCE(`revokedAt`, CURRENT_TIMESTAMP(3)),
  `lastSeenAt` = `createdAt`,
  `absoluteExpiresAt` = `createdAt`;

ALTER TABLE `auth_sessions`
  MODIFY COLUMN `lastSeenAt` DATETIME(3) NOT NULL,
  MODIFY COLUMN `absoluteExpiresAt` DATETIME(3) NOT NULL;

CREATE INDEX `auth_sessions_absoluteExpiresAt_idx`
  ON `auth_sessions` (`absoluteExpiresAt`);

CREATE INDEX `auth_sessions_userId_lastSeenAt_idx`
  ON `auth_sessions` (`userId`, `lastSeenAt`);
