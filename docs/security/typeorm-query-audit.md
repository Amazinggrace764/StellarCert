<!-- This document is operational/security documentation only. It contains no executable code. -->
# TypeORM Security Advisory Audit (Issue #652)

## 1. Overview
- **Vulnerability:** Blind SQL injection in `UpdateQueryBuilder` / `SoftDeleteQueryBuilder` via unvalidated `orderBy` / `addOrderBy` clauses under MySQL/MariaDB drivers.
- **Advisory ID:** [GHSA-9ggv-8w38-r7pm](https://github.com/advisories/GHSA-9ggv-8w38-r7pm)
- **Vulnerable Releases:** `<= 0.3.28`
- **Patched Releases:** `>= 0.3.29`

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

## 5. Unbounded Query Audit (Issue #653)

Separate from the SQL injection audit above, an audit of unbounded result-set queries was performed. The following `certificate-search.service.ts` methods previously called `getMany()` with no `take`/pagination, loading every matching row into memory and JSON-serializing it. On a large issuer this caused slow responses and potential OOM, and the endpoints were attacker-reachable amplification vectors.

### Remediation

| Method | Previous Behavior | New Behavior |
|--------|-------------------|--------------|
| `getCertificatesByRecipient` | `getMany()` (unbounded) | Paginated via `take`/`skip`; hard max page size enforced |
| `getCertificatesByIssuer` | `getMany()` (unbounded) | Paginated via `take`/`skip`; hard max page size enforced |
| `getDuplicateCertificates` | `getMany()` (unbounded) | Paginated via `take`/`skip`; hard max page size enforced |
| `exportCertificates` | `getMany()` + JSON serialize (unbounded) | Streamed via `stream()`; hard max page size enforced |
| `search` | `getMany()` (unbounded) | Paginated via `take`/`skip`; hard max page size enforced |

### Controls

- **Hard maximum page size:** All list/search methods clamp the requested `limit` to a hard maximum (`MAX_PAGE_SIZE`) and default to a safe `DEFAULT_PAGE_SIZE` when unspecified.
- **Pagination contract:** List/search methods accept `limit` and `offset` (or keyset) parameters and return pagination metadata (`total`, `limit`, `offset`) without breaking existing response shapes.
- **Streamed exports:** `exportCertificates` uses a streaming query builder (`stream()`) so rows are not fully materialized in memory; the hard maximum page size still applies to bound the stream.
- **Backward compatibility:** Existing callers that omit pagination parameters receive the default page size; no request/response field removals were made.

### Regression Coverage

- Unit tests in `certificate-search.service.spec.ts` assert that each method applies `take`/`skip`, clamps oversized `limit` values to `MAX_PAGE_SIZE`, and that `exportCertificates` uses a streaming query builder rather than `getMany()`. The spec file must parse cleanly (no stray/invalid characters) for these tests to load under Jest.
- Boundary tests cover `limit = 0`, negative `offset`, and `limit` exceeding `MAX_PAGE_SIZE`.

### Verification Checklist

- [x] All five methods no longer call `getMany()` without `take`/`skip` (or use `stream()` for exports).
- [x] Hard maximum page size enforced on every list/search/export path.
- [x] `exportCertificates` streams results instead of JSON-serializing the full result set.
- [x] Existing API and data compatibility preserved (defaults applied when pagination params omitted).
- [x] Focused tests and typecheck/build run; regression tests added in `certificate-search.service.spec.ts` (spec file verified to load under Jest with no syntax errors).
