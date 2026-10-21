# Data Retention and Deletion Policy

This document defines the end-to-end retention and deletion guarantees for personally identifiable information (PII) processed by the Stellar Certificate platform. It is the authoritative reference for the implemented deletion/anonymization workflow and for operational procedures.

## 1. Principles for certificate related PII

1. **Certificate integrity is preserved.** Certificate records that are referenced by an immutable on-chain transaction are never deleted. PII attached to them is **anonymized** instead of removed, so the certificate remains verifiable while the subject is no longer identifiable from our systems.
2. **Immutable on-chain records are out of scope.** Data written to the Stellar blockchain cannot be altered or erased by this platform. We minimize what is put on-chain and document this limitation to data subjects.
3. **Legally required audit evidence is retained.** Audit logs are kept for the configured retention period and are not erased while a legal hold is active. PII in audit logs is redacted at write time (see `AuditService.redactSensitiveData`).
4. **Deletion is idempotent and auditable.** Every deletion/anonymization run is recorded in the audit trail and can be safely re-run without causing data loss or duplicate effects.
5. **Authorization is explicit.** Only authorized administrators (or the data subject for self-service requests) can trigger deletion.

## 2. Data Inventory

The table below maps each PII category to its storage locations, owner, retention period, and deletion/anonymization behavior.

| PII category | Storage locations | Owner | Retention period | Deletion / anonymization behavior |
| --- | --- | --- | --- | --- |
| Account identity (name, email, username, phone) | `users` table (PostgreSQL) | Identity team | Active lifetime + legal hold | Anonymized on account deletion (email -> `deleted+<uuid>@example.invalid`, name/phone -> null); rows retained for referential integrity of certificates |
| Authentication secrets (password hash, 2FA secrets, refresh tokens) | `users` table (PostgreSQL) | Security team | Active lifetime | Erased immediately on account deletion (credentials cleared) |
| Profile picture (S3 object key) | `users` table + S3 object storage | Identity team | Active lifetime | S3 object deleted; key cleared on account deletion |
| Certificate subject PII (recipient name, email) | `certificates` table (PostgreSQL) | Certificate team | Active lifetime of certificate + legal hold | Anonymized; on-chain hash and certificate ID preserved |
| Audit evidence (user id, email, ip, user agent) | `audit_logs` table (PostgreSQL) | Compliance team | 365 days (configurable by policy) | Purged by `AuditService.cleanupOldLogs` after retention, unless legal hold is active |
| Email queue payloads (name, email, tokens) | Redis (Bull queue) | Platform team | Until job completes or fails + 7 days | Removed on completion (`removeOnComplete`); failed jobs purged by cleanup job |
| Temporary files (uploads, exports) | Local disk (`temp/`) | Platform team | 24 hours | Deleted by `CleanupService.handleCleanup` |
| Application logs | Log aggregator | Platform team | 30 days | PII redacted at source; rotated by log aggregator |

## 3. Retention and Legal Hold Rules

- **Default retention** for account PII is the active lifetime of the account. Once an account is deleted, PII is anonymized immediately and auth secrets are erased.
- **Certificate records** are retained in anonymized form for as long as the certificate is verifiable on-chain.
- **Audit logs** are retained for 365 days by default. The period is configurable via the retention policy and must not be shorter than any applicable legal requirement.
- A valid **active legal hold** suspends deletion for the affected resources. Holds are stored in the `data_retention_holds` table with an expiry date and a reason. Holds can be released only by an authorized administrator.
- **Backups** follow the same retention window as the primary store. Deletion is propagated to backups through the normal backup rotation cycle; an account deletion is fully effective in backups within the backup retention period (default 30 days).
- **Asynchronous queues** are drained and their payloads for the affected user are removed during deletion.

## 4. Deletion / Anonymization Workflow

The workflow is implemented in `DataRetentionService`. It is triggered by an authorized administrator or the data subject and runs the following steps in order:

1. **Pre-checks** — confirm the actor is authorized, confirm the user exists, and check for an active legal hold. If a hold is active, the workflow records a skipped audit event and returns without deleting.
2. **Drain queues** — remove pending email jobs that reference the user's email address.
3. **Delete object-store copies** — delete the profile picture object from S3 if present.
4. **Anonymize certificate records** — replace recipient PII with a stable anonymous token while keeping the certificate ID and on-chain hash intact.
5. **Anonymize the user row** — clear auth secrets, replace email with a non-routable address, clear name/phone/profile picture, and mark the account as deleted.
6. **Redact audit PII** — redact the user email in audit logs for this user while preserving the audit evidence itself. This step is skipped when a legal hold is active.
7. **Record audit event** — an `AUDIT_LOG_REDACTION` or `USER_ANONYMIZE` event is written with the actor, correlation ID, and step results.

The workflow is idempotent: running it again on an already-anonymized user produces the same result and records a second audit event with the same correlation ID.

## 5. Authorization

- Administrators with the `admin` keys management role can delete any account.
- The data subject can request deletion of their own account.
- Any other request is rejected with a 403 before any data is modified.
- Legal holds can be created and released only by authorized administrators.

## 6. Operational Procedures

### 6.1 Responding to a deletion request

1. Verify the requester's identity and authority.
2. Check for an active legal hold on the account. If one exists, communicate the hold to the requester and do not proceed.
3. Trigger the deletion workflow via the admin API or the self-service endpoint.
4. Confirm the audit event was written and the correlation ID is recorded.
5. Notify the requester of completion.

### 6.2 Responding to a legal hold

1. Create a hold with a reason, affected user IDs, and an expiry date.
2. Deletion requests for affected users will be skipped and audited while the hold is active.
3. Release the hold only after the legal obligation has been satisfied.

### 6.3 Audit log retention

1. The daily cleanup job calls `AuditService.cleanupOldLogs` with the configured retention period.
2. Logs belonging to users under an active legal hold are excluded from the purge.
3. Purge results are logged with the number of records removed.

### 6.4 Backups

1. Database backups are retained for 30 days by default.
2. An account deletion is reflected in backups as they expire and are replaced by newer snapshots.
3. Restores from backup must re-apply the deletion workflow for any accounts deleted after the snapshot was taken.

## 7. Testing

Every guarantee in this document is covered by unit tests in `backend/src/modules/data-retention/services/data-retention.service.spec.ts`:

- authorization failures for unauthorized actors,
- legal-hold skip behavior,
- idempotent re-runs,
- queue draining,
- object-store deletion,
- certificate anonymization with on-chain references preserved,
- audit PII redaction,
- audit log purge excluding held records.

## 8. Review

This policy is reviewed at least annually and whenever a new PII storage location is introduced. Changes to the implementation must be reflected here in the same change.
