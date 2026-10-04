-- Prize catalogue descriptions are editorial/product copy and may legitimately exceed
-- the original 255-character placeholder limit. Keep application validation bounded
-- while allowing the persisted catalogue text to round-trip safely.
ALTER TABLE `owner_season_prizes`
  MODIFY COLUMN `description` TEXT NULL;
