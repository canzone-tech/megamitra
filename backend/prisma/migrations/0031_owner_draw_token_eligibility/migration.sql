-- Owner monthly draws use immutable installment tokens as the authoritative entry source.
-- Generic lucky draws continue to use program_draw_eligibility_hooks.
-- A lucky_draw_entry therefore has either a legacy sourceHookId or a permanent drawToken.

ALTER TABLE `lucky_draw_entries`
  MODIFY COLUMN `sourceHookId` CHAR(36) NULL,
  ADD CONSTRAINT `lucky_draw_entries_source_identity_check`
    CHECK (`sourceHookId` IS NOT NULL OR `drawToken` IS NOT NULL);
