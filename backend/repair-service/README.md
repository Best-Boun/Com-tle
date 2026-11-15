# Repair Service

Repair-Service owns work orders, repair workflow state, and the parts catalog.
Booking check-in creates one work order per booking; retrying the check-in
returns the existing ticket.

## Setup

1. Copy `.env.example` to `.env` and set the service's database and JWT values.
2. Install dependencies with `npm install`.
3. Configure `PAYMENT_SERVICE_URL` for the running Payment Service.
4. Apply the additive schema with `npx knex migrate:latest --env development`.
5. Start the service with `npm start`.

Migrations are additive; they do not drop or reset existing tables. The
workflow migration adds symptom/result and handover fields, quotation
metadata, and stock inventory/movement tables. `RECEIVED` is exposed to the
frontend as `PENDING`.

## Work-order API

Routes are mounted at the service root; the API Gateway exposes them under
`/api/repairs`.

- `POST /work-orders` — Booking-Service creates a work order using the
  authenticated administrator token and the booking id as the idempotency key.
- `GET /work-orders/me` — list the signed-in customer's work orders.
- `GET /work-orders/:workOrderId` — retrieve a work order and its status history
  when the caller owns it or has assigned/admin access.
- `GET /work-orders/assigned` — list the signed-in technician's assigned work.
- `GET /work-orders` — admin work-order list with optional `status` and `search`.
- `POST /work-orders/:workOrderId/assign` — ADMIN assigns or reassigns an active
  work order using `{ "technician_user_id": "<user UUID>" }`. The active
  assignment is stored in `work_order_assignments`; closed work orders cannot
  be assigned.
- `POST /work-orders/walk-in` — ADMIN creates a walk-in ticket with customer and
  device snapshots.
- Technician operations — start/save diagnosis, propose quote items, start
  repair, record repair results, and record a test at
  `/work-orders/:workOrderId/...`. Each operation checks the active assignment
  and current status in a transaction.
- Quotation operations — ADMIN prices/sends a draft or creates a new revision;
  the owner approves/rejects online, and ADMIN records walk-in decisions.
- `POST /work-orders/:workOrderId/handover` — ADMIN hands over a tested device.
  Repair-Service checks the live Payment-Service balance using the caller's
  authorization token; an outstanding amount requires an exception reason.
- `POST /work-orders/:workOrderId/cancel` — ADMIN cancels an open ticket and
  records returned stock.
- `GET/POST /parts`, `GET /parts/movements`, and `POST /parts/:partId/receive`
  — ADMIN-managed part catalog and stock receipts. Work-order part issues are
  restricted to approved quotation quantities and available stock.

The Inventory Service is still a skeleton; stock is persisted in the
Repair-Service database (`repair_parts_inventory` and
`repair_stock_movements`) so parts can be used without demo data. Payments stay
in Payment-Service. The frontend registers or updates a bill from approved
quotations before recording payment or handover; handover independently
verifies the balance server-side.