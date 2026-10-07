-- Preserve full owner authorization codes for privileged register display.
-- Hash remains authoritative for one-time consumption lookup; ciphertext is encrypted at rest.
-- Existing pre-encryption rows remain NULL and continue to render as masked suffixes.

ALTER TABLE `owner_auth_codes`
  ADD COLUMN `codeCiphertext` TEXT NULL AFTER `displaySuffix`;
