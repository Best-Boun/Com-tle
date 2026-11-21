# Booking Service (port 3002)

Owns **repair requests** ("แจ้งซ่อมล่วงหน้า"): a customer tells the shop which
device and what kind of fault before bringing it in. There is no time slot, no
deposit and no no-show. When the customer arrives, the counter finds the request
by its number or phone and checks the device in, which opens the work order in
Repair Service.

The table is still called `bookings` (team schema: `bookings`,
`booking_status_history`), so existing work orders keep their `booking_id` link.
Requests are never deleted; every status change is written to
`booking_status_history` with who changed it (`null` = the system) and why.

Columns added to the team's `bookings` table (additive only):

| Column | Why |
|---|---|
| `booking_number` | Human-friendly reference: `RQ-YYYYMMDD-XXXXXX` for requests (old bookings keep `BK-...`), unique |
| `service_code`, `service_name`, `service_starting_price`, `service_currency` | Snapshot of the Catalog service, so later price/name changes do not rewrite past requests |
| `symptom_group` | The kind of fault the customer picked (see below) |
| `contact_name`, `contact_phone` | Who the counter calls; phone stored as digits only and used for search |
| `technician_id` | Old appointment flow only (technicians no longer take requests here) |

`scheduled_at` is nullable: new requests have no appointment; old bookings keep theirs.

## Setup

```bash
cp .env.example .env      # fill DB_* values
npm install
npm run migrate
npm start
npm test
```

| Variable | Default | Meaning |
|---|---|---|
| `REQUEST_DIAGNOSIS_SERVICE_ID` | Catalog seed `HW-DIAG` | Service a request is for when the customer does not pick one |
| `REQUEST_MAX_OPEN_PER_CUSTOMER` | 5 | Open requests one customer may have |
| `REQUEST_EXPIRY_DAYS` | 30 | Requests nobody brought in are closed after this many days |
| `REQUEST_EXPIRY_CHECK_MINUTES` | 60 | How often the expiry check runs (also 10 s after start) |
| `BOOKING_TIMEZONE` | Asia/Bangkok | Shop-local dates (`?date=` filter, request numbers) |
| `CATALOG_SERVICE_URL`, `REPAIR_SERVICE_URL`, `SERVICE_CALL_TIMEOUT_MS` | | Services this one calls |

## Status flow

```
create ──> PENDING ──check-in──> COMPLETED   (work order created in Repair)
              │
              ├──cancel (customer any time, shop with a reason)──> CANCELLED
              └──no device within REQUEST_EXPIRY_DAYS (automatic)──> EXPIRED
```

Left by the old appointment flow (never created any more): `CONFIRMED` can still
be checked in or cancelled; `NO_SHOW` is final. Leftover `AWAITING_DEPOSIT`
bookings were cancelled by migration `20261119000101_repair_requests.js`.

## Endpoints

Gateway prefix: `/api/bookings`. All need `Authorization: Bearer <token>`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/options` | booking.create / booking.manage | `{ device_types, symptom_groups }` for the form |
| POST | `/` | booking.create | Customer creates a request (PENDING) |
| GET | `/me` | booking.view_own | `?status=&date=&page=&limit=`, newest first |
| GET | `/` | booking.manage | All requests, `?status=&date=&customer_id=&search=` |
| GET | `/:bookingId` | owner or booking.manage | Includes `status_history` |
| PATCH | `/:bookingId/cancel` | owner or booking.manage | The shop must send `{ "reason": "..." }`; sets cancelled_at/by |
| POST | `/:bookingId/check-in` | booking.manage | `{ accessories?, intake_terms_acknowledged? }`; calls Repair, PENDING → COMPLETED |

`search` is either a request number (`RQ-...` or an old `BK-...`, matched from
the start, case-insensitive) or part of a phone number (digits only, e.g.
`5678` or `081-234`).

Create body:

```json
{
  "device_type": "NOTEBOOK",
  "brand": "Asus",
  "model": "TUF F15",
  "serial_number": "SN123456",
  "symptom_group": "OVERHEATING_OR_NOISE",
  "reported_symptom": "เครื่องร้อนและดับเอง",
  "contact_name": "สมชาย ใจดี",
  "contact_phone": "081-234-5678",
  "service_id": null
}
```

- `device_type`: `NOTEBOOK`, `DESKTOP`, `ALL_IN_ONE`, `OTHER`
- `symptom_group`: `WONT_POWER_ON`, `DISPLAY`, `SLOW_OR_FREEZING`,
  `BATTERY_OR_CHARGING`, `KEYBOARD_TOUCHPAD_PORTS`, `OVERHEATING_OR_NOISE`,
  `LIQUID_OR_DROP_DAMAGE`, `SOFTWARE_OR_VIRUS`, `DATA_RECOVERY`, `OTHER`
- `contact_phone`: a Thai number (`0` + 8–9 digits; `+66`, spaces and dashes are accepted)
- `service_id`: optional, for a known job such as cleaning; otherwise the request is for a diagnosis
- `customer_id` always comes from the JWT `sub`, never from the body

## Calls to other services

**Catalog** — `GET {CATALOG_SERVICE_URL}/services/:id` with the caller's token,
for the chosen service or `REQUEST_DIAGNOSIS_SERVICE_ID`. The service and its
category must be active.

**Repair Service** — on check-in:

```
POST {REPAIR_SERVICE_URL}/work-orders
Authorization: <admin token forwarded>
Idempotency-Key: booking-<booking_id>

{ "source": "BOOKING", "booking_id", "booking_number", "customer_id",
  "service_id", "service_code", "service_name", "device_type", "brand", "model",
  "serial_number", "accessories", "reported_symptom", "scheduled_at",
  "intake_terms_acknowledged" }
```

- The contract keeps the `booking_*` names.
- `device_type` is sent as the walk-in form's text (`NOTEBOOK` → `โน้ตบุ๊ก`,
  `DESKTOP` → `PC`, `ALL_IN_ONE` → `All-in-One`, `OTHER` → `อื่น ๆ`).
- `reported_symptom` starts with the symptom group, e.g.
  `[เปิดไม่ติด / ดับเอง] ...`, because work orders have no symptom-group field.
- `scheduled_at` is the time the request was made (an old booking sends its appointment).

Expected response `2xx { "data": { "work_order_id": "<uuid>" } }`. Repair returns
the same work order for a repeated request id. If Repair fails or times out, the
request stays open and check-in can be retried safely.

## Concurrency

- A request-number collision is retried with a new number (up to 3 times).
- Status changes only apply while the row is still in the expected status, so
  two people acting at once cannot both succeed (the loser gets 409).
- The expiry check locks the rows it closes, so a check-in at the same moment
  either wins or sees the request expired, and running it on two instances
  expires each request only once.
