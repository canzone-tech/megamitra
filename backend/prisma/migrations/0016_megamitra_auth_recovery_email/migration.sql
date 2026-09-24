ALTER TABLE `system_auth_config`
  ADD COLUMN `passwordResetEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `passwordResetTokenTtlMinutes` INT NOT NULL DEFAULT 30,
  ADD COLUMN `passwordResetRequestWindowMinutes` INT NOT NULL DEFAULT 15,
  ADD COLUMN `passwordResetMaxRequestsPerWindow` INT NOT NULL DEFAULT 5,
  ADD COLUMN `emailVerificationEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `emailVerificationRequiredForLogin` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `emailVerificationTokenTtlMinutes` INT NOT NULL DEFAULT 1440,
  ADD COLUMN `emailVerificationRequestWindowMinutes` INT NOT NULL DEFAULT 15,
  ADD COLUMN `emailVerificationMaxRequestsPerWindow` INT NOT NULL DEFAULT 5,
  ADD COLUMN `emailChangeEnabled` BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE `system_auth_config`
  ADD CONSTRAINT `system_auth_config_password_reset_ttl_check`
    CHECK (`passwordResetTokenTtlMinutes` BETWEEN 5 AND 1440),
  ADD CONSTRAINT `system_auth_config_password_reset_window_check`
    CHECK (`passwordResetRequestWindowMinutes` BETWEEN 1 AND 1440),
  ADD CONSTRAINT `system_auth_config_password_reset_limit_check`
    CHECK (`passwordResetMaxRequestsPerWindow` BETWEEN 1 AND 100),
  ADD CONSTRAINT `system_auth_config_email_verification_ttl_check`
    CHECK (`emailVerificationTokenTtlMinutes` BETWEEN 5 AND 10080),
  ADD CONSTRAINT `system_auth_config_email_verification_window_check`
    CHECK (`emailVerificationRequestWindowMinutes` BETWEEN 1 AND 1440),
  ADD CONSTRAINT `system_auth_config_email_verification_limit_check`
    CHECK (`emailVerificationMaxRequestsPerWindow` BETWEEN 1 AND 100),
  ADD CONSTRAINT `system_auth_config_email_required_implies_enabled_check`
    CHECK (`emailVerificationRequiredForLogin` = FALSE OR `emailVerificationEnabled` = TRUE);

CREATE TABLE `auth_action_tokens` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `purpose` ENUM('PASSWORD_RESET', 'EMAIL_VERIFICATION', 'EMAIL_CHANGE') NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `pendingEmail` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `invalidatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_action_tokens_tokenHash_key` (`tokenHash`),
  KEY `auth_action_tokens_user_purpose_created_idx` (`userId`, `purpose`, `createdAt`),
  KEY `auth_action_tokens_expiry_idx` (`expiresAt`),
  KEY `auth_action_tokens_pending_email_idx` (`pendingEmail`),

  CONSTRAINT `auth_action_tokens_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `auth_action_tokens_pending_email_shape_check`
    CHECK (
      (`purpose` = 'EMAIL_CHANGE' AND `pendingEmail` IS NOT NULL)
      OR (`purpose` <> 'EMAIL_CHANGE' AND `pendingEmail` IS NULL)
    )
)
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auth_email_template_versions` (
  `id` CHAR(36) NOT NULL,
  `purpose` ENUM('PASSWORD_RESET', 'EMAIL_VERIFICATION', 'EMAIL_CHANGE') NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  `subjectTemplate` VARCHAR(255) NOT NULL,
  `textTemplate` TEXT NOT NULL,
  `htmlTemplate` MEDIUMTEXT NULL,
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_email_template_versions_purpose_version_key` (`purpose`, `version`),
  KEY `auth_email_template_versions_effective_idx` (`purpose`, `lifecycle`, `effectiveFrom`, `effectiveTo`),
  KEY `auth_email_template_versions_created_by_idx` (`createdByUserId`),

  CONSTRAINT `auth_email_template_versions_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `auth_email_template_versions_publishedByUserId_fkey`
    FOREIGN KEY (`publishedByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `auth_email_template_versions_retiredByUserId_fkey`
    FOREIGN KEY (`retiredByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `auth_email_template_versions_version_check`
    CHECK (`version` > 0),
  CONSTRAINT `auth_email_template_versions_effective_check`
    CHECK (`effectiveTo` IS NULL OR `effectiveTo` > `effectiveFrom`)
)
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

INSERT INTO `auth_email_template_versions` (
  `id`, `purpose`, `version`, `lifecycle`, `subjectTemplate`, `textTemplate`, `htmlTemplate`,
  `effectiveFrom`, `publishedAt`, `createdAt`, `updatedAt`
)
VALUES
  (
    UUID(), 'PASSWORD_RESET', 1, 'PUBLISHED',
    'Reset your MegaMitra password',
    'Hello {{username}},\n\nUse this secure link to reset your MegaMitra password:\n{{actionUrl}}\n\nThis link expires in {{expiresInMinutes}} minutes. If you did not request this, you can ignore this email.',
    '<p>Hello {{username}},</p><p>Use this secure link to reset your MegaMitra password:</p><p><a href="{{actionUrl}}">Reset password</a></p><p>This link expires in {{expiresInMinutes}} minutes. If you did not request this, you can ignore this email.</p>',
    '1970-01-01 00:00:00.000', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  ),
  (
    UUID(), 'EMAIL_VERIFICATION', 1, 'PUBLISHED',
    'Verify your MegaMitra email',
    'Hello {{username}},\n\nVerify your email address using this secure link:\n{{actionUrl}}\n\nThis link expires in {{expiresInMinutes}} minutes.',
    '<p>Hello {{username}},</p><p>Verify your email address using this secure link:</p><p><a href="{{actionUrl}}">Verify email</a></p><p>This link expires in {{expiresInMinutes}} minutes.</p>',
    '1970-01-01 00:00:00.000', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  ),
  (
    UUID(), 'EMAIL_CHANGE', 1, 'PUBLISHED',
    'Confirm your new MegaMitra email',
    'Hello {{username}},\n\nConfirm {{pendingEmail}} as your new MegaMitra email address:\n{{actionUrl}}\n\nThis link expires in {{expiresInMinutes}} minutes.',
    '<p>Hello {{username}},</p><p>Confirm <strong>{{pendingEmail}}</strong> as your new MegaMitra email address:</p><p><a href="{{actionUrl}}">Confirm new email</a></p><p>This link expires in {{expiresInMinutes}} minutes.</p>',
    '1970-01-01 00:00:00.000', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  );

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'auth.email-template.read', 'Read versioned authentication email templates', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'auth.email-template.manage', 'Manage versioned authentication email templates', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('auth.email-template.read', 'auth.email-template.manage');
