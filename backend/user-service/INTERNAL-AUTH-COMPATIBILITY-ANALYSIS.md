# Com-tle (SmartFix) User-Service Internal Authentication Compatibility Audit

**Status:** Audit completed; authorized high-severity fix implemented
**Scope:** User-Service internal service authentication, replay protection, and
internal customer/permission endpoints
**Database evidence:** Supplied User-Service dump, as recorded in
`DATABASE-COMPATIBILITY-SPECIFICATION.md`
**Database access:** None. No Railway or other database was contacted.

## 1. Executive Summary

- **CODE FACT:** Internal Service JWT verification requires a signature,
  issuer, audience, expiry/issued-at claims, internal-token discriminator,
  service identity, configured allowlist membership, and `jti`. A valid token
  is consumed before endpoint parsing or business authorization.
- **CODE FACT — FIX APPLIED:** A trusted `kid` is now bound to exactly one
  configured service identity, and the verifier rejects a token if its
  `client_id` does not match that key's configured identity.
- **DATABASE FACT / BLOCKER:** The supplied dump does not contain
  `internal_token_replays`. The production repository inserts each accepted
  token's `(issuer, jti)` and the verifier requires that insert to succeed.
  Against a database matching the dump, the missing table causes replay
  storage to fail closed with 503; internal endpoints are unavailable when
  internal auth is mounted.
- **CODE FACT:** `/internal/customers/resolve` has an explicit
  `payment-service` check and independently verifies a User access token.
  Only an ACTIVE registered customer with exactly one matching identity
  succeeds. Missing, guest, disabled, or locked identities return a generic
  404; multiple mappings return 409.
- **CODE FACT:** `/internal/permissions/check` authenticates the service
  separately from the target user and checks current user status and current
  DB permission assignments. Unknown permissions deny; DB errors fail closed.
- **TEST FACT:** Focused internal-auth tests passed: 33 passed, 0 failed.
  The full User-Service suite passed: 127 total, 122 passed, 0 failed,
  4 skipped, and 1 TODO. These tests do not establish MySQL table availability,
  real unique-index concurrency, or deployed configuration.
- **PENDING:** The effective deployment allowlist, replay-table provisioning,
  replay cleanup scheduling, endpoint timeout/retry/cache behavior at the
  caller, and finer-grained per-service permission scope need operational or
  architecture confirmation.

## 2. Actual Internal Authentication Flow

1. **CODE FACT:** Payment-Service contains the token issuer at
   `backend/payment-service/src/services/internalServiceTokenIssuer.js`.
   It signs the internal request token; this file is cited only to identify
   the issuer dependency and was not changed.
2. **CODE FACT:** User-Service `server.js` loads internal-auth configuration,
   constructs `createInternalTokenReplayRepository({ db })`, injects
   `consumeJti` into `createInternalServiceAuthService`, and mounts `/internal`
   routes only when the configuration is present.
3. **CODE FACT:** `requireInternalServiceAuth` extracts a Bearer token,
   calls `verifyServiceToken`, and attaches the validated service identity to
   the request before the route handler runs.
4. **CODE FACT:** `verifyServiceToken` validates token claims and signature,
   then calls `consumeJti`. A duplicate is rejected; a storage failure is
   returned as service unavailable. Consumption occurs before JSON parsing
   and before endpoint authorization or identity/permission lookup.
5. **CODE FACT:** `POST /internal/permissions/check` calls the internal
   permission service after service authentication. User status and current
   permissions are queried separately from the internal service identity.
6. **CODE FACT:** `POST /internal/customers/resolve` also requires the
   authenticated service identity, then separately validates a User access
   token and resolves the identity for that User subject.

**BLOCKER:** When internal auth is not configured, `/internal` routes are not
mounted. When it is configured against the supplied dump, replay insertion
fails because the required table is absent. Neither configuration state was
tested against a running deployment.

## 3. Token Issuance Findings

- **CODE FACT:** The inspected issuer is
  `backend/payment-service/src/services/internalServiceTokenIssuer.js`,
  outside User-Service. It signs RS256 tokens with a key ID, issuer and
  audience, service `sub` and `client_id`, `token_use: internal_service`,
  `iat`, `exp`, and a random `jti`. Issuance lifetime is bounded to 1–300
  seconds.
- **CODE FACT:** User-Service config loads issuer/audience, a service
  allowlist, maximum token lifetime, and trusted RSA public keys from
  configuration in `src/config/internalServiceAuth.js`. Secret values are
  not included in this report.
- **CODE FACT — FIX APPLIED:** `INTERNAL_SERVICE_JWT_KEY_SERVICES` maps every
  configured `kid` to one allowed service using comma-separated
  `kid:service-id` entries. Missing, duplicate, malformed, unallowlisted, or
  incomplete mappings reject configuration. Deployments with internal auth
  enabled must supply this new setting or startup will fail closed.
- **PENDING:** The actual runtime allowlist and deployed key configuration
  cannot be established from source/tests alone.
- **CODE FACT:** A User access token is not intended to serve as an Internal
  Service token; the token discriminator is separately validated.

## 4. Token Verification Findings

**CODE FACT:** `src/services/internalServiceAuthService.js`,
`verifyServiceToken`, checks:

- RS256 signature against a configured key selected by `kid`.
- Configured issuer and audience.
- Integer `iat` and `exp`, expiry and issued-at skew, and maximum lifetime.
- `jti` format and the internal-token discriminator.
- Service identity in required claims, including matching service identity
  claims, membership in the configured allowlist, and equality between
  `client_id` and the service identity bound to the selected `kid`.
- Successful single-use consumption through the replay repository before
  returning authenticated service identity.

Missing, malformed, expired, wrong-issuer, wrong-audience, wrong-purpose,
unknown-key, invalid-signature, or unallowlisted tokens are rejected by the
verification path.

- **CODE FACT — RESOLVED:** The security review confirmed that, before the
  follow-up fix, a different trusted key could claim `payment-service`.
  `hasValidKeyServiceIds` now validates the complete mapping and
  `verifyServiceToken` rejects a key/claim mismatch before consuming the JTI.
  References: `src/services/internalServiceAuthService.js:11-26,119`;
  configuration parsing in `src/config/internalServiceAuth.js:43-82`.
- **TEST FACT:** `tests/internalServiceAuth.test.js:146-182` now verifies that
  a trusted booking key cannot claim Payment-Service and that rejection occurs
  before replay consumption. Configuration tests verify complete,
  allowlisted mappings.
- **PENDING:** Deployment configuration must be updated and validated. No
  deployed key files or environment values were inspected.

## 5. Caller Allowlist Findings

- **CODE FACT:** Internal authentication applies the configured
  `allowedServices` set before the route handler. The runtime set is
  configuration-driven; its deployed contents were not available during this
  audit.
- **CODE FACT:** Each configured key is now separately bound to one service
  through `INTERNAL_SERVICE_JWT_KEY_SERVICES`; the mapped service must also be
  in `INTERNAL_SERVICE_JWT_ALLOWED_SERVICES`.
- **CODE FACT:** `src/services/internalCustomerIdentityService.js` separately
  restricts identity resolution to `serviceId === "payment-service"`.
  Unapproved callers are audited and denied with 403.
- **CODE FACT:** `/internal/permissions/check` accepts callers that pass the
  configured service allowlist. It does not define a per-caller permission
  scope; callers can ask about any known permission code for a supplied user.
  Unknown permissions return a deny decision.
- **PENDING:** Decide whether every allowlisted internal service may query
  every known user permission, or whether the internal permission contract
  needs an approved caller-to-permission scope. Do not expand the allowlist
  without approval.

## 6. Replay Protection Findings

### Production call graph

- **CODE FACT:** `server.js` constructs
  `createInternalTokenReplayRepository({ db })` and injects its
  `consumeJti` function into the internal auth service.
- **CODE FACT:** `verifyServiceToken` calls `consumeJti({ issuer, jti,
  clientId, expiresAt })` after token validation and before it returns the
  authenticated service identity.
- **CODE FACT:** `src/services/internalTokenReplayRepository.js`,
  `consumeJti`, performs an atomic insert into `internal_token_replays`.
  It does not first SELECT the key. A duplicate-key result is treated as
  replay and rejected; other insert errors or an unexpected insert result
  become a generic 503.
- **CODE FACT:** `cleanupExpired` issues a DELETE for expired replay records.
  No scheduled or production invocation of cleanup was established in the
  inspected call graph.
- **CODE FACT:** The migration defines a unique `(issuer, jti)` key. The
  intended concurrent behavior is one insert winner and duplicate rejection
  for competing requests.
- **TEST FACT:** Repository tests cover duplicate and concurrent attempts
  using a fake/stubbed database, cleanup cutoff behavior, and storage failure.
  They do not prove actual MySQL unique-index or transaction behavior.

### Database compatibility

- **DATABASE FACT:** The supplied SQL dump does not contain
  `internal_token_replays`. The existing
  `DATABASE-COMPATIBILITY-SPECIFICATION.md` records that this table is absent
  from the dump.
- **BLOCKER:** If an environment uses that schema and internal-auth config
  mounts the routes, every otherwise-valid internal token reaches the
  repository insert and fails because the table is missing. The repository
  fails closed; requests receive service-unavailable behavior rather than
  silently falling back to an in-memory replay cache.
- **CODE FACT:** `migrations/202611110005_create_internal_token_replays.js`
  describes the table, but it was not run or modified. A migration definition
  is not evidence that the table exists in the supplied database or Railway.
- **NOT VERIFIED:** No isolated MySQL replay integration test was run.
  Table existence, actual duplicate-key classification, concurrent insert
  behavior, and persistence across process restarts remain unverified.

**PROPOSAL:** Obtain explicit approval for a compatible durable replay-store
provisioning/migration strategy, or separately approve a durable alternate
store. Do not replace persistent replay protection with in-memory storage and
do not create a table without approval.

## 7. Database Compatibility Findings

| Resource | Code operation | Supplied dump | Assessment |
|---|---|---|---|
| `internal_token_replays` | INSERT `(issuer, jti, client_id, expires_at)` in `consumeJti`; DELETE expired rows in `cleanupExpired` | Table absent | **DATABASE FACT / BLOCKER:** required insert cannot work against the supplied schema. No SELECT-before-insert exists. |
| `user_audit_logs` | Internal customer resolution records success/denial through the audit service | Present in the supplied dump | **CODE FACT:** audit writes use the User-Service audit abstraction; no database was contacted to verify them. |
| User/Customer identity | Lookup of current user and customer mapping during resolver transaction | `users`, `customers` present | **CODE FACT:** source uses these tables; actual SQL execution was not verified. |
| Roles/Permissions | Internal permission decision reads current database assignments | `roles`, `user_roles`, `permissions`, `role_permissions` present | **CODE FACT:** lookup is database-backed and fails closed on query error; no live query was run. |

No schema, migration, seed, or record operation was performed.

## 8. Endpoint Security Findings

### `POST /internal/permissions/check`

- **CODE FACT:** The route requires Internal Service authentication before
  parsing/handling the request. Internal service authentication is separate
  from target-user authentication.
- **CODE FACT:** The request is strictly validated. The permission service
  checks the target user's current `ACTIVE` status and current
  role-permission assignments. Unknown permission codes deny. DB lookup errors
  fail closed as 503.
- **CODE FACT:** This decision is not proof of resource ownership. The
  endpoint validates supplied resource identifiers but does not establish
  ownership of a payment/work order; the owning service must still enforce
  its own resource checks.
- **TEST FACT:** Route tests cover valid and invalid internal calls, unknown
  permission denial, caller-supplied authorization data rejection, denied
  decisions, and lookup failure/token consumption behavior.

### `POST /internal/customers/resolve`

- **CODE FACT:** The route is behind Internal Service authentication and
  separately requires a User access token. The resolver checks
  `token_use === "user_access"`, a nonblank subject, and equality between the
  token subject and requested `user_id`.
- **CODE FACT:** Only `payment-service` may use this resolver. Invalid/missing
  User tokens and subject mismatch are denied.
- **CODE FACT:** Resolution succeeds only for one ACTIVE registered customer
  mapping. GUEST, DISABLED, LOCKED, missing users/mappings, and other
  non-registered cases share a generic 404. Multiple matching mappings
  produce 409.
- **CODE FACT:** Resolution and success/denial audit writes occur in the
  resolver's transaction. Other validation denials use a separate audit
  transaction. Database/audit failures fail closed.
- **TEST FACT:** Unit and route tests cover registered success, generic
  not-found cases, multiple mappings, token mismatch/purpose, missing token,
  disallowed caller, malformed request, and database/audit failures.
- **NOT VERIFIED / PENDING:** No timeout, retry, or cache behavior was found
  in the inspected User-Service implementation. The stated 3-second timeout
  and caller retry/cache behavior require verification in the calling service
  and are outside this User-Service-only audit.

## 9. Logging and Secret Exposure Findings

- **CODE FACT:** The replay verifier/repository logs service identity and
  failure category; inspected error logging does not include full JWTs,
  Authorization headers, signing secrets, or token claim dumps.
- **CODE FACT:** Customer-resolution audit records include identity/resource
  identifiers and reason metadata required to record the decision; the
  inspected resolver does not audit raw User JWTs, passwords, or signing
  secrets. Identifier access remains sensitive and should be restricted to
  authorized audit consumers.
- **TEST FACT:** Identity route tests assert that token-like material is not
  included in the audited record for tested cases.
- **PENDING:** This source audit does not establish production log aggregation,
  reverse-proxy/access-log redaction, or database audit-reader access policy.

## 10. Test Coverage Matrix

“Covered” means an existing unit/route test exercises the behavior with a
fake/stubbed dependency; it is not MySQL or production verification.

| Requirement | Evidence/status |
|---|---|
| Valid internal token | **TEST FACT — covered:** `tests/internalServiceAuth.test.js`; `tests/internalRoutes.test.js`. |
| Invalid signature | **TEST FACT — covered:** verification cases in `tests/internalServiceAuth.test.js`. |
| Expired token / wrong issuer / wrong audience | **TEST FACT — covered:** verification cases in `tests/internalServiceAuth.test.js`. |
| Missing service identity / malformed required claims | **TEST FACT — partial:** malformed/invalid claim validation is exercised in `tests/internalServiceAuth.test.js`; separate persisted cases for every missing claim were not established in the inspected evidence. |
| Unauthorized internal caller | **TEST FACT — covered:** `tests/internalRoutes.test.js`; `tests/internalCustomerIdentityRoutes.test.js` checks an unapproved caller. |
| User Access Token rejected by internal middleware | **TEST FACT — covered by token-purpose validation:** `tests/internalServiceAuth.test.js`; no production middleware integration with a real token issuer was run. |
| Internal token rejected by User authentication middleware | **NOT VERIFIED:** no dedicated cross-purpose middleware test was identified in the inspected evidence. |
| Replay rejection / duplicate `jti` | **TEST FACT — covered with stubs:** `tests/internalTokenReplayRepository.test.js`; `tests/internalRoutes.test.js`. |
| Concurrent replay attempts | **TEST FACT — stubbed only:** repository concurrency case in `tests/internalTokenReplayRepository.test.js`. Real MySQL concurrency is **NOT VERIFIED**. |
| Replay storage unavailable | **TEST FACT — stubbed:** repository failure is fail-closed in `tests/internalTokenReplayRepository.test.js`; no test against the missing-table MySQL schema was run. |
| Internal permission endpoint | **TEST FACT — covered with stubs:** `tests/internalRoutes.test.js` covers decisions, unknown permissions, malformed/caller-supplied data, and lookup failure. |
| Customer identity endpoint | **TEST FACT — covered with stubs:** `tests/internalCustomerIdentity.test.js` and `tests/internalCustomerIdentityRoutes.test.js`. |
| DB failure during identity/audit work | **TEST FACT — stubbed:** `tests/internalCustomerIdentity.test.js`; actual transaction rollback behavior is **NOT VERIFIED**. |
| 3-second timeout, no retry, no cache | **NOT VERIFIED:** not established in User-Service; caller behavior is outside this scope. |
| Replay table/schema and real database behavior | **NOT VERIFIED:** no isolated MySQL integration test was available or run. |

### Tests executed for this audit

**TEST FACT:** Ran only these non-database tests:

`node --test tests/internalServiceAuth.test.js tests/internalRoutes.test.js tests/internalTokenReplayRepository.test.js tests/internalTokenReplayMigration.test.js tests/internalCustomerIdentity.test.js tests/internalCustomerIdentityRoutes.test.js`

Result: **33 passed, 0 failed, 0 skipped**. No DB opt-in variables were set.
No database-writing or migration-running test was executed.

**TEST FACT:** The full suite also passed: **127 total, 122 passed, 0 failed,
4 skipped, 1 TODO**. Database opt-in flags were explicitly removed from the
test process; the four database integration tests skipped.

**TASK 07 verification:** The full suite was rerun after confirming the
key-to-service binding implementation and regression test. It again passed
with the same totals. `requireAuth.js`, replay storage behavior, and database
schema were not changed.

## 11. Confirmed Defects

### Security finding

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | `src/services/internalServiceAuthService.js` | 119 | Before the fix, trusted signing keys were not bound to service identities; a holder of another trusted key could sign a token claiming `payment-service`. Fixed in the current source and covered by a regression test. | 10/10 |

**CODE FACT:** This was a key-to-identity binding defect, not a
signature-validation bypass. The current verifier enforces the configured
mapping, but deployment configuration must be updated before enabling it.

### Compatibility blocker

- **DATABASE FACT / BLOCKER:** `internal_token_replays` is absent from the supplied dump but is required by every accepted internal token. Against that schema, replay storage fails closed and internal requests receive service-unavailable behavior. This is not a claim that Railway was checked.

## 12. Pending Decisions

1. **PENDING:** Configure and validate `INTERNAL_SERVICE_JWT_KEY_SERVICES`
   for each trusted key in each deployment. Define how key rotation preserves
   the one-key/one-service association.
2. **PENDING:** Approve how the durable replay store is provisioned in the
   intended environment. The supplied dump has no replay table; migration
   `202611110005_create_internal_token_replays.js` was not executed.
3. **PENDING:** Confirm the deployed `allowedServices` values and whether
   `/internal/permissions/check` needs caller-specific permission scopes.
4. **PENDING:** Establish whether and how expired replay records are cleaned
   up; no production invocation was established.
5. **PENDING:** Verify the 3-second caller timeout and no-retry/no-cache
   requirements outside User-Service.
6. **PENDING:** Add explicit middleware cross-token-type tests and isolated
   MySQL tests for replay inserts, duplicate races, and identity transaction
   behavior.
7. **PENDING:** Confirm production log redaction and audit-reader access
   policy.

## 13. Recommended Next Steps

1. **PROPOSAL:** Populate and validate the new key/service mapping in a
   controlled deployment configuration; do not enable internal auth with
   missing mappings. The code and regression test are updated, but deployment
   configuration was not changed or validated here.
2. **PROPOSAL:** Decide a durable replay-table provisioning strategy compatible
   with the real schema. Do not use in-memory replay storage, run migrations,
   or alter the database without approval.
3. **PROPOSAL:** Run the opt-in replay/identity integration tests only after
   an isolated, pre-provisioned test database and explicit safe configuration
   are available. Do not use Railway or production.
4. **PROPOSAL:** Confirm the effective service allowlist and caller-scoped
   permission contract; do not broaden them implicitly.
5. **PROPOSAL:** Verify timeout, retry, cache, proxy logging, and audit-access
   policy in the relevant deployment/caller configuration.

## Files Inspected

- `backend/user-service/server.js`
- `backend/user-service/.env.example`
- `backend/user-service/src/config/internalServiceAuth.js`
- `backend/user-service/src/services/internalServiceAuthService.js`
- `backend/user-service/src/middleware/requireInternalServiceAuth.js`
- `backend/user-service/src/routes/internalRoutes.js`
- `backend/user-service/src/services/internalTokenReplayRepository.js`
- `backend/user-service/src/services/internalPermissionService.js`
- `backend/user-service/src/services/internalCustomerIdentityService.js`
- `backend/user-service/src/controllers/internalCustomerIdentityController.js`
- `backend/user-service/src/services/authService.js`
- `backend/user-service/migrations/202611110005_create_internal_token_replays.js`
- `backend/user-service/tests/internalServiceAuth.test.js`
- `backend/user-service/tests/internalRoutes.test.js`
- `backend/user-service/tests/internalTokenReplayRepository.test.js`
- `backend/user-service/tests/internalTokenReplayMigration.test.js`
- `backend/user-service/tests/internalCustomerIdentity.test.js`
- `backend/user-service/tests/internalCustomerIdentityRoutes.test.js`
- `backend/user-service/DATABASE-COMPATIBILITY-SPECIFICATION.md`
- Caller token issuer reference only: `backend/payment-service/src/services/internalServiceTokenIssuer.js`
