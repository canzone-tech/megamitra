-- Owner monthly draws use immutable installment tokens as the authoritative entry source.
-- Generic lucky draws continue to use program_draw_eligibility_hooks.
-- sourceHookId is nullable only for token-backed owner entries; drawToken remains globally unique.

ALTER TABLE `lucky_draw_entries`
  MODIFY COLUMN `sourceHookId` CHAR(36) NULL;
