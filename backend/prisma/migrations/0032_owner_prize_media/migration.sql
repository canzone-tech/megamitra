-- Prize catalogue media attachments are stored in MongoDB GridFS.
-- MariaDB keeps the immutable attachment reference and display metadata with each prize row.

ALTER TABLE `owner_season_prizes`
  ADD COLUMN `mediaId` CHAR(24) NULL AFTER `description`,
  ADD COLUMN `mediaName` VARCHAR(191) NULL AFTER `mediaId`,
  ADD COLUMN `mediaMimeType` VARCHAR(100) NULL AFTER `mediaName`,
  ADD INDEX `owner_season_prizes_mediaId_idx` (`mediaId`);
