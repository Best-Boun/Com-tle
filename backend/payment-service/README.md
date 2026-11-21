# Payment-Service (port 3006)

Owns money for work orders: bills, payments at the counter, the online
(mock) checkout, balances, payment locks, voids and two-person refunds. Every
money change is written with an audit log and an outbox event in the same
transaction. It never reads another service's database.

Amounts are **whole baht** (integers). Through the API Gateway every route
below sits under `/api/payments` and needs `Authorization: Bearer <token>`.

## Setup

```bash
cp .env.example .env      # DB_*, JWT and service URLs
npm install
npm start
npm test
```

- The schema is created from `baseline/001_payment_service_fresh_schema.sql`
  (tables below). `migrations/` only holds the two deposit migrations from the
  removed booking deposit: they already ran on the shared database and must
  stay, because knex refuses to migrate when an applied file is missing. Their
  `deposits` / `deposit_audit_logs` tables are unused.
- `.env`: `PAYMENT_USER_SERVICE_BASE_URL` (customer lookup),
  `PAYMENT_REPAIR_SERVICE_URL` (online checkout reads the work order),
  `PAYMENT_USER_JWT_*` (verifying user tokens with User-Service's public key),
  `PAYMENT_INTERNAL_JWT_*` (this service's key for internal calls).

## Tables (`payment_db`)

| Table | Holds |
|---|---|
| `inbox_events` | Bills as `repair.bill.issued` events: work order, bill version, customer, total. The latest version is the amount due |
| `payments` | Each payment: work order, bill version, amount, method, status (`PENDING`, `SUCCEEDED`, `FAILED`, `VOIDED`), who recorded it |
| `refunds` | Refunds against a payment: amount, reason, status, who requested / approved / executed |
| `payment_locks` | One row per work order: `is_locked` stops new payments; locking the row serialises money changes for that work order |
| `idempotency_records` | Results of `Idempotency-Key` requests (24 h), so a retry returns the first result |
| `payment_audit_logs` | Who did what to which payment or refund |
| `outbox_events` | Events for other services (no relay publishes them yet) |

Balance of a work order = latest bill total − `SUCCEEDED` payments + `COMPLETED` refunds.

## Who may do what

Permissions are taken from the **roles in the verified access token**, so
payments keep working while User-Service is down (a role change applies once
the user's 15-minute access token is renewed):

| Role | Permissions |
|---|---|
| ADMIN | `payment.record`, `payment.view_all`, `payment.refund` |
| CUSTOMER | `payment.view_own` (only their own work orders) |
| TECHNICIAN | none |

A customer's `customer_id` is looked up once from User-Service
(`POST /internal/customers/resolve`, internal JWT) and then remembered.

## Endpoints

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/bills` | ADMIN | Register a bill version `{ work_order_id, bill_id, bill_version, customer_id, total_amount }`. Repair-Service calls this with the approved total (`POST /api/repairs/work-orders/:id/bill`, and at handover); an older or equal version returns 409 |
| POST | `/` | ADMIN | Record a payment at the counter `{ work_order_id, amount, payment_method: CASH\|TRANSFER\|CARD, reference_number? }`. Needs `Idempotency-Key`. Partial payments allowed; more than the balance returns 409; a locked work order returns 423 |
| POST | `/checkout` | CUSTOMER | Pay the whole balance online `{ work_order_id, payment_method: PROMPTPAY\|CARD }`. Needs `Idempotency-Key`. The amount is never sent by the browser: it comes from the work order in Repair-Service, read with the customer's own token. Mock provider: succeeds immediately |
| GET | `/` | ADMIN | Payments, `?work_order_id=&status=&payment_method=&page=&page_size=` |
| GET | `/my` | CUSTOMER | The caller's own bills and payments |
| GET | `/balances` | ADMIN | Balance of every work order with a bill |
| GET | `/balances/:workOrderId` | ADMIN or the owning customer | One balance |
| POST | `/work-orders/:workOrderId/lock` | ADMIN | Stop new payments `{ reason }` |
| POST | `/work-orders/:workOrderId/unlock` | ADMIN | Allow payments again `{ reason }` |
| POST | `/:paymentId/void` | ADMIN | Void a payment recorded by mistake `{ reason }`: only `SUCCEEDED`, and not when it already has refunds |
| POST | `/refunds` | ADMIN | Request a refund `{ payment_id, amount, reason }`. Needs `Idempotency-Key`. At most what is still refundable on that payment |
| GET | `/refunds` | ADMIN | Refunds, `?work_order_id=&payment_id=&status=&page=&page_size=` |
| POST | `/refunds/:refundId/approve` | ADMIN, not the requester | `REQUESTED` → `APPROVED` |
| POST | `/refunds/:refundId/reject` | ADMIN | `REQUESTED` or `APPROVED` → `REJECTED` `{ reason }` |
| POST | `/refunds/:refundId/execute` | ADMIN, not the requester | The money was sent back: `APPROVED` → `COMPLETED`; only now does the balance change |

`Idempotency-Key`: 8–100 characters of `A-Z a-z 0-9 . _ : -`. The same key with a
different body returns 422; a request still running with that key returns 409.

## Refunds need two admins

```
Admin A: POST /refunds                      REQUESTED
Admin B: POST /refunds/:id/approve          APPROVED   (the requester cannot approve)
Admin B: POST /refunds/:id/execute          COMPLETED  (the requester cannot execute)
```

`REQUESTED`, `APPROVED` and `COMPLETED` refunds reserve the payment's
refundable amount; `REJECTED` releases it.

## Calls to other services

- **User-Service**: `POST /internal/customers/resolve` with an internal JWT
  signed by this service, to turn a user id into a `customer_id`.
- **Repair-Service**: `GET /work-orders/:id` with the customer's token during
  checkout, to read the approved total and check ownership.

## Tests

`npm test` runs the route, service, authorization and security tests without a
database. The 12 tests in `tests/paymentService.database.integration.test.js`
are skipped unless `PAYMENT_SERVICE_ALLOW_DATABASE_TESTS=1` and a test database
is configured (see `tests/test-db.js`); do not point them at the shared
Railway database.
