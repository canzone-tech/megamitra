-- Five-digit lucky draw tokens are unique inside a MegaGoldenClub season.
-- The same five-digit token may be reused by a different season, avoiding the
-- 90,000-token lifetime ceiling of the original global-token primary key.
--
-- tokenScopeId preserves the old global uniqueness rule for legacy/non-season
-- draws while resolving to seasonId for all season-bound tokens.

ALTER TABLE `lucky_draw_tokens`
  DROP PRIMARY KEY,
  ADD COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD COLUMN `seasonId` CHAR(36) NULL AFTER `token`,
  ADD PRIMARY KEY (`id`);

UPDATE `lucky_draw_tokens` t
JOIN `program_enrollments` e ON e.id=t.enrollmentId
JOIN `owner_seasons` s ON s.programVersionId=e.programVersionId
SET t.seasonId=s.id
WHERE t.seasonId IS NULL;

UPDATE `lucky_draw_tokens` t
JOIN `owner_draw_runs` r ON r.drawId=t.drawId
SET t.seasonId=r.seasonId
WHERE t.seasonId IS NULL;

UPDATE `lucky_draw_tokens` t
JOIN `lucky_draw_entries` e ON e.id=t.entryId
JOIN `owner_draw_runs` r ON r.drawId=e.drawId
SET t.seasonId=r.seasonId
WHERE t.seasonId IS NULL;

ALTER TABLE `lucky_draw_tokens`
  ADD COLUMN `tokenScopeId` CHAR(36)
    AS (IFNULL(`seasonId`, '00000000-0000-0000-0000-000000000000')) PERSISTENT
    AFTER `seasonId`,
  ADD UNIQUE INDEX `lucky_draw_tokens_season_token_key` (`seasonId`, `token`),
  ADD UNIQUE INDEX `lucky_draw_tokens_scope_token_key` (`tokenScopeId`, `token`),
  ADD INDEX `lucky_draw_tokens_season_installment_idx`
    (`seasonId`, `installmentSequence`, `status`);

ALTER TABLE `lucky_draw_entries`
  DROP INDEX `lucky_draw_entries_draw_token_key`,
  ADD UNIQUE INDEX `lucky_draw_entries_draw_token_key` (`drawId`, `drawToken`);
