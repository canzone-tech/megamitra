-- After-draw installment income recovery: immutable policy snapshots and real wallet reserve accounts.
-- First published 50% rule is seeded for existing ACTIVE sessions. No historical earnings are replayed.
ALTER TABLE ledger_accounts
 MODIFY COLUMN kind ENUM(
  'USER_WALLET','COMMISSION_EXPENSE','REFERRAL_REWARD_EXPENSE','LUCKY_DRAW_PRIZE_EXPENSE',
  'WITHDRAWAL_CLEARING','WITHDRAWAL_FEE_REVENUE','WITHDRAWAL_TDS_PAYABLE','RANK_REWARD_EXPENSE',
  'USER_INSTALLMENT_RESERVE','INSTALLMENT_RECOVERY_CLEARING'
 ) NOT NULL;
ALTER TABLE ledger_transactions
 MODIFY COLUMN type ENUM(
  'BINARY_PAIR_COMMISSION','REFERRAL_REWARD','LUCKY_DRAW_PRIZE_PAYOUT','WITHDRAWAL_PAYOUT',
  'ADJUSTMENT','REVERSAL','RANK_ACHIEVEMENT','RANK_MONTHLY',
  'INSTALLMENT_RESERVE_HOLD','INSTALLMENT_RESERVE_RELEASE','INSTALLMENT_AUTO_PAYMENT'
 ) NOT NULL;

CREATE TABLE installment_recovery_policy_versions (
 id CHAR(36) NOT NULL PRIMARY KEY,
 seasonId CHAR(36) NOT NULL,
 version INT NOT NULL,
 lifecycle ENUM('PUBLISHED','RETIRED') NOT NULL DEFAULT 'PUBLISHED',
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 reservePercent DECIMAL(5,2) NOT NULL DEFAULT 50.00,
 createdByUserId CHAR(36) NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT installment_recovery_policy_season_fk FOREIGN KEY(seasonId) REFERENCES owner_seasons(id),
 CONSTRAINT installment_recovery_policy_percent_check CHECK(reservePercent BETWEEN 0 AND 100),
 UNIQUE KEY installment_recovery_policy_season_version_key(seasonId, version),
 INDEX installment_recovery_policy_active_idx(seasonId, lifecycle, version)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO installment_recovery_policy_versions
(id,seasonId,version,lifecycle,enabled,reservePercent)
SELECT UUID(), id, 1,'PUBLISHED',TRUE,50.00 FROM owner_seasons WHERE status='ACTIVE';

CREATE TABLE installment_recovery_holds (
 id CHAR(36) NOT NULL PRIMARY KEY,
 earningTransactionId CHAR(36) NOT NULL,
 userId CHAR(36) NOT NULL,
 installmentId CHAR(36) NOT NULL,
 policyVersionId CHAR(36) NOT NULL,
 amount DECIMAL(18,2) NOT NULL,
 ledgerTransactionId CHAR(36) NOT NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT installment_recovery_hold_earning_fk FOREIGN KEY(earningTransactionId) REFERENCES ledger_transactions(id),
 CONSTRAINT installment_recovery_hold_installment_fk FOREIGN KEY(installmentId) REFERENCES program_installments(id),
 CONSTRAINT installment_recovery_hold_policy_fk FOREIGN KEY(policyVersionId) REFERENCES installment_recovery_policy_versions(id),
 CONSTRAINT installment_recovery_hold_ledger_fk FOREIGN KEY(ledgerTransactionId) REFERENCES ledger_transactions(id),
 CONSTRAINT installment_recovery_hold_positive_check CHECK(amount>0),
 UNIQUE KEY installment_recovery_hold_earning_key(earningTransactionId),
 UNIQUE KEY installment_recovery_hold_ledger_key(ledgerTransactionId),
 INDEX installment_recovery_hold_user_idx(userId,createdAt)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE installment_recovery_settlements (
 id CHAR(36) NOT NULL PRIMARY KEY,
 installmentId CHAR(36) NOT NULL,
 userId CHAR(36) NOT NULL,
 paymentRecordId CHAR(36) NOT NULL,
 ledgerTransactionId CHAR(36) NOT NULL,
 amount DECIMAL(18,2) NOT NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY installment_recovery_settled_installment_key(installmentId),
 UNIQUE KEY installment_recovery_settled_payment_key(paymentRecordId),
 CONSTRAINT installment_recovery_settled_installment_fk FOREIGN KEY(installmentId) REFERENCES program_installments(id),
 CONSTRAINT installment_recovery_settled_record_fk FOREIGN KEY(paymentRecordId) REFERENCES program_payment_records(id),
 CONSTRAINT installment_recovery_settled_ledger_fk FOREIGN KEY(ledgerTransactionId) REFERENCES ledger_transactions(id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
