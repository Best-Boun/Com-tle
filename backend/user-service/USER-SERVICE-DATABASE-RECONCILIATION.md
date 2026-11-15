# User-Service Database Environment & Schema Reconciliation

**Date:** 2026-11-13  
**Scope:** User-Service configuration, supplied schema snapshot, runtime
database requirements, and checked-in migrations  
**Database access:** None. No connection credentials were inspected or
reproduced. No database, including Railway, was contacted.

## 1. Executive Summary

- **DATABASE FACT:** The supplied file
  `C:\Users\UsER\Downloads\dump-user_db-202611131507.sql` is a static MySQL
  snapshot. Its header reports MySQL Server 8.4.13 and its DDL contains nine
  tables, but not `internal_token_replays`.
- **CODE FACT:** Internal authentication requires a persistent insert into
  `internal_token_replays` for every otherwise-valid internal token.
- **BLOCKER:** A database that exactly matches the snapshot cannot complete
  that insert; replay-dependent internal requests fail closed with HTTP 503.
- **NOT VERIFIED:** No safe target environment was explicitly identified and
  no live database schema or migration ledger was inspected. The absence in
  the snapshot cannot establish whether the table is also absent from the
  current intended environment. A later provision, a different database, or
  dump scope/version drift cannot be ruled out.
- **CODE FACT:** The source contains five migrations, but the first four
  conflict with objects/constraints in the supplied schema. Migration 005
  defines the replay table expected by the current replay repository, but the
  snapshot does not contain that table. The existence of migration files does
  not prove any migration was applied.
- **CODE FACT:** Current runtime handling for refresh sessions, audit writes,
  and permission reads/seeding has been updated and is more compatible with
  the snapshot than some older sections of
  `DATABASE-COMPATIBILITY-SPECIFICATION.md` describe. The migration files
  remain incompatible and must not be used as evidence of actual database
  structure.
- **PROPOSAL:** Obtain explicit approval for a read-only inspection of the
  intended non-production database and reconcile its schema and migration
  history before selecting any provisioning or baseline strategy.

## 2. Database Environment Inventory

| Environment/configuration | Code facts | Assessment |
|---|---|---|
| Application database | `src/config/database.js` loads `backend/user-service/.env`, requires `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and creates a MySQL2 Knex connection. `DB_POOL_MIN`/`DB_POOL_MAX` are optional; connection acquisition timeout is 10 seconds. | **CODE FACT:** These names identify configuration inputs only. Runtime values were not inspected. |
| `.env.example` | Shows `DB_*` names and placeholder values, including a placeholder Railway host and `user_db`; it also documents `NODE_ENV`, `PORT`, and JWT settings. | **CODE FACT:** Example placeholders are not evidence of deployed settings or a connection target. |
| Knex development profile | `knexfile.js` has a `development` profile using `DB_*`, migrations directory `./migrations`, and ledger name `knex_migrations`. | **CODE FACT:** No development target was contacted. |
| Knex test profile | `knexfile.js` has a `test` profile using `DB_TEST_HOST`, `DB_TEST_PORT`, `DB_TEST_USER`, `DB_TEST_PASSWORD`, and `DB_TEST_NAME`, with a one-connection pool. | **CODE FACT:** This is a separate configuration profile; an isolated database was not confirmed. |
| Integration-test target | Opt-in integration tests require specific `USER_SERVICE_ALLOW_*_DATABASE_TESTS=1` flags and `DB_TEST_*` settings. The general database integration test also requires loopback and a test-only schema name; it runs migrations, seeds, and rollback operations when opted in. | **TEST FACT:** These tests were not run. No test target was inspected by connecting. |
| Actual deployment/production environment | No production Knex profile or verified runtime environment values were inspected. The application database module itself reads `DB_*`; it does not select `DB_TEST_*` based on `NODE_ENV`. | **NOT VERIFIED:** No claim is made about Railway or any other live target. |

Only environment-variable names and non-secret configuration structure were
reviewed. `.env` contents, process environment values, passwords, and database
credentials were not read or reproduced.

## 3. SQL Dump Provenance

- **DATABASE FACT:** The supplied snapshot file is named
  `dump-user_db-202611131507.sql`.
- **DATABASE FACT:** Its header identifies `user_db`, a host marker
  `mainline.proxy.rlwy.net`, MySQL dump client `10.13` / distribution
  `8.0.19` for Win64, and server version `8.4.13`.
- **NOT VERIFIED:** The dump client is older than the reported server version.
  The file alone does not establish whether the client version affected
  metadata completeness.
- **DATABASE FACT:** The dump footer says `Dump completed on
  2026-11-13 15:08:05`. The completion timestamp has no timezone annotation;
  the filename's `202611131507` is not an authoritative timestamp by itself.
- **DATABASE FACT:** The DDL lists nine `CREATE TABLE` statements:
  `customer_merge_history`, `customers`, `permissions`,
  `refresh_token_sessions`, `role_permissions`, `roles`,
  `user_audit_logs`, `user_roles`, and `users`. It has no `CREATE TABLE` for
  `internal_token_replays`, `audit_logs`, or `knex_migrations`.
- **NOT VERIFIED:** The dump header is not a provenance certificate. The
  export operator, exact environment, inclusion filters, checksum, whether
  the proxy marker represents the currently intended environment, and any
  changes after the export are unknown. The snapshot is not proof of current
  Railway state.
- **DATABASE FACT:** The DDL declares InnoDB tables using `utf8mb4` and
  `utf8mb4_0900_ai_ci`. The dump includes data statements; this report uses
  schema and metadata only; no row values are reproduced.

## 4. Schema Inventory

**DATABASE FACT:** The supplied snapshot defines:

| Table | Schema facts relevant to User-Service |
|---|---|
| `users` | `user_id CHAR(36)` PK; unique `email`; password hash, nullable phone, `ACTIVE`/`DISABLED`/`LOCKED` status enum; `created_at` and `updated_at` defaults. |
| `roles` | `role_id CHAR(36)` PK; unique role code and name; nullable description; `created_at` default. |
| `user_roles` | Composite PK `(user_id, role_id)`; nullable `assigned_by`; `assigned_at` default; FKs to users/roles; deleting the assigned-by user sets that column null. |
| `customers` | `customer_id CHAR(36)` PK; nullable unique `user_id`; nullable email/phone; `REGISTERED`, `GUEST`, and `MERGED` enum; `merged_into_customer_id`; timestamp defaults; user/self FKs and consistency checks. |
| `permissions` | `permission_id CHAR(36)` PK; unique permission code and name; nullable description; `created_at` default. |
| `role_permissions` | Composite PK `(role_id, permission_id)`; `assigned_at` default; FKs to roles/permissions with `RESTRICT` deletion; no `assigned_by`. |
| `refresh_token_sessions` | `session_id CHAR(36)` PK; unique `token_hash`; `token_family_id`; expiry/revocation/replacement and last-used timestamps; self-FK `replaced_by_token_id` targets `session_id`; user FK and checks. |
| `user_audit_logs` | `audit_id CHAR(36)` PK; nullable actor; action, resource type/ID, reason, JSON metadata, timestamp default; actor FK with `SET NULL`; actor/resource/time indexes. |
| `customer_merge_history` | Merge source/target customer and user references, required verification reference, timestamp, FKs and non-self-merge check. |

**DATABASE FACT:** The snapshot has no `internal_token_replays` table. Its
permission and role-permission tables contain no definitions or assignments.
These are snapshot contents, not verified live data.

**CODE FACT:** Current source queries `users`, `roles`, `user_roles`,
`customers`, `permissions`, `role_permissions`, `refresh_token_sessions`,
`user_audit_logs`, and `internal_token_replays`. No current User-Service
query against `customer_merge_history` was found.

## 5. Source-to-Schema Compatibility Matrix

| Table / concern | Current runtime requirement | Snapshot comparison | Finding |
|---|---|---|---|
| `users` | Registration, login, account status, profile, administration, and internal identity checks use `user_id`, `email`, `password_hash`, `phone`, and `status`; inserts omit DB-managed timestamps. | Required columns and defaults exist. | **CODE FACT / DATABASE FACT:** Runtime use is compatible at the inspected query level. Migration 001 omits timestamp defaults and does not define the snapshot's status enum. |
| `roles` | Login/refresh and authorization load `role_code`; role seed reads/inserts ID, code, name, and description. | Required columns exist; snapshot contains role rows. | **CODE FACT / DATABASE FACT:** Runtime reads and seed fields are compatible. Migration 001 omits `created_at`. |
| `user_roles` | Role loading joins on `user_id`/`role_id`; role administration may use `assigned_by`; inserts omit `assigned_at`. | Columns and default exist; dump FK uses `SET NULL` for `assigned_by`. | **CODE FACT / DATABASE FACT:** Runtime fields are compatible. Migration 001 defines a different `assigned_by` delete action and omits `assigned_at`. |
| `customers` | Register, profile, guest linking, and internal identity resolution use customer/user IDs, name, email/phone, and customer type. Current flows create/link registered and guest customers; no merge operation was found. | Snapshot permits nullable email and `MERGED`, has `merged_into_customer_id`, timestamps, FKs, checks. | **CODE FACT / DATABASE FACT:** Current registered/guest fields are available. **PENDING:** MERGED lifecycle behavior is not implemented/verified. Migration 001 requires email, omits merge/timestamp columns, and excludes `MERGED`. |
| `permissions` | Permission seed reads/inserts ID, code, name, description; runtime reads permission code. | Columns exist; snapshot has no permission definitions. | **CODE FACT / DATABASE FACT:** Shape is compatible for current seed/runtime fields; authorization grants are unavailable in this snapshot until approved seed data exists. Migration 003 omits `created_at` and unique permission-name constraint. |
| `role_permissions` | Current permission lookup joins role and permission IDs; seed inserts only `(role_id, permission_id)`. | Composite key and default `assigned_at` match; snapshot has no assignments and no `assigned_by`. | **CODE FACT / DATABASE FACT:** Current query and seed columns are compatible. Migration 003 adds nonexistent `assigned_by` and uses different FK deletion rules. |
| `refresh_token_sessions` | Current auth code inserts and queries `session_id`, `user_id`, token hash, family, timestamps, and replacement pointer; replacement points to the new `session_id`, and logout/reuse revocation is family-scoped. | Snapshot PK, unique token hash, family, replacement FK, timestamps, and checks align with the inspected runtime flow. | **CODE FACT / DATABASE FACT:** Runtime mapping is compatible at source level. `last_used_at` exists in the dump but no write to it was found; whether it is required by business policy is **PENDING**. Migration 002 instead creates `token_id`, uses the wrong replacement target, and omits family/last-used columns. |
| `user_audit_logs` | Current audit writer inserts `audit_id`, actor, action, `resource_type`, `resource_id`, reason, and metadata; DB supplies `created_at`. | Snapshot table has those columns and defaults. | **CODE FACT / DATABASE FACT:** Current runtime mapping is compatible at inspected column level. Migration 004 creates a different `audit_logs` table and incompatible column names. |
| `customer_merge_history` | No current runtime query or merge operation found. | Table exists with internal FKs/checks. | **DATABASE FACT:** Schema exists; **PENDING:** merge behavior and any future writes remain unimplemented/unapproved. |
| `internal_token_replays` | Replay repository inserts issuer, JTI, client ID, expiration and creation timestamps; cleanup deletes only expired rows. | No such table in the dump. | **DATABASE FACT / BLOCKER:** Against this exact snapshot, replay insert fails closed with HTTP 503. Migration 005 defines the expected table, but applied state is unknown. |

**CODE FACT:** The current audit and permission reports describe runtime
changes that are newer than some “current source expectation” text in
`DATABASE-COMPATIBILITY-SPECIFICATION.md`. For current-runtime status, this
matrix uses the inspected source plus
`AUDIT-COMPATIBILITY-ANALYSIS.md` and
`PERMISSION-ROLE-MAPPING-ANALYSIS.md`; the older specification remains useful
for its recorded dump facts and original findings, not as the sole source for
current code behavior.

**BLOCKER:** Because `permissions` and `role_permissions` are empty in the
snapshot, DB-backed permission checks have no assignments to grant. Current
checks fail closed; this is a data/bootstrap prerequisite, not evidence that
the table shape is incompatible.

## 6. Migration Compatibility Findings

**CODE FACT:** Five migration files exist. The `knexfile.js` configures the
ledger name as `knex_migrations`, but the supplied dump's DDL inventory has no
such table. No applied-migration history is present in the dump.
The migration filename prefix `20261111` predates the dump's filename stamp,
but filenames do not prove execution or establish the live schema state.

| Migration | DDL behavior | Reconciliation finding |
|---|---|---|
| `202611110001_create_user_service_auth_schema.js` | Creates `users`, `roles`, `customers`, `user_roles`. | **BLOCKER:** Those tables already exist in the snapshot; creation would conflict. Definitions also omit timestamp fields/defaults, omit `MERGED` and merge pointer, require customer email, and differ on `assigned_by` FK behavior. |
| `202611110002_create_refresh_token_sessions.js` | Creates refresh table with `token_id` PK and replacement FK to `token_id`. | **BLOCKER:** Snapshot has `session_id` PK; replacement FK targets `session_id`; it has `token_family_id` and `last_used_at` instead. |
| `202611110003_create_role_permissions.js` | Creates `permissions` and `role_permissions`, including `assigned_by`. | **BLOCKER:** Both tables already exist; the migration omits `permissions.created_at`/name uniqueness, adds `role_permissions.assigned_by`, and uses different FK delete rules. |
| `202611110004_create_audit_logs.js` | Creates `audit_logs` and columns such as `target_entity_type`, `occurred_at`, and `outcome`. | **BLOCKER:** Snapshot instead has `user_audit_logs` with resource fields and metadata. Current runtime uses the latter; this migration is not its schema. |
| `202611110005_create_internal_token_replays.js` | Defines InnoDB table with generated PK; `issuer`, `jti`, `client_id`, `expires_at`, `created_at`; unique `(issuer, jti)` and expiry index. | **CODE FACT:** Matches the current replay repository's expected fields and duplicate-key design. **DATABASE FACT:** Table absent from snapshot. **NOT VERIFIED:** Whether this migration was applied elsewhere. |

**NOT VERIFIED:** Migration filename order is not applied-migration history.
Since the snapshot contains neither `knex_migrations` nor an inspected live
ledger, it is not possible to determine which migration batches, if any, have
run in an actual environment.

**BLOCKER:** Do not run `knex migrate:latest` against a database matching the
snapshot. The earlier migrations attempt to create existing objects and
several definitions conflict with the authoritative snapshot. No migration
was run during this audit.

## 7. Replay Table Findings

- **CODE FACT:** `createInternalTokenReplayRepository.consumeJti` inserts into
  `internal_token_replays`; a unique `(issuer, jti)` violation is treated as
  replay. Other DB errors fail closed. No alternate table or in-memory replay
  store is used.
- **CODE FACT:** Migration 005 defines
  `internal_token_replay_id` as generated primary key; `issuer VARCHAR(255)`,
  `jti VARCHAR(128)`, `client_id VARCHAR(64)`, `expires_at DATETIME(3)`, and
  `created_at DATETIME(3)`, all non-null, plus unique `(issuer, jti)` and an
  `expires_at` index. It specifies InnoDB and `utf8mb4_bin`.
- **CODE FACT:** `cleanupExpired` floors its UTC cleanup instant to the start
  of the current whole second and deletes where `expires_at < cutoff`, matching
  the verifier's integer-second expiry boundary. No production scheduler or
  call site for cleanup was found; external scheduling was not inspected.
- **DATABASE FACT:** The snapshot lacks the table, so its columns, indexes,
  constraints, and engine cannot be compared to a snapshot definition.
- **NOT VERIFIED:** Real table existence, applied migration state, actual
  duplicate-key behavior, MySQL timestamp comparisons, and restart durability
  are unverified. Unit tests use a stub database and do not establish these
  live properties.
- **BLOCKER:** If the actual target matches the snapshot, every otherwise-valid
  token reaches a missing-table insert and returns HTTP 503. If the table was
  added after export or the target differs, only an approved read-only
  inspection can establish that; this audit did not connect.

## 8. Confirmed Blockers

1. **DATABASE FACT / BLOCKER:** `internal_token_replays` is absent from the
   supplied snapshot and required by runtime replay validation.
2. **BLOCKER:** Migrations 001–004 do not safely reconcile the existing
   snapshot. A source migration file is not authority to change schema.
3. **DATABASE FACT / BLOCKER:** Permission and role-permission records are
   absent from the snapshot; DB-backed permission checks cannot grant the
   seed-defined mappings until approved data is provisioned.
4. **NOT VERIFIED:** The actual intended environment, applied migration
   ledger, and current table state are unknown; therefore the audit cannot
   classify the missing replay table as a live-environment mismatch versus a
   snapshot-only limitation.

## 9. Not Verified Items

- **NOT VERIFIED:** Any current Railway or other live database schema.
- **NOT VERIFIED:** Actual `.env` values, process environment, deployment
  secrets, and production/test target separation.
- **NOT VERIFIED:** Provenance chain, dump export operator, export filters,
  checksum, and timezone of the dump completion timestamp.
- **NOT VERIFIED:** Applied migration versions/batches in a live
  `knex_migrations` ledger.
- **NOT VERIFIED:** MySQL execution of migrations, schema queries, seeds,
  refresh lifecycle, audit inserts, permissions, or replay inserts.
- **NOT VERIFIED:** External replay cleanup scheduling.
- **TEST FACT:** No tests were executed in this investigation. The opt-in
  MySQL integration tests were not run; they require explicitly isolated
  `DB_TEST_*` settings and some perform migrations, seeds, rollback, or DB
  writes. No test database was confirmed as safe.

## 10. Recommended Remediation Options

All options are **PROPOSAL** only; no remediation is selected or performed.

### A. Reconcile against an approved, read-only view of the intended database

- Confirm the target environment with its owner before any connection.
- Inspect table names, columns, indexes, constraints, engines, and applied
  migration history read-only; compare with the supplied snapshot and current
  runtime expectations.
- If `internal_token_replays` exists and matches the contract, record the
  snapshot drift and keep the schema unchanged. If absent, proceed only after
  separate schema approval.
- **Operational risk:** A different environment or stale proxy metadata could
  be mistaken for the intended target. This task did not inspect one.
- **Rollback:** No database rollback for a read-only check; preserve the
  inspection record and do not mutate schema or data.

### B. Provision only the replay table through an approved schema change

- Use only after the actual target and migration/baseline history are known.
  Migration 005's DDL matches the repository contract, but earlier migrations
  are not safe to run blindly against the supplied schema.
- **Security impact:** Supplies durable replay storage only if the expected
  unique constraint and engine are verified.
- **Operational risk:** DDL compatibility and migration-ledger drift.
- **Required approval:** Solution Architect and database/schema owner.
- **Rollback:** Dropping the table destroys replay history; rollback must
  account for unexpired tokens and must not remove replay records while tokens
  remain acceptable.

### C. Establish a reviewed migration baseline/reconciliation plan

- Reconcile or baseline the existing schema under a separately approved plan
  rather than applying migrations 001–004 to existing tables.
- **Operational risk:** Incorrectly marking migrations as applied can conceal
  schema drift; modifying legacy migration files can misrepresent history.
- **Required approval:** Solution Architect, database owner, and service
  owner. No history update or migration change is authorized by this audit.
- **Rollback:** Preserve the original migration ledger and schema evidence;
  approve a reversible plan before changing ledger state or DDL.

## 11. Required Approvals

1. **PENDING:** Confirm the intended database environment and approve any
   future read-only inspection. No Railway connection is authorized by this
   task.
2. **PENDING:** Confirm dump provenance and whether this dated snapshot is the
   approved schema authority for the target environment.
3. **PENDING:** Approve any DDL, migration baseline, or schema change through
   the Solution Architect and database owner. The existence of migration 005
   is not approval to apply it.
4. **PENDING:** Approve seed/data provisioning for the empty permission
   tables.
5. **PENDING:** Resolve whether `last_used_at` must be maintained as a
   business invariant; current source does not write it.
6. **PENDING:** Approve a dedicated loopback MySQL test database before
   enabling opt-in integration tests. No migration/seed/test was run here.

## Files Inspected

- Supplied dump: `C:\Users\UsER\Downloads\dump-user_db-202611131507.sql`
  (header and schema used; no row values reproduced)
- `backend/user-service/.env.example`
- `backend/user-service/src/config/database.js`
- `backend/user-service/knexfile.js`
- `backend/user-service/server.js`
- `backend/user-service/migrations/202611110001_create_user_service_auth_schema.js`
- `backend/user-service/migrations/202611110002_create_refresh_token_sessions.js`
- `backend/user-service/migrations/202611110003_create_role_permissions.js`
- `backend/user-service/migrations/202611110004_create_audit_logs.js`
- `backend/user-service/migrations/202611110005_create_internal_token_replays.js`
- `backend/user-service/src/services/authService.js`
- `backend/user-service/src/services/auditLogService.js`
- `backend/user-service/src/services/permissionService.js`
- `backend/user-service/src/services/guestCustomerLinkingService.js`
- `backend/user-service/src/services/userProfileService.js`
- `backend/user-service/src/services/userAdministrationService.js`
- `backend/user-service/src/services/internalCustomerIdentityService.js`
- `backend/user-service/src/services/internalTokenReplayRepository.js`
- `backend/user-service/seeds/001_roles.js`
- `backend/user-service/seeds/002_permissions.js`
- `backend/user-service/tests/database.integration.test.js`
- `backend/user-service/tests/authRefresh.database.integration.test.js`
- `backend/user-service/tests/auditLog.database.integration.test.js`
- `backend/user-service/tests/permissionAuthorization.database.integration.test.js`
- `backend/user-service/DATABASE-COMPATIBILITY-SPECIFICATION.md`
- `backend/user-service/AUDIT-COMPATIBILITY-ANALYSIS.md`
- `backend/user-service/PERMISSION-ROLE-MAPPING-ANALYSIS.md`
- `backend/user-service/INTERNAL-AUTH-COMPATIBILITY-ANALYSIS.md`
- `backend/user-service/REPLAY-PROTECTION-COMPATIBILITY-ANALYSIS.md`
- `backend/user-service/README.md`
