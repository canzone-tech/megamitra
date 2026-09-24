CREATE TABLE `presentation_definitions` (
  `id` CHAR(36) NOT NULL,
  `kind` ENUM('THEME', 'TEMPLATE', 'CMS') NOT NULL,
  `surface` ENUM('PUBLIC', 'AUTH', 'MEMBER', 'ADMIN') NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `presentation_definitions_code_key` (`code`),
  INDEX `presentation_definitions_kind_surface_default_idx` (`kind`, `surface`, `isDefault`),
  CONSTRAINT `presentation_definitions_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `presentation_versions` (
  `id` CHAR(36) NOT NULL,
  `definitionId` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `lifecycle` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  `mongoDocumentKey` VARCHAR(191) NOT NULL,
  `contentChecksum` CHAR(64) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `publishedByUserId` CHAR(36) NULL,
  `retiredByUserId` CHAR(36) NULL,
  `publishedAt` DATETIME(3) NULL,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `presentation_versions_definition_version_key` (`definitionId`, `version`),
  UNIQUE INDEX `presentation_versions_mongoDocumentKey_key` (`mongoDocumentKey`),
  INDEX `presentation_versions_definition_lifecycle_idx` (`definitionId`, `lifecycle`),
  INDEX `presentation_versions_lifecycle_publishedAt_idx` (`lifecycle`, `publishedAt`),
  CONSTRAINT `presentation_versions_definitionId_fkey`
    FOREIGN KEY (`definitionId`) REFERENCES `presentation_definitions` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `presentation_versions_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `presentation_versions_publishedByUserId_fkey`
    FOREIGN KEY (`publishedByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `presentation_versions_retiredByUserId_fkey`
    FOREIGN KEY (`retiredByUserId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
)
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'presentation.read', 'Read theme, template and CMS presentation configuration', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'presentation.manage', 'Manage and publish theme, template and CMS presentation configuration', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` IN ('presentation.read', 'presentation.manage');

INSERT INTO `presentation_definitions` (
  `id`, `kind`, `surface`, `code`, `name`, `description`, `isDefault`, `createdAt`, `updatedAt`
)
SELECT UUID(), 'THEME', 'MEMBER', 'MEMBER_PORTAL_THEME', 'Member Portal Theme',
       'Versioned visual tokens for the MegaMitra member portal', TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `presentation_definitions` WHERE `code` = 'MEMBER_PORTAL_THEME');

INSERT INTO `presentation_definitions` (
  `id`, `kind`, `surface`, `code`, `name`, `description`, `isDefault`, `createdAt`, `updatedAt`
)
SELECT UUID(), 'TEMPLATE', 'MEMBER', 'MEMBER_PORTAL_TEMPLATE', 'Member Portal Template',
       'Versioned shell layout for sidebar, topbar, content and mobile navigation', TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `presentation_definitions` WHERE `code` = 'MEMBER_PORTAL_TEMPLATE');

INSERT INTO `presentation_definitions` (
  `id`, `kind`, `surface`, `code`, `name`, `description`, `isDefault`, `createdAt`, `updatedAt`
)
SELECT UUID(), 'CMS', 'MEMBER', 'MEMBER_PORTAL_COPY', 'Member Portal Copy',
       'Versioned presentation copy for the member dashboard; no business values or financial rules', TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `presentation_definitions` WHERE `code` = 'MEMBER_PORTAL_COPY');
