-- MegaGoldenClub account access model: SUPER_ADMIN, ADMIN, AGENT, MEMBER.
-- member_profiles.memberType is retained only for backward compatibility with historical data;
-- all active registration flows now treat the account role as the source of truth.

INSERT INTO `roles` (`id`, `name`, `description`, `status`, `createdAt`, `updatedAt`)
VALUES (
  UUID(),
  'AGENT',
  'MegaGoldenClub delegated agent account; permissions are assigned through RBAC',
  'ACTIVE',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `status` = 'ACTIVE',
  `updatedAt` = CURRENT_TIMESTAMP(3);

UPDATE `member_profiles`
SET `memberType` = 'MEMBER'
WHERE `memberType` <> 'MEMBER';

ALTER TABLE `member_profiles`
  MODIFY COLUMN `memberType` VARCHAR(30) NOT NULL DEFAULT 'MEMBER';

UPDATE `system_registration_config`
SET `defaultRoleName` = 'MEMBER', `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` = 1;
