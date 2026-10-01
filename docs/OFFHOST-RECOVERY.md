# MegaGoldenClub Off-Host Recovery Procedure

This procedure defines the operational evidence required for encrypted off-host backup and disaster-recovery approval. It does not select a storage vendor and does not treat the CI recovery drill as proof that a real remote storage account, retention policy or production-like restore host is working.

## Recovery contract

MySQL is authoritative business/financial truth. MongoDB contains presentation/template documents. Redis is non-authoritative and is cleared after restore rather than backed up.

A production backup is considered complete only after all of these are true:

1. `npm run backup:data` completed successfully.
2. The local backup's `SHA256SUMS` validates.
3. The backup was exported with `npm run backup:export-offhost` using a key file held outside the repository and outside the backup storage boundary.
4. The encrypted `.tar.gz.enc` archive and its `.sha256` file were copied to protected off-host storage.
5. The remote object/storage reference and encrypted archive SHA-256 were recorded in release/operations evidence.

A recovery exercise is considered complete only after the encrypted archive is retrieved from the off-host storage boundary, imported with `npm run backup:import-offhost`, restored into isolated production-like infrastructure, root `npm run verify` passes, and critical records are sampled.

## Encryption key handling

Set `MEGAGOLDENCLUB_BACKUP_KEY_FILE` to a regular non-empty key file with mode `600` or `400`. The key file must not be committed, copied beside the encrypted backup, embedded in scripts, included in tickets/chat, or stored in the same failure/security boundary as the off-host archive.

The repository scripts use OpenSSL AES-256-CBC with PBKDF2, salt and 200,000 PBKDF2 iterations. Changing the cipher/KDF contract requires a forward-compatible migration/recovery plan; old backups must remain decryptable for their retention period.

Example key preparation on an authorized operations host:

```bash
umask 077
openssl rand -base64 48 > /secure/megagoldenclub-backup.key
chmod 600 /secure/megagoldenclub-backup.key
```

Do not print the key contents.

## Create and export a backup

From `backend/`:

```bash
npm run backup:data -- /protected/local-backups
```

Identify the timestamped directory created by that command, then export it to a mounted/synchronized off-host destination:

```bash
MEGAGOLDENCLUB_BACKUP_KEY_FILE=/secure/megagoldenclub-backup.key \
  npm run backup:export-offhost -- \
  /protected/local-backups/<timestamp> \
  /mnt/protected-off-host/megagoldenclub
```

The export command:

- rejects an incomplete local backup;
- validates the local `SHA256SUMS` before packaging;
- encrypts only `mysql.sql`, `mongodb.archive.gz`, `manifest.txt` and `SHA256SUMS`;
- writes `megagoldenclub-backup-<timestamp>.tar.gz.enc`;
- writes a sibling `.sha256` for the encrypted archive;
- refuses to overwrite an existing archive/checksum pair.

Record the encrypted archive name, SHA-256, storage/provider object reference, source release commit and UTC completion time. Do not record the encryption key.

## Retrieve and import

Retrieve both the encrypted archive and its sibling `.sha256` from the real off-host boundary into an isolated recovery host. Then from `backend/` run:

```bash
MEGAGOLDENCLUB_BACKUP_KEY_FILE=/secure/megagoldenclub-backup.key \
  npm run backup:import-offhost -- \
  /recovery/incoming/megagoldenclub-backup-<timestamp>.tar.gz.enc \
  /recovery/work
```

The import command validates the encrypted archive SHA-256 before decryption, rejects unexpected archive entries, decrypts into a private temporary workspace, extracts only the four expected backup files, and validates the inner `SHA256SUMS` before returning `/recovery/work/imported`.

Do not restore directly from an unverified/decrypted ad-hoc directory.

## Restore drill

Restore is destructive. Use isolated production-like infrastructure and stop/avoid application traffic.

```bash
MEGAGOLDENCLUB_RESTORE_CONFIRM=YES \
  npm run restore:data -- /recovery/work/imported
```

After restore, return to the repository root and run:

```bash
npm run verify
```

Before approving recovery readiness, sample at minimum:

- wallet/ledger totals and representative financial records;
- active program/policy versions;
- payout/withdrawal records;
- entitlement and fulfilment records;
- lucky-draw entries, token registry and claim state;
- audit records;
- current published presentation/theme version.

Record the isolated host/environment reference, retrieved remote object reference, encrypted archive SHA-256, restore operator, UTC timestamps, root verify result and sample evidence in `docs/RELEASE-SIGNOFF.md` or the linked operations record.

## Automated regression versus operational evidence

Backend CI runs `verify-backup-restore-drill.sh` only in isolated `NODE_ENV=test` infrastructure. The drill now creates a real backup, exports it through the encrypted off-host format, deletes the original local backup to simulate primary-host loss, imports only the encrypted archive, restores it, verifies MySQL/MongoDB canaries and confirms Redis was cleared.

That automated regression proves the repository's backup → encryption/export → import/decryption → restore code path. It does **not** prove access to a real remote storage provider, retention/immutability settings, credential recovery, network retrieval, production-like capacity or human operational execution. Those remain release/operations gates.
