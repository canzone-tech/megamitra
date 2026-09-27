-- Revised client binary topology: four direct placement slots per parent.
-- A/B are LEFT, C/D are RIGHT. Fixed qualifying pairs are A:C and B:D.
-- Existing legacy LEFT/RIGHT rows are deterministically preserved as A/C.

ALTER TABLE `binary_placements`
  ADD COLUMN `slot` ENUM('A','B','C','D') NULL AFTER `side`;

UPDATE `binary_placements`
SET `slot` = CASE WHEN `side` = 'LEFT' THEN 'A' ELSE 'C' END
WHERE `slot` IS NULL;

ALTER TABLE `binary_placements`
  MODIFY `slot` ENUM('A','B','C','D') NOT NULL,
  DROP INDEX `binary_placements_parentUserId_side_key`,
  ADD UNIQUE INDEX `binary_placements_parentUserId_slot_key` (`parentUserId`, `slot`),
  ADD INDEX `binary_placements_parentUserId_side_slot_idx` (`parentUserId`, `side`, `slot`);

ALTER TABLE `binary_ancestry`
  ADD COLUMN `firstLegSlot` ENUM('A','B','C','D') NULL AFTER `firstLegSide`;

UPDATE `binary_ancestry`
SET `firstLegSlot` = CASE WHEN `firstLegSide` = 'LEFT' THEN 'A' ELSE 'C' END
WHERE `firstLegSlot` IS NULL;

ALTER TABLE `binary_ancestry`
  MODIFY `firstLegSlot` ENUM('A','B','C','D') NOT NULL,
  ADD INDEX `binary_ancestry_ancestor_slot_depth_idx` (`ancestorUserId`, `firstLegSlot`, `depth`);

ALTER TABLE `binary_upline_volume_credits`
  ADD COLUMN `slot` ENUM('A','B','C','D') NULL AFTER `side`;

UPDATE `binary_upline_volume_credits`
SET `slot` = CASE WHEN `side` = 'LEFT' THEN 'A' ELSE 'C' END
WHERE `slot` IS NULL;

ALTER TABLE `binary_upline_volume_credits`
  MODIFY `slot` ENUM('A','B','C','D') NOT NULL,
  ADD INDEX `binary_upline_volume_credits_ancestor_slot_createdAt_idx` (`ancestorUserId`, `slot`, `createdAt`);

ALTER TABLE `binary_upline_qualifying_units`
  ADD COLUMN `slot` ENUM('A','B','C','D') NULL AFTER `side`;

UPDATE `binary_upline_qualifying_units`
SET `slot` = CASE WHEN `side` = 'LEFT' THEN 'A' ELSE 'C' END
WHERE `slot` IS NULL;

ALTER TABLE `binary_upline_qualifying_units`
  MODIFY `slot` ENUM('A','B','C','D') NOT NULL,
  DROP INDEX `binary_upline_qualifying_units_sequence_key`,
  DROP INDEX `binary_upline_qualifying_units_queue_idx`,
  ADD UNIQUE INDEX `binary_upline_qualifying_units_sequence_key` (`ancestorUserId`, `planVersionId`, `slot`, `sequence`),
  ADD INDEX `binary_upline_qualifying_units_queue_idx` (`ancestorUserId`, `planVersionId`, `slot`, `sequence`);
