# User-Service Database Readiness & Migration Baseline Plan

**Status:** Investigation and proposal only; Solution Architect approval required
**Scope:** Com-tle User-Service
**Database access:** None. No Railway, live, or unknown database was contacted.
No migrations, seeds, or database operations were run.

## Evidence labels

- **CODE FACT** — directly observed in checked-in source, configuration, tests,
  or reports.
- **DATABASE FACT** — directly observed in the dated SQL dump only; not a claim
  about a live database.
- **TEST FACT** — an existing test definition or an executed test result.
- **NOT VERIFIED** — evidence was unavailable or was not checked.
- **BLOCKER** — prevents treating the schema or service as ready.
- **PENDING** — a product/schema decision remains unapproved.
- **PROPOSAL** — a safe future action, not authorization to execute it.

## 1. Executive assessment

- **DATABASE FACT:** `dump-user_db-202611131507.sql` is a dated MySQL 8.4.13
  snapshot containing nine expected tables. It does not contain
  `internal_token_replays`. Its header is not proof of current environment,
  provenance, or production source of truth.
- **CODE FACT:** Migrations 001–004 do not reproduce the snapshot schema.
  Migration 005 defines the replay table used by the current replay repository.
  The existence of migration files does not establish that they were applied.
- **CODE FACT:** Current application code queries/writes
  `users`, `customers`, `roles`, `user_roles`, `permissions`,
  `role_permissions`, `refresh_token_sessions`, and `user_audit_logs`.
  The current replay repository requires `internal_token_replays`.
  No current merge operation using `customer_merge_history` was found.
- **BLOCKER:** The migrations, current runtime, test expectations, and dated
  dump do not describe one complete, approved baseline. In particular,
  migration 004 creates `audit_logs` while runtime and dump use
  `user_audit_logs`; the dump contains `customer_merge_history`, which no
  migration creates; migrations 001–003 also conflict with the dump.
- **NOT VERIFIED:** Live schema, migration ledger, current deployment target,
  and whether any migration ran. The dump contains no `knex_migrations` table.
- **PROPOSAL:** Approve and document a canonical schema baseline before any
  future write. Do not run `migrate:latest`, seeds, or migration rollbacks
  against the dump, Railway, or any unidentified database.

## 2. Target schema inventory

The following inventory records the observed dump DDL for its nine tables and
migration 005 for the absent replay table. It is an **evidence inventory, not
an approved declaration that the dump is the desired or live schema**. The
canonical target remains **PENDING** reconciliation and Solution Architect /
database-owner approval.

### Common storage facts

- **DATABASE FACT:** Every table in the dump uses InnoDB,
  `DEFAULT CHARSET=utf8mb4`, and `utf8mb4_0900_ai_ci`.
- **CODE FACT:** Migrations 001–004 specify InnoDB, `utf8mb4`, and
  `utf8mb4_unicode_ci`; migration 005 specifies InnoDB, `utf8mb4`, and
  `utf8mb4_bin`. This is another reason not to infer the target from migration
  files alone.
- **NOT VERIFIED:** The storage engine, charset, collation, defaults, and
  constraints of any live database.

### `users`

- **DATABASE FACT — columns:** `user_id CHAR(36) NOT NULL`;
  `email VARCHAR(255) NOT NULL`; `password_hash VARCHAR(255) NOT NULL`;
  `phone VARCHAR(30) NULL`; `status ENUM('ACTIVE','DISABLED','LOCKED') NOT
  NULL DEFAULT 'ACTIVE'`; `created_at DATETIME(3) NOT NULL DEFAULT
  CURRENT_TIMESTAMP(3)`; `updated_at DATETIME(3) NOT NULL DEFAULT
  CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** PK `user_id`; unique `uq_users_email`
  (`email`); indexes `idx_users_status` (`status`) and
  `idx_users_created_at` (`created_at`).
- **DATABASE FACT — foreign/check constraints:** None shown in the dump.
- **PENDING:** Confirm whether these types, timestamp defaults, status domain,
  and index set are the canonical baseline.

### `customers`

- **DATABASE FACT — columns:** `customer_id CHAR(36) NOT NULL`;
  `user_id CHAR(36) NULL`; `full_name VARCHAR(150) NOT NULL`;
  `phone VARCHAR(30) NULL`; `email VARCHAR(255) NULL`;
  `customer_type ENUM('REGISTERED','GUEST','MERGED') NOT NULL`;
  `merged_into_customer_id CHAR(36) NULL`;
  `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`;
  `updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE
  CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** PK `customer_id`; unique
  `uq_customers_user_id` (`user_id`); indexes `idx_customers_phone` (`phone`),
  `idx_customers_email` (`email`), and `idx_customers_merged_into`
  (`merged_into_customer_id`).
- **DATABASE FACT — foreign keys:** `user_id` references `users.user_id`
  (`ON DELETE RESTRICT ON UPDATE RESTRICT`);
  `merged_into_customer_id` references `customers.customer_id`
  (`ON DELETE RESTRICT ON UPDATE RESTRICT`).
- **DATABASE FACT — checks:** `chk_customers_not_merged_into_self` requires
  `merged_into_customer_id IS NULL OR merged_into_customer_id <> customer_id`.
  `chk_customers_type_consistency` requires GUEST to have null `user_id` and
  merge pointer; REGISTERED to have non-null `user_id` and null merge pointer;
  MERGED to have non-null merge pointer. The MERGED branch does not constrain
  `user_id`.
- **PENDING:** Runtime merge/`MERGED` lifecycle and its relationship to the
  `customer_merge_history` record have no implementation in the inspected
  service. Do not infer merge side effects or identity-verification rules.

### `roles`

- **DATABASE FACT — columns:** `role_id CHAR(36) NOT NULL`;
  `role_code VARCHAR(50) NOT NULL`; `role_name VARCHAR(100) NOT NULL`;
  `description VARCHAR(500) NULL`; `created_at DATETIME(3) NOT NULL DEFAULT
  CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** PK `role_id`; unique
  `uq_roles_role_code` (`role_code`) and `uq_roles_role_name` (`role_name`).
- **DATABASE FACT — foreign/check constraints:** None shown in the dump.
- **CODE FACT:** The role seed defines CUSTOMER, TECHNICIAN, and ADMIN only.
  **PENDING:** No STAFF role is approved.

### `user_roles`

- **DATABASE FACT — columns:** `user_id CHAR(36) NOT NULL`;
  `role_id CHAR(36) NOT NULL`; `assigned_by CHAR(36) NULL`;
  `assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** Composite PK (`user_id`, `role_id`);
  indexes `idx_user_roles_role_id` (`role_id`) and
  `idx_user_roles_assigned_by` (`assigned_by`).
- **DATABASE FACT — foreign keys:** `user_id` → `users.user_id` and `role_id`
  → `roles.role_id`, both RESTRICT on delete/update. `assigned_by` →
  `users.user_id`, RESTRICT on update and SET NULL on delete.
- **DATABASE FACT — checks/defaults:** No check shown; `assigned_at` is
  database-defaulted.
- **PENDING:** Confirm whether the supplied assignment attribution and FK
  behavior remain the canonical baseline.

### `permissions`

- **DATABASE FACT — columns:** `permission_id CHAR(36) NOT NULL`;
  `permission_code VARCHAR(100) NOT NULL`;
  `permission_name VARCHAR(150) NOT NULL`; `description VARCHAR(500) NULL`;
  `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** PK `permission_id`; unique
  `uq_permissions_code` (`permission_code`) and `uq_permissions_name`
  (`permission_name`).
- **DATABASE FACT — foreign/check constraints:** None shown in the dump.
- **PENDING:** The permission definitions are code/seed driven; role mapping
  approval is separate and is not implied by having a permission row.

### `role_permissions`

- **DATABASE FACT — columns:** `role_id CHAR(36) NOT NULL`;
  `permission_id CHAR(36) NOT NULL`;
  `assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
  There is **no `assigned_by` column**.
- **DATABASE FACT — keys/indexes:** Composite PK (`role_id`, `permission_id`);
  index `idx_role_permissions_permission_id` (`permission_id`).
- **DATABASE FACT — foreign keys:** `role_id` → `roles.role_id` and
  `permission_id` → `permissions.permission_id`, both RESTRICT on delete/update.
- **DATABASE FACT — checks/defaults:** No check shown; `assigned_at` is
  database-defaulted.
- **PENDING:** Other role-permission mappings beyond the two explicitly
  approved pairs in §4 remain unapproved.

### `refresh_token_sessions`

- **DATABASE FACT — columns:** `session_id CHAR(36) NOT NULL`;
  `user_id CHAR(36) NOT NULL`; `token_hash CHAR(64) NOT NULL`;
  `token_family_id CHAR(36) NOT NULL`; `expires_at DATETIME(3) NOT NULL`;
  `revoked_at DATETIME(3) NULL`; `replaced_by_token_id CHAR(36) NULL`;
  `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`;
  `last_used_at DATETIME(3) NULL`.
- **DATABASE FACT — keys/indexes:** PK `session_id`; unique
  `uq_refresh_token_hash` (`token_hash`); indexes `idx_refresh_user`
  (`user_id`,`created_at`), `idx_refresh_family`
  (`token_family_id`,`revoked_at`), `idx_refresh_expiry` (`expires_at`), and
  `idx_refresh_replaced_by` (`replaced_by_token_id`).
- **DATABASE FACT — foreign keys:** `user_id` → `users.user_id` and
  `replaced_by_token_id` → `refresh_token_sessions.session_id`, both RESTRICT
  on delete/update.
- **DATABASE FACT — checks/defaults:** `chk_refresh_token_expiry` requires
  `expires_at > created_at`; `chk_refresh_token_not_self_replaced` permits a
  null replacement or requires it differ from `session_id`. Only `created_at`
  has a default. `last_used_at` is nullable.
- **CODE FACT:** Current auth code uses `session_id` as the row ID, a
  `token_family_id`, and replacement IDs that point to another `session_id`.
  It does not write `last_used_at`.
- **PENDING:** Whether `last_used_at` must be maintained is a policy decision;
  do not infer a new write requirement.

### `user_audit_logs`

- **DATABASE FACT — columns:** `audit_id CHAR(36) NOT NULL`;
  `actor_user_id CHAR(36) NULL`; `action VARCHAR(100) NOT NULL`;
  `resource_type VARCHAR(100) NOT NULL`; `resource_id VARCHAR(100) NULL`;
  `reason VARCHAR(500) NULL`; `metadata JSON NULL`;
  `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** PK `audit_id`; indexes
  `idx_user_audit_actor_created` (`actor_user_id`,`created_at`),
  `idx_user_audit_resource_created` (`resource_type`,`resource_id`,`created_at`),
  and `idx_user_audit_created` (`created_at`).
- **DATABASE FACT — foreign keys:** `actor_user_id` → `users.user_id`,
  SET NULL on delete and RESTRICT on update.
- **DATABASE FACT — checks/defaults:** No check shown; `created_at` is
  database-defaulted.
- **CODE FACT:** Current audit writer inserts into `user_audit_logs` using
  these snapshot column names and omits `created_at`.

### `customer_merge_history`

- **DATABASE FACT — columns:** `merge_history_id CHAR(36) NOT NULL`;
  `source_customer_id CHAR(36) NOT NULL`;
  `target_customer_id CHAR(36) NOT NULL`; `target_user_id CHAR(36) NOT NULL`;
  `verified_by_user_id CHAR(36) NOT NULL`;
  `verification_reference VARCHAR(500) NOT NULL`;
  `merge_reason VARCHAR(500) NULL`;
  `merged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
- **DATABASE FACT — keys/indexes:** PK `merge_history_id`; index
  `fk_merge_target_user` (`target_user_id`); indexes
  `idx_merge_source_customer` (`source_customer_id`,`merged_at`),
  `idx_merge_target_customer` (`target_customer_id`,`merged_at`), and
  `idx_merge_verified_by` (`verified_by_user_id`,`merged_at`).
- **DATABASE FACT — foreign keys:** Source/target IDs reference
  `customers.customer_id`; target/verifier user IDs reference `users.user_id`.
  All are RESTRICT on delete/update.
- **DATABASE FACT — checks/defaults:** `chk_merge_source_not_target` requires
  source and target IDs differ. `merged_at` is database-defaulted.
- **CODE FACT:** No current merge service/repository or migration was found.
  **PENDING:** Requiredness/meaning of verifier and verification reference,
  data movement, authorization, and transaction/audit behavior.

### `internal_token_replays`

- **DATABASE FACT:** Absent from the dated dump.
- **CODE FACT — migration 005 candidate columns:** `internal_token_replay_id`
  generated auto-increment primary key; `issuer VARCHAR(255) NOT NULL`;
  `jti VARCHAR(128) NOT NULL`; `client_id VARCHAR(64) NOT NULL`;
  `expires_at DATETIME(3) NOT NULL`; `created_at DATETIME(3) NOT NULL`.
- **CODE FACT — migration 005 candidate indexes/storage:** unique
  `internal_token_replays_issuer_jti_unique` (`issuer`,`jti`); index
  `internal_token_replays_expires_at_index` (`expires_at`); InnoDB,
  `utf8mb4`, `utf8mb4_bin`.
- **CODE FACT — constraints/defaults:** No foreign key or check is defined;
  no timestamp default is defined. Repository supplies all five non-PK fields.
- **PENDING:** Confirm the canonical schema and target-server ability to create
  the composite UTF-8 unique index before an approved migration.

## 3. Migration assessment

All five files were inspected. Their names/order are not evidence of applied
history. Knex configuration points to `./migrations` and uses
`knex_migrations`; the dump has neither that ledger nor its DDL.

| Migration | Purpose and DDL | Snapshot compatibility / conflicts | Dependencies and reuse |
|---|---|---|---|
| `202611110001_create_user_service_auth_schema.js` | Creates `users`, `roles`, `customers`, `user_roles`. Defines PKs; unique user email, role code/name, and customer user ID; composite user-role PK; role-ID index; user/role/customer FKs; and registered-vs-guest customer check. All FKs use ON UPDATE CASCADE; deletes are RESTRICT, including `user_roles.assigned_by`. InnoDB/utf8mb4/`utf8mb4_unicode_ci`; no timestamp defaults. | **BLOCKER:** all four tables already exist in the dump. It omits users/roles/customer/user-role timestamp fields/defaults; defines `users.status` as unconstrained string with no ACTIVE default; requires `customers.email`; permits only REGISTERED/GUEST and omits merge pointer; omits `user_roles.assigned_at` and its assigned-by index; assigned-by delete action is RESTRICT rather than SET NULL. | Depends only on a database with no conflicting objects; its own FKs require users/roles in stated creation order. **Not safe to reuse** as the canonical baseline for dump-shaped data or current complete requirements. An empty database would avoid name collisions but still produce an incomplete/incompatible schema. |
| `202611110002_create_refresh_token_sessions.js` | Creates `refresh_token_sessions` with `token_id` PK; separate `session_id`; unique token hash; expiry, revocation, replacement and created timestamps; session/user/expiry indexes; user FK and self-FK to `token_id`. Both FKs use ON UPDATE CASCADE; user delete is RESTRICT and replacement delete SET NULL. No checks or column defaults are declared. | **BLOCKER:** dump/runtime use `session_id` as PK, require `token_family_id`, replacement FK points to `session_id`, and dump has nullable `last_used_at` plus expiry and non-self checks. Migration 002 does not supply these and cannot represent the current runtime's row contract. | Requires `users` from 001. **Not safe to reuse** for the current runtime or dump schema. |
| `202611110003_create_role_permissions.js` | Creates `permissions` and `role_permissions`; unique permission code; composite role-permission PK; permission and assigned-by indexes; role/permission/assigned-user FKs. Role/permission FKs cascade on delete; assigned-by FK restricts delete; all use update cascade. No timestamp defaults or checks. | **BLOCKER:** both tables exist in the dump. It omits `permissions.created_at` and unique `permission_name`, uses `TEXT` for description, adds `role_permissions.assigned_by` (not in dump or current seed), omits `assigned_at`, and uses CASCADE for role/permission deletes rather than RESTRICT. | Requires roles/users from 001. **Not safe to reuse** for canonical permission/role tables. |
| `202611110004_create_audit_logs.js` | Creates `audit_logs` with target-entity, occurred-at, outcome, request-id, metadata fields; PK; actor/time, target/time, and action/time indexes; actor FK with ON DELETE SET NULL / ON UPDATE CASCADE. No timestamp default or checks. | **BLOCKER:** dump and current writer use `user_audit_logs` with resource/reason/created-at fields. This migration's table name and columns are incompatible with both. | Requires users from 001. **Not safe to reuse** for the current runtime or dump. |
| `202611110005_create_internal_token_replays.js` | Creates the replay table described in §2 with a generated PK, unique issuer/JTI, and expiry index. | **DATABASE FACT:** table absent in dump. **CODE FACT:** columns and atomic duplicate handling match the current repository contract. It does not resolve other schema gaps. | No FK dependency. **Conditionally reusable only** after approval, target-version/index validation, and confirmation that a baseline will not already create the table. Not evidence of applied status. |

- **CODE FACT / BLOCKER:** A fresh database migrated with 001–005 would not
  contain `customer_merge_history` or `user_audit_logs`; it would instead
  contain `audit_logs` and incompatible definitions for several runtime
  tables. Therefore the checked-in migration sequence is not a complete,
  safe canonical baseline for this assessment.
- **CODE FACT:** `DATABASE-COMPATIBILITY-SPECIFICATION.md` has stale source
  descriptions in places: it describes the old `token_id` refresh model,
  `audit_logs` writer, and a permission seed that writes `assigned_by`.
  Current `authService.js`, `auditLogService.js`, and `002_permissions.js`
  differ and align with the dump's refresh/audit/role-permission column
  conventions. Use direct current source for runtime behavior and the SQL
  dump only for its dated DDL; do not treat older report claims as verified
  live state.
- **PROPOSAL:** Preserve all existing migration files and their historical
  meaning. If approved, introduce a separately reviewed baseline/migration
  strategy; do not silently edit or mark incompatible migrations as applied.

## 4. Seed assessment

### `001_roles.js`

- **CODE FACT:** Defines CUSTOMER/Customer, TECHNICIAN/Technician, and
  ADMIN/Admin, with null descriptions; generates IDs and runs in a transaction.
  It adds no STAFF role.
- **CODE FACT:** Re-running skips a matching code/name without changing its
  existing ID or description. A code/name mismatch throws; a name already
  owned by another role also throws. It does not overwrite or delete roles.
- **PROPOSAL:** Run before permission seed only against a verified isolated
  database with approved schema. Review unexpected existing roles rather than
  treating this seed as a role reconciliation tool.

### `002_permissions.js`

- **CODE FACT:** Defines all permission codes from shared constants and the
  four User-Service `user.*` admin permissions. It verifies existing
  permission-code/name consistency, inserts missing definitions, and runs in a
  transaction. It requires the role seed to have populated all three role
  codes.
- **APPROVED DECISIONS:** `payment.record` → ADMIN;
  `payment.view_own` → CUSTOMER.
- **CODE FACT:** The current seed assigns only those two pairs, inserts only
  `role_id` and `permission_id` into `role_permissions`, and relies on the
  database's `assigned_at` default. There is no `role_permissions.assigned_by`
  column in the dump or current seed.
- **APPROVED DECISIONS:** `can_refund` remains denied/undefined; no STAFF role;
  all other role-permission mappings remain **PENDING**.
- **CODE FACT:** Seeding is add-only/idempotent for known permission
  definitions and the two approved pairs. It does not remove extra permission
  definitions or pre-existing assignments and is not a reconciliation
  mechanism. A conflicting existing permission name or missing role throws.
- **BLOCKER:** Do not infer grants from `ROLE_PERMISSIONS`, legacy mappings,
  README text, or earlier compatibility prose. Some checked-in documentation
  and integration-test expectations describe additional grants and the legacy
  `audit_logs`/permission schema; they conflict with the supplied approval
  boundary and current seed. Reconcile those expectations before using the
  test suite as a release gate.

**PROPOSAL — safe order:** (1) verify baseline and target, (2) run roles seed,
(3) run permissions seed, (4) verify exact role rows, permission definitions,
and approved pairs; verify there is no `can_refund`, STAFF, or unauthorized
role-permission pair. Stop on conflicts; do not use `ON DUPLICATE KEY UPDATE`
or destructive cleanup.

## 5. Replay storage assessment

- **CODE FACT:** After token signature and claim checks, the verifier calls
  `consumeJti` before returning an authenticated service identity. Repository
  performs one insert into `internal_token_replays`; it does not SELECT first
  or fall back to memory.
- **CODE FACT:** Unique `(issuer,jti)` is the atomic duplicate guard.
  `client_id` is persisted but is not part of the unique key. A MySQL duplicate
  (`ER_DUP_ENTRY` / 1062) is classified as replay; other storage errors and
  unverifiable insert outcomes fail closed with service-unavailable behavior.
- **CODE FACT:** `expires_at` is stored as JWT `exp` plus the existing
  30-second clock skew. `created_at` is supplied by the repository. No TTL or
  replay design change is proposed here.
- **CODE FACT:** `cleanupExpired()` deletes only where `expires_at <` the
  start of the current UTC second, preserving the verifier's whole-second
  acceptance boundary. No production scheduler/call site was found; cleanup
  is an explicit repository operation.
- **NOT VERIFIED:** Real MySQL duplicate races, committed durability,
  timestamp behavior, target index-length compatibility, and external cleanup
  scheduling. The unit test uses a stub database and does not establish those
  properties.
- **BLOCKER:** If internal auth is enabled against a database without this
  table, accepted-token replay inserts fail closed. Migration 005 must not be
  presumed applied or run without environment and schema approval.

## 6. Fresh isolated development/test strategy

Everything below is **PROPOSAL only**; no database was created or changed.

1. **Identify and isolate:** Use a newly provisioned, disposable database
   owned by the User-Service team, with a unique test-only name and dedicated
   least-privilege credentials. Verify the database/server identity directly
   with its owner; do not use Railway or an unknown endpoint. Do not expose or
   copy credentials into this plan.
2. **Check prerequisites:** Confirm the MySQL version supports the approved
   InnoDB, JSON, `DATETIME(3)`, and CHECK requirements, charset/collation, and
   required index lengths. Reconcile dump version evidence with target
   compatibility; do not assume the dump is the baseline.
3. **Approve a canonical baseline:** Produce an architect-reviewed schema
   contract for all ten tables, including the unresolved merge and migration
   history decisions. Existing 001–004 cannot serve as-is. Select a reviewed
   new baseline/squash or explicitly designed migration path that creates
   exactly the approved table/constraint definitions. Decide whether replay
   table 005 is applied separately or incorporated, never both.
4. **Initialize once:** Only after approval and verified empty schema,
   initialize the reviewed baseline using the approved migration mechanism.
   Record migration history that accurately represents the executed baseline;
   never fabricate a record that 001–004 ran. Confirm actual Knex ledger and
   lock-table behavior as part of the reviewed plan.
5. **Seed:** Run `001_roles.js`, then `002_permissions.js`, transactionally.
   On any mismatch, stop and inspect; seeds are not schema repair tools and
   do not delete unapproved assignments.
6. **Verify before service use:** Run the objective checklist in §8 against
   the initialized database, including all columns, indexes, FK actions,
   checks, defaults, engines/collations, seed pairs, replay unique index, and
   migration history. Run only explicitly approved integration tests against
   this isolated database after validating every destructive test guard.
7. **Environment guards:** Use separate DB identities/configuration for
   development and tests. Current integration tests require explicit
   `USER_SERVICE_ALLOW_*_DATABASE_TESTS=1` and `DB_TEST_*`; some require
   loopback and a test-only name, and the general migration integration test
   requires an initially empty schema and may migrate/seed/drop allowlisted
   objects. Its protections do not authorize a non-test or remote target.
8. **Rollback and backup:** Before initialization, capture the empty-schema
   state and verify a restorable post-baseline backup. For a disposable
   database, rollback/recreation may be considered only under approved,
   explicit test controls. Do not run migration `down` against populated or
   shared databases. Dropping replay storage destroys replay history; no
   rollback may remove rows while their tokens remain acceptable.

## 7. Existing environment inspection and reconciliation

- **PROPOSAL:** Before any future connection, obtain explicit environment
  identification/authorization from the database owner. Confirm service,
  environment, host/port, database name, account purpose, and whether writes
  are prohibited; do not infer identity from `.env.example`, a dump header,
  or a familiar hostname.
- **PROPOSAL:** Use a read-only account/session and inspect `information_schema`
  for table/column types, nullability, defaults, generated/update behavior,
  indexes/uniques, FK targets and delete/update rules, CHECK clauses, engines,
  charset/collation, and Knex migration history. Save the observation as
  environment- and timestamp-scoped evidence; compare it to §2 and current
  runtime expectations. Do not run DDL, seeds, or migration commands during
  inspection.
- **DATABASE FACT:** The supplied dump records a prior snapshot only.
  **NOT VERIFIED:** Whether a current target matches it, whether later
  migrations ran, or whether any deployed table has changed.
- **BLOCKER:** The actual live schema and applied-migration ledger are
  unverified. Filenames, local test results, and `knex_migrations` configuration
  do not prove applied history.
- **PROPOSAL:** After read-only reconciliation, present drift and alternatives
  to the Solution Architect/database owner. A future write requires a separate
  explicit approval, exact target re-identification, verified restorable
  backup, reviewed DDL/data plan, maintenance/rollback plan, and a second
  pre-write identity check. Do not baseline, mark migrations, or repair drift
  by assumption.

## 8. Readiness checklist — all required before starting on a new database

The database owner/release operator must record **PASS/FAIL** evidence for each
item. Any missing, extra, or mismatched required object is a **FAIL** pending
review, not permission to repair automatically.

- [ ] **Target identity:** Explicitly identified, isolated User-Service
  development/test database; correct credentials and environment; no
  production/shared endpoint.
- [ ] **Baseline/history:** Architect-approved canonical baseline selected;
  schema matches it; migration ledger matches executed migrations; no
  unverified or fabricated applied-migration entries.
- [ ] **Tables:** Exactly the required User-Service tables exist:
  `users`, `customers`, `roles`, `user_roles`, `permissions`,
  `role_permissions`, `refresh_token_sessions`, `user_audit_logs`,
  `customer_merge_history`, and `internal_token_replays`. Knex's migration
  metadata tables are accounted for separately. No `audit_logs` substitute
  may stand in for `user_audit_logs`.
- [ ] **Columns/defaults:** Each table's column names, data types, widths,
  nullability, enum domains, defaults, auto-update behavior, and generated
  values match the approved schema inventory. In particular, verify
  `role_permissions.assigned_at` exists and `assigned_by` does not; confirm
  refresh session identity/family/replacement fields and audit column names.
- [ ] **Indexes/uniques:** Verify all PKs, unique email/code/name/user/token
  constraints, composite role keys, lookup/expiry indexes, merge indexes, and
  replay unique `(issuer,jti)` plus `expires_at` cleanup index with exact
  ordered columns.
- [ ] **Foreign keys/checks:** Verify all expected FK references and
  ON DELETE/ON UPDATE rules, customer type/self-merge checks, refresh expiry
  and non-self replacement checks, and merge source-not-target check. Confirm
  server enforces the approved checks.
- [ ] **Storage:** All tables use the approved engine, charset, and collation;
  replay composite index is creatable and present. The dump's and migrations'
  different collations must be resolved rather than silently mixed.
- [ ] **Seed state:** CUSTOMER, TECHNICIAN, ADMIN only; permission definitions
  match the approved catalog; `payment.record` → ADMIN and
  `payment.view_own` → CUSTOMER are present exactly once; `can_refund`, STAFF,
  and all other unapproved grants are absent. Any pending route grants have
  explicit disposition before asserting full application authorization
  readiness.
- [ ] **Replay behavior:** Table and unique key are present; repository insert
  columns fit; duplicate handling fails closed; `client_id`, `expires_at`, and
  `created_at` are present; expiry cleanup follows the existing strict,
  skew-aware rule. Cleanup operations/scheduling are owned and documented
  without changing TTL.
- [ ] **Service gate:** Schema verification runs before declaring the service
  ready. **CODE FACT:** `server.js` currently starts listening without a
  full schema check; `/health` only executes `SELECT 1`. Connectivity alone
  is not schema readiness. A future startup/readiness gate requires separate
  approval and implementation.
- [ ] **Test evidence:** Any database test is explicitly opted in and points
  to the isolated approved target. Do not use the current general migration
  integration test as proof of this target: it expects nine migration-created
  tables including `audit_logs`, old refresh columns, and `assigned_by` in
  `role_permissions`, and it performs migrations/seeds/cleanup. It conflicts
  with this ten-table inventory.
- [ ] **Approval/backup:** Solution Architect and database owner approve the
  baseline, seed policy, environment, test evidence, and rollback plan; a
  restorable backup exists where data is retained.

**PENDING:** Remaining permission mappings, customer merge semantics, exact
canonical schema authority, migration-baseline mechanism/history, target
collation strategy, replay cleanup operation owner/schedule, and whether the
unused refresh `last_used_at` field has a policy requirement.

## 9. Investigation record

### Files inspected

- `C:\Users\UsER\Downloads\dump-user_db-202611131507.sql` (DDL only; no database
  connection)
- `backend/user-service/knexfile.js`, `.env.example`, `server.js`,
  `package.json`, and `README.md`
- All five files under `backend/user-service/migrations/`
- Both files under `backend/user-service/seeds/`
- Relevant current code: `src/config/database.js`,
  `src/services/authService.js`, `auditLogService.js`,
  `permissionService.js`, `userAdministrationService.js`,
  `guestCustomerLinkingService.js`, `internalServiceAuthService.js`,
  `internalTokenReplayRepository.js`, `src/constants/adminPermissions.js`,
  and `backend/shared/constants/index.js`
- Relevant tests: role/permission seed tests, database integration test,
  refresh database integration test, and replay repository/migration tests
- Existing compatibility reports: `DATABASE-COMPATIBILITY-SPECIFICATION.md`,
  `USER-SERVICE-DATABASE-RECONCILIATION.md`,
  `AUDIT-COMPATIBILITY-ANALYSIS.md`,
  `PERMISSION-ROLE-MAPPING-ANALYSIS.md`,
  `REPLAY-PROTECTION-COMPATIBILITY-ANALYSIS.md`, and
  `INTERNAL-AUTH-COMPATIBILITY-ANALYSIS.md`

### Test and connection status

- **TEST FACT:** No tests were run. This is a documentation-only assessment;
  database integration tests are opt-in and may create, migrate, seed, or
  clean test objects, so they were intentionally skipped.
- **NOT VERIFIED:** No live schema or migration history was inspected.
- **Database connection confirmation:** **No database connection was
  attempted or made.** No Railway or unknown database was contacted.

### Approval gate

This plan does not authorize implementation, DDL, seeds, migration execution,
ledger updates, or database inspection against a live environment. **Wait for
Solution Architect approval before implementation.**
