# SmartFix Frontend

React + Vite web app for the SmartFix repair shop — customer, technician and admin screens, Thai / English.

> **Status:** works fully on **built-in demo data** by default. With `VITE_USE_MOCK=false`, auth, catalog, bookings and payments use the real backend through the API Gateway (see *Real API mode*).

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Demo accounts

Password for all: `demo1234` (or use the buttons on the sign-in page)

| Role | Email | Lands on |
|---|---|---|
| Customer | customer@smartfix.test | `/my/bookings` |
| Technician | technician@smartfix.test | `/tech` |
| Admin | admin@smartfix.test | `/admin` |

Demo data is saved in the browser (localStorage). **Reset demo data** in the footer restores it.

## Pages

| Area | Route | What it does |
|---|---|---|
| Public | `/`, `/services`, `/login`, `/register` | Home, price list, sign in / up |
| Customer | `/book` | 4-step booking: service → date & slot → device → confirm |
| | `/my/bookings`, `/my/bookings/:id` | Bookings, status history, cancel before the appointment |
| | `/my/repairs`, `/my/repairs/:id` | Repair progress, approve / reject quotations, payment balance |
| | `/my/payments`, `/my/profile` | Balances and transactions, profile |
| Technician | `/tech`, `/tech/jobs/:id` | Assigned jobs; diagnose → propose items → repair → test; propose additional work |
| | `/tech/parts` | Stock lookup |
| Admin | `/admin` | Today: what needs attention |
| | `/admin/bookings` | Confirm, cancel (reason required), check in → opens the work order |
| | `/admin/work-orders`, `/new`, `/:id` | Walk-ins, assign technician, price & send quotations, revise rejected ones, approve for walk-ins, issue parts, take payments / refunds, handover (exception with reason if unpaid), cancel with part returns |
| | `/admin/catalog` | Services and categories (hide instead of delete) |
| | `/admin/inventory` | Parts, receive stock, movement log |
| | `/admin/payments` | Balances per work order, all transactions |

## Business rules implemented (from the team review)

1. 1 booking → 1 work order (check-in), walk-ins create work orders directly
2. Quotation revisions are never overwritten (Rev.1 rejected → Rev.2 …)
3. Extra problems during repair → *additional* quotation; approved work continues
4. Parts are issued through Inventory, only within the approved scope and available stock
5. Partial payments; balance is computed from transactions (UNPAID / PARTIAL / PAID / PARTIALLY_REFUNDED / REFUNDED)
6. Handover needs completed + tested + paid, otherwise an admin exception with reason and outstanding amount is recorded
7. Cancelling keeps all history; issued parts can be returned to stock

## Structure

```
src/
  api/
    index.js          ← the only place pages import data access from
    session.js        ← signed-in user (+ token later)
    mock/             ← demo backend: db.js (seed data), index.js (rules)
  auth/               ← AuthProvider, RequireRole
  i18n/               ← TH/EN: dictionary for shared terms, L("ไทย","English") inline
  components/         ← layouts, ticket, quotation card, items editor, modal, toast
  pages/public|customer|technician|admin/
  styles/             ← tokens.css (colors, type, spacing), components, layout, ticket
```

## Real API mode

Set in `frontend/.env`:

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:3000/api
```

Then start the backend (`cd backend && npm run dev`) and `npm run dev` here. The API Gateway's
`CORS_ALLOWED_ORIGINS` must include `http://localhost:5173`.

| Module | Real backend | Notes |
|---|---|---|
| auth | User Service `/api/users` | login, register, profile, technician list |
| catalog | Catalog Service `/api/catalog` | reading is public; changes need ADMIN |
| bookings | Booking Service `/api/bookings` | customer names for admins come from User Service |
| payments | Payment Service `/api/payments` | bridges to demo work orders |
| repairs, inventory | — demo data | Repair / Inventory services not built yet |
| dashboard | mixed | booking figures real, work orders / parts demo |

**Check-in needs Repair Service.** Until it implements `POST /work-orders` (see
`backend/booking-service/README.md`), "Check in" shows an error and the booking stays CONFIRMED.

Pages only call `api.<module>.<function>()` from `src/api/index.js`; each real module in
`src/api/http/` keeps the same function names and return shapes as the demo one in `src/api/mock/`.
