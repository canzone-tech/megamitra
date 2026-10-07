-- Rank achievement rewards: joining-date deadlines and non-reused direct/team cohorts.
-- Cash posting and recurring payouts use authoritative balanced wallet entries.
ALTER TABLE ledger_accounts
  MODIFY COLUMN kind ENUM('USER_WALLET','COMMISSION_EXPENSE','REFERRAL_REWARD_EXPENSE','RANK_REWARD_EXPENSE') NOT NULL;
ALTER TABLE ledger_transactions
  MODIFY COLUMN type ENUM('BINARY_PAIR_COMMISSION','REFERRAL_REWARD','ADJUSTMENT','REVERSAL','RANK_ACHIEVEMENT','RANK_MONTHLY') NOT NULL;

CREATE TABLE rank_reward_policy_versions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  programVersionId CHAR(36) NOT NULL,
  version INT NOT NULL,
  lifecycle ENUM('DRAFT','PUBLISHED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  effectiveFrom DATETIME(3) NOT NULL,
  effectiveTo DATETIME(3) NULL,
  tiers JSON NOT NULL,
  createdByUserId CHAR(36) NULL,
  publishedAt DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT rank_policy_program_fk FOREIGN KEY (programVersionId) REFERENCES program_versions(id) ON DELETE RESTRICT,
  UNIQUE KEY rank_policy_program_version_key (programVersionId, version),
  INDEX rank_policy_active_idx (programVersionId, lifecycle, effectiveFrom)
) ENGINE=InnoDB;

CREATE TABLE rank_achievements (
  id CHAR(36) NOT NULL PRIMARY KEY,
  enrollmentId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  policyVersionId CHAR(36) NOT NULL,
  tierCode VARCHAR(32) NOT NULL,
  tierName VARCHAR(120) NOT NULL,
  directCount INT NOT NULL,
  teamCount INT NOT NULL,
  deadlineAt DATETIME(3) NOT NULL,
  achievedAt DATETIME(3) NOT NULL,
  cashAmount DECIMAL(18,2) NOT NULL,
  monthlyAmount DECIMAL(18,2) NOT NULL,
  monthlyMonths INT NOT NULL DEFAULT 0,
  tripDescription VARCHAR(255) NULL,
  tripStatus ENUM('NOT_APPLICABLE','PENDING','FULFILLED') NOT NULL DEFAULT 'NOT_APPLICABLE',
  tripReference VARCHAR(191) NULL,
  fulfilledAt DATETIME(3) NULL,
  fulfilledByUserId CHAR(36) NULL,
  ledgerTransactionId CHAR(36) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rank_achievement_enrollment_fk FOREIGN KEY (enrollmentId) REFERENCES program_enrollments(id) ON DELETE RESTRICT,
  CONSTRAINT rank_achievement_user_fk FOREIGN KEY (userId) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT rank_achievement_policy_fk FOREIGN KEY (policyVersionId) REFERENCES rank_reward_policy_versions(id) ON DELETE RESTRICT,
  CONSTRAINT rank_achievement_ledger_fk FOREIGN KEY (ledgerTransactionId) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  UNIQUE KEY rank_achievement_enrollment_tier_key (enrollmentId, tierCode),
  UNIQUE KEY rank_achievement_ledger_key (ledgerTransactionId),
  INDEX rank_achievement_user_idx (userId, achievedAt)
) ENGINE=InnoDB;

CREATE TABLE rank_monthly_payouts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  achievementId CHAR(36) NOT NULL,
  sequence INT NOT NULL,
  dueAt DATETIME(3) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  ledgerTransactionId CHAR(36) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rank_monthly_achievement_fk FOREIGN KEY (achievementId) REFERENCES rank_achievements(id) ON DELETE RESTRICT,
  CONSTRAINT rank_monthly_ledger_fk FOREIGN KEY (ledgerTransactionId) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  UNIQUE KEY rank_monthly_achievement_sequence_key (achievementId, sequence),
  UNIQUE KEY rank_monthly_ledger_key (ledgerTransactionId)
) ENGINE=InnoDB;

-- Initial flyer is published for already-published program versions only.
-- Future versions require an explicitly published rank policy; values remain configurable.
INSERT INTO rank_reward_policy_versions
  (id, programVersionId, version, lifecycle, effectiveFrom, tiers, publishedAt, createdAt, updatedAt)
SELECT UUID(), pv.id, 1, 'PUBLISHED', COALESCE(pv.publishedAt, CURRENT_TIMESTAMP(3)),
       JSON_ARRAY(
         JSON_OBJECT('code','LIGHTNING','name','Lightning Start Bonus','newDirect',4,'newTeam',0,'hours',4,'cash','1000.00','monthly','0.00','months',0,'trip',NULL),
         JSON_OBJECT('code','BRONZE','name','Bronze Achiever','newDirect',10,'newTeam',40,'hours',480,'cash','5000.00','monthly','0.00','months',0,'trip',NULL),
         JSON_OBJECT('code','SILVER','name','Silver Explorer','newDirect',25,'newTeam',100,'hours',720,'cash','10000.00','monthly','0.00','months',0,'trip','Goa family trip'),
         JSON_OBJECT('code','GOLD','name','Gold Leader','newDirect',50,'newTeam',250,'hours',1440,'cash','20000.00','monthly','2000.00','months',18,'trip','Ooty family trip'),
         JSON_OBJECT('code','DIAMOND','name','Diamond Director','newDirect',100,'newTeam',500,'hours',2160,'cash','50000.00','monthly','5000.00','months',18,'trip','Shimla family trip')
       ),
       CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM program_versions pv WHERE pv.lifecycle = 'PUBLISHED';