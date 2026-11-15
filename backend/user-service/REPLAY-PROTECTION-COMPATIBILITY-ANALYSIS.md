# User-Service Replay Protection Compatibility Analysis

**Date:** 2026-11-13  
**Scope:** User-Service internal service-token replay protection  
**Mode:** Boundary fix implemented and unit-tested. No configuration,
migration, seed, or database changes were made. No database, including
Railway, was contacted.

## 1. Executive Summary

- **CODE FACT:** `verifyServiceToken` validates an internal JWT's signature and
  required claims, then calls the persistent replay repository before returning
  an authenticated service identity. The same middleware protects both
  currently mounted internal endpoints.
- **DATABASE FACT / BLOCKER:** The existing
  `DATABASE-COMPATIBILITY-SPECIFICATION.md` records that the supplied SQL
  snapshot lacks `internal_token_replays`. The repository inserts every
  otherwise-valid internal token into that table. Against a database matching
  the snapshot, the insert fails and the request fails closed with HTTP 503.
- **CODE FACT:** The migration describes an InnoDB table with a unique
  `(issuer, jti)` key. If the table and that constraint exist, one atomic insert
  is the replay check; there is no preceding SELECT and no in-memory fallback.
- **CODE FACT — FIXED:** `cleanupExpired` now floors its UTC cutoff to the
  verifier's whole-second boundary before applying the existing strict `<`
  comparison. It cannot remove a row during a second in which verification
  still accepts that token.
- **TEST FACT:** Deterministic expiry-boundary and cleanup-then-replay tests
  pass with injected clocks and a stub database. Real MySQL timestamp and
  concurrency behavior remain **NOT VERIFIED**.
- **CODE FACT:** No production call to `cleanupExpired` was found; it remains
  unscheduled in the inspected source.
- **NOT VERIFIED:** No raw SQL dump file was present in the inspected
  workspace/session files; dump findings below rely on the existing database
  compatibility specification's recorded snapshot inspection. No live
  database was contacted. MySQL concurrency, table availability, transaction
  behavior, and persistence across process restarts were not verified.
- **PROPOSAL:** Obtain an approved decision on durable storage provisioning or
  reconciliation, then verify it in an isolated MySQL environment before
  enabling replay-dependent internal endpoints.

## 2. Actual Replay Protection Flow

1. **CODE FACT:** `server.js` calls `loadInternalServiceAuthConfig()`. If
   internal authentication is configured, it creates
   `createInternalTokenReplayRepository({ db })`, injects `consumeJti` into
   `createInternalServiceAuthService`, and mounts `/internal`.
2. **CODE FACT:** `requireInternalServiceAuth` extracts a Bearer token and
   awaits `verifyServiceToken`. On success, it attaches the verified service
   identity to `req.internalService`; errors go to Express error handling.
3. **CODE FACT:** `verifyServiceToken` decodes the header only to select a
   configured `kid`, then verifies the RS256 signature. It checks issuer,
   audience, expiry/issued-at and clock skew, `jti`, token purpose, caller
   identity, allowlist membership, and key-to-service binding before calling
   `consumeJti`.
4. **CODE FACT:** Replay validation is therefore **after signature and claim
   verification**, and before the middleware returns. In both
   `POST /internal/permissions/check` and
   `POST /internal/customers/resolve`, authentication middleware runs before
   JSON parsing and the endpoint handler.
5. **CODE FACT:** A successfully consumed token is not reusable for a later
   request, including a request that later fails parsing or business
   authorization. No operation-specific exemption was found.
6. **CODE FACT:** User-Service contains User access-token issuance in
   `authService.js`, but no Internal Service JWT issuance function. Internal
   issuance is outside this User-Service-only inspection.

## 3. Token Identifier and Lifecycle

- **CODE FACT:** The token's `jti` claim is the unique token identifier. It is
  required and validated against an 8–128 character pattern. The repository
  receives `issuer`, `jti`, `clientId`, and `expiresAt`; it does not store the
  JWT or its hash.
- **CODE FACT:** The database uniqueness namespace is `(issuer, jti)`.
  `client_id` is persisted for attribution but is not part of the unique key.
  A same-issuer `jti` collision across different client identities is denied
  as a duplicate, not treated as a separate token.
- **CODE FACT:** The verifier allows the configured 30-second clock skew. It
  stores `expires_at = exp + 30 seconds` and `created_at` from the application
  clock, both serialized as UTC date-time strings.
- **CODE FACT:** A valid first use proceeds only if its insert is confirmed.
  A duplicate `(issuer, jti)` becomes a replay rejection (HTTP 401). Other
  storage errors or an unverified insert result fail closed (HTTP 503).
- **PENDING:** The business contract's intended token TTL and any retention
  period beyond expiry plus the configured skew require architecture approval;
  this report does not propose a new TTL.

## 4. Replay Storage Implementation

**CODE FACT:** `createInternalTokenReplayRepository` uses only the
`internal_token_replays` table. No alternative table or in-memory store is
used. `consumeJti` performs one insert and does not issue a SELECT first.

The source migration
`migrations/202611110005_create_internal_token_replays.js` describes:

| Column / property | Expected definition |
|---|---|
| `internal_token_replay_id` | Auto-increment generated numeric primary key |
| `issuer` | `VARCHAR(255) NOT NULL` |
| `jti` | `VARCHAR(128) NOT NULL` |
| `client_id` | `VARCHAR(64) NOT NULL` |
| `expires_at` | `DATETIME(3) NOT NULL` |
| `created_at` | `DATETIME(3) NOT NULL` |
| Unique constraint | `(issuer, jti)` |
| Cleanup index | Index on `expires_at` |
| Engine / character configuration | InnoDB, `utf8mb4`, `utf8mb4_bin` |

**CODE FACT:** The insert supplies all five non-PK columns. No foreign key,
default timestamp, or other application-level constraint is declared by this
migration. The repository expects MySQL duplicate errors identified by
`ER_DUP_ENTRY` or errno `1062`; it classifies other errors as storage failure.

## 5. Concurrency and Atomicity Analysis

- **CODE FACT:** The intended concurrency guard is the single INSERT plus the
  unique `(issuer, jti)` constraint. With an InnoDB table carrying that exact
  constraint, competing inserts for the same key should serialize so only one
  succeeds and the other receives a duplicate-key error.
- **CODE FACT:** No explicit multi-statement transaction is used by
  `consumeJti`; the replay operation is one statement. The repository does not
  configure transaction isolation or issue a transaction commit itself.
- **TEST FACT:** `tests/internalTokenReplayRepository.test.js` simulates two
  concurrent attempts against an in-memory Map and asserts one success and
  one duplicate. This validates repository branching with a stub, not MySQL's
  unique-index behavior.
- **NOT VERIFIED:** No isolated MySQL race test, autocommit check, transaction
  failure test, or restart test was run. Concurrency protection is conditional
  on the real table's engine and unique constraint matching the migration.
- **CODE FACT:** Token identity is also bound to the configured key's service
  identity before replay storage. A cross-service claim substitution is
  rejected before `consumeJti`. Replay rows themselves are keyed by issuer and
  JTI, with client identity stored but not included in the uniqueness key.

## 6. Expiration and Retention Policy

- **CODE FACT:** The repository stores replay rows through `exp + 30 seconds`.
  `cleanupExpired(nowUtc)` deletes rows only where `expires_at <` the start of
  the current UTC second; the comparison remains strict. It returns the
  database delete count and fails with 503 if deletion fails.
- **CODE FACT:** No scheduler, startup task, public cleanup endpoint, or
  production call to `cleanupExpired` was found. References outside the
  repository are tests and documentation. Cleanup is therefore an explicit
  operation with no established automatic schedule.
- **CODE FACT — ROOT CAUSE:** The verifier calculates
  `floor(nowMilliseconds / 1000)` and accepts while that integer second is
  less than or equal to `exp + 30`. Before the fix, cleanup compared the
  millisecond-precision timestamp directly with `expires_at`, so it could
  delete the row after the stored cutoff but before the verifier advanced to
  the next integer second.
- **CODE FACT — FIX:** Cleanup now floors its time to the start of the current
  second, then retains the strict `expires_at < cutoff` predicate. During the
  final fractional second of acceptance, the floored cutoff equals the stored
  expiry and the strict comparison preserves the row. At the start of the
  next second, the cutoff is later than the stored expiry and cleanup can
  delete it. This preserves existing verifier semantics and the `exp + skew`
  retention policy; it only delays deletion until the verifier rejects the
  token.
- **PENDING:** No production cleanup invocation was found. Cleanup remains
  unscheduled in the inspected source; no external scheduler was checked.
- **NOT VERIFIED:** No MySQL test verified actual timestamp precision,
  comparison semantics, cleanup retention, or behavior at the expiry
  boundary.

## 7. Database Compatibility Findings

- **DATABASE FACT (snapshot record):** The existing
  `DATABASE-COMPATIBILITY-SPECIFICATION.md` records the supplied User-Service
  SQL snapshot as containing nine of the ten documented tables, with
  `internal_token_replays` absent. This task did not independently reopen a
  raw dump because none was found in the repository or current session files.
  The finding is about that recorded snapshot only, not Railway or any live
  environment.
- **CODE FACT:** Runtime replay queries target the literal table name
  `internal_token_replays`; no fallback or similarly named table is queried.
- **CODE FACT:** The source migration's column names and widths match the
  repository's insert fields. The supplied snapshot record has no such table,
  so there is no snapshot table structure, unique key, cleanup index, or
  timestamp type to compare against.
- **PENDING:** The target MySQL version is not established. `DATETIME(3)`
  requires fractional-second support. The unique index spans up to 255 + 128
  `utf8mb4` characters (up to 1,532 bytes); older InnoDB index-length limits
  or row-format settings may prevent creating that index. The migration
  selects InnoDB and collation but does not select a row format. Confirm the
  actual server version, page size, row format, and resulting index definition
  before an approved provisioning change.
- **CODE FACT:** The repository writes explicit UTC-formatted strings into
  timezone-naive `DATETIME(3)` fields and compares them to UTC-formatted
  strings. This is a UTC-by-convention contract; the database does not encode
  a timezone.
- **NOT VERIFIED:** The migration has a static compilation test, and the
  general database integration test describes the repository-migrated schema.
  Neither was run for this investigation; neither proves that the supplied
  snapshot or any live database has the replay table.

## 8. Failure Handling

| Condition | Code behavior |
|---|---|
| Duplicate `(issuer, jti)` | Repository returns `false`; verifier rejects with HTTP 401. |
| Missing table, connection failure, or other insert error | Repository throws an operational 503; verifier logs service ID only and throws a generic 503. |
| Insert result cannot be verified | Treated as storage failure; HTTP 503. |
| Cleanup database error | `cleanupExpired` throws 503; it is not part of a request path currently. |
| Missing/malformed/expired/wrong-purpose token | Rejected before replay insertion, normally HTTP 401 (identity mismatch is 403). |

**CODE FACT:** The middleware forwards the error to the shared handler, which
uses the operational `AppError` status and message. A missing table is not
reported as a replay, and the client receives service-unavailable behavior
rather than a successful authentication or an in-memory fallback.

**CODE FACT:** Knex is configured with an `acquireConnectionTimeout` of
10,000 ms. No replay-specific statement timeout or explicit replay
transaction is configured. Rejected connection/query errors fail closed;
behavior of a stalled query beyond connection acquisition is **NOT VERIFIED**.

## 9. Security Test Coverage

“Covered” below means an existing test exercises repository/service logic with
stubs unless otherwise noted.

| Requirement | Evidence and status |
|---|---|
| First use of a valid token | **TEST FACT — stubbed:** first insert succeeds and stores expiry plus skew. |
| Reuse of the same token / JTI | **TEST FACT — stubbed:** duplicate `(issuer, jti)` returns false; route tests also reject replayed internal tokens. |
| Duplicate concurrent requests | **TEST FACT — stubbed only:** Map-backed concurrency test yields one success; MySQL race **NOT VERIFIED**. |
| Database unavailable | **TEST FACT — stubbed:** repository/service failure returns 503. Missing-table behavior against MySQL **NOT VERIFIED**. |
| Duplicate-key database error | **TEST FACT — stubbed:** `ER_DUP_ENTRY` and errno `1062` are classified as replay. Actual driver error behavior **NOT VERIFIED**. |
| Transaction rollback | **NOT VERIFIED:** replay insert is a single statement with no explicit transaction; no rollback case is tested. |
| Expired JWT | **TEST FACT — stubbed:** verifier rejects a token beyond configured clock skew. |
| Before, at, final fractional second of, and immediately after effective expiry | **TEST FACT — stubbed:** deterministic injected-clock verifier test covers all four points relative to `exp + skew`. |
| Cleanup followed by replay attempt | **TEST FACT — stubbed:** integrated verifier/repository test runs cleanup in the final accepted fractional second; the replay remains rejected as already used. |
| Cleanup while token is acceptable | **TEST FACT — stubbed:** cleanup retains the row at `effectiveExpiry + 999 ms`; the verifier reaches replay detection and rejects the reused token. |
| Expired replay-record cleanup | **TEST FACT — stubbed:** cleanup removes the row at the first whole second when the verifier rejects the token. Real MySQL precision/comparison is **NOT VERIFIED**. |
| Process restart behavior | **NOT VERIFIED:** no restart test or MySQL persistence test was run. Durability depends on a successful committed insert in the real database. |
| Different service identities | **TEST FACT — service verifier:** a signing key bound to another service cannot claim the target service. **NOT VERIFIED:** real database replay behavior across identities. |
| Different token identifiers | **TEST FACT — stubbed:** different JTI values are independently accepted. |
| Replay-record retention | **TEST FACT — stubbed:** `expires_at` is set to `exp + skew`; actual DB retention and cleanup are **NOT VERIFIED**. |
| Cross-endpoint replay | **TEST FACT — route code path:** both routes use the same verifier/repository; no real HTTP+MySQL cross-endpoint test was run. |

**Tests executed:**  
`node --test tests/internalServiceAuth.test.js tests/internalTokenReplayRepository.test.js`

Result: **16 passed, 0 failed, 0 skipped**. These tests use signed test JWTs,
injected clocks, and a stub database. No database-connected tests, migrations,
or seeds were run. MySQL timestamp precision and comparison behavior remain
**NOT VERIFIED**.

## 10. Confirmed Defects

1. **DATABASE FACT / BLOCKER — Replay table absent from recorded snapshot.**
   The production path requires an insert into `internal_token_replays` for
   every otherwise-valid internal token. Against a database matching the
   recorded snapshot, that missing table causes the insert to fail and the
   request to return HTTP 503. This does not establish the state of any live
   environment.
2. **CODE FACT — RESOLVED:** The cleanup boundary defect is fixed by flooring
   the cleanup cutoff to the verifier's whole-second clock while retaining the
   strict `<` predicate. The regression test proves cleanup preserves the row
   while the token is acceptable and that reuse is still rejected.
3. **NOT VERIFIED — Real atomicity and durability.** The code design depends on
   an InnoDB table with the unique `(issuer, jti)` constraint and durable insert
   behavior. No actual MySQL instance was used to verify these conditions.

## 11. Database Facts vs Code Facts

| Classification | Finding |
|---|---|
| **DATABASE FACT (snapshot record)** | `DATABASE-COMPATIBILITY-SPECIFICATION.md` records that the supplied snapshot lacks `internal_token_replays`. Raw dump not available for independent reinspection in this workspace. |
| **CODE FACT** | The repository always inserts into `internal_token_replays`; it does not use another table or memory. |
| **CODE FACT** | The source migration defines the five data columns, generated PK, unique `(issuer, jti)`, expiry index, InnoDB, and `utf8mb4_bin`. |
| **CODE FACT** | Database errors and unverifiable insertion results fail closed with HTTP 503; duplicate keys fail closed as replay with HTTP 401. |
| **TEST FACT** | Replay repository and service tests use stubs; migration tests compile expected DDL. They do not prove deployed schema behavior. |
| **NOT VERIFIED** | Railway/live table existence, actual MySQL version and table definition, real concurrency, production cleanup schedule, query timeout behavior, and process-restart durability. |

## 12. Remediation Options

All options below are **PROPOSAL** only. None is selected or implemented.

### A. Provision the migration-defined table through an approved database change

- **Security impact:** Preserves the intended durable one-time check if the
  table is InnoDB and the unique `(issuer, jti)` key is present and effective.
- **Compatibility impact:** Resolves the blocker only for environments where
  the approved DDL is applied and verified; it does not make the supplied
  snapshot itself contain the table.
- **Operational risks:** DDL permissions/locking, version and index-size
  compatibility, deployment ordering, and migration drift. Internal routes
  must not be enabled before storage is verified.
- **Required approval:** Solution Architect and database/schema owner approval
  of the exact DDL, target environment, and rollout.
- **Rollback considerations:** The source `down` migration drops the table.
  Dropping it destroys replay history and can make still-acceptable tokens
  reusable. Rollback must not drop the table while internal tokens may remain
  valid; an approved rollback should first stop token acceptance and account
  for outstanding tokens.

### B. Reconcile the snapshot with the intended provisioned database

- **Security impact:** If an approved read-only check confirms the exact table
  and required unique constraint already exist, documenting the snapshot drift
  can avoid unnecessary DDL without weakening replay protection.
- **Compatibility impact:** Works only if the existing definition matches the
  repository contract, including columns, types, engine, uniqueness, and
  expiry index. A table with only a matching name is insufficient.
- **Operational risks:** The supplied dump may be stale or from another
  environment; relying on an unverified assertion can leave all internal
  requests failing closed or can hide a missing constraint.
- **Required approval:** Database owner approval for the read-only inspection
  and Solution Architect approval to treat the snapshot as stale or
  incomplete.
- **Rollback considerations:** Reverting documentation has no database
  rollback; if the inspection finds drift, keep internal auth disabled and
  return to an approved provisioning decision. No live inspection occurred
  in this task.

### C. Adopt an already-approved compatible durable User-Service store

- **Security impact:** Potentially equivalent only if the existing store
  provides durable atomic uniqueness for `(issuer, jti)`, fail-closed writes,
  and expiry retention. In-memory storage or an audit table without equivalent
  constraints is not acceptable.
- **Compatibility impact:** No compatible alternative was found in the
  inspected User-Service source or snapshot record. Reusing another service's
  database would violate service ownership boundaries.
- **Operational risks:** Requires verified persistence, concurrency, timeout,
  retention, ownership, and operational monitoring contracts; changing
  storage code may create a gap during transition.
- **Required approval:** Solution Architect, User-Service owner, and
  database/storage owner approval of the existing store and any implementation
  contract change.
- **Rollback considerations:** Preserve replay history across any transition.
  Switching back to a store without the same records can reopen previously
  consumed tokens; define an approved transition and rollback procedure before
  implementation.

## 13. Pending Decisions

1. **PENDING:** Confirm whether the intended database already has
   `internal_token_replays`; do not infer live state from the supplied
   snapshot.
2. **PENDING:** Approve option A, B, or a separately evidenced option C. No
   schema change or alternate store is approved by this investigation.
3. **PENDING:** Confirm target MySQL version, InnoDB row format, index
   capacity, and UTC/session-time behavior.
4. **PENDING:** Define an approved cleanup schedule and resolve the
   cleanup-versus-verifier expiry boundary before cleanup is operationally
   enabled.
5. **PENDING:** Confirm token one-time-use policy across all internal
   operations, retention expectations, and what happens to outstanding tokens
   during rollback or store migration.
6. **PENDING:** Provide an isolated MySQL test environment for real
   duplicate/concurrency, database-failure, restart, timestamp, and cleanup
   tests. Production and Railway are not suitable for this investigation.

## 14. Recommended Next Steps

1. **PROPOSAL:** Keep replay protection enabled as fail-closed behavior; do not
   bypass the insert or add in-memory fallback.
2. **PROPOSAL:** Have the database owner perform an approved read-only
   inspection of the intended non-production environment, or approve
   migration-defined provisioning after version/index review.
3. **PROPOSAL:** Keep cleanup unscheduled until an owner approves its
   operational schedule and verifies the retained boundary in isolated MySQL.
4. **PROPOSAL:** Once storage is approved and isolated, run MySQL integration
   tests for first use, duplicate key, concurrent insert, storage failure,
   persistence across restart, expiry retention, and cleanup. Record those
   results separately from stubbed unit tests.
5. **PROPOSAL:** Obtain Solution Architect approval before implementing any
   remediation.

## Files Inspected

- `backend/user-service/src/services/internalServiceAuthService.js`
- `backend/user-service/src/services/internalTokenReplayRepository.js`
- `backend/user-service/src/middleware/requireInternalServiceAuth.js`
- `backend/user-service/src/middleware/requireAuth.js`
- `backend/user-service/src/routes/internalRoutes.js`
- `backend/user-service/src/config/internalServiceAuth.js`
- `backend/user-service/src/constants/internalServiceAuth.js`
- `backend/user-service/src/config/database.js`
- `backend/user-service/server.js`
- `backend/user-service/knexfile.js`
- `backend/user-service/migrations/202611110005_create_internal_token_replays.js`
- `backend/user-service/tests/internalTokenReplayRepository.test.js`
- `backend/user-service/tests/internalTokenReplayMigration.test.js`
- `backend/user-service/tests/internalServiceAuth.test.js`
- `backend/user-service/tests/internalRoutes.test.js`
- `backend/user-service/tests/internalCustomerIdentityRoutes.test.js`
- `backend/user-service/tests/database.integration.test.js`
- `backend/user-service/src/services/authService.js` (to distinguish User JWT issuance from internal verification)
- `backend/user-service/README.md`
- `backend/user-service/DATABASE-COMPATIBILITY-SPECIFICATION.md`
- `backend/user-service/INTERNAL-AUTH-COMPATIBILITY-ANALYSIS.md`
- `backend/shared/errors/AppError.js`
- `backend/shared/middleware/errorMiddleware.js`
