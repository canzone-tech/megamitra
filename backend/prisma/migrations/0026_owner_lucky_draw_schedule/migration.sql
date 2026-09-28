ALTER TABLE `owner_seasons`
  ADD COLUMN `drawStartMonth` TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER `drawDay`,
  ADD COLUMN `drawWeekOfMonth` TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER `drawStartMonth`,
  ADD COLUMN `drawWeekday` VARCHAR(10) NOT NULL DEFAULT 'SUNDAY' AFTER `drawWeekOfMonth`,
  ADD COLUMN `drawTimezone` VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata' AFTER `drawWeekday`,
  ADD CONSTRAINT `owner_seasons_drawStartMonth_check`
    CHECK (`drawStartMonth` BETWEEN 1 AND 12),
  ADD CONSTRAINT `owner_seasons_drawWeekOfMonth_check`
    CHECK (`drawWeekOfMonth` BETWEEN 1 AND 5),
  ADD CONSTRAINT `owner_seasons_drawWeekday_check`
    CHECK (`drawWeekday` IN ('SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'));

UPDATE `owner_seasons` AS `season`
JOIN `owner_portal_settings` AS `settings` ON `settings`.`id` = 1
SET `season`.`drawTimezone` = `settings`.`timezone`;
