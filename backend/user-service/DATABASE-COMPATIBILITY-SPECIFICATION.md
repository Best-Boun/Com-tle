# Com-tle (SmartFix) User-Service Database Compatibility Specification

**Status:** Draft for review; implementation and Railway verification are pending
**Evidence snapshot:** `dump-user_db-202611131507.sql` (MySQL 8.4.13)
**Scope:** User-Service only. No code, schema, data, or Railway changes were made.

## 1. Evidence and decision boundaries

Labels used below:

- **DUMP FACT** — directly observed in the supplied User-Service SQL dump.
- **CODE FACT** — behavior or expected schema in the current workspace source.
- **HANDOVER LOCKED** — a rule explicitly supplied in the handover.
- **PROPOSAL** — compatibility behavior suggested for implementation; not yet approved.
- **PENDING** — evidence or a decision is missing; do not implement by assumption.

The supplied dump is the schema authority. It is a dated snapshot, not proof that
the current Railway database is reachable or still has exactly that schema. No
Railway connection, live schema inspection, migration, or database write was
performed.

The Master Guide, three member PDFs, and Backend Code Audit PDF are present in
Downloads, but their text could not be reliably extracted with available local
tools. The inspected `Com-tle-main.zip` is materially older than the current
workspace and lacks the current auth/session implementation and migrations.
Business Overview/Rules and ADR-01 Revision 3 were not confirmed in the
inspectable material. Accordingly, the explicit handover rules below are
honored, while any additional decisions that depend on those documents remain
**PENDING**.

The attached **SmartFix – User-Service Implementation Blueprint v1.0** is
readable and has been reviewed. It is explicitly marked **Draft for Review**,
with implementation and database modification authorization not granted. It is
used here as planning input, not as approval to implement its proposals or
modify the database. Where it conflicts with current source behavior, the
conflict is called out below.

The current worktree already contains unrelated modifications and untracked
User-Service/Payment-Service files. This specification is the only file added
for this task.

## 2. Executive findings

1. The dump contains nine of the ten requested tables. `internal_token_replays`
   is absent.
2. The current refresh implementation does not match the dump: it requires
   `token_id`, reuses `session_id` during rotation, and does not use
   `token_family_id` or `last_used_at`.
3. The current audit service writes to `audit_logs` with columns that do not
   exist in the dump. The dump has `user_audit_logs` with a different shape.
4. The permission seed writes `assigned_by` to `role_permissions`; that column
   is absent from the dump. The dump has `assigned_at`.
5. The dump supports `customers.customer_type = 'MERGED'` and has
   `customer_merge_history`; the current source has no merge workflow and its
   migration only permits `REGISTERED` and `GUEST`.
6. The current database integration test validates a schema created by the
   repository migrations, not the supplied Railway dump. Its expected schema
   conflicts with the dump, so it is not evidence of compatibility with the
   current database.
7. No database or HTTP integration test against the supplied schema or Railway
   has been demonstrated.

## 3. Database mapping

The “current source expectation” column describes the checked-in/current
workspace source, not a desired schema. Do not run its migrations against the
target database to make the two agree.

| Table | DUMP FACT: schema and observed data | Current source expectation | Compatibility |
|---|---|---|---|
| `users` | `user_id CHAR(36)` PK; unique `email VARCHAR(255)`; `password_hash VARCHAR(255)`; nullable `phone VARCHAR(30)`; `status ENUM('ACTIVE','DISABLED','LOCKED')` default `ACTIVE`; `created_at`/`updated_at DATETIME(3)` defaults. One user row exists in this snapshot. | Uses the same identity, credential, phone, and status columns. Migration omits timestamps and represents status as an unconstrained string. | **Mostly compatible at query level.** Use DB defaults for timestamps; do not assume the migration is equivalent. |
| `customers` | `customer_id CHAR(36)` PK; nullable unique `user_id`; required `full_name VARCHAR(150)`; nullable phone/email; enum `REGISTERED`, `GUEST`, `MERGED`; nullable `merged_into_customer_id`; created/updated timestamps. Has user and self FKs, and checks for valid type/link consistency and no self-merge. One `REGISTERED` customer exists in this snapshot. | Migration permits only `REGISTERED`/`GUEST`, requires email, and has no merge pointer or timestamps. Services currently register `REGISTERED`, link `GUEST` to `REGISTERED`, and read `customer_type`; no merge operation exists. | **Incompatible migration; incomplete merge behavior.** Existing common register/profile queries use dump columns, but MERGED behavior is not specified in source. |
| `roles` | `role_id CHAR(36)` PK; unique role code/name; description nullable; `created_at`. Three role rows (`CUSTOMER`, `TECHNICIAN`, `ADMIN`) exist in this snapshot. | Role seed queries/inserts role code/name/description. Migration omits `created_at`. | **Query-compatible for seed fields.** Existing role identities are database-owned; seed must validate rather than replace them. |
| `user_roles` | Composite PK `(user_id, role_id)`; nullable `assigned_by`; `assigned_at` default; FKs to users/roles restrict deletes; `assigned_by` FK sets null on user delete. One assignment exists in this snapshot. | Reads/inserts `user_id`, `role_id`, `assigned_by`; migration omits `assigned_at` and uses different FK delete behavior. | **Mostly compatible for current inserts/reads.** Database default should populate `assigned_at`; migration is not equivalent. |
| `permissions` | `permission_id CHAR(36)` PK; unique `permission_code` and `permission_name`; nullable description; `created_at`. No permission rows exist in this snapshot. | Permission seed reads/inserts ID/code/name/description; migration omits `created_at` and name uniqueness. | **Query-compatible for seed fields, but definitions/mappings are unverified.** Do not seed until the approved permission catalog is confirmed. |
| `role_permissions` | Composite PK `(role_id, permission_id)`; `assigned_at` default; FKs to roles/permissions restrict deletes. No rows exist in this snapshot. **No `assigned_by` column.** | Permission seed inserts `assigned_by: null`; migration expects that column and adds an `assigned_by` FK. | **Incompatible.** Current permission seed insert fails against the dump. Use only dump columns after permission policy approval. |
| `refresh_token_sessions` | `session_id CHAR(36)` PK; `user_id`; unique `token_hash CHAR(64)`; `token_family_id CHAR(36)`; expiry, revocation, replacement, created, and last-used timestamps. `replaced_by_token_id` self-FK targets `session_id`; user FK; expiry and non-self-replacement checks. No token rows exist in this snapshot. | Requires a separate `token_id` PK; stores `session_id` as a family/session identifier; replacement FK targets `token_id`; rotation reuses `session_id`; does not write `token_family_id` or `last_used_at`. | **Incompatible.** Existing refresh and logout SQL cannot safely run against the dump schema. See §4. |
| `user_audit_logs` | `audit_id CHAR(36)` PK; nullable `actor_user_id`; `action`; `resource_type`; nullable `resource_id`, `reason`, `metadata JSON`; `created_at`; actor FK sets null on delete. No audit rows exist in this snapshot. | `auditLogService` inserts into `audit_logs` using `target_entity_type`, `target_entity_id`, `occurred_at`, `outcome`, and `request_id`. | **Incompatible table and columns.** Resolve field mapping and metadata policy before enabling audited operations. See §5. |
| `customer_merge_history` | `merge_history_id CHAR(36)` PK; source/target customer IDs; target/verifying user IDs; required verification reference; optional reason; `merged_at`; FKs to customers/users restrict deletes; source and target must differ. No history rows exist in this snapshot. | No current service or migration reads/writes this table. | **Schema present; behavior absent.** Do not infer identity proof, eligibility, or merge side effects. See §7. |
| `internal_token_replays` | **Table absent from the supplied dump.** | Repository code inserts/cleans rows in this table; migration 005 defines it with a unique `(issuer, jti)` key. README says internal JWT verification depends on it. | **Unavailable against this dump.** No approved alternative was found in accessible material. Do not run migration 005 or enable replay-dependent internal auth without approval. See §8. |

### Snapshot data (not a live-state guarantee)

The dump has three role records, one active user/customer registration, and one
user-role assignment. `permissions`, `role_permissions`,
`refresh_token_sessions`, `user_audit_logs`, and `customer_merge_history` are
empty in the dump. The dump contains no `internal_token_replays` table.

### Relationship and ownership boundary

All observed foreign keys above are within the User-Service database. No
cross-service database access or cross-service foreign key is required or
permitted. User-Service remains the sole owner of these tables.

## 4. Refresh token lifecycle specification

### Locked policy

- **HANDOVER LOCKED:** every login creates a new token family.
- **HANDOVER LOCKED:** each refresh-token record has a new `session_id`.
- **HANDOVER LOCKED:** rotations from the same login retain one
  `token_family_id`.
- **HANDOVER LOCKED:** `replaced_by_token_id` references the replacement
  record's `session_id`.
- **HANDOVER LOCKED:** refresh rotation and reuse detection are required.
- **HANDOVER LOCKED:** logout revokes only the family identified by the
  presented device token; other login families remain usable.
- The database schema must not be changed to accommodate the old implementation.

### Proposed database lifecycle

1. **Login:** generate a fresh UUID `token_family_id` and a fresh UUID
   `session_id`; generate the opaque refresh token; persist only its SHA-256
   lowercase-hex hash (64 characters); set `user_id`, `expires_at`, and
   `created_at`. Insert the family and token row atomically with the success
   audit event. A subsequent login for the same user gets a different family.
2. **Successful refresh:** find the row by `token_hash` under a transaction and
   row lock; validate expiry, revocation, active user, and current database
   roles. Create a replacement with a new `session_id` and the same family ID.
   Mark the old row revoked, set its `replaced_by_token_id` to the new
   `session_id`, update `last_used_at`, and write the audit event in the same
   transaction. Commit before returning the new raw token once.
3. **Reuse:** a known previously revoked/replaced token must not issue a token.
   **PROPOSAL:** revoke every still-active row with that `token_family_id` and
   write the reuse audit in the same transaction; return the generic 401 only
   after that transaction commits. This must not touch any other family for
   the user.
4. **Logout:** find the presented token hash and identify its family.
   **PROPOSAL:** revoke active rows for that family only, atomically with the
   logout audit. A known older token may identify its family even if already
   rotated; an unknown token has no family to revoke. Return the existing
   idempotent `revoked` result. Never revoke all user families.
5. Preserve the DB invariants: `session_id` is the record PK; replacement
   points to a different `session_id`; `expires_at > created_at`; token hash
   remains unique; family ID remains constant through rotation.

### Implementation gaps and decisions still needed

- **CODE FACT:** `authService.js` inserts `token_id`, reuses the old
  `session_id`, links `replaced_by_token_id` to `token_id`, and revokes by
  `session_id`. Each conflicts with the dump or locked family semantics.
- **CODE FACT:** login creates no `token_family_id`; refresh does not update
  `last_used_at`.
- **PENDING:** whether an expired-but-not-reused token revokes only itself or
  its family; exact `last_used_at` semantics; retry/concurrency response
  details; and refresh-token TTL policy confirmation from the inaccessible
  guide/ADR.
- **CODE FACT (preserved pending policy):** the implementation rejects an
  expired token and revokes that token record only. It does not update
  `last_used_at`; both policies remain pending rather than being inferred here.
- **CODE FACT (concurrency):** requests serialize on the token-row lock. A
  second request that observes the first request's rotated token takes the
  reuse path and revokes active rows in that family. The test suite records
  this edge as TODO because the duplicate-request/retry policy is not approved.
- **CODE FACT (logout):** logout with any known token now resolves its family,
  including a previously rotated token, and revokes only active records in
  that family. Repeating logout after the family has no active records returns
  `revoked: false`.
- **PROPOSAL:** retain the current generic 401 response for invalid, expired,
  revoked, and reused tokens so the API does not disclose token state.
- Do not log or return token hashes/raw refresh tokens in audit metadata.

## 5. Audit log mapping

### Observed mismatch

`src/services/auditLogService.js` currently inserts into `audit_logs` and uses
columns that are absent from the dump. The database table is
`user_audit_logs`.

### Candidate semantic mapping (requires approval)

| Current audit event field | Dump column candidate | Notes |
|---|---|---|
| generated audit UUID | `audit_id` | Compatible type/size. |
| `actor_user_id` | `actor_user_id` | Nullable in both semantics; DB FK sets null if actor is deleted. |
| `action` | `action` | Compatible length. |
| `target_entity_type` | `resource_type` | Candidate rename; validate vocabulary/length policy. |
| `target_entity_id` | `resource_id` | Candidate rename; DB allows 100 characters; source currently validates up to 36. |
| metadata `reason` | `reason` | Candidate extraction from existing metadata; avoid silently duplicating or dropping. |
| remaining allowlisted metadata | `metadata` | JSON column exists; preserve only approved non-secret fields. |
| `occurred_at` | `created_at` | Candidate timestamp mapping. |
| `outcome`, `request_id` | **No dedicated columns** | **PENDING.** Proposed option: store as explicit JSON keys in `metadata`, preserving existing metadata. This requires approval and updating the metadata allowlist/schema; do not silently discard or encode into unrelated columns. |

The current success/failure audit semantics, action names, allowed metadata,
request-ID policy, and whether failed-auth audit failures should block the
request must be confirmed against the approved audit/business policy. Passwords,
password hashes, raw tokens, and key material must never be logged.

## 6. Permission mapping

- **DUMP FACT:** the database defines role and permission codes as data, and
  role-permission membership is the `(role_id, permission_id)` pair. The dump
  has roles but no permission definitions or role-permission assignments.
- **DUMP FACT:** `role_permissions` stores `assigned_at`; it has no
  `assigned_by`.
- **BLUEPRINT CLAIM (Draft):** the attached blueprint says a previous decision
  maps `payment.record` to ADMIN and `payment.view_own` to CUSTOMER, and that
  `can_refund` is not approved. These mappings also appear in current
  repository constants. The originating locked decision was not available to
  verify; the draft alone does not authorize seeding or exposing them.
- Do not infer additional permission mappings from the broader repository
  constants. Unknown permissions, including `can_refund`, must remain denied.
- **CODE FACT:** `seeds/002_permissions.js` derives permission candidates from
  `backend/shared/constants` and `adminPermissions`, then inserts
  `{ role_id, permission_id, assigned_by: null }`. That insert is incompatible
  with the dump.
- **HANDOVER RULE:** do not invent permissions, roles, or business rules.
- **PROPOSAL:** when the approved catalog is supplied, resolve existing
  `roles.role_code` and `permissions.permission_code` to DB IDs, insert only
  missing approved pairs using `{ role_id, permission_id }`, and allow the DB
  default to set `assigned_at`. Do not delete, overwrite, or rename existing
  rows. Make seeding idempotent and abort on code/name conflicts.
- **PENDING:** confirm that repository role/permission constants and mappings
  are the approved catalog before any seed runs against Railway.
- Authorization should continue resolving current user-role and
  role-permission rows from User-Service's database, not trusting JWT role or
  permission claims. Unknown permission codes must fail closed.

## 7. Customer merge compatibility

### Database facts

- `MERGED` is a valid `customer_type`.
- A MERGED customer must have a non-null `merged_into_customer_id`, and cannot
  point to itself. The dump's check does not otherwise constrain `user_id` or
  `merged_into_customer_id` for this type.
- `customer_merge_history` requires source/target customer IDs, target user,
  verifying user, and `verification_reference`; source and target must differ.
- Current dump contains no merge history rows.

### Source and API status

- Current registration creates `REGISTERED`; the internal guest-linking
  service changes `GUEST` to `REGISTERED` after a trusted identity verifier.
- A `GUEST` must not be treated as `REGISTERED`; matching email or phone alone
  is not identity proof. Current source does not expose a guest-linking route.
- No merge service/API is present. Profile/admin reads select `customer_type`
  but have no explicit MERGED resolution behavior. The current migration
  prohibits the database's MERGED enum value.
- The existing internal customer resolver accepts only an active user with a
  matching `REGISTERED` customer.

### Compatibility boundary

- **PROPOSAL:** preserve existing customer IDs and history references; treat
  `MERGED` as a persisted database state, not permission to merge or rewrite
  customer records from an API.
- **PENDING:** eligibility of source/target customers, target-user identity,
  verification evidence requirements, which user/profile fields survive,
  history insertion semantics, chained merges, reads/API response for MERGED,
  and how references owned by other services are handled. These rules must
  come from approved business documentation; do not access or modify other
  service databases.
- A future merge, if approved, must execute its User-Service updates and
  `customer_merge_history` insert atomically in the User-Service database,
  under row locks and existing FKs/checks. The exact mutations are **not
  approved** by this specification.

## 8. Internal token replay compatibility

- **DUMP FACT:** `internal_token_replays` is absent.
- **CODE FACT:** source repository `202611110005_create_internal_token_replays.js`
  proposes a table with generated numeric PK, `issuer`, `jti`, `client_id`,
  expiry/creation timestamps, unique `(issuer, jti)`, and an expiry index.
  `internalTokenReplayRepository` relies on an atomic insert and duplicate-key
  rejection; storage errors fail closed.
- The existence of a source migration is not approval to change the database.
  Do not run it on Railway.
- **PENDING:** approved persistence/retention/cleanup design and approval to
  provision the missing table or an already-approved alternative. No approved
  alternative was established from the inspectable evidence.
- Until that decision is resolved and replay persistence is verified, internal
  JWT verification that requires single-use `jti` replay protection must not
  be enabled in production. Configuration alone is not evidence of readiness.
- The current README labels internal JWT/permission bridge contracts proposed;
  issuer/audience/key distribution, allowed callers, network restrictions, and
  security review remain separate approval dependencies.

## 9. Transaction boundaries

All transactions below are within the User-Service database only.

| Operation | Atomic work required by current behavior / proposal |
|---|---|
| Register | Insert user, registered customer, customer-role assignment, and success audit together. Any required insert/audit failure rolls back the full operation. |
| Login | Create refresh-session row and success audit together. Credential/status/role reads currently occur before that transaction; whether they must be locked/rechecked in the same transaction is **PENDING**. |
| Refresh | Lock presented session; validate user/status/current roles; insert replacement; update old row (`revoked_at`, replacement session ID, `last_used_at`); audit outcome. Reuse-family revocation and reuse audit commit before returning 401. |
| Logout | Lock token row; revoke only its family and write audit atomically. Unknown token has no family; preserve documented idempotent response. |
| Profile update | Lock user/customer; update corresponding user/customer fields and audit in one transaction. |
| Admin status/role change | Perform status/role mutation, existing protection checks, and audit in the same transaction. Use `user_roles.assigned_by` only for user-role assignment; it is not a role-permission column. |
| Internal permission check | Current permission service performs database-backed reads; replay `jti` consumption is a separate prior atomic insert. The draft blueprint classifies this as read-only, consistent with the permission-check service itself. Replay storage and internal contracts remain approval-gated. |
| Internal customer resolution | Current source reads the user/customer mapping and writes an audit event in the same User-Service transaction. The attached draft blueprint classifies this as read-only, which conflicts with current source. **PENDING:** approve whether the audit side effect is required; do not silently remove or preserve it as a locked rule. Replay `jti` consumption remains a separate prior atomic insert. |
| Customer merge | No operation is currently defined. If approved, all User-Service customer mutations and history insert must share one transaction; exact lock order and mutations are **PENDING**. |

External service calls must not be made while holding a User-Service DB
transaction unless an approved design explicitly requires it. No transaction
may span service-owned databases.

## 10. API behavior and current compatibility

Current paths and status behavior below are observed in the workspace
controllers/routes and User-Service README; they are not proof that those
handlers work against the supplied schema.

| Endpoint | Current API intent | Database compatibility status |
|---|---|---|
| `POST /auth/register` | 201; creates active user, REGISTERED customer, CUSTOMER role and audit. Invalid input 400; duplicate email 409. | User/customer/role columns mostly align, but audit insert targets the wrong table. Atomic success therefore cannot currently complete against the dump. |
| `POST /auth/login` | 200; returns access and one-time refresh tokens; generic 401 for invalid credentials/inactive account. | Reads user/roles; refresh insert and audit are schema-incompatible. |
| `POST /auth/refresh` | 200 with rotated tokens; invalid/revoked/expired token 401. | Incompatible token identifiers/family fields; must be changed to §4 before DB use. |
| `POST /auth/logout` | 200 with `data.revoked`; missing/malformed token 400; unknown/revoked token idempotent. Access tokens remain valid to expiry. | Current service revokes by source `session_id` semantics rather than the locked family semantics. |
| `GET/PATCH /users/me` | Authenticated current-user profile; updates full name/phone. | Reads/writes existing user/customer fields; audit write is incompatible. MERGED behavior is unresolved. |
| `GET /users/me/permissions` and permission-protected routes | Resolve current role-permission membership from DB. | Reads align structurally, but the dump has no permission or role-permission data. Seed is blocked pending catalog approval and column fix. |
| Admin user/status/role routes | Reads users/customers/roles; role assignment records `user_roles.assigned_by`; audit is transaction-coupled. | User-role attribution column exists; audit table mismatch prevents successful audited mutations. |
| `POST /internal/permissions/check`, `/internal/customers/resolve` | Internal JWT-protected routes mount only when configured. README describes the contract as proposed. | Replay table absent; no production readiness until §8 approvals and persistence exist. Customer resolver only accepts REGISTERED mapping. |
| Customer merge API | None in current routes. | No API behavior is approved; do not add one in this compatibility task. |

### Error contract conflict

The attached draft lists a database failure as HTTP 500. The current
User-Service README documents unexpected database failures as generic 503;
most service database wrappers also return 503, while the shared error
middleware defaults unwrapped errors to 500. The final API contract therefore
has a **CONFLICT** that must be resolved before HTTP acceptance tests. In all
cases, database details, hashes, tokens, and stack traces must not be exposed
to clients.

## 11. Integration test plan and release gates

### Gate A — schema-only preflight (read-only)

1. Obtain explicit authorization and an isolated non-production MySQL target
   that represents the supplied dump. Never point migration/test commands at
   Railway production.
2. Inspect `information_schema` read-only for the ten requested tables,
   columns, types, nullability, defaults, primary/unique indexes, FKs, and
   checks. Confirm the expected nine present tables and the current absence of
   `internal_token_replays`; record any drift from the supplied dump.
3. Do not run Knex migrations or seeds during preflight. Existing migration
   tests require an empty schema, create/rollback migration-owned tables, and
   assert a schema that differs from the dump; they are not safe/valid against
   the target database.

### Gate B — database integration on the approved schema

After compatible implementation and a dedicated isolated test database are
approved, run actual MySQL tests without mocks and without DDL/deletes:

- Register: assert user/customer/role rows, normalized email, password hash,
  DB timestamp defaults, and audit mapping; verify a failure leaves no partial
  records.
- Login: verify DB-backed role resolution, separate family per login, unique
  token hashes, and no raw token persistence.
- Refresh: verify new `session_id`, same family ID, correct replacement FK,
  `revoked_at`/`last_used_at`, and reuse revocation scoped to that family.
- Race two requests with one refresh token; only one rotation may succeed and
  final family state must follow the approved reuse policy.
- Logout one family and prove another login family for the same user remains
  refreshable. Confirm access-token expiry behavior remains unchanged.
- Resolve effective permissions from inserted, approved DB role-permission
  rows; unknown permission and inactive/unknown users must fail closed.
- Verify audit events use only actual dump columns, approved metadata, and the
  same transaction outcome as the operation.
- Cover guest/registered rows and dump constraints. MERGED workflow/API
  assertions remain blocked until the rules in §7 are approved.
- Internal replay tests (first use, duplicate `(issuer,jti)`, expiry/cleanup,
  DB unavailable fail-closed) are blocked until §8 is approved and the storage
  is available.

The added opt-in MySQL refresh integration test requires
`USER_SERVICE_ALLOW_REFRESH_DATABASE_TESTS=1`, loopback `DB_TEST_*` settings,
and a test-only schema name. It verifies the actual refresh table columns and
uses only inserts/reads/transactions; it never migrates or deletes data. It
injects a test audit adapter because the production audit mapping remains
blocked in §5, so it verifies refresh-token database persistence/rollback but
does not establish production audit or full auth database integration.

Generate unique test identities and leave test records intact; do not delete
records as cleanup. Use only an approved isolated test database, not production
customer data. The attached draft asks for safe test-data reset, but that
cannot authorize `DELETE`/`DROP` under the handover's no-delete/no-drop rule.
Any reset mechanism that removes database records remains **PENDING** explicit
approval; until then, use unique append-only test records.

### Gate C — real HTTP integration

Run the User-Service over HTTP against the same approved isolated MySQL
database, with real JWT keys and no mocked database. Exercise register, login,
refresh, logout, protected profile/permissions, role enforcement, and the
approved internal routes. Assert the documented HTTP status codes/envelopes,
generic authentication errors, no credential/token leakage, family isolation,
and DB persistence. Internal route tests remain blocked until replay persistence
and internal integration/security contracts are approved.

### Gate D — Railway readiness

Before any real Railway write test, require explicit target/environment
confirmation and approval for controlled test records. First compare live
schema read-only to this specification. Do not run migrations or seeds on
Railway as part of this plan. A passing local unit suite or isolated MySQL test
does not satisfy live Railway verification.

## 12. Current blockers and next approvals

1. Approve/resolve the audit mapping for `outcome` and `request_id`, and the
   final allowed metadata contract.
2. Confirm the approved permission catalog and role-permission matrix.
3. Approve customer MERGED lifecycle/API/business rules or explicitly defer
   merge operations.
4. Decide the approved internal replay persistence/retention approach; the
   table is absent and no schema change is authorized by this specification.
5. Confirm refresh expiration and edge-case policy against ADR-01 Revision 3.
6. Confirm the `payment.record` / `payment.view_own` mappings and
   `can_refund` denial against the originating approved decision; no other
   mappings are approved by this draft.
7. Resolve the internal customer-resolution audit conflict and database error
   status conflict with the attached draft.
8. Confirm the User JWT `kid`/key-rotation decision; do not add a `kid` or key
   rotation behavior without approval.
9. Provide readable/exported Master Guide, member docs, Backend Code Audit,
   Business Overview/Rules, and ADR-01 Revision 3/Locked Decisions for
   requirement-level verification.
10. Approve a dedicated MySQL integration target and, separately, any eventual
   controlled Railway HTTP test. No test has yet established live DB
   compatibility.

**No implementation is authorized by this draft.** Once decisions and evidence
are confirmed, update this mapping first, then implement only User-Service and
verify against the approved schema before proceeding to Payment-Service.
