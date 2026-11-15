# User-Service Database Architecture Decisions

**Status:** Decision package for Solution Architect review — **NOT APPROVED**
**Scope:** Com-tle User-Service
**Mode:** Documentation only. No code, migration, seed, schema, or database
operation was performed. No Railway or other database was contacted.

## Decision status and evidence labels

Each item below is a **PROPOSAL**, not an approved architecture decision.
Solution Architect approval and the listed dependencies are required before
implementation.

- **CODE FACT** — verified in current source, migration, seed, config, or test.
- **DATABASE FACT** — observed in the dated SQL dump only; not a live-state
  statement.
- **PROPOSAL** — recommended option for approval; not authorization to execute.
- **PENDING** — decision or evidence is still missing.
- **NOT VERIFIED** — not inspected or not established.

## Decision summary

| ID | Proposed direction | Status |
|---|---|---|
| DB-01 | Use a reviewed, runtime-compatible ten-table schema contract. Treat the nine-table dump and migration 005 as evidence inputs, not authority; reconcile conflicts before declaring the contract canonical. | **PROPOSAL — NOT APPROVED** |
| DB-02 | For new environments, use an immutable, versioned schema-only snapshot plus a dedicated baseline identity/history mechanism. Keep legacy migration history truthful; do not record old migrations as applied without evidence. | **PROPOSAL — NOT APPROVED** |
| DB-03 | Do not implement or infer merge semantics. Preserve existing registered/guest behavior; separately approve merge eligibility, proof, side effects, and audit/transaction rules. | **PROPOSAL — NOT APPROVED** |
| DB-04 | Preserve existing collations pending approval. Explicitly decide comparison behavior by field, especially email uniqueness and replay identity, before schema changes. | **PROPOSAL — NOT APPROVED** |
| DB-05 | Do not enable cleanup now. Assign an operational owner; if approved later, prefer a single externally orchestrated execution with monitoring, using the existing function and unchanged retention rule. | **PROPOSAL — NOT APPROVED** |

## DB-01 — Canonical database schema

**Status: PROPOSAL — NOT APPROVED**

### Problem

There is no single verified schema description shared by the supplied dump,
the five migrations, and current runtime requirements. A canonical ten-table
contract must be approved before baselining a new database or reconciling an
existing one. This proposal does not claim the dump is the production source
of truth.

### Current facts

- **DATABASE FACT:** The dated dump contains nine expected User-Service tables
  and omits `internal_token_replays`. It defines `customer_merge_history` and
  `user_audit_logs`.
- **CODE FACT:** Current application code uses
  `users`, `customers`, `roles`, `user_roles`, `permissions`,
  `role_permissions`, `refresh_token_sessions`, and `user_audit_logs`.
  The internal-auth repository also requires `internal_token_replays`.
  `customer_merge_history` has no current service operation.
- **CODE FACT:** Migration 001–004 do not reproduce the dump/runtime schema.
  Migration 004 creates `audit_logs`; migration 005 creates the expected
  replay table but does not create `customer_merge_history` or
  `user_audit_logs`.
- **NOT VERIFIED:** Whether a live database matches the dump, whether
  migrations ran, and which schema/history is intended.
- **CODE FACT:** The complete observed dump DDL and migration-005 replay
  contract are inventoried in
  [USER-SERVICE-MIGRATION-BASELINE-PLAN.md](./USER-SERVICE-MIGRATION-BASELINE-PLAN.md).

### Candidate ten-table contract

**PROPOSAL:** Use the dump's nine table definitions and migration 005's replay
definition as the initial comparison baseline, then reconcile each item below
against runtime behavior and approved business requirements. This candidate
must not be applied or treated as canonical until approved.

| Table | Candidate source | Unresolved schema details and decision questions |
|---|---|---|
| `users` | Dump | Migration 001 uses `VARCHAR(20) NOT NULL` status without enum/default, omits `created_at`/`updated_at` and their defaults, and omits status/created indexes. Decide these exact types/defaults/indexes and email's case/accent uniqueness behavior. PK/email/password/phone are used by runtime. |
| `customers` | Dump | Migration 001 makes `email` NOT NULL (dump allows NULL), limits type to REGISTERED/GUEST (dump adds MERGED), omits merge pointer and timestamp columns/defaults, and omits phone/email/merge-pointer indexes. It has a user FK but no merge self-FK; its user FK uses ON UPDATE CASCADE whereas dump uses RESTRICT. Decide the type/link and non-self checks, FK actions, and these columns/indexes exactly; no additional merge behavior may be inferred. |
| `roles` | Dump | Migration 001 uses `TEXT` description rather than `VARCHAR(500)` and omits `created_at` default. Confirm both unique code/name keys, their case behavior, and timestamp definition. Seed reads/inserts ID/code/name/description only. |
| `user_roles` | Dump | Migration 001 omits `assigned_at` default and the `assigned_by` index. Its FKs use ON UPDATE CASCADE, while dump uses RESTRICT; assigned-by delete is RESTRICT in migration versus SET NULL in dump. Decide exact index and all FK actions. Keep attribution separate from `role_permissions`. |
| `permissions` | Dump | Migration 003 uses `TEXT` description, omits `created_at` default and unique `permission_name`; it defines only the unique permission code. Decide exact type, both unique keys, and default. |
| `role_permissions` | Dump | Migration 003 adds `assigned_by`, its index and FK; dump and current seed do not use that column. Migration omits `assigned_at` default, uses CASCADE deletes for role/permission FKs, and ON UPDATE CASCADE; dump uses RESTRICT on both update/delete. Decide exact columns/index/FK actions; current seed inserts only role and permission IDs. |
| `refresh_token_sessions` | Dump | Migration 002 makes `token_id` the PK and has a separate `session_id`; dump/runtime use `session_id` as PK. Migration omits `token_family_id`, `last_used_at`, dump's user+created/family+revoked/replacement indexes, and both checks; its replacement FK points to `token_id` and uses SET NULL/UPDATE CASCADE rather than the dump's `session_id` target and RESTRICT rules. It omits the `created_at` default. Decide exact column/PK/index/check/FK/default contract; decide `last_used_at` meaning separately below. |
| `user_audit_logs` | Dump | Migration 004 creates a different `audit_logs` table with target-entity, occurred-at, outcome, and request-id columns; it does not create the dump's resource/reason/created-at columns or actor/resource/created indexes. It also names a different actor FK/table and has no `created_at` default. Decide table name, columns, indexes, FK actions, and timestamp default; current writer uses `user_audit_logs`. |
| `customer_merge_history` | Dump | No migration creates this table. Confirm all observed columns (including required verifier/reference), `merged_at` default, four indexes, four internal FKs and RESTRICT actions, and source-not-target check. The required relationships are source/target customer and target/verifier user; merge semantics remain separately pending. |
| `internal_token_replays` | Migration 005 | Confirm the migration's generated PK, required issuer/JTI/client/expiry/created columns, unique `(issuer,jti)`, expiry index, InnoDB and `utf8mb4_bin` collation. It is absent from dump. Validate server support for the composite index before any approved creation. No FK/check or timestamp default is defined. |

### Cross-table relationships and storage questions

- **DATABASE FACT:** The dump's candidate relationships are all within the
  User-Service database: customer-to-user and customer self-reference;
  user-role to user/role/assigned-by user; role-permission to role/permission;
  refresh session to user and replacement session; audit actor to user; merge
  history to source/target customers and target/verifier users.
- **PENDING:** Approve whether these references and delete/update rules are the
  canonical relationships. No cross-service FK should be inferred.
- **DATABASE FACT:** The dump's nine tables use InnoDB, `utf8mb4`, and
  `utf8mb4_0900_ai_ci`. Migrations 001–004 use `utf8mb4_unicode_ci`; migration
  005 uses `utf8mb4_bin`.
- **PENDING:** Decide table/column collation and engine policy across the ten
  tables. Preserve current definitions until a decision is approved; details
  and comparison implications are in DB-04.
- **NOT VERIFIED:** Whether dump defaults, indexes, constraints, or storage
  options exist in any live environment.

### Options

1. **Adopt dump DDL as-is for the nine present tables and migration 005 for
   replay.** Least divergence from the dated evidence and several current
   runtime mappings. **Trade-off:** still an unapproved snapshot, leaves
   customer merge semantics unresolved, and requires validating replay
   collation/index compatibility.
2. **Adopt the exact current migration 001–005 result.** It is reproducible
   from the checked-in migrations. **Trade-off:** it omits two expected tables
   and diverges from current runtime and dump on refresh, audit, permission,
   customer, and other definitions. Not recommended.
3. **Approve a reconciled canonical contract across the ten tables.**
   Reuse verified dump definitions where they satisfy runtime and approved
   rules; document every accepted deviation and unresolved decision.
   **Trade-off:** requires explicit schema review and future migration/test
   work before it can be used.

### Recommendation

**PROPOSAL:** Select option 3. Use the dump and migration 005 as schema
evidence, not authority. Preserve the current runtime's observed contracts,
avoid adding merge behavior or permission policy, and leave all unresolved
items as blockers until their owners decide. No schema edits are authorized.

### Risks

- Treating the dated dump as live truth can misidentify or overwrite a
  different environment.
- Treating migrations as canonical can create a baseline incompatible with
  current runtime and missing required tables.
- Resolving `MERGED`, FK actions, defaults, or indexes without owners could
  alter data-retention, identity, or uniqueness behavior.

### Required approval and dependencies

Approval: Solution Architect, User-Service owner, and database/schema owner.
Dependencies: confirmed runtime contract, customer-merge requirements,
permission mapping decision, collation decision (DB-04), migration history
strategy (DB-02), and target MySQL capability check.

## DB-02 — Migration baseline history

**Status: PROPOSAL — NOT APPROVED**

### Problem

The five historical migration files do not produce the candidate canonical
schema. Migration execution history and live schema are **NOT VERIFIED**.
Any fresh-environment strategy must preserve truthful history and avoid
claiming that an old migration ran when it did not.

### Current facts

- **CODE FACT:** Knex uses `./migrations` and the `knex_migrations` history
  table. The dated dump includes no `knex_migrations` table.
- **CODE FACT:** Migrations 001–004 are not safe as a complete candidate
  baseline; 005 is only conditionally reusable for replay storage.
- **NOT VERIFIED:** Whether any environment has migration rows, what those
  rows record, or whether the recorded schema matches them.

### Options

1. **New initial baseline migration.** Create one reviewed migration that
   builds the approved schema on a fresh empty database.
   - **Trade-offs:** Knex provides a familiar migration ledger and repeatable
     execution. However, the existing earlier filenames will be discovered
     and run before a later baseline migration if left in the same migration
     directory. The old sequence must therefore be retired or isolated from
     the new generation under an explicitly versioned migration directory/
     config; merely adding a later file is unsafe.
2. **Versioned schema-only snapshot with controlled history.** Publish an
   immutable, versioned schema DDL artifact (no dump data) plus a dedicated
   baseline identifier and documented process for initializing the matching
   migration history.
   - **Trade-offs:** Clear, reviewable point-in-time schema and straightforward
     restoration. A hand-entered history marker can conceal drift unless it
     names the snapshot and is only written after exact schema verification.
     Knex's migration directory/ledger behavior must be designed so legacy
     migrations are not also replayed.
3. **Forward-only reconciliation migrations for an existing database.**
   After an approved read-only inspection, add only reviewed migrations that
   move its known schema to the canonical contract.
   - **Trade-offs:** Preserves known history and avoids destructive rebuilds.
     It is not viable before environment/history verification and can require
     careful data-preserving transformations.
4. **Manual schema administration without versioned history.**
   - **Trade-offs:** Simple for a one-off database but provides poor
     reproducibility and auditability; not recommended as the normal approach.

### Recommendation

**PROPOSAL:** Adopt option 2 as the schema authority for fresh environments,
with a separately versioned and controlled baseline execution mechanism
(option 1's migration-backed execution) after DB-01 is approved. Use option 3
only for an existing environment after read-only schema/history reconciliation
and explicit write approval. Do not import the dated dump's data as a
baseline.

### Truthful history rules

- Never insert migration-history rows for 001–005 unless an inspection proves
  those exact migrations ran in that environment.
- A new environment must record the new baseline under its own distinct,
  accurate identifier; the record must mean “this approved baseline was
  applied,” not “legacy 001–004 were applied.”
- Do not add a newer baseline migration to the same active directory while
  leaving Knex free to execute incompatible older migrations first.
- For an existing environment with absent/ambiguous history, stop. Preserve
  the evidence, determine actual schema and migration lineage, and obtain
  approval before adopting any baseline marker or reconciliation migration.
- Do not edit historical migration files to make them appear compatible with
  a state they did not create.

### Risks

Misleading history can mask drift and cause future migrations to fail or skip
required work. A snapshot generated from the wrong database can canonize
incorrect structure. Concurrent schema ownership can invalidate a baseline.

### Required approval and dependencies

Approval: Solution Architect, database owner, and service owner. Dependencies:
DB-01 canonical schema and verified MySQL target capabilities. Existing
database execution additionally depends on DB-03 through DB-05 decisions where
they affect schema or operations.

## DB-03 — Customer merge behavior

**Status: PROPOSAL — NOT APPROVED**

### Problem

The candidate schema includes `MERGED`, `merged_into_customer_id`, and
`customer_merge_history`, but source code provides no customer-merge workflow.
Schema presence is not approval of merge semantics.

### Current facts

- **DATABASE FACT:** The dump's `customers` table permits `MERGED`, has a
  nullable self-reference, and checks for a non-self pointer plus type/link
  consistency. `customer_merge_history` requires source/target customer IDs,
  target/verifier user IDs, and a verification reference; it records an
  optional reason and merge timestamp, has FKs, and checks that source and
  target differ.
- **CODE FACT:** No merge service, route, repository query, or migration for
  `customer_merge_history` was found.
- **CODE FACT:** Registration creates a `REGISTERED` customer. The internal
  guest-linking service is a different behavior: it changes one existing
  `GUEST` customer to `REGISTERED`, associates an ACTIVE user, retains that
  customer ID, and writes an audit event in the same transaction. It is not a
  merge.
- **NOT VERIFIED:** The dump does not establish whether the merge schema is
  current or whether related records exist in another system.

### Options

1. **Keep merge schema as reserved data model; no merge operation.**
   Preserves current code behavior and avoids inferring business rules.
   Trade-off: `MERGED` data cannot be created or interpreted through this
   service until a workflow is approved.
2. **Approve a separate merge specification before implementation.**
   Trade-off: supports future merges but requires product/security decisions
   and explicit handling of related records, authorization, identity proof,
   and audit history.
3. **Treat guest linking as a merge.** Not recommended: current operation
   retains the customer ID and converts the guest to registered, while the
   dump's merge model has source/target history and a merged pointer. These
   are materially different semantics.

### Recommendation

**PROPOSAL:** Select option 1 for current behavior: do not merge customers or
change the existing guest-linking operation. Require a separately approved
merge specification before any future merge implementation.

### Unresolved business rules

**PENDING:** Which customer types may be sources or targets; who may authorize
and verify a merge; how identity proof is established and what
`verification_reference` contains; whether the target must be registered and
associated with an ACTIVE user; what happens to source `user_id` and profile
fields; how repair/payment/booking references are preserved or re-pointed;
whether merge chains/cycles are allowed; treatment of already-merged
customers; conflict and idempotency behavior; locking/concurrency; transaction
boundary for customer changes, history and audit; reversibility/correction;
and retention/access policy for verification evidence.

### Risks

Guessing could misattribute customer history, weaken identity checks, lose
referential integrity, or expose verification evidence. Treating guest linking
as merging would silently change established identity semantics.

### Required approval and dependencies

Approval: Product/business owner, security/identity owner, Solution Architect,
and database owner. Dependencies: explicit merge lifecycle and proof policy,
related-service ownership decisions, and DB-01 agreement on constraints and
history schema.

## DB-04 — Collation strategy

**Status: PROPOSAL — NOT APPROVED**

### Problem

The dump and migrations use three different collations. Collation affects
uniqueness and equality for textual identifiers. It must be intentional,
particularly for email addresses and replay identifiers.

### Current facts and comparison behavior

- **DATABASE FACT:** The dump's nine tables use `utf8mb4_0900_ai_ci`.
  This is case-insensitive and accent-insensitive for character comparisons.
- **CODE FACT:** Migrations 001–004 set `utf8mb4_unicode_ci`, also a
  case-/accent-insensitive collation, but with different Unicode collation
  behavior/version from `_0900_ai_ci`.
- **CODE FACT:** Migration 005 sets `utf8mb4_bin`, a binary/case-sensitive
  collation for replay-table strings.
- **CODE FACT:** User registration/login normalize email to lowercase in
  application code. The dump's unique email key inherits its table
  collation; its uniqueness therefore also treats case- or accent-equivalent
  values as equal under that collation.
- **CODE FACT:** Refresh token hashes are SHA-256 lowercase hexadecimal text.
  The dump's unique `CHAR(64)` hash inherits the case-insensitive table
  collation, although normal code writes lowercase hashes.
- **CODE FACT:** The replay unique key uses `(issuer,jti)`. Under migration
  005's binary collation, case-distinct issuer/JTI values are distinct.
  `client_id` is stored but is not part of this unique key.
- **CODE FACT:** Internal verifier service identity comparisons use exact
  application string equality and configured allowlist/key-to-service
  mappings. Service IDs are validated in lowercase syntax; issuer is checked
  against the configured issuer.
- **NOT VERIFIED:** Actual live per-column/table collations and any
  environment-specific overrides.

### Options

1. **Preserve observed per-table collation:** `_0900_ai_ci` on the nine dump
   tables and `_bin` for replay.
   - Trade-off: aligns to observed DDL and exact replay tuple matching;
     leaves email/other text identifiers case/accent-insensitive and allows
     cross-table collation differences.
2. **Standardize all tables to a single case-insensitive collation.**
   - Trade-off: more uniform text queries, but issuer/JTI uniqueness could
     collapse case-distinct tokens and behavior may differ from application
     exact equality. Requires explicit handling of existing collisions.
3. **Use binary/case-sensitive collations for all identifiers.**
   - Trade-off: aligns exact comparisons but changes email uniqueness and
     lookup behavior; case variants can coexist unless normalized/validated
     elsewhere. This is a behavior change and is not recommended without
     explicit policy.
4. **Use column-specific collations by identifier purpose.**
   - Trade-off: can make email and token identities explicit, but adds schema
     and query complexity and requires approved decisions per field.

### Recommendation

**PROPOSAL:** Do not change any existing collation as part of this task.
Preserve the dump's observed collations for its nine tables and migration
005's binary replay collation as a candidate only, pending DB-01 approval.
Before any future schema operation, approve comparison expectations for
email, permission/role codes, refresh token hashes, issuer, JTI, and
`client_id`; test duplicate/case/accent cases against the exact target MySQL
version. Keep application-level exact service-identity validation regardless
of database collation.

### Risks

Unreviewed collation changes can reject formerly distinct data, allow
unintended variants, alter unique constraints, or make database equality
disagree with application identity checks. Replay uniqueness is security
sensitive; the intended case behavior of issuer/JTI must remain explicit.

### Required approval and dependencies

Approval: Solution Architect, database/schema owner, and identity/security
owner. Dependencies: DB-01 target definitions, confirmed target MySQL version,
data collision analysis before any future collation change, and defined email
normalization/uniqueness policy.

## DB-05 — Replay cleanup ownership

**Status: PROPOSAL — NOT APPROVED**

### Problem

Replay rows must remain present while the verifier accepts their tokens.
Storage cleanup exists in code, but no production invocation or owner is
established.

### Current facts

- **CODE FACT:** `createInternalTokenReplayRepository().cleanupExpired()` is
  an explicit repository function. It floors the supplied/current UTC time
  to the start of the current whole second and deletes rows with
  `expires_at < cutoff`.
- **CODE FACT:** `consumeJti` stores `expires_at = exp + 30 seconds` to match
  the existing verifier skew. This package does not propose changing the
  retention or verifier rule.
- **CODE FACT:** No internal production scheduler, startup timer, public
  cleanup route, or other call site for `cleanupExpired()` was found in the
  inspected User-Service source.
- **NOT VERIFIED:** An external scheduler or operational job may exist; it
  was not inspected.
- **CODE FACT:** The replay table has an index on `expires_at`. Cleanup errors
  surface as service-unavailable errors from the repository.

### Options

1. **External scheduled single-run job owned by User-Service operations.**
   Invoke only an approved supported execution path; use least privilege,
   monitoring, and no public endpoint.
   - Trade-off: separates maintenance from request replicas and avoids every
     service instance running a timer. An invocation mechanism is not
     currently established in source.
2. **Dedicated User-Service maintenance worker.**
   - Trade-off: explicit ownership and observability, but adds a deployment
     component and requires single-run/overlap control.
3. **Timer in each application replica.**
   - Trade-off: operationally simple to add, but causes duplicate concurrent
     deletes and unclear ownership/scaling behavior; not recommended.
4. **Manual controlled cleanup runbook.**
   - Trade-off: avoids adding an unsanctioned scheduler, but may allow storage
     growth and depends on an operator following the precise expiry boundary.

### Recommendation

**PROPOSAL:** Do not enable cleanup now. Assign User-Service operations as the
future owner and prefer one externally orchestrated scheduled execution or
dedicated single worker only after its invocation, observability, overlap
prevention, credentials, and failure handling are approved. Until then, a
controlled manual runbook is safer than an uncoordinated per-replica timer.
Any invocation must call the existing cleanup behavior and retain the current
`exp + 30 seconds` storage rule and strict `<` comparison.

### Risks

Deleting replay records before the verifier rejects a token can permit token
reuse. No cleanup can grow storage. Concurrent jobs may create load or obscure
failure ownership. A public unauthenticated cleanup endpoint would expand the
attack surface and is not recommended.

### Required approval and dependencies

Approval: Solution Architect, User-Service service owner, and platform/
operations owner; security review for execution credentials and invocation.
Dependencies: DB-01 replay schema and index, DB-04 issuer/JTI equality,
verified production invocation path, cleanup observability and ownership.

## Additional pending decisions

### `last_used_at`

- **CODE FACT:** Dump has nullable `refresh_token_sessions.last_used_at`;
  current refresh code does not write it. Migration 002 does not define it.
- **PENDING:** Decide whether it means successful refresh, any token
  presentation, or something else; whether it is needed for session
  administration/retention; and whether a write belongs in rotation,
  validation, or both. Do not add writes or change nullability/defaults before
  approval.
- **Recommendation:** Keep current behavior unchanged until the auth/session
  owner decides. Requires Solution Architect and auth/security owner approval.

### Permission mappings and `can_refund`

- **CODE FACT / APPROVED DECISIONS:** Current permission seed creates
  `payment.record` → ADMIN and `payment.view_own` → CUSTOMER only.
- **PENDING:** Every other role-permission grant remains undecided. Do not
  infer grants from legacy constants, documentation, or tests.
- **TASK CONSTRAINT:** `can_refund` remains undefined/denied. No STAFF
  role. `role_permissions` has no `assigned_by` column.
- **Recommendation:** Preserve the two approved payment mappings; keep all
  other mappings unassigned pending owner approval. Do not introduce
  `can_refund` or a role mapping for it. Requires product/security and
  Solution Architect approval for any additional grant.

## Files inspected

- The previous
  [USER-SERVICE-MIGRATION-BASELINE-PLAN.md](./USER-SERVICE-MIGRATION-BASELINE-PLAN.md)
  and its referenced dated SQL dump evidence.
- [Migration 005](./migrations/202611110005_create_internal_token_replays.js),
  [internalTokenReplayRepository.js](./src/services/internalTokenReplayRepository.js),
  [internalServiceAuth.js](./src/constants/internalServiceAuth.js), and
  [internalServiceAuth configuration](./src/config/internalServiceAuth.js).
- [authService.js](./src/services/authService.js) and
  [guestCustomerLinkingService.js](./src/services/guestCustomerLinkingService.js).
- All five migration definitions, both seed files, relevant database
  configuration, permission/audit services, shared role/permission constants,
  integration tests, and existing compatibility reports as itemized in the
  baseline plan.

## Approval gate

No decision in this package is approved. No source, migration, or seed was
changed, and no database was contacted. Wait for Solution Architect approval
before implementation or database work.
