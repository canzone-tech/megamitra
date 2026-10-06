-- Store Indian postal PIN code with the member profile address.
ALTER TABLE `member_profiles`
  ADD COLUMN `postalCode` VARCHAR(6) NULL AFTER `city`;
