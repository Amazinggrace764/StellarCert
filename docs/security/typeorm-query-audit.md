# TypeORM Security Advisory Audit (Issue #652, #653)

## 1. Overview
- **Vulnerability:** Blind SQL injection in `UpdateQueryBuilder` / `SoftDeleteQueryBuilder` via unvalidated `orderBy` / `addOrderBy` clauses under MySQL/MariaDB drivers.
- **Advisory ID:** [GHSA-9ggv-8w38-r7pm](https://github.com/advisories/GHSA-9ggv-8w38-r7pm)
- **Vulnerable Releases:** `<= 0.3.28`
- **Patched Releases:** `>= 0.3.29`
- **Related Release Integrity Work:** See [reproducible-releases.md](./reproducible-releases.md) for pinned toolchains, SBOMs, provenance, and promotion gating that apply to the application images and contract WASM built from this audited source.

## 2. Dependency Upgrade Status
- **Current Pinned Version:** `typeorm@0.3.31` (`^0.3.31` in `backend/package.json`).
- **Lockfile Resolution:** Both `backend/package-lock.json` and root `package-lock.json` resolve to `0.3.31`.
- **npm audit Status:** `npm audit` confirms `typeorm` itself has 0 vulnerabilities.

## 3. Query Builder Predicate Audit


A complete audit of all 30+ `createQueryBuilder` / `leftJoinAndSelect` call sites was conducted across the codebase to ensure 100% parameter binding and prevent SQL injection through request parameters.

### Audited Services & Repositories

| File | Functions Audited | Parameter Binding Mechanism | Status |
|------|-------------------|-----------------------------|--------|
| `certificate.service.ts` | `findAll`, `findOne`, `findByVerificationCode`, `exportFilteredCertificates`, `exportAllFiltered`, `getCertificatesByRecipient`, `getCertificatesByIssuer`, `getDuplicateCertificates`, `search`, `getCertificatesByUserId` | Bound parameters (`:search`, `:status`, `:issuerId`, `:filterIssuerId`, `:startDate`, `:endDate`, `:...certificateIds`) | Verified Safe |
| `certificate-search.service.ts` | `findAll`, `findOne`, `getCertificatesByRecipient`, `getCertificatesByIssuer`, `getDuplicateCertificates`, `exportCertificates`, `search` | Bound parameters (`:query`, `:issuerId`, `:status`, `:recipientEmail`, `:id`) | Verified Safe |
| `certificate.repository.ts` | `findById`, `findByCertificateId`, `findByVerificationCode`, `findByStellarTransactionHash`, `findByUserId`, `search`, `findActiveExpired`, `findActiveByStellarSequence` | Bound parameters for all filter predicates; `orderBy` fields sanitized against allowlist (`sanitizeSortField`) and direction clamped to `ASC`/`DESC` | Verified Safe |
| `stats.service.ts` | `getIssuanceTrend`, `getTopIssuersData` | Bound parameters (`:startDate`, `:endDate`, `:issuerId`, `:start`, `:end`); static aliases | Verified Safe |
| `admin-analytics.service.ts` | `getUserRegistrationTrend`, `getCertificateIssuanceTrend` | Bound parameters (`:startDate`, `:endDate`) | Verified Safe |
| `user.repository.ts` | `findAll`, `applyFilters`, `findById`, `findByEmail` | Bound parameters (`:search`, `:email`, `:firstName`, `:lastName`, `:role`, `:status`, `:isActive`, `:isEmailVerified`); `sanitizeSortField()` allowlist | Verified Safe |
| `issuers.service.ts` | `listIssuers` | Bound parameters (`:isActive`, `:search`, `:tier`); `allowedSortFields` allowlist | Verified Safe |
| `audit.service.ts` | `search`, `getStatistics` | Bound parameters (`:ipAddress`, `:status`, `:startTime`, `:endTime`, `:action`, `:resourceType`, `:userId`) | Verified Safe |
| `webhooks.service.ts` | `triggerEvent` | Bound parameters (`:issuerId`, `:isActive`, `:event = ANY(sub.events)`) | Verified Safe |
| `jobs.processor.ts` | Expiration check | Bound parameters (`:status`, `:now`, `:sequenceThreshold`, `:windowDate`) | Verified Safe |
| `duplicate-detection.service.ts` | `applyRule`, `generateDuplicateReport` | Bound parameters (`:status`, `:cutoffDate`, `:isDuplicate`, `:startDate`, `:endDate`) | Verified Safe |
| `two-factor.service.ts` | `disable`, `validateLogin` | Bound parameters (`:id`) | Verified Safe |

## 4. Verification Checklist

- [x] TypeORM direct dependency updated to patched release (`0.3.31`).
- [x] Zero raw string concatenation or template literal interpolation used in `.where()`, `.andWhere()`, or `.orWhere()`.
- [x] Dynamic `.orderBy()` field inputs strictly validated against whitelist arrays.
- [x] Dedicated unit tests added to prevent regressions in `certificate-search.service.spec.ts`.

## 5. Index Coverage Audit (Issue #653)

### 5.1 Reported Gap
`certificate.entity.ts` declared `@Index()` on roughly a dozen columns, but the two hottest lookup paths were unindexed:

| Column | Line (pre-fix) | Consumer | Impact |
|--------|----------------|----------|--------|
| `verificationCode` | 123 | `CertificateService.findByVerificationCode` (public, unauthenticated `GET /certificates/verify/:code`) | Full table scan per request — amplification/DoS vector on the most attacker-reachable query in the system. |
| `expiresAt` | 159 | Expiration job (`jobs.processor.ts` expiration check) | Full table scan on every scheduled run; cost grows linearly with certificate volume. |

### 5.2 Fix
- Added `@Index({ unique: true })` to `verificationCode`. Uniqueness is already enforced at the service layer (codes are generated and checked for collisions), so the constraint is compatible with existing data; the index also makes the public verify lookup an O(log n) point lookup.
- Added `@Index()` to `expiresAt` so the expiration job's range predicate (`expiresAt <= :now` combined with `status`) can use an index scan.

### 5.3 Migration / Compatibility
- No API or data-shape change. Existing rows are unaffected; the unique index is created by the standard TypeORM migration flow.
- Rollout note: on large deployments, index creation on `certificates` should be scheduled during a low-traffic window (or run `CONCURRENTLY` on Postgres) to avoid a write lock while the unique index is built. If duplicate `verificationCode` values are found during migration, the migration will fail loudly — this is intentional, since duplicates would already break the verify endpoint's single-row assumption.

### 5.4 Regression Coverage
- Added entity metadata tests asserting `verificationCode` carries a unique index and `expiresAt` carries a non-unique index, so a future refactor that drops either decorator fails CI.
- Added a repository-level test asserting `findByVerificationCode` and the expiration query both resolve via the indexed columns (query plan / metadata assertion), guarding against silent regression to a full scan.

### 5.5 Verification Checklist
- [x] `verificationCode` indexed with `@Index({ unique: true })`.
- [x] `expiresAt` indexed with `@Index()`.
- [x] Entity metadata regression tests added.
- [x] Focused tests and typecheck/build run for `backend`.
- [x] Migration/rollout note documented above.
