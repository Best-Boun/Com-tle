# Com-tle (SmartFix) User-Service Audit Compatibility Analysis

**Status:** Approved audit mapping implemented; MySQL integration is opt-in and was skipped
**Database evidence:** `dump-user_db-202611131507.sql`, MySQL 8.4.13
**Scope:** User-Service audit writes, producers, transactions, and tests

## 1. Executive summary

- **CODE FACT:** User-Service has one audit writer, `src/services/auditLogService.js`.
  It validates events, extracts a validated `X-Request-ID`, and maps validated
  events to `user_audit_logs` using only the supplied schema columns.
- **DATABASE FACT:** The supplied dump instead defines `user_audit_logs` with
  `resource_type`, `resource_id`, `reason`, `metadata`, and `created_at`; it has
  no `audit_logs` table and no columns for outcome or request ID.
- **CODE FACT:** The runtime table/column incompatibility is addressed by the
  approved mapper; no schema change or migration was needed.
- **CODE FACT:** There is no separate audit repository, model, or middleware.
  Producer services call the audit service directly. `eventSchema` is the
  event validator; `getAuditRequestId` is a helper called by controllers and
  routes, not middleware.
- **CODE FACT:** The approved mapping is implemented. `created_at` is omitted
  from inserts so the database default applies.
- **PENDING:** The isolated MySQL integration test has not run. The legacy
  migration remains incompatible and was neither changed nor executed.

No database schema changes, migrations, seeds, Railway operations, or database
connections were performed for this implementation.

## 2. Current implementation overview

### Audit writer and request ID handling

- **CODE FACT:** `createAuditLogService` validates strict event inputs:
  nullable actor ID, action, target type/ID, `SUCCESS`/`FAILURE`, optional
  request ID, and allowlisted metadata. Metadata keys are limited to
  `changed_fields`, `calling_service`, `from_status`, `linked_user_id`,
  `reason`, `revoked`, `role_code`, `role_codes`, and `to_status`.
- **CODE FACT:** `getAuditRequestId` accepts `X-Request-ID` only if it matches
  `[A-Za-z0-9._:-]{1,100}`. Auth, profile update, admin mutation, and internal
  customer-resolution controllers pass this value to services. A guest-linking
  caller may supply it directly; the service defaults it to null.
- **CODE FACT:** The writer inserts into `user_audit_logs` using
  `audit_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`,
  `reason`, and `metadata`. The database supplies `created_at`.
- **CODE FACT:** Invalid events throw rather than being ignored. Insert errors
  are rethrown with a generic message and `AUDIT_LOG_PERSISTENCE_FAILED`
  code, retaining the underlying error as `cause`. Producer services await
  the insert.

### Missing layers and DB access

- **CODE FACT:** No separate User-Service audit repository/model/middleware
  was found. Validation and persistence are in `auditLogService.js`; request
  ID extraction is a helper in the same file.
- **CODE FACT:** There are no production audit read queries or audit-read API
  in the inspected User-Service source. Database writes originate from the
  producer services below.
- **CODE FACT:** `migrations/202611110004_create_audit_logs.js` creates the
  incompatible `audit_logs` schema. Its rollback drops that table. The static
  migration test expects precisely that schema; it is not evidence that the
  supplied DB supports it.

## 3. Database schema comparison

| Concern | Runtime writer / legacy migration | Supplied DB dump | Classification |
|---|---|---|---|
| Table | Runtime: `user_audit_logs`; migration: `audit_logs` | `user_audit_logs` | Runtime matches. **PENDING:** legacy migration remains incompatible. |
| Primary key | `audit_id CHAR(36)` | `audit_id CHAR(36)` | Compatible |
| Actor | nullable `actor_user_id` | nullable `actor_user_id`, FK to `users.user_id`, `ON DELETE SET NULL` | Compatible; retain DB behavior |
| Action | `action VARCHAR(100)` | `action VARCHAR(100)` | Compatible |
| Target type | Runtime: `resource_type`; migration: `target_entity_type` | `resource_type VARCHAR(100)` | Runtime maps approved vocabulary `user`, `refresh_session`, `customer`. |
| Target ID | Runtime: `resource_id`; migration: `target_entity_id` | `resource_id VARCHAR(100)` | Runtime maps the validated target ID without truncation. |
| Reason | Runtime: dedicated `reason`; migration has no reason column | nullable `reason VARCHAR(500)` | Runtime stores the validated reason in this column only. |
| Metadata | nullable JSON; reserved runtime keys `outcome`, `request_id` | nullable JSON | Ordinary allowlisted metadata and reserved values are retained. |
| Event time | Runtime omits `created_at`; migration has `occurred_at` | `created_at DATETIME(3)`, default `CURRENT_TIMESTAMP(3)` | Database default applies; no app timestamp or timezone change. |
| Outcome | Runtime: `metadata.outcome`; migration: direct column | No column | Preserved as reserved JSON metadata. |
| Request ID | Runtime: `metadata.request_id`; migration: direct column | No column | Preserved as reserved JSON metadata. |

The dump also defines indexes on actor/time, resource/time, and created time.
The actor FK uses `ON DELETE SET NULL`. No schema modification was made.

## 4. Complete audit event inventory

All event details below are **CODE FACTS** from current producers. `resource
type` and `resource ID` show the implemented approved mapping from current
target fields. “Mandatory”
means the current producer awaits the audit call and does not treat its failure
as success.

| Action/event | Actor user ID | Resource type / ID | Reason | Outcome | Request ID | Additional metadata | Transaction boundary | Mandatory |
|---|---|---|---|---|---|---|---|---|
| `USER.REGISTERED` | New user ID | `user` / new user ID | None | `SUCCESS` | Passed from header if valid | `role_codes: [CUSTOMER]` | Same transaction as user, customer, and user-role inserts | Yes; audit failure rolls back registration |
| `AUTH.LOGIN` success | Authenticated user ID | `user` / user ID | None | `SUCCESS` | Passed from header if valid | `role_codes` | Same transaction as refresh-session insert | Yes; no successful login response if audit fails |
| `AUTH.LOGIN` failure | Null; known user is not asserted as actor | `user` / known user ID or null | `INVALID_CREDENTIALS`, `INACTIVE_ACCOUNT`, or `NO_VALID_ROLE` | `FAILURE` | Passed from header if valid | None | Separate audit-only transaction after failed check | Yes; audit failure changes response to service-unavailable |
| `AUTH.REFRESH_REJECTED` malformed/missing token | Null | `refresh_session` / null | `INVALID_TOKEN` | `FAILURE` | Passed from header if valid | None | Separate audit-only transaction | Yes; failed audit prevents the generic 401 |
| `AUTH.REFRESH_REJECTED` unknown token | Null | `refresh_session` / null | `UNKNOWN_TOKEN` | `FAILURE` | Passed from header if valid | None | Same transaction as lookup; transaction commits before generic 401 | Yes |
| `AUTH.REFRESH_REJECTED` expired token | Null | `refresh_session` / session ID | `EXPIRED_TOKEN` | `FAILURE` | Passed from header if valid | None | Same transaction as session revocation | Yes; audit failure rolls back revocation |
| `AUTH.REFRESH_REJECTED` inactive/missing user | Null | `user` / session user ID | `INACTIVE_ACCOUNT` | `FAILURE` | Passed from header if valid | None | Same transaction as session revocation | Yes |
| `AUTH.REFRESH_REJECTED` no valid role | User ID | `user` / session user ID | `NO_VALID_ROLE` | `FAILURE` | Passed from header if valid | None | Same transaction as session revocation | Yes |
| `AUTH.REFRESH_REUSE_DETECTED` | Null | `refresh_session` / reused session ID | `REVOKED_TOKEN` | `FAILURE` | Passed from header if valid | None | Same transaction as revoking the active token family; commits before 401 | Yes |
| `AUTH.REFRESH_ROTATED` | User ID | `refresh_session` / prior session ID | None | `SUCCESS` | Passed from header if valid | None | Same transaction as replacement insert and prior-token update | Yes; audit failure rolls back rotation |
| `AUTH.LOGOUT` malformed/missing token | Null | `refresh_session` / null | `INVALID_TOKEN` | `FAILURE` | Passed from header if valid | None | Separate audit-only transaction before 400 | Yes |
| `AUTH.LOGOUT` unknown token | Null | `refresh_session` / null | None | `SUCCESS` | Passed from header if valid | `revoked: false` | Transaction contains lookup and audit; no session rows change | Yes |
| `AUTH.LOGOUT` known token | Token owner ID | `refresh_session` / presented token session ID | None | `SUCCESS` | Passed from header if valid | `revoked: true/false` | Same transaction as active-family revocation | Yes; failure rolls back revocation |
| `USER.PROFILE_UPDATED` | User ID | `user` / user ID | None | `SUCCESS` | Passed from header if valid | `changed_fields` | Same transaction as user/customer profile updates | Yes; failure rolls back update |
| `ADMIN.USER_STATUS_CHANGED` | Acting admin ID | `user` / target user ID | None | `SUCCESS` | Passed from header if valid | `from_status`, `to_status` | Same transaction as account status update | Yes; failure rolls back update |
| `ADMIN.USER_ROLE_ASSIGNED` | Acting admin ID | `user` / target user ID | None | `SUCCESS` | Passed from header if valid | `role_code` | Same transaction as `user_roles` insert | Yes; failure rolls back assignment |
| `ADMIN.USER_ROLE_REMOVED` | Acting admin ID | `user` / target user ID | None | `SUCCESS` | Passed from header if valid | `role_code` | Same transaction as `user_roles` delete | Yes; failure rolls back removal |
| `CUSTOMER.GUEST_LINKED` | Null | `customer` / customer ID | None | `SUCCESS` | Optional service argument | `linked_user_id` | Same transaction as customer link update | Yes; failure rolls back link |
| `INTERNAL.CUSTOMER_IDENTITY_RESOLVED` | Null | `user` / verified subject ID | `RESOLVED` | `SUCCESS` | Passed from header if valid | `calling_service` | Same transaction as User/Customer resolution reads | Yes; failure returns 503 |
| `INTERNAL.CUSTOMER_IDENTITY_DENIED` | Null | `user` / verified subject ID or null | `CALLER_NOT_ALLOWED`, `INVALID_USER_TOKEN`, `INVALID_REQUEST`, `USER_SUBJECT_MISMATCH`, `MAPPING_NOT_FOUND`, or `MAPPING_INTEGRITY_CONFLICT` | `FAILURE` | Passed from header if valid | `calling_service` | Usually separate audit-only transaction before 403/401/400/404/409; mapping denial is audited with the lookup transaction | Yes; failure returns 503 |

### Audit coverage that is absent

- **CODE FACT:** Profile reads, access/permission reads, admin list/detail
  reads, and internal permission checks do not emit audit events.
- **CODE FACT:** Idempotent user-status updates (status already equals target)
  return without an audit event. Invalid admin changes and authorization
  denials are not audited by these producers.
- **PENDING:** Whether these omitted events should be logged is a
  business/security coverage decision; this analysis does not recommend
  expanding coverage without approval.

## 5. Approved field mapping

| Current event field | Candidate DB destination | Semantic validity / information loss | Compatibility impact / decision |
|---|---|---|---|
| `audit_id` | `audit_id` | Direct identity match; no loss | Compatible |
| `actor_user_id` | `actor_user_id` | Direct match; preserve nullable actor and DB FK behavior | Compatible |
| `action` | `action` | Direct match | Compatible |
| `target_entity_type` | `resource_type` | The target type identifies the acted-on resource. The writer accepts only `user`, `refresh_session`, and `customer`. | No value loss; mapping is approved and enforced. |
| `target_entity_id` | `resource_id` | The target identifier identifies the acted-on resource. | No value loss; mapping is approved. |
| `metadata.reason` | `reason` | Reason is extracted from validated producer metadata and written to the dedicated column. It must be a string of at most 500 characters. | Reason is not duplicated in JSON; invalid or over-limit values reject the event rather than being truncated. |
| `outcome` | reserved `metadata.outcome` key | Preserves `SUCCESS`/`FAILURE`, which has no dedicated DB column. | Writer controls the key; producer collisions are rejected. |
| `request_id` | reserved `metadata.request_id` key | Preserves the validated correlation value, or `null` when absent. | Writer controls the key; validation remains `[A-Za-z0-9._:-]{1,100}`. |
| Existing ordinary `metadata` | `metadata` JSON | Existing allowlisted values are retained. | Producer-supplied `outcome` and `request_id` are rejected; reserved values are merged deterministically. |
| `occurred_at` | Omitted | The approved decision uses the database-generated timestamp. | `created_at` is not supplied in the insert; DB timezone configuration is unchanged. |

**CODE FACT:** The audit writer explicitly maps the validated event to the DB
row. No schema change was necessary or performed.

## 6. Security and reliability findings

- **CODE FACT:** the event schema is strict and rejects unknown metadata keys.
  Current producers do not pass passwords, password hashes, raw refresh/access
  tokens, JWTs, or secrets to the audit service. The audit-service unit test
  checks absence of password/token strings.
- **CODE FACT:** audit metadata does include identifiers such as
  `linked_user_id`, resource IDs, and role codes. These are not credentials,
  but remain identifying data and should stay allowlisted.
- **CODE FACT:** raw DB insert errors are wrapped with a generic message and
  code; producer services generally convert them to 503. The shared error
  middleware logs server-side errors, including the error object/cause, but
  returns an operational message or generic internal error to the client.
- **PROPOSAL:** verify log redaction/retention for DB causes in operational
  logs; this is a secondary data-exposure risk, not evidence that secrets are
  currently included in audit payloads.
- **CODE FACT:** write failures are not swallowed. Required audit calls are
  awaited and failures either roll back the mutation or prevent the intended
  response. The behavior is fail-closed but may turn a failed-login 401 or
  malformed-logout 400 into 503 if audit storage is unavailable.
- **CODE FACT:** runtime audit inserts now use the supplied table and its
  existing columns; the prior table/column mismatch is addressed.
- **CODE FACT:** failed login/invalid request audit-only writes use their own
  transaction. Successful and mutating events are generally written in the
  same transaction as the state change. Internal customer resolution writes
  audit in the same transaction as the lookup; denials before lookup use an
  audit-only transaction.
- **CODE FACT:** one refresh compare-and-update conflict currently throws a
  generic 401 and rolls back without emitting an audit event. Whether that
  exceptional concurrency failure must be audited is **PENDING**.

## 7. Audit-related tests and evidence quality

- **CODE FACT:** `tests/auditLogService.test.js` verifies the canonical
  `user_audit_logs` row mapping, validation, reserved-key rejection, and
  persistence-error wrapping using a fake transaction.
- **CODE FACT:** `tests/auditLogMigration.test.js` asserts that migration 004
  creates `audit_logs` and expects the incompatible columns.
- **CODE FACT:** `tests/authService.test.js`,
  `tests/userProfileService.test.js`,
  `tests/userAdministrationService.test.js`,
  `tests/guestCustomerLinkingService.test.js`, and
  `tests/internalCustomerIdentity.test.js` use in-memory/fake DBs with
  `user_audit_logs` rows. They validate canonical event data and transaction
  behavior, not compatibility with a live MySQL instance.
- **CODE FACT:** `tests/database.integration.test.js` expects the migration
  schema to contain `audit_logs`, its non-dump columns/indexes, and reads rows
  from that table. It validates a migration-created schema rather than the
  supplied DB schema. It requires explicit DB test opt-in and performs schema
  creation/rollback/cleanup; it must not be pointed at Railway or the supplied
  populated DB.
- **CODE FACT:** `tests/auditLog.database.integration.test.js` now verifies
  exact columns, insert/read mapping, DB-generated `created_at`, and rollback
  after a duplicate audit insert. It requires explicit loopback-only
  `DB_TEST_*` settings and was skipped because its opt-in was unset.
- **PENDING:** The new test has not yet been executed against a pre-provisioned
  isolated MySQL database.

## 8. Pending decisions

1. **PENDING:** whether internal customer-resolution read attempts should
   remain audited in future policy.
2. **PENDING:** whether additional read or authorization-denial events should
   be added.
3. **PENDING:** whether operational DB error logs need a separate redaction
   policy. Client responses remain mapped to safe errors.
4. **PENDING:** whether exceptional refresh concurrency failures need
   additional audit events.
5. **PENDING:** future migration strategy for fresh environments. Migration
   `202611110004_create_audit_logs.js` still creates the incompatible schema;
   it was neither modified nor executed.

## 9. Implementation disposition

1. Implemented the approved mapper in the audit persistence layer. Inserts
   target only `user_audit_logs`, use only its current columns, and omit
   `created_at`.
2. Preserved the current metadata allowlist, added strict reserved-key and
   resource vocabulary validation, and kept reason in the dedicated column.
3. Updated audit writer and producer tests, including audit-failure rollback
   checks for registration, profile update, and refresh rotation.
4. Added an opt-in MySQL integration test for an already provisioned exact
   schema. It does not create, drop, or delete database objects or records.
5. Left the incompatible migration and migration history untouched. The
   existing migration-based integration test remains separate and must not be
   run against the supplied DB, Railway, or production.
6. Ran focused and full User-Service suites. Real MySQL integration remains
   unverified because its explicit opt-in settings were not enabled.

## 10. Acceptance criteria

- No User-Service runtime query references `audit_logs` or columns absent from
  the supplied dump.
- Each source event maps deterministically to `user_audit_logs` columns or
  approved metadata keys; no event field is silently discarded.
- Event action, actor, resource, reason, outcome, request ID, metadata,
  transaction, and mandatory/optional status are covered by tests.
- No password, password hash, raw token, JWT, private key, or secret is written
  to audit payloads or exposed to clients.
- Required audit failures remain visible and preserve their approved
  transaction behavior; no failure is silently swallowed.
- An opt-in isolated MySQL integration test is available, but its execution
  remains pending; no Railway or production readiness is claimed.
- Pending policy and fresh-environment migration decisions remain explicitly
  unresolved and were not expanded by this implementation.

## 11. Source inventory

- Audit writer/validator: [`auditLogService.js`](./src/services/auditLogService.js)
- Auth/register/refresh/logout producers:
  [`authService.js`](./src/services/authService.js)
- Profile producer: [`userProfileService.js`](./src/services/userProfileService.js)
- Admin producers:
  [`userAdministrationService.js`](./src/services/userAdministrationService.js)
- Guest-link producer:
  [`guestCustomerLinkingService.js`](./src/services/guestCustomerLinkingService.js)
- Internal identity producers:
  [`internalCustomerIdentityService.js`](./src/services/internalCustomerIdentityService.js)
- Request ID wiring: [`authController.js`](./src/controllers/authController.js),
  [`usersController.js`](./src/controllers/usersController.js),
  [`adminUsersController.js`](./src/controllers/adminUsersController.js),
  [`internalCustomerIdentityController.js`](./src/controllers/internalCustomerIdentityController.js),
  [`internalRoutes.js`](./src/routes/internalRoutes.js)
- Incompatible schema migration:
  [`202611110004_create_audit_logs.js`](./migrations/202611110004_create_audit_logs.js)
- Audit tests: [`auditLogService.test.js`](./tests/auditLogService.test.js),
  [`auditLog.database.integration.test.js`](./tests/auditLog.database.integration.test.js),
  [`auditLogMigration.test.js`](./tests/auditLogMigration.test.js),
  [`database.integration.test.js`](./tests/database.integration.test.js),
  plus producer tests listed in §7.

**Final status:** Approved User-Service audit mapping implemented and unit
tested. No schema modification, migration, seed, database connection, or
Railway operation was performed. Isolated MySQL integration remains pending.
