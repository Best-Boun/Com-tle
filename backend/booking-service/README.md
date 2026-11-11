# Booking Service (port 3002)

Owns bookings, appointment time and booking status (team schema: `bookings`, `booking_status_history`). Bookings are never deleted; every status change is written to `booking_status_history` with who changed it and why.

Columns added to the team's `bookings` table (additive only, no original column changed):

| Column | Why |
|---|---|
| `booking_number` | Human-friendly reference, e.g. `BK-20261120-FAK643` (unique) |
| `service_code`, `service_name`, `service_starting_price`, `service_currency` | Snapshot of the Catalog service at booking time, so later catalog price/name changes do not rewrite past bookings |

## Setup

```bash
cp .env.example .env      # fill DB_* values
npm install
npm run migrate
npm start
npm test
```

## Status flow

```
PENDING ──confirm──> CONFIRMED ──check-in──> COMPLETED   (Work Order created in Repair)
   │                    │
   └──cancel────────────┴──cancel──> CANCELLED           (no-show = admin cancel with reason)
```

## Time

The API uses shop-local time (`BOOKING_TIMEZONE`, default Asia/Bangkok): `appointment_date` + `appointment_time`. The database stores `scheduled_at` in **UTC**. Responses return both `scheduled_at` (ISO UTC) and the local `appointment_date` / `appointment_time`.

## Endpoints

Gateway prefix: `/api/bookings`. All need `Authorization: Bearer <token>`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/availability?date=YYYY-MM-DD` | booking.create / booking.manage | Slots + remaining capacity |
| POST | `/` | booking.create | Customer creates booking (PENDING) |
| GET | `/me` | booking.view_own | `?status=&date=&page=&limit=` |
| GET | `/` | booking.manage | All bookings, `?status=&date=&customer_id=` |
| GET | `/:bookingId` | owner or booking.manage | Includes `status_history` |
| PATCH | `/:bookingId/confirm` | booking.manage | PENDING → CONFIRMED |
| PATCH | `/:bookingId/cancel` | owner (before appointment) or booking.manage | Admin must send `{ "reason": "..." }`; sets cancelled_at/by |
| POST | `/:bookingId/check-in` | booking.manage | Calls Repair, CONFIRMED → COMPLETED |

Create body:

```json
{
  "service_id": "uuid",
  "appointment_date": "2026-11-20",
  "appointment_time": "10:00",
  "device_type": "Notebook",
  "brand": "Asus",
  "model": "TUF F15",
  "serial_number": "SN123456",
  "reported_symptom": "เครื่องร้อนและดับเอง"
}
```

`customer_id` always comes from the JWT `sub`, never from the body.

## Calls to other services

**Catalog** — `GET {CATALOG_SERVICE_URL}/services/:id` with the caller's token. The service and its category must be active.

**Repair (contract to agree with the Repair owner)** — on check-in:

```
POST {REPAIR_SERVICE_URL}/work-orders
Authorization: <admin token forwarded>
Idempotency-Key: booking-<booking_id>

{ "source": "BOOKING", "booking_id", "booking_number", "customer_id",
  "service_id", "service_code", "service_name", "device_type", "brand", "model", "serial_number", "reported_symptom", "scheduled_at" }
```

Expected response `2xx { "data": { "work_order_id": "<uuid>" } }`. Repair must return the **same** work order when the same Idempotency-Key is sent again. If Repair fails or times out, the booking stays CONFIRMED and check-in can be retried safely.

## Concurrency

While booking, the service holds a MySQL named lock (`GET_LOCK`) for that slot on the same connection as the transaction, and releases it only after COMMIT, so parallel requests cannot exceed `BOOKING_SLOT_CAPACITY` (no extra table needed). Verified with 108 requests (36 concurrent) against MariaDB.
