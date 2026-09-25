-- MegaGoldenClub brand transition.
-- Prior migrations remain immutable. This migration updates mutable display metadata
-- and creates new published email-template versions instead of rewriting published history.

UPDATE `roles`
SET `description` = REPLACE(`description`, 'MegaMitra', 'MegaGoldenClub'),
    `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `description` LIKE '%MegaMitra%';

UPDATE `kyc_policies`
SET `name` = REPLACE(`name`, 'MegaMitra', 'MegaGoldenClub'),
    `description` = REPLACE(`description`, 'MegaMitra', 'MegaGoldenClub'),
    `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `name` LIKE '%MegaMitra%' OR `description` LIKE '%MegaMitra%';

UPDATE `withdrawal_policies`
SET `name` = REPLACE(`name`, 'MegaMitra', 'MegaGoldenClub'),
    `description` = REPLACE(`description`, 'MegaMitra', 'MegaGoldenClub'),
    `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `name` LIKE '%MegaMitra%' OR `description` LIKE '%MegaMitra%';

UPDATE `catalog_products`
SET `name` = REPLACE(`name`, 'MegaMitra', 'MegaGoldenClub'),
    `description` = REPLACE(`description`, 'MegaMitra', 'MegaGoldenClub'),
    `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `name` LIKE '%MegaMitra%' OR `description` LIKE '%MegaMitra%';

UPDATE `presentation_definitions`
SET `name` = REPLACE(`name`, 'MegaMitra', 'MegaGoldenClub'),
    `description` = REPLACE(`description`, 'MegaMitra', 'MegaGoldenClub'),
    `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `name` LIKE '%MegaMitra%' OR `description` LIKE '%MegaMitra%';

CREATE TEMPORARY TABLE `brand_email_template_sources` AS
SELECT
  t.`id`,
  t.`purpose`,
  t.`subjectTemplate`,
  t.`textTemplate`,
  t.`htmlTemplate`,
  t.`createdByUserId`,
  (
    SELECT COALESCE(MAX(v.`version`), 0) + 1
    FROM `auth_email_template_versions` v
    WHERE v.`purpose` = t.`purpose`
  ) AS `nextVersion`
FROM `auth_email_template_versions` t
WHERE t.`lifecycle` = 'PUBLISHED'
  AND (
    t.`subjectTemplate` LIKE '%MegaMitra%'
    OR t.`textTemplate` LIKE '%MegaMitra%'
    OR t.`htmlTemplate` LIKE '%MegaMitra%'
  );

UPDATE `auth_email_template_versions` t
INNER JOIN `brand_email_template_sources` s ON s.`id` = t.`id`
SET t.`lifecycle` = 'RETIRED',
    t.`effectiveTo` = CURRENT_TIMESTAMP(3),
    t.`retiredAt` = CURRENT_TIMESTAMP(3),
    t.`updatedAt` = CURRENT_TIMESTAMP(3);

INSERT INTO `auth_email_template_versions` (
  `id`, `purpose`, `version`, `lifecycle`, `subjectTemplate`, `textTemplate`, `htmlTemplate`,
  `effectiveFrom`, `effectiveTo`, `createdByUserId`, `publishedByUserId`, `retiredByUserId`,
  `publishedAt`, `retiredAt`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  s.`purpose`,
  s.`nextVersion`,
  'PUBLISHED',
  REPLACE(s.`subjectTemplate`, 'MegaMitra', 'MegaGoldenClub'),
  REPLACE(s.`textTemplate`, 'MegaMitra', 'MegaGoldenClub'),
  CASE
    WHEN s.`htmlTemplate` IS NULL THEN NULL
    ELSE REPLACE(s.`htmlTemplate`, 'MegaMitra', 'MegaGoldenClub')
  END,
  CURRENT_TIMESTAMP(3),
  NULL,
  s.`createdByUserId`,
  NULL,
  NULL,
  CURRENT_TIMESTAMP(3),
  NULL,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `brand_email_template_sources` s;

DROP TEMPORARY TABLE `brand_email_template_sources`;
