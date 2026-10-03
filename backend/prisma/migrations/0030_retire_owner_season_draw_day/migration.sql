-- Retire the fixed calendar-day field from active season configuration.
-- Lucky-draw recurrence is authoritative via drawStartMonth/drawWeekOfMonth/drawWeekday/drawTimezone.
-- Existing non-null values are preserved only as historical compatibility data.

ALTER TABLE `owner_seasons`
  MODIFY COLUMN `drawDay` TINYINT UNSIGNED NULL;
