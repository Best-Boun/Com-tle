# Payment-Service

Payment-Service owns its database. It implements internal payment recording,
balance retrieval, refund request/review/execution, payment/refund history
queries, and persistent audit logging. It exposes no HTTP endpoints and does
not connect to other services' databases.

## Schema

- `work_order_payment_accounts` stores the external `work_order_id`, external
  `customer_id`, amount due, currency, and timestamps. Its local primary key
  lets Payment-Service serialize account-level financial changes. There is no
  cross-service foreign key.
- `payments` stores each payment attempt and its amount, currency, status,
  work-order account reference, optional payment method, recorded staff ID,
  and timestamps. Multiple rows can refer to one work order. The optional
  columns preserve compatibility with payment rows created before Step 2;
  new recording logic always supplies both. Payment statuses are `PENDING`,
  `COMPLETED`, `FAILED`, and `CANCELLED`.
- `refunds` stores each refund against a local payment, including amount,
  currency, status, initiator, reviewer decision, and timestamps. Refund
  statuses are `REQUESTED`, `APPROVED`, `REJECTED`, `PROCESSING`, `COMPLETED`,
  `FAILED`, and `CANCELLED`.

All amounts use `DECIMAL(12,2)`, not floating-point columns. Amounts must be
positive; currency codes are three uppercase letters. A refund may have at
most one review decision. Database checks require all reviewer decision
fields together and prohibit the initiator from reviewing their own refund.
The `reviewer_user_id` and `initiated_by` values are external identity
references; Payment-Service does not create cross-service foreign keys.

Outstanding balance is calculated as `amount_due - completed payments +
completed refunds`. Atomic payment/refund operations lock the account row
within a transaction. The internal balance calculation uses integer minor
units, requires payment/refund currencies to match the account, and reports
negative balances, invalid monetary data, or refunds exceeding completed
payments as financial inconsistencies. Statuses here are independent from
Work Order and Repair statuses.

## Migration and tests

The Step 1 schema migration is
`migrations/202611110001_create_payment_schema.js`. Step 2 adds
`migrations/202611110002_add_payment_recording_fields.js`; Step 4 adds the
nullable `reason` field with
`migrations/202611110003_add_refund_reason.js`; Step 5 adds execution state
with `migrations/202611110004_add_refund_execution_fields.js`; Step 7 adds
`audit_logs` with
`migrations/202611110005_create_payment_audit_logs.js`. New columns are
legacy-safe. All migrations are reversible. Review and verify the configured
database target before applying them; the service does not run migrations
automatically. Audit logs are append-only through service APIs, have no
ordinary read/update/delete API, and do not have cross-service actor
foreign keys.

Run the offline migration SQL tests from this directory:

```powershell
npm.cmd test
```

These compile Knex schema definitions without connecting to MySQL. No
Payment-Service database integration is configured.

## Payment recording status

The internal `paymentService.recordPayment(authContext, input)` operation is
implemented, but no HTTP route is exposed. Constructing the service requires
trusted providers to (1) authenticate the actor and verify the current
database-backed `payment.record` permission, (2) confirm the stored account
amount/currency came from an approved Repair-Service quotation, and (3)
validate a configured approved payment method. Actor identity is taken only
from the authorization provider; request bodies cannot specify it. This
service does not connect to another service's database.

The input shape is `{ "work_order_id": "...", "amount": "25.50",
"currency": "THB", "payment_method": "<approved configured value>" }`.
Amounts must be decimal strings with at most two fraction digits. The service
records a successful receipt as `COMPLETED`. `getBalance(workOrderId)` returns
the Work Order ID, currency, amount due, total completed payments, total
completed refunds, and outstanding balance. No HTTP balance endpoint is exposed; business routes are not part of the
Security-only runtime.
Only `COMPLETED` payments count toward paid totals; `PENDING`, `FAILED`, and
`CANCELLED` do not. Only `COMPLETED` refunds are added back to the outstanding
balance; requested, approved, rejected, processing, failed, and cancelled
refunds have no effect. Balance validation and payment insertion occur in one
transaction after locking the payment account row. Refund state changes use
the same account-row locking protocol.

Payment statuses are `PENDING`, `COMPLETED`, `FAILED`, and `CANCELLED`.
Recording currently creates a `COMPLETED` payment; only completed payments
affect the balance. Refunds transition from `REQUESTED` to `APPROVED` or
`REJECTED`; approved refunds may enter `PROCESSING`, then become `COMPLETED`
or confirmed `FAILED`. `REQUESTED`, `APPROVED`, `PROCESSING`, and `COMPLETED`
reserve refundable capacity; `REJECTED`, `FAILED`, and `CANCELLED` release it.
Only `COMPLETED` refunds affect the balance. These states are independent of
Work Order and Repair status.

Successful payment recording, refund requests and decisions, and refund
execution start/retry/final outcomes are written to `audit_logs` in the same
transaction as their financial state change. Financial payment validation
rejections are audited in a separate transaction after the failed financial
transaction rolls back. Audit events contain event ID/key, trusted actor when
available, action, target, time, outcome, validated request/correlation ID,
and allowlisted metadata. They do not contain raw request bodies, credentials,
provider references, or idempotency/lease secrets. A unique event key prevents
duplicate event insertion. Audit persistence failures are surfaced; critical
financial mutations roll back if their corresponding audit insert fails.
There is no Payment-Service account snapshot creation/update operation, so no
account amount-due audit event is currently applicable.

There is no approved Repair-Service quotation API or payment-method catalog.
The security adapter is initialized by the Security-only runtime, but it is
not connected to the internal payment operation or any HTTP route. Until the
remaining providers and business integration are approved, the operation
cannot be used by HTTP clients. The shared permission catalog defines
`payment.record` for ADMIN; the service does not trust role or permission
claims directly.

## Remaining business decisions

Before payment APIs are added, define the Repair-Service quotation endpoint
and snapshot/update rules and the approved payment-method catalog. No
business routes or payment/refund service composition is implemented by the
Security-only runtime.

## Refund request, review, and execution status

`createRefundRequest(authContext, input)` and
`decideRefundRequest(authContext, input)` are internal service operations;
there are no refund HTTP endpoints. Both require the injected trusted
`authorizeRefundActor(authContext, "can_refund")` provider and derive the
actor ID only from its response. The requester must provide a completed
payment ID, positive decimal-string amount, and non-empty reason. A refund
starts as `REQUESTED`; its original payment is unchanged.

Refund availability is calculated from the completed payment amount less
existing reservations. `REQUESTED`, `APPROVED`, `PROCESSING`, and `COMPLETED`
refunds reserve capacity; `REJECTED`, `FAILED`, and `CANCELLED` do not.
`PROCESSING` is conservatively reserved to prevent another request from
spending funds already in execution. A different actor with independently
verified `can_refund` permission must decide a `REQUESTED` refund as
`APPROVED` or `REJECTED`; the decision records reviewer ID and timestamp.
Only `REQUESTED` refunds can be reviewed. Only `COMPLETED` refunds affect the
Step 3 outstanding-balance formula.

`executeRefund(authContext, { refund_id })` is internal. It accepts only an
`APPROVED` refund, or resumes a previously `PROCESSING`/unknown or
confirmed-`FAILED` execution. It records the executing actor, first execution
time, attempt count, and stable `refund:<refund_id>` idempotency key, then
commits `PROCESSING` before calling `refundProvider.executeRefund` with the
refund/payment IDs, decimal amount, currency, and key. A provider must
deduplicate requests by that key and return only explicit `succeeded`,
`failed` (confirmed), or `unknown` outcomes. Success moves to `COMPLETED`;
confirmed failure moves to `FAILED`; exceptions, timeouts, and malformed
outcomes remain `PROCESSING` with `UNKNOWN`. These cases retain the
reservation until a safe retry/reconciliation. Provider references are stored
when supplied. No provider is configured, so production execution remains
disabled until a real provider explicitly marked trusted is injected. A
test-only provider is accepted only with the explicit test opt-in and is
rejected in production. Tests use a stub provider only; it cannot transfer
money. Provider credentials are held by the provider integration and are
never passed to or stored in audit records.

Claiming and finalizing execution lock the payment account and related rows
inside transactions. A 60-second lease prevents parallel workers from
starting the same refund while a call is active; expired/unknown attempts
reuse the same provider idempotency key. A real provider must guarantee that
the key prevents duplicate transfers even across timeouts and concurrent
retries. Only provider-confirmed completion affects the Step 3 balance, once.
The offline concurrency tests use a serialized fake and do not verify MySQL
lock behavior.

The shared permission catalog does not define `can_refund`. The runtime
adapter therefore denies this unknown permission, and no refund operation can
pass authorization until its definition and role mapping are explicitly
approved. The external refund-provider contract is also not configured; no
endpoint is exposed. User-Service permission catalog changes are required;
this task did not modify User-Service.

## Payment and refund history queries

Internal query methods are `getPaymentHistory(authContext, workOrderId, query)`,
`getPaymentDetails(authContext, paymentId)`,
`getRefundHistory(authContext, query)`, and
`getRefundDetails(authContext, refundId)`. No HTTP endpoints are exposed.
Payment history supports `status`, approved `payment_method`, inclusive ISO
8601 `from`/`to` dates, and `page`/`page_size`. Refund history requires a
`payment_id` or `work_order_id` and supports refund `status`, date range, and
the same pagination. Defaults are page 1 and 25 rows; page size is capped at
100. Results sort newest first with payment/refund ID as a stable tie-breaker.
List responses contain `items` and `pagination` (`page`, `page_size`, `total`,
`total_pages`).

Queries select only documented safe fields, omit provider references,
idempotency keys, lease data, and other internal execution metadata, and check
payment/refund currency consistency. Reads run in a repeatable-read
transaction. The existing `getBalance(workOrderId)` remains the sole balance
implementation; it still returns `completed_payments_total`,
`completed_refunds_total`, and `outstanding_balance` without clamping
inconsistent balances.

History methods fail closed unless trusted `authorizePaymentQuery` and
`authorizeRefundQuery` providers are injected. A provider must authenticate
the caller, enforce the applicable approved permission and Work Order/payment
ownership, and return `true` or `{ allowed: true, include_recorded_by: true }`
for payment queries where the recording actor may be disclosed. The shared
catalog has `payment.view_own` for CUSTOMER. The runtime adapter checks that
permission and verifies ownership through the trusted identity lookup plus
Payment-Service's local payment account, but no business query route is
registered. There is no approved refund-history read permission or staff-wide
payment-history mapping, so refund history remains denied.

## Required integration contracts and limitations

Before any endpoint or production workflow is wired, the project must approve
and implement: the `can_refund` permission definition and mapping; an
approved Refund History read permission; trusted approved-quotation
verification; and an approved payment-method catalog. No API Gateway or
other service integration is part of this service implementation.

Automated tests use in-memory transaction/query doubles. They validate
transactional intent and rollback behavior but do not establish MySQL
transaction, locking, pagination, or concurrent-worker guarantees. Run
database integration tests only with an explicitly opted-in isolated MySQL
test database. No live database is used by `npm.cmd test`.

## Security-only runtime and User-Service bridge

The server composes a Security-only runtime containing the User JWT verifier,
Internal Service JWT issuer, and User authorization adapter. The application
factory preserves the existing middleware and health route but registers no
payment or refund routes and does not construct `createPaymentService`.
Creating the runtime does not make network requests or execute SQL. The
adapter is available through the runtime dependency object for future
injection; there is no mutable module-global security state.

User identity is taken from a verified RS256 User access token only; the
adapter discards JWT roles/permissions and obtains current permission
decisions from User-Service. It sends a separate short-lived RS256 Internal
Service JWT to `POST /internal/permissions/check`, validates the returned
subject, permission, and allow/deny shape, and fails closed on token errors,
malformed responses, timeouts, or User-Service/network failures. Authentication
failures are distinct from explicit permission denials. Tokens and credentials
are never logged.

### Environment configuration

The following variables are required to start the Security-only runtime:

- `PAYMENT_USER_SERVICE_BASE_URL`: trusted User-Service base URL.
- `PAYMENT_USER_JWT_ISSUER` and `PAYMENT_USER_JWT_AUDIENCE`.
- `PAYMENT_USER_JWT_PUBLIC_KEY_PATH`: path to the trusted User-Service RSA
  public key.
- `PAYMENT_INTERNAL_JWT_PRIVATE_KEY_PATH`: path to the Payment-Service RSA
  signing key.
- `PAYMENT_INTERNAL_JWT_KID`, `PAYMENT_INTERNAL_JWT_ISSUER`,
  `PAYMENT_INTERNAL_JWT_AUDIENCE`, and `PAYMENT_INTERNAL_SERVICE_ID`.

Key paths may be absolute or relative to `backend/payment-service`. User
verification uses only the configured public key; the User-Service private
key must never be copied here. Internal token signing uses only the
Payment-Service private key, whose corresponding public key is configured at
the trusted verifier.

`PAYMENT_USER_JWT_KID` is optional and must remain unset for the current
User-Service token format, which has no `kid`. User JWTs use
`token_use: "user_access"`; role and permission claims are not authorization
inputs. `PAYMENT_INTERNAL_JWT_LIFETIME_SECONDS` is optional, defaults to 60,
and must be between 1 and 300 seconds.

`PAYMENT_USER_SERVICE_BASE_URL` must use HTTPS. HTTP is accepted only for a
loopback URL when `NODE_ENV=development` is explicitly set. Credentials,
query strings, fragments, and URL paths are rejected. The runtime never
downgrades HTTPS to HTTP.

Internal service signing requires
`PAYMENT_INTERNAL_JWT_PRIVATE_KEY_PATH`,
`PAYMENT_INTERNAL_JWT_KID`,
`PAYMENT_INTERNAL_JWT_ISSUER`,
`PAYMENT_INTERNAL_JWT_AUDIENCE`, and `PAYMENT_INTERNAL_SERVICE_ID`.
`PAYMENT_INTERNAL_JWT_LIFETIME_SECONDS` is configurable from 1 to 300 seconds
(default 60). Each request receives a fresh `jti`. The signing private key is
provided by deployment configuration and is not included in the repository.
Each outbound request gets a newly signed, single-use token; there are no
automatic retries. User-Service persistently consumes each `jti` in its
MySQL replay store with the approved 30-second clock-skew allowance; replay
storage failures fail closed. No keys or credentials are included in
`.env.example`.

The adapter retains its three-second request timeout, including response
body parsing, and fails closed on network errors, timeouts, malformed
responses, and denied decisions. Refund-history authorization remains denied.
The existing `/health` endpoint remains unauthenticated and reports only
service/database status; its database probe runs only when the health route is
requested, not while constructing the runtime or application.

Run the offline Payment-Service tests from this directory with
`npm.cmd test`. The tests use temporary test-only RSA keys, mocked transport,
and database doubles; they do not contact User-Service or a database.

The adapter checks `payment.record` for each record operation and returns the
verified actor ID. The existing approved catalog maps this permission to
ADMIN. It independently checks `payment.view_own` and performs a trusted
service-to-service customer lookup plus a local comparison against
`work_order_payment_accounts.customer_id`. Client-supplied `customer_id` is
never accepted as proof of ownership.

`can_refund` is queried independently for refund request, review, and
execution, but it is absent from the User-Service/shared permission catalog.
User-Service therefore denies it as unknown, and no refund operation can pass
this adapter until its permission definition and role mapping are explicitly
approved. No refund-history permission is approved; the adapter denies refund
history queries. The `payment.view_own` permission decision itself does not
establish Work Order ownership.

User-Service exposes `POST /internal/customers/resolve` only when its explicit
Internal Service JWT verification configuration is present. The public API
Gateway must not proxy this route; direct network access must be restricted
independently. For customer resolution, Payment-Service sends the verified
User's original access token in `X-User-Access-Token` and the separate
single-use Internal Service JWT in `Authorization: Bearer`. User-Service
independently validates the User JWT, its `user_access` purpose, and that its
subject matches the request's `user_id`.

The adapter performs this lookup live with a three-second timeout covering
response-body parsing, no automatic retries, and a fresh Internal Service JWT
for every request. It strictly validates the response and compares the
resolved registered Customer ID only with Payment-Service's local
`work_order_payment_accounts.customer_id`. Identity lookup failures and
mismatches fail closed. No client-facing Payment endpoint is enabled; the
server initializes the adapter only as part of the Security-only runtime.

The remaining requirements are:

- Approval of the Internal Service JWT issuer/audience/service identity and
  key-distribution deployment configuration.
- A trusted User JWT public-key distribution and future `kid`/rotation
  contract.
- Approval and mapping of `can_refund`, including its application to request,
  review, and execution; approval of a refund-history permission.
- Production internal-network/TLS configuration and deployment key values.

The adapter tests use generated in-memory RSA keys and stubbed HTTP responses;
they contact no external service and no database. User-Service permission
tests use query doubles. No database or production credentials are used.
