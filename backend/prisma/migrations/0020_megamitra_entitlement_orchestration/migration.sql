CREATE TABLE `program_entitlement_orchestration_bindings` (
  `id` CHAR(36) NOT NULL,
  `programEventPolicyVersionId` CHAR(36) NOT NULL,
  `entitlementPolicyVersionId` CHAR(36) NOT NULL,
  `createdByUserId` CHAR(36) NULL,
  `updatedByUserId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_entitlement_orchestration_bindings_policy_key` (`programEventPolicyVersionId`),
  INDEX `program_entitlement_orchestration_bindings_target_idx` (`entitlementPolicyVersionId`),
  CONSTRAINT `program_entitlement_orchestration_bindings_event_policy_fkey`
    FOREIGN KEY (`programEventPolicyVersionId`) REFERENCES `program_event_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_entitlement_orchestration_bindings_target_fkey`
    FOREIGN KEY (`entitlementPolicyVersionId`) REFERENCES `entitlement_policy_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_entitlement_orchestration_bindings_created_by_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `program_entitlement_orchestration_bindings_updated_by_fkey`
    FOREIGN KEY (`updatedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `program_entitlement_generation_links` (
  `id` CHAR(36) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `bindingId` CHAR(36) NOT NULL,
  `runId` CHAR(36) NOT NULL,
  `businessEventId` CHAR(36) NOT NULL,
  `entitlementGenerationRunId` CHAR(36) NOT NULL,
  `status` ENUM('GENERATED','INELIGIBLE') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `program_entitlement_generation_links_source_key` (`sourceKey`),
  UNIQUE INDEX `program_entitlement_generation_links_event_key` (`businessEventId`),
  UNIQUE INDEX `program_entitlement_generation_links_generation_key` (`entitlementGenerationRunId`),
  INDEX `program_entitlement_generation_links_run_idx` (`runId`, `status`),
  INDEX `program_entitlement_generation_links_binding_idx` (`bindingId`, `createdAt`),
  CONSTRAINT `program_entitlement_generation_links_binding_fkey`
    FOREIGN KEY (`bindingId`) REFERENCES `program_entitlement_orchestration_bindings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_entitlement_generation_links_run_fkey`
    FOREIGN KEY (`runId`) REFERENCES `program_event_processing_runs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_entitlement_generation_links_event_fkey`
    FOREIGN KEY (`businessEventId`) REFERENCES `program_business_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `program_entitlement_generation_links_generation_run_fkey`
    FOREIGN KEY (`entitlementGenerationRunId`) REFERENCES `entitlement_generation_runs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
