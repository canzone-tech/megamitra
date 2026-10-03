ALTER TABLE `owner_epins`
  ADD COLUMN `pinType` ENUM('ACTIVATION','INSTALLMENT') NOT NULL DEFAULT 'ACTIVATION'
    AFTER `seasonId`,
  ADD INDEX `owner_epins_season_type_status_idx` (`seasonId`, `pinType`, `status`);

-- Existing E-PINs predate typed catch-up registration and retain their original
-- activation semantics through the ACTIVATION default/backfill above.
