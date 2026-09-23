INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'operations.read', 'Read operational dashboards and processing queues', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.`name` = 'SUPER_ADMIN'
  AND p.`code` = 'operations.read';

CREATE INDEX `lucky_draw_instances_status_drawAt_idx`
  ON `lucky_draw_instances` (`status`, `drawAt`, `id`);

CREATE INDEX `lucky_draw_prize_claims_status_deadline_idx`
  ON `lucky_draw_prize_claims` (`status`, `claimDeadline`, `id`);

CREATE INDEX `program_business_events_occurred_id_idx`
  ON `program_business_events` (`occurredAt`, `id`);
