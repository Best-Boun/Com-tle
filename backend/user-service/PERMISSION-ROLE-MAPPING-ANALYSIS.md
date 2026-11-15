# Com-tle (SmartFix) User-Service Permission and Role Mapping Analysis

**Status:** Analysis with TASK 05 implementation update  
**Scope:** User-Service permission catalog, role mappings, API enforcement, and
other services' authorization dependencies  
**Database evidence:** `dump-user_db-202611131507.sql` (provided MySQL dump)  
**Database access:** None. No database records or schema were changed.

## 1. Executive Summary

- **DATABASE FACT:** The dump contains `CUSTOMER`, `TECHNICIAN`, and `ADMIN`
  role rows. `permissions` and `role_permissions` exist but contain no rows.
  `role_permissions` has a composite `(role_id, permission_id)` primary key,
  database-generated `assigned_at`, and no `assigned_by` column.
- **CODE FACT:** The shared permission catalog defines 28 permission codes;
  User-Service separately defines four `user.*` administrative permissions.
  The compatible seed defines those permissions but assigns only
  `payment.record` to ADMIN and `payment.view_own` to CUSTOMER.
- **DATABASE FACT:** The supplied dump still has no permission definitions or
  assignments; no seed was run. Those two grants therefore remain unavailable
  in that database until the compatible seed is run against an approved,
  isolated/pre-provisioned database.
- **CODE FACT:** The permission seed now inserts only existing columns and
  omits `assigned_at`, allowing its database default to apply. The incompatible
  `assigned_by` reference is not present in the seed.
- **BLOCKER:** Migration 003 attempts to create tables that already exist and
  defines `role_permissions.assigned_by`, omits `permissions.created_at`, and
  uses different foreign-key delete rules. It remains incompatible and was
  not run or modified.
- **CODE FACT:** User-Service loads current database roles at Login and
  Refresh, puts roles (not permissions) in access-token claims, and checks
  permission-protected routes against the database on each request. Internal
  permission checks additionally require an active user.
- **CODE FACT:** `requireAuth` now checks the current database status for all
  authenticated User-Service user/admin routes. DISABLED and LOCKED users are
  denied immediately; a status lookup failure returns a generic 503.
- **BUSINESS RULE:** The assignments `payment.record` → ADMIN and
  `payment.view_own` → CUSTOMER are approved. All other role assignments,
  including `user.*`, remain PENDING and are not inserted by the seed.
- **PENDING:** `can_refund` remains undefined in User-Service and denied.
- **CODE FACT:** Payment-Service is the only inspected business service that
  calls User-Service's `/internal/permissions/check` contract. Its
  `can_refund` request is unknown to the User-Service catalog and therefore
  denied. Booking, Catalog, Repair, and Inventory permission checks were not
  found in their present source trees.

No database connection, seed execution, migration, schema change, or record
operation was performed. TASK 05 source and tests were updated.

## 2. Actual Database Schema Comparison

### Supplied schema

| Table | Supplied columns and constraints | Dump data | Classification |
|---|---|---|---|
| `roles` | `role_id CHAR(36)` PK; `role_code VARCHAR(50)` unique; `role_name VARCHAR(100)` unique; nullable `description VARCHAR(500)`; `created_at DATETIME(3)` defaulted | `CUSTOMER`, `TECHNICIAN`, and `ADMIN` rows exist | **DATABASE FACT** |
| `permissions` | `permission_id CHAR(36)` PK; `permission_code VARCHAR(100)` unique; `permission_name VARCHAR(150)` unique; nullable `description VARCHAR(500)`; `created_at DATETIME(3)` defaulted | No permission rows | **DATABASE FACT** |
| `role_permissions` | `role_id`, `permission_id`, `assigned_at DATETIME(3)` defaulted; composite PK `(role_id, permission_id)`; FKs to roles/permissions with `RESTRICT` deletes | No assignment rows; no `assigned_by` column | **DATABASE FACT** |

### Query, seed, and migration comparison

- **CODE FACT:** `permissionService.getUserAccess` joins
  `user_roles.role_id` → `roles.role_id` → `role_permissions.role_id` →
  `permissions.permission_id`, and selects `roles.role_code` and
  `permissions.permission_code`. The joins and selected columns are compatible
  with the supplied schema. It does not query `assigned_by`.
- **CODE FACT:** `seeds/001_roles.js` selects/inserts only role ID, code, name,
  and description. Omitting `created_at` is compatible with the database
  default. Existing code/name conflicts cause the seed to fail rather than
  overwrite the role.
- **CODE FACT:** `seeds/002_permissions.js` inserts existing permission
  columns, resolves role and permission IDs by their codes, and inserts only
  `(role_id, permission_id)` for the two approved pairs. It relies on the
  database default for `assigned_at`.
- **CODE FACT:** The seed is transactional and idempotent for permission
  definitions and those two mappings. No seed was run against a database.
- **BLOCKER:** `migrations/202611110003_create_role_permissions.js` first
  creates `permissions`, already present in the dump. It then defines a
  `role_permissions.assigned_by` column/index/FK not present in the dump.
  Its `permissions` definition omits `created_at` and the unique
  `permission_name` constraint, and its FKs use `CASCADE` rather than the
  dump's `RESTRICT` rules.
- **CODE FACT:** `migrations/202611110001_create_user_service_auth_schema.js`
  also defines `roles` without the dump's `created_at` column. Its
  `user_roles.assigned_by` is a separate column and is present in the supplied
  dump; it must not be confused with the absent
  `role_permissions.assigned_by`.
- **CODE FACT:** Unit tests use fake/in-memory databases and now assert
  schema-compatible seed columns, exact approved grants, current-status denial,
  and fail-closed DB errors. The legacy migration test remains separate and
  documents the incompatible migration definition.
- **CODE FACT:** An opt-in MySQL integration test now checks the pre-provisioned
  schema, seed idempotency, actual grant/deny decisions, and immediate status
  revocation. It requires loopback `DB_TEST_*` settings and an isolated test
  database; it was not run because no such configuration was available.

**CODE FACT:** The seed change is compatible with the supplied schema and
approved mapping. Keep the existing database schema as source of truth; do not
run migration 003 or seed against Railway or production.

## 3. Permission Inventory

Permission descriptions below are **CODE FACTS** inferred only from the
permission identifiers; the code and seed do not supply approved business
descriptions. “Legacy source mapping” records the earlier `ROLE_PERMISSIONS`
and seed declarations; it is not the current seed policy and must not be
treated as an active grant. TASK 05's current seed mapping contains only the
two explicitly approved pairs. Apart from User-Service routes and the
Payment-Service adapter described below, no current operation-level consumer
was found for these codes.

| Permission code | Code-derived description | Intended owner / operation | Current enforcement/use | Legacy source mapping (not seeded) | Status |
|---|---|---|---|---|---|
| `user.profile.view_own` | View own profile | User-Service, `GET /users/me` | User-Service route checks DB permission | All three roles via seed | **PENDING** exact grant approval; **BLOCKER** absent DB rows |
| `user.profile.update_own` | Update own profile | User-Service, `PATCH /users/me` | User-Service route checks DB permission | All three roles via seed | **PENDING** exact grant approval; **BLOCKER** absent DB rows |
| `booking.create` | Create booking | Booking-Service booking creation | Catalog/seed only; no current Booking API enforcement found | CUSTOMER | **PENDING** |
| `booking.view_own` | View own booking | Booking-Service customer booking read | Catalog/seed only; no current Booking API enforcement found | CUSTOMER | **PENDING** |
| `booking.manage` | Manage bookings | Booking-Service operations | Catalog/seed only; no current Booking API enforcement found | ADMIN | **PENDING** |
| `catalog.view` | View catalog | Catalog-Service catalog read | Catalog/seed only; no current Catalog API enforcement found | CUSTOMER, ADMIN | **PENDING** |
| `catalog.manage` | Manage catalog | Catalog-Service catalog administration | Catalog/seed only; no current Catalog API enforcement found | ADMIN | **PENDING** |
| `work_order.receive_create` | Receive/create work order | Repair-Service work-order intake | Catalog/seed only; no current Repair API enforcement found | ADMIN | **PENDING** |
| `work_order.view_assigned` | View assigned work orders | Repair-Service technician work | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `work_order.assign_technician` | Assign technician | Repair-Service work-order assignment | Catalog/seed only; no current Repair API enforcement found | ADMIN | **PENDING** |
| `diagnosis.record` | Record diagnosis | Repair-Service diagnosis | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `repair.item.propose` | Propose repair items | Repair-Service quotation/repair flow | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `quotation.set_price` | Set quotation price | Repair-Service quotation | Catalog/seed only; no current quotation API enforcement found | ADMIN | **PENDING** |
| `quotation.view_own` | View own quotation | Repair-Service customer quotation read | Catalog/seed only; no current quotation API enforcement found | CUSTOMER | **PENDING** |
| `quotation.approve_own` | Approve own quotation | Repair-Service customer approval | Catalog/seed only; no current quotation API enforcement found | CUSTOMER | **PENDING** |
| `quotation.reject_own` | Reject own quotation | Repair-Service customer rejection | Catalog/seed only; no current quotation API enforcement found | CUSTOMER | **PENDING** |
| `quotation.approve_walk_in` | Approve walk-in quotation | Repair-Service quotation | Catalog/seed only; no current quotation API enforcement found | ADMIN | **PENDING** |
| `repair.start` | Start repair | Repair-Service technician operation | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `repair.result.record` | Record repair result | Repair-Service technician operation | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `repair.history.view_own` | View own repair history | Repair-Service customer history read | Catalog/seed only; no current Repair API enforcement found | CUSTOMER | **PENDING** |
| `repair.history.view_assigned` | View assigned repair history | Repair-Service technician history read | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `repair.history.view_all` | View all repair history | Repair-Service operational read | Catalog/seed only; no current Repair API enforcement found | ADMIN | **PENDING** |
| `test_result.record` | Record test result | Repair-Service testing | Catalog/seed only; no current Repair API enforcement found | TECHNICIAN | **PENDING** |
| `inventory.part.propose` | Propose inventory part | Inventory-Service/Repair-Service repair flow | Catalog/seed only; no current Inventory API enforcement found | TECHNICIAN | **PENDING** |
| `inventory.issue` | Issue inventory | Inventory-Service stock operation | Catalog/seed only; no current Inventory API enforcement found | ADMIN | **PENDING** |
| `payment.view_own` | View own payment | Payment-Service history/details | Payment adapter calls User-Service internal permission check; then separately verifies customer ownership | CUSTOMER | **CONFIRMED** mapping; **BLOCKER** absent DB rows |
| `payment.record` | Record payment | Payment-Service record operation | Payment adapter calls User-Service internal permission check | ADMIN | **CONFIRMED** mapping; **BLOCKER** absent DB rows |
| `handover.complete` | Complete handover | Repair-Service handover | Catalog/seed only; no current Repair API enforcement found | ADMIN | **PENDING** |
| `user.list` | List users | User-Service, `GET /admin/users` | Route checks DB permission | ADMIN via permission seed | **PENDING** grant approval; **BLOCKER** absent DB rows |
| `user.view` | View user detail | User-Service, `GET /admin/users/:userId` | Route checks DB permission | ADMIN via permission seed | **PENDING** grant approval; **BLOCKER** absent DB rows |
| `user.status.manage` | Change user status | User-Service, `PATCH /admin/users/:userId/status` | Route checks DB permission | ADMIN via permission seed | **PENDING** grant approval; **BLOCKER** absent DB rows |
| `user.role.manage` | Assign/remove user role | User-Service, `PUT/DELETE /admin/users/:userId/roles/:roleCode` | Route checks DB permission | ADMIN via permission seed | **PENDING** grant approval; **BLOCKER** absent DB rows |
| `can_refund` | Refund authorization (name is not catalog-defined) | Payment-Service refund request/review/execution | Payment adapter requests it from User-Service; User-Service treats it as unknown and returns deny | No mapping defined | **BLOCKER** until permission definition and mapping are approved |

**CODE FACT:** The 32 codes above comprise 28 entries in
`backend/shared/constants/index.js` and four User-Service `ADMIN_PERMISSIONS`.
`can_refund` is a separate Payment-Service adapter request, not a
User-Service permission definition. Tests also use values such as
`unknown.permission` and `refund.approve` as negative test inputs; they are
not catalog entries.

**CODE FACT:** The seed now creates assignments only for
`payment.record` → ADMIN and `payment.view_own` → CUSTOMER. All other listed
permissions are definitions without role grants until separately approved.

**DATABASE FACT:** The supplied DB has no rows in either `permissions` or
`role_permissions`; consequently no permission is currently granted by that
database snapshot. The approved mappings are implemented in code but were not
seeded into any database.

## 4. Role-Permission Matrix

The first matrix records the seed's **current implementation mapping**, not
the legacy source declarations. High-level rules (“customer-facing
functions,” “assigned repair-related functions,” and “shop operations
according to approved permissions”) do not approve any additional code.

| Role | Current code/seed assignments | Business-rule assessment |
|---|---|---|
| `CUSTOMER` | `payment.view_own` | **CONFIRMED** assignment; no corresponding row exists in the supplied database yet. |
| `TECHNICIAN` | None | Other assignments remain **PENDING**; no `STAFF` role exists, and the admin role-assignment API does not assign `ADMIN`. |
| `ADMIN` | `payment.record` | **CONFIRMED** assignment; no corresponding row exists in the supplied database yet. |

- **DATABASE FACT:** The actual `role_permissions` table currently has no
  pairs for any role.
- **BUSINESS RULE:** Do not create a `STAFF` role, do not treat ADMIN as
  implicitly entitled to every permission, and do not enable staff acting as
  Technician in v1.
- **CODE FACT:** The shared `ROLE_PERMISSIONS` constants and dormant Gateway
  permission middleware remain unchanged, but User-Service's seed no longer
  uses those legacy mappings. They do not create User-Service DB grants.
- **PENDING:** No role is currently authorized for `can_refund`; no
  role-permission pair for it is defined.

## 5. Source Code Findings

### Permission and role implementation

- **CODE FACT:** There is a `permissionService`, but no separate Role service,
  Permission repository, or Role repository was found. Permission lookup and
  role loading queries are embedded in services.
- **CODE FACT:** `permissionService.getUserAccess` gets a user's role codes
  and permission codes from the current `user_roles` / `roles` /
  `role_permissions` / `permissions` joins. It filters results against known
  role and permission sets, deduplicates, and sorts them.
- **CODE FACT:** Unknown permissions are rejected by `userHasPermission`
  without a database grant. Database errors become a 503, not an allow.
- **CODE FACT:** `userHasPermission` now checks `users.status === ACTIVE`
  before looking up current permission assignments. The internal
  `activeUserHasPermission` contract uses the same fail-closed check.
- **CODE FACT:** `requireAuth` verifies the access token and checks current
  database status before setting `req.auth`. DISABLED and LOCKED accounts are
  immediately denied on `/users/me`, `/users/me/permissions`, and `/admin/users`
  routes even when the token is unexpired. Status-query failures propagate as
  a generic authorization-service 503.
- **CODE FACT:** User-role assignment is separate from role-permission
  mapping. Registration inserts only the CUSTOMER role. Admin assignment
  accepts only CUSTOMER or TECHNICIAN; ADMIN cannot be assigned through this
  API. The acting admin ID comes from the authenticated request.
- **CODE FACT:** Role checks in Login and Refresh load roles from
  `user_roles` joined to `roles`, then filter to the three known codes.
  Login and Refresh reject users with no valid role.

### JWT and current database behavior

- **CODE FACT:** Access tokens contain `sub`, `roles`, standard issuer/
  audience/time claims, and `token_use: user_access`. They contain no
  permission claims.
- **CODE FACT:** Login and Refresh reload roles from the database. Existing
  access tokens retain their role snapshot until expiry, but User-Service
  protected profile/admin operations query current database permissions on
  each request. `/users/me/permissions` also returns a fresh database result.
- **CODE FACT:** `GET /users/me/permissions` requires a valid token and active
  database account but no separate permission grant; its access list is
  loaded from current DB assignments.
- **CODE FACT:** The internal permission path checks current active status
  and current database role-permission assignments. It does not trust role
  or permission claims from the User access token.
- **CODE FACT:** A failed permission DB read fails closed as service
  unavailable; an absent or unknown permission is denied.

### Seeds, migrations, and tests

- **CODE FACT:** Role seed definitions are exactly CUSTOMER, TECHNICIAN, and
  ADMIN. The permission seed retains the source permission definitions but
  creates only the two approved payment mappings.
- **CODE FACT:** Permission seed inserts no `role_permissions.assigned_by` and
  leaves `assigned_at` to its database default. It remains unexecuted.
- **BLOCKER:** Migration 003 does not represent the already provisioned
  permission schema. It must not be used to replace or rebuild the supplied
  tables without explicit authorization.
- **CODE FACT:** Permission-service and seed unit tests verify active-status
  denial, fail-closed database errors, schema-compatible insert columns, and
  only approved mappings. The legacy migration test remains separate.
- **CODE FACT:** An opt-in integration test targets a pre-provisioned MySQL
  schema on loopback only. It tests seed idempotency, exact grants, and status
  revocation without creating tables or cleaning up rows. It was skipped
  because no isolated DB_TEST configuration was available.

## 6. API Authorization Coverage

| User-Service API | Current mechanism | Finding |
|---|---|---|
| `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Public authentication routes; account/token validation is in Auth-Service | No role/permission middleware is attached. Registration always assigns CUSTOMER. Login/Refresh issue role-bearing access tokens from current DB roles. |
| `GET /users/me` | `requireAuth` checks token and active DB status, then DB-backed `user.profile.view_own` | Fails closed if status is not ACTIVE, lookup fails, or the pending permission is absent. Profile service uses authenticated user ID. |
| `PATCH /users/me` | `requireAuth` checks token and active DB status, then DB-backed `user.profile.update_own` | Same active-status behavior; the permission mapping remains PENDING. |
| `GET /users/me/permissions` | `requireAuth` checks token and active DB status | Returns current database role/permission view without a separate grant. |
| `GET /admin/users` | `requireAuth` checks active status, then `user.list` | Requires DB grant. ADMIN's `user.list` assignment is PENDING and is not created by the seed. |
| `GET /admin/users/:userId` | `requireAuth` checks active status, then `user.view` | ADMIN mapping is PENDING and is not seeded. |
| `PATCH /admin/users/:userId/status` | `requireAuth` checks active status, then `user.status.manage` | ADMIN mapping is PENDING and is not seeded. |
| `PUT/DELETE /admin/users/:userId/roles/:roleCode` | `requireAuth` checks active status, then `user.role.manage` | ADMIN mapping is PENDING and is not seeded; service restricts role changes to CUSTOMER/TECHNICIAN and protects self/final-role constraints. |
| `POST /internal/permissions/check` | When internal auth is configured: one-use, short-lived Internal Service JWT, configured service allowlist, then current active-user DB permission check | Fails closed for unknown permissions and missing DB grants. Resource validation does not itself establish resource ownership. |
| `POST /internal/customers/resolve` | When configured: Internal Service JWT, explicitly allowlisted to `payment-service`, plus a verified User access token and active registered-customer lookup | Separates service authentication from User authentication. It does not use a permission code. |
| `GET /health` | Public health endpoint | No role/permission check; returns service/database health only. |

**DATABASE FACT:** The supplied dump has empty permission tables, so no
permission-protected operation can succeed from that snapshot until approved
permission data is provisioned. The implementation fails closed.

## 7. Cross-Service Dependencies

### Payment-Service

- **CODE FACT:** Payment-Service's `userAuthorizationAdapter` validates a
  User access token, discards its roles/permission claims for authorization,
  and sends a separate short-lived Internal Service JWT request to
  `POST /internal/permissions/check`.
- **CODE FACT:** `payment.record` is requested for payment recording. The
  approved mapping is ADMIN; the compatible seed creates it, but no database
  permission or assignment exists in the supplied dump.
- **CODE FACT:** `payment.view_own` is requested for payment history/details.
  The adapter additionally resolves the authenticated user's registered
  customer identity and compares it with the local payment account's
  `customer_id`. The permission decision alone is not treated as proof of
  ownership. The approved mapping is CUSTOMER; the supplied dump has no
  assignment row.
- **CODE FACT:** The adapter requests `can_refund` for refund operations.
  User-Service does not define it in `PERMISSIONS` or
  `ADMIN_PERMISSIONS`; the internal permission service therefore returns
  `allowed: false`. Payment's adapter fails closed. Payment's own code
  documents the two-person rule; this analysis does not approve any role
  assignment.
- **CODE FACT:** Payment-Service source documents internal payment/refund
  operations and a security-only runtime; no public payment/refund HTTP
  routes are registered in the inspected application. No cross-service
  database access by User-Service was found.

### Other services and API Gateway

- **CODE FACT:** No Booking-, Catalog-, Repair-, or Inventory-Service source
  call to `/internal/permissions/check`, role/permission middleware, or
  User-Service authorization adapter was found. Their inspected source trees
  contain database configuration only, not operation-level authorization
  code. The permission identifiers for these domains are therefore
  definitions/seeds, not proven enforcement.
- **CODE FACT:** API Gateway defines role and permission middleware. Its
  permission middleware derives grants from static `ROLE_PERMISSIONS` and
  role claims in the User access token; it does not query User-Service.
  The middleware is not imported or mounted by the current Gateway app.
- **CODE FACT:** Gateway currently proxies only an allowlist of User-Service
  paths; `/api/bookings`, `/api/catalog`, `/api/repairs`, `/api/inventory`,
  and `/api/payments` are explicitly denied as unmapped routes.
- **BLOCKER:** Gateway's dormant permission middleware recognizes only
  `PERMISSIONS`, not the separate `ADMIN_PERMISSIONS`; if later attached to
  the admin paths, `user.list` and related codes would be rejected as
  unknown. If static role middleware is later used, authorization can also
  reflect the token's role snapshot rather than current database assignments.

No cross-service database access is proposed. Service authorization remains
an API/internal-token contract; any future endpoint integration requires
explicit route and ownership checks in the owning service.

## 8. Security Findings

- **CODE FACT — positive:** Unknown roles are filtered from Login/Refresh
  role loading and rejected in access tokens. Unknown permission codes deny
  by default. Permission DB errors do not become allows.
- **CODE FACT — positive:** Registration assigns CUSTOMER only. The admin
  role-management API cannot assign ADMIN or STAFF, requires a separate
  `user.role.manage` grant, and guards self-modification and removal of the
  final role.
- **CODE FACT — positive:** Internal permission calls require a signed,
  short-lived, single-use service JWT, and the customer resolver further
  binds the request to a verified User access token. Configuring internal
  authentication is required before those routes are mounted.
- **CODE FACT — resolved:** All protected user/admin routers check current
  ACTIVE status before dispatch. DISABLED/LOCKED users with otherwise valid,
  unexpired tokens are denied; status DB failures return 503 without exposing
  database details.
- **CODE FACT — resolved:** Permission seed no longer references the absent
  `role_permissions.assigned_by` column and creates only approved mappings.
- **PENDING:** ADMIN user-management permissions, profile grants, and all
  other role-permission assignments remain unseeded until separately approved.
- **PENDING:** The internal permission endpoint has a configured service
  allowlist but no per-service permission scope. Any allowed internal service
  can ask whether a supplied user has any known permission. Decide whether
  this permission-decision oracle is acceptable for every configured caller.
- **CODE FACT:** `payment.view_own` checks a permission first and then
  separately checks registered-customer ownership in Payment-Service. The
  User-Service permission endpoint only validates that a work-order or
  payment identifier is supplied; it does not validate ownership.
- **CODE FACT:** Status changes take effect on the next protected request;
  there is no status cache in `requireAuth`.
- **BUSINESS RULE:** No STAFF role exists or may be invented; staff acting as
  Technician is disabled in v1. The source role enum and admin assignable
  role schema currently contain only CUSTOMER, TECHNICIAN, and ADMIN.

## 9. Pending Business Decisions

1. **PENDING:** Approve business descriptions for permission definitions;
   source identifiers do not establish descriptions.
2. **PENDING:** Approve all role-permission pairs other than the two locked
   payment mappings, including profile and User-Service admin permissions.
3. **BUSINESS RULE:** `payment.record` → ADMIN and `payment.view_own` →
   CUSTOMER are approved and are the only assignments created by the seed.
   The provided database remains empty because no seed was run.
4. **PENDING:** Define `can_refund`, its allowed role mapping, and how its
   enforcement interacts with the two-person refund rule. Until then,
   refunds remain denied at this authorization check.
5. **PENDING:** Decide whether each internal service should be restricted to
   an explicit set of permission checks rather than the shared
   `allowedServices` trust boundary.
6. **PENDING:** Decide the fresh-environment migration strategy. Migration
   003 is incompatible with the supplied schema; do not run, roll back, or
   alter database history without approval.

## 10. Recommended Implementation Plan

**TASK 05 implementation complete for the approved scope; remaining work:**

1. Execute the opt-in test only against a loopback, isolated, pre-provisioned
   MySQL database. The test refuses unknown permission rows or unapproved
   assignments and performs no table creation or cleanup.
2. Do not run this seed or any migration against Railway/production. The
   supplied dump remains unchanged and contains no permission data.
3. Resolve pending grants, `can_refund`, internal caller scope, and the
   future fresh-environment migration strategy separately.
4. Keep Payment-Service's independent customer-ownership check. No
   cross-service database access or authorization architecture change is
   proposed.

## 11. Acceptance Criteria

- Every permission code in the current source, plus Payment-Service's
  `can_refund` request, is inventoried above.
- The database's three existing roles, empty permission tables, composite
  key, defaults, and FK restrictions are documented.
- The seed inserts only the two approved mappings:
  `payment.record` → ADMIN and `payment.view_own` → CUSTOMER.
- No other role assignment is inferred from ADMIN, tests, source constants,
  or naming.
- Every current User-Service protected route and internal authorization route
  has its mechanism and findings recorded.
- The seed is compatible with current columns; migration 003 remains
  documented as incompatible and untouched.
- Payment-Service's User-Service dependency and the absence of equivalent
  current calls in Booking, Catalog, Repair, and Inventory are recorded.
- Disabled/locked users are denied on protected requests and DB failures fail
  closed. Internal service scope and remaining role mappings stay documented
  as pending.
- No schema changes, migrations, seeds, database records, or other-service
  source changes were made.

## 12. TASK 05 Implementation Results

- **CODE FACT:** Modified `seeds/002_permissions.js` to keep the catalog
  definitions, add only the two approved assignments, and use only
  `role_id`/`permission_id` for `role_permissions`.
- **CODE FACT:** Modified `permissionService.js`, `requireAuth.js`,
  `usersRoutes.js`, and `adminUsersRoutes.js` so every authenticated
  User-Service route checks current database status. Inactive users receive
  401; status lookup failures return a generic 503.
- **CODE FACT:** Updated permission service, seed, and HTTP route tests for
  approved mappings, pending-deny behavior, immediate DISABLED/LOCKED denial,
  and fail-closed database errors.
- **CODE FACT:** Added `tests/permissionAuthorization.database.integration.test.js`
  and `test:permission-database`. It is opt-in, requires loopback DB_TEST
  settings and a test-only database, validates existing schema, performs no
  DDL, and never deletes test records.
- **PENDING:** The isolated MySQL integration test was skipped because no
  dedicated DB_TEST configuration was available. No database was contacted.
- **CODE FACT:** The full User-Service suite passed: 125 tests total, 120
  passed, 0 failed, 4 skipped, and 1 TODO. The focused permission/route suite
  passed: 23 tests total, 22 passed, 0 failed, and the opt-in MySQL test
  skipped.
- **BLOCKER:** Migration `202611110003_create_role_permissions.js` remains
  incompatible with the supplied schema. It was not changed or executed.

## Evidence Index

- Database schema/data: `C:\Users\UsER\Downloads\dump-user_db-202611131507.sql:99-118,164-210`
- Permission and role catalog/mapping: `backend\shared\constants\index.js:8-74`
- User-Service administrative permission codes: `backend\user-service\src\constants\adminPermissions.js:1-7`
- Permission query/enforcement: `backend\user-service\src\services\permissionService.js:1-92`; `src\middleware\requirePermission.js:1-37`
- Internal check/API: `src\services\internalPermissionService.js:1-56`; `src\routes\internalRoutes.js:1-68`; `src\middleware\requireInternalServiceAuth.js:1-25`
- Role loading/JWT: `src\services\authService.js:55-145,300-320,430-460`; `src\middleware\requireAuth.js:1-29`
- Seed/migration: `seeds\001_roles.js`; `seeds\002_permissions.js:1-88`; `migrations\202611110001_create_user_service_auth_schema.js:1-80`; `migrations\202611110003_create_role_permissions.js:1-53`
- User API routes: `src\routes\usersRoutes.js:1-46`; `src\routes\adminUsersRoutes.js:1-59`; `src\routes\authRoutes.js:1-17`
- Payment caller: `backend\payment-service\src\services\userAuthorizationAdapter.js:1-318`; `backend\payment-service\src\services\paymentService.js:183-245,520-650,850-870`
- Gateway: `backend\api-gateway\src\middleware\permissionMiddleware.js:1-54`; `roleMiddleware.js:1-42`; `routes\serviceRoutes.js:1-85`; `app.js:1-41`
- Relevant tests: `tests\permissionService.test.js`; `tests\permissions-seed.test.js`; `tests\permissionMigration.test.js`; `backend\api-gateway\tests\permissionMiddleware.test.js`
