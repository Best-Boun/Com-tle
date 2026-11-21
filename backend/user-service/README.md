# User-Service Authentication API

The User-Service exposes the authentication, own-profile, current-access, and
administrative routes described below. All request and response bodies use
JSON and the service's common `{ "success": true, "message": "...", "data":
... }` envelope.

## `POST /auth/register`

Creates an active user, a `REGISTERED` customer, and the `CUSTOMER` role
assignment in one transaction. The password is hashed and is never returned.

Request:

```json
{
  "full_name": "Example Customer",
  "email": "customer@example.com",
  "password": "a-secure-password",
  "phone": "555-0100"
}
```

`phone` is optional and may be `null`. A successful request returns HTTP 201
with `data.user` and `data.roles`. Invalid input returns HTTP 400; a duplicate
email returns HTTP 409.

## `POST /auth/login`

Request:

```json
{
  "email": "customer@example.com",
  "password": "a-secure-password"
}
```

A successful request returns HTTP 200. Its `data` contains an RS256
`access_token`, a one-time `refresh_token`, `token_type`, `expires_in`,
`refresh_expires_in`, the user ID/email/phone, and assigned roles. Invalid
credentials and inactive accounts share a generic HTTP 401 response.

## `POST /auth/refresh`

Request:

```json
{
  "refresh_token": "<refresh-token>"
}
```

A successful request returns a new access token and rotated refresh token.
The prior token is invalidated. Reuse of a rotated token revokes active tokens
in its session. Invalid, expired, or revoked tokens return a generic HTTP 401
response.

## `POST /auth/logout`

Request:

```json
{
  "refresh_token": "<refresh-token>"
}
```

Returns HTTP 200 with `data.revoked` indicating whether an active session was
revoked. Unknown or already-revoked tokens are handled idempotently; a missing
or malformed token returns HTTP 400. Logout revokes refresh-token use; access
tokens remain valid until their expiration because the service does not
maintain access-token revocation state.

## `GET /users/me`

Requires `Authorization: Bearer <access_token>`. The verified token subject is
the only identity used to look up the profile; request-supplied user IDs are
not used.

Example response:

```json
{
  "success": true,
  "message": "Profile retrieved",
  "data": {
    "user_id": "user-uuid",
    "email": "customer@example.com",
    "phone": "555-0100",
    "status": "ACTIVE",
    "full_name": "Example Customer",
    "customer_type": "REGISTERED",
    "roles": ["CUSTOMER"]
  }
}
```

Password hashes, refresh tokens, and private key material are never included.
Missing or invalid access tokens return HTTP 401.

## `PATCH /users/me`

Requires the same bearer token. Only explicitly provided `full_name` and/or
`phone` fields are accepted. `full_name` is trimmed and must contain 1–150
characters. `phone` may be `null` or a string up to 30 characters. An empty
update, invalid value, or any unsupported field (including `email`, `user_id`,
`status`, `roles`, or `permissions`) returns HTTP 400. User and customer phone
values are updated in one transaction.

Example request:

```json
{
  "full_name": "Updated Customer",
  "phone": null
}
```

The HTTP 200 response uses the same profile shape as `GET /users/me` and
contains the updated values:

```json
{
  "success": true,
  "message": "Profile updated",
  "data": {
    "user_id": "user-uuid",
    "email": "customer@example.com",
    "phone": null,
    "status": "ACTIVE",
    "full_name": "Updated Customer",
    "customer_type": "REGISTERED",
    "roles": ["CUSTOMER"]
  }
}
```

Both profile routes require the corresponding current database permission:
`user.profile.view_own` or `user.profile.update_own`. The service resolves the
authenticated user's current role-permission assignments on each authorization
check rather than trusting role or permission claims in the access token.

## `GET /users/me/permissions`

Requires a valid bearer access token and returns the authenticated user's
current database-backed roles and permissions:

```json
{
  "success": true,
  "message": "Access retrieved",
  "data": {
    "roles": ["CUSTOMER"],
    "permissions": [
      "booking.create",
      "user.profile.update_own",
      "user.profile.view_own"
    ]
  }
}
```

Role and permission management APIs are not exposed by this service step.
Permission codes and business-role mappings use the approved definitions in
`backend/shared/constants`. The User-Service permission seed additionally
assigns only `user.profile.view_own` and `user.profile.update_own` to
TECHNICIAN and ADMIN, as it already does for CUSTOMER; this enables every
authenticated role to access only its own profile. No other permissions or
roles are added by this profile-access extension. After applying migrations,
run the User-Service role seed before `seeds/002_permissions.js`.

## User administration

All administration routes require a valid bearer access token, an ACTIVE
account, current database membership in the ADMIN role, and the explicit
permission required by that route. Both the role and permission are checked
from the current database access result; an ADMIN role alone does not bypass
the permission check. Permission grants require explicit approval. JWT
role/permission claims and client-supplied administrator IDs are not used to
authorize operations. Authorization database failures fail closed with HTTP 503.

### `GET /admin/users`

Requires `user.list`. Supports `page` (default 1), `limit` (default 25, max
100), `search` (up to 100 characters), `status` (`ACTIVE`, `DISABLED`, or
`LOCKED`), and `role` (`CUSTOMER`, `TECHNICIAN`, or `ADMIN`).

Example:

```http
GET /admin/users?page=1&limit=25&search=example&status=ACTIVE&role=CUSTOMER
Authorization: Bearer <access_token>
```

Returns an `items` array with safe account/customer fields and assigned roles,
plus pagination metadata. Password hashes and token data are excluded.

Example response:

```json
{
  "success": true,
  "message": "Users retrieved",
  "data": {
    "items": [
      {
        "user_id": "user-uuid",
        "email": "customer@example.com",
        "phone": "555-0100",
        "status": "ACTIVE",
        "full_name": "Example Customer",
        "customer_type": "REGISTERED",
        "roles": ["CUSTOMER"]
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 25,
      "total": 1,
      "total_pages": 1
    }
  }
}
```

### `GET /admin/users/:userId`

Requires `user.view`; returns account information, associated customer details
when present, and assigned roles. Unknown IDs return 404.

Example response:

```json
{
  "success": true,
  "message": "User retrieved",
  "data": {
    "user_id": "user-uuid",
    "email": "customer@example.com",
    "phone": "555-0100",
    "status": "ACTIVE",
    "customer": {
      "customer_id": "customer-uuid",
      "full_name": "Example Customer",
      "email": "customer@example.com",
      "phone": "555-0100",
      "customer_type": "REGISTERED"
    },
    "roles": ["CUSTOMER"]
  }
}
```

### `PATCH /admin/users/:userId/status`

Requires `user.status.manage`. Request body:

```json
{
  "status": "DISABLED"
}
```

Only `ACTIVE -> DISABLED`, `DISABLED -> ACTIVE`, and `LOCKED -> ACTIVE` are
allowed. Setting `LOCKED` manually is rejected; same-status updates are
idempotent. Administrators cannot change their own status. Disabling the last
active ADMIN returns 409. The ADMIN-role lock and active-admin check execute in
the same transaction as the update. A disabled account cannot authenticate on
subsequent login or refresh checks. Existing stateless access tokens remain
valid until expiration; this service does not claim to revoke them immediately.

Example response:

```json
{
  "success": true,
  "message": "User status updated",
  "data": { "user_id": "user-uuid", "status": "DISABLED" }
}
```

### `PUT /admin/users/:userId/roles/:roleCode`

Requires `user.role.manage`. The path role code may be `CUSTOMER` or
`TECHNICIAN`; `ADMIN` and unknown role codes are rejected. A user has exactly
one role, so assigning a role **replaces** the current one (CUSTOMER <->
TECHNICIAN) in one transaction; the audit record lists the replaced role codes
(`replaced_role_codes`). The authenticated administrator is recorded in
`assigned_by`. Assigning the role the user already has returns 409, an ADMIN
account's role cannot be changed (409), and administrators cannot change their
own role (403).

Example:

```http
PUT /admin/users/user-uuid/roles/TECHNICIAN
Authorization: Bearer <access_token>
```

On success the response data is `{ "user_id": "user-uuid", "role_code":
"TECHNICIAN" }`.

The success response is:

```json
{
  "success": true,
  "message": "Role assigned",
  "data": { "user_id": "user-uuid", "role_code": "TECHNICIAN" }
}
```

### `DELETE /admin/users/:userId/roles/:roleCode`

Requires `user.role.manage`. Only `CUSTOMER` and `TECHNICIAN` can be removed;
ADMIN removal is prohibited. Self-role changes are rejected, and removing a
user's final role returns 409. Role mutations lock the target user in a
transaction, preventing concurrent operations from bypassing the final-role
check. Users and accounts are never hard-deleted by these APIs.
On success the response data contains the target `user_id` and removed
`role_code`. Because every user has exactly one role, that role is always the
final one, so this route returns 409 in practice; change a role with `PUT`
instead.

Example:

```http
DELETE /admin/users/user-uuid/roles/TECHNICIAN
Authorization: Bearer <access_token>
```

The success response uses the same shape with message `"Role removed"`.

Successful requests use the common `{ "success": true, "message": "...",
"data": ... }` envelope. Invalid inputs return 400, unauthenticated requests
401, insufficient permission 403, unknown users/assignments 404, and invalid
transitions or protected conflicts 409. Unexpected database failures return a
generic 503 response without exposing database details.

Successful responses use the common envelope:

```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

## Customer merge

`POST /admin/customer-merge-requests` requires an active ADMIN with
`customer.merge.request`. Send `source_customer_id`, `target_customer_id`, and
an optional `merge_reason` in the JSON body, with an `Idempotency-Key` header.
Only distinct REGISTERED customers are eligible.

`POST /admin/customer-merge-requests/:requestId/approve` requires a different
active ADMIN with `customer.merge.approve` and a JSON `verification_reference`.
The same permission is required for `/reject`. Only the initiating user may
call `/cancel`. Reject and cancel accept an optional JSON `reason`. Actor
identities come from the authenticated access token, not request data.

Requests expire 24 hours after database creation. Approval rejects an expired
request even before the expiry worker runs. The worker is disabled by default;
set `USER_SERVICE_MERGE_EXPIRY_ENABLED=1` only after the merge schema and
deployment prerequisites have been explicitly approved and applied. It
releases reservations when it transitions expired requests. Until then,
expired requests remain reserved.

The merge migration and permission definitions/grants are not applied by this
code change. Provision the separately approved permissions and schema before
enabling this workflow. Do not run the legacy migration chain without first
reconciling its compatibility with the target schema. The source user account
is retained, and MERGED customer profiles cannot be updated.
MySQL DDL commits implicitly: if merge schema deployment is interrupted,
stop and inspect the target before any retry. Do not blindly rerun or drop
partially created objects; use an approved, backup-backed recovery plan.

## Guest customer linking

Guest customers may exist without a User account (`user_id` is `NULL`), while
registered customers are associated with one User. The existing schema
preserves this distinction and enforces a unique customer profile per User.

No guest identity-verification process or permission for guest linking is
defined in the approved requirements or current permission catalog. Therefore,
this service does **not** expose a guest-linking HTTP endpoint or grant a
permission for it. Matching email or phone is not treated as proof of
identity. Before adding an endpoint, approve both an identity-verification
process that resolves its proof to an existing User and an authorization
permission/role mapping.

The internal `guestCustomerLinkingService` requires a trusted verifier
dependency; its `linkGuestCustomer(customerId, identityEvidence)` operation
does not accept a caller-supplied User ID. It links only to an ACTIVE User and
changes only the existing Customer's `user_id` and `customer_type`. The
operation uses a transaction and row locks, retains the Customer ID and
historical references, and rejects already-registered customers or Users
with an existing Customer profile. If executed internally, it writes its
audit record in the same transaction. The internal service is not wired to
HTTP until verification and authorization rules are approved. Email and phone
matching alone are not verification.

## Audit log

Migration `202611110004_create_audit_logs.js` adds the internal
`audit_logs` table. There is no API for reading or changing audit records.
Audit inserts are transactionally coupled to successful registration, login,
refresh-token rotation/reuse handling, logout, profile updates, administrative
status and role changes, and internally executed guest-customer linking.
Failed login and refresh attempts are recorded without credentials or raw
tokens. A database failure to persist a required audit event fails the
operation rather than being ignored.

Recorded actions are `USER.REGISTERED`, `AUTH.LOGIN`,
`AUTH.REFRESH_ROTATED`, `AUTH.REFRESH_REJECTED`,
`AUTH.REFRESH_REUSE_DETECTED`, `AUTH.LOGOUT`,
`USER.PROFILE_UPDATED`, `ADMIN.USER_STATUS_CHANGED`,
`ADMIN.USER_ROLE_ASSIGNED`, `ADMIN.USER_ROLE_REMOVED`, and
`CUSTOMER.GUEST_LINKED`.

Records contain an audit UUID, nullable actor user ID, action, target type and
ID, timestamp, success/failure outcome, optional validated `X-Request-ID`, and
only allowlisted metadata (for example changed field names, status transition,
role code, or a generic failure reason). Passwords, password hashes, access
tokens, refresh tokens, private keys, and secrets are not logged. Audit data
is append-only through the ordinary User-Service APIs; database-level
administrative access remains outside this service's control.

## Environment, migrations, and tests

Configure database credentials, pool sizing, JWT issuer/audience/expiry, and
private-key path in the service environment as shown in `.env.example`.
Apply migrations only after verifying the configured database target:

```powershell
npx knex migrate:latest --knexfile knexfile.js --env development
```

Run the User-Service tests from this directory:

```powershell
npm.cmd test
```

The MySQL integration test is skipped unless `USER_SERVICE_ALLOW_DATABASE_TESTS=1`
and all `DB_TEST_*` settings are provided. It requires an explicitly isolated,
empty test schema and refuses a configured development database. Unit tests
and compiled migration checks do not contact MySQL.

## Internal service permission check

The internal permission bridge is mounted only when all
`INTERNAL_SERVICE_JWT_*` verification settings are configured. Its route is
`POST /internal/permissions/check`; the public API Gateway must not proxy this
path. Restrict direct service network access to trusted callers as well. The
route requires an RS256 Internal Service JWT with a configured `kid`, issuer,
audience, expiry, `jti`, `token_use: "internal_service"`, and an allowlisted
`client_id` that matches `sub`. User access tokens are not accepted as internal
service credentials.

Request:

```json
{
  "user_id": "user-uuid",
  "permission": "payment.record",
  "resource": {
    "work_order_id": "work-order-id"
  }
}
```

Only the target user ID, permission key, and optional resource IDs are
accepted. Caller-supplied roles, permissions, and customer IDs are rejected.
The response contains only the requested user ID, permission key, and an
explicit `allowed` boolean. Permission decisions are resolved from the current
User-Service database role-permission assignments; unknown permission codes
are denied, and inactive or unknown users are denied. The service identity
comes only from the verified internal token.
Database and token validation errors fail closed.

The Internal Service JWT contract and `/internal/permissions/check` route are
**PROPOSED** integration contracts, not an approved architecture decision.
Internal token replay protection is implemented with the
`internal_token_replays` MySQL table and a single atomic insert protected by a
unique `(issuer, jti)` index. A successful insert consumes the token; duplicate
key responses are denied as replays, and database errors fail closed. Tokens
are retained through `exp + 30 seconds` to match the verifier's approved clock
skew. The explicit `cleanupExpired()` repository operation deletes only rows
with `expires_at < UTC now`; no cleanup timer or public cleanup endpoint is
configured. A token is consumed after cryptographic and claim validation but
before request parsing and permission evaluation, so malformed requests,
denials, and permission database failures do not make a token reusable.

The replay table migration must be applied using the normal reviewed migration
process before enabling the internal route. Replay persistence does not itself
approve the proposed JWT/permission bridge or replace key distribution,
service allowlisting, deployment network restrictions, or security review.
Do not treat the route as production-ready until those integration contracts
and deployment requirements are approved and configured.

Internal service verification settings are:

- `INTERNAL_SERVICE_JWT_PUBLIC_KEYS_DIR`: trusted public PEM files named
  `<kid>.pem`; private keys are rejected.
- `INTERNAL_SERVICE_JWT_ISSUER` and `INTERNAL_SERVICE_JWT_AUDIENCE`.
- `INTERNAL_SERVICE_JWT_ALLOWED_SERVICES`: comma-separated service IDs.
- `INTERNAL_SERVICE_JWT_MAX_LIFETIME_SECONDS`: 1–300 seconds, default 300.
- The replay table must be migrated before enabling internal service JWT
  verification. Its expiry cleanup is currently an explicit repository
  operation; deployments must decide and operate an appropriate maintenance
  schedule without exposing cleanup publicly.

The existing User JWT contract is RS256 with `sub`, `roles`, `iss`, `aud`,
`iat`, and `exp`. New User access tokens include
`token_use: "user_access"`; the User-Service verifier rejects any other
purpose while continuing to accept already-issued legacy User tokens that
omit the marker until their normal expiration. The internal customer identity
lookup is stricter and requires the marker explicitly. The current User JWT
has no `kid`, and the repository contains no approved key-rotation contract.
User JWT issuance therefore does not add a `kid`.

The existing catalog maps `payment.record` to ADMIN and `payment.view_own` to
CUSTOMER. `can_refund` is not in the approved catalog and is always denied as
an unknown permission; no permission or role grant was added. The generic
permission check does not verify Payment-Service resource ownership. In
particular, `payment.view_own` must not be used until Payment-Service also
compares the Work Order payment account's customer ID with the trusted
User-to-Customer lookup described below.

## Internal customer identity lookup

`POST /internal/customers/resolve` is mounted only when internal service JWT
verification is configured and is not exposed through the public API Gateway.
It requires the existing single-use RS256 Internal Service JWT and explicitly
allows only `payment-service` for this operation. Every valid Internal Service
JWT is consumed before request parsing or User-token verification.

The original User access token must be supplied separately in the
`X-User-Access-Token` header. User-Service independently verifies that token
using its existing User JWT verification configuration and requires
`token_use: "user_access"`. The strict JSON body contains only `user_id`, which
must match the verified JWT subject:

```json
{
  "user_id": "user-uuid"
}
```

Success returns only `user_id`, `customer_id`, and `customer_type` (always
`REGISTERED`) in the standard response envelope. Unknown fields, including a
caller-supplied `customer_id`, are rejected. Only ACTIVE Users with a matching
REGISTERED Customer are resolved. Missing Users, inactive Users, GUEST
Customers, and missing mappings receive the same generic 404. Multiple
Customer mappings fail closed with a safe 409 integrity conflict. Database or
audit failures return 503. Both successful and denied lookup attempts are
audited with the calling service, safe reason category, and request ID where
available; tokens and personal profile fields are not logged. The read and its
audit record are written within a User-Service transaction.

Payment-Service must compare the returned Customer ID with its local
`work_order_payment_accounts.customer_id`. This lookup is live and uncached.
The Payment-Service adapter uses a three-second timeout, does not retry, and
sends a newly issued single-use Internal Service JWT for each request. Caller
retries must create a new token with a new `jti`.
