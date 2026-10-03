-- Owner lucky draws support auditable software selection and externally conducted manual selection.
-- Winner-to-prize truth remains in lucky_draw_winners.prizeTierId for both modes.

ALTER TABLE `owner_draw_runs`
  ADD COLUMN `selectionMode` VARCHAR(30) NOT NULL DEFAULT 'AUTO' AFTER `status`,
  ADD COLUMN `externalDrawReference` VARCHAR(191) NULL AFTER `selectionMode`,
  ADD COLUMN `externalDrawNote` VARCHAR(1000) NULL AFTER `externalDrawReference`,
  ADD COLUMN `externalDrawFinalizedAt` DATETIME(3) NULL AFTER `externalDrawNote`,
  ADD COLUMN `externalDrawRecordedByUserId` CHAR(36) NULL AFTER `externalDrawFinalizedAt`,
  ADD INDEX `owner_draw_runs_selection_mode_idx` (`selectionMode`, `status`);
