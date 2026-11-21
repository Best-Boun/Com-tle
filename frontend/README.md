# SmartFix Frontend

React + Vite web app for the SmartFix repair shop — customer, technician and admin screens, Thai / English.

> **Status:** works on **built-in demo data** by default. With `VITE_USE_MOCK=false`, repair workflow, parts stock, payments, notifications, auth, catalog and repair requests use the backend through the API Gateway (see *Real API mode*).

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
| Public | `/`, `/services`, `/team`, `/login`, `/register` | Home, price list, the team behind SmartFix, sign in / up |
| Customer | `/book` | Repair request ("แจ้งซ่อมล่วงหน้า"): device, kind of problem, details, contact phone; no time slot |
| | `/my/bookings`, `/my/bookings/:id` | My requests, status history, cancel while waiting for the device |
| | `/my/repairs`, `/my/repairs/:id` | Repair progress, choose one of the priced options (or "no repair"), pay online, warranty |
| | `/my/notifications` | Notifications (also the bell in the header) |
| | `/my/payments`, `/my/profile` | Balances and transactions, profile |
| Technician | `/tech` | My jobs, what needs me now, how many jobs wait in the queue |
| | `/tech/queue` | Received devices nobody has taken; take one (first come, first served) |
| | `/tech/jobs/:id` | Diagnose → send 1-5 priced options → waiting parts → repair → test; options for extra work |
| | `/tech/parts` | Stock lookup |
| Admin | `/admin` | Today: requests, jobs, overdue pick-ups, payments |
| | `/admin/bookings` | Repair requests at the counter: search by RQ number or phone, check in → opens the work order, cancel (reason required) |
| | `/admin/work-orders`, `/new`, `/:id` | Walk-ins, assign technician, record a walk-in customer's choice, issue parts, take payments / refunds, handover (exception with reason if unpaid), warranty claims, cancel with part returns |
| | `/admin/catalog` | Services and categories (hide instead of delete) |
| | `/admin/inventory` | Parts, receive stock, movement log |
| | `/admin/payments` | Balances per work order, all transactions, refunds |
| | `/admin/users`, `/admin/staff` | Customer accounts; technician accounts and their role |

## Business rules implemented (from the team review)

1. Walk-in is the main entry; a repair request ("แจ้งซ่อมล่วงหน้า") is optional, has no time slot, and closes itself after 30 days without a device
2. 1 request → 1 work order (check-in); walk-ins create work orders directly; technicians take received jobs from the queue
3. The technician sends 1-5 priced options; the system always adds "no repair" (inspection fee ฿300); the customer, or the shop for a walk-in, picks one
4. Extra problems during repair → options for *additional* work with "skip the extra work" (฿0); approved work continues
5. Parts are issued from Repair-Service inventory, only within the chosen option and available stock
6. Partial payments; balance is computed from transactions (UNPAID / PARTIAL / PAID / PARTIALLY_REFUNDED / REFUNDED); refunds need two admins
7. Ready devices are kept free for 7 days, then the dashboard asks the shop to call
8. Handover needs completed + tested (or declined) + paid, otherwise an admin exception with reason and outstanding amount is recorded
9. 90-day warranty from handover; the same fault coming back opens a free claim work order linked to the original
10. Cancelling keeps all history; issued parts can be returned to stock

## Structure

```
src/
  api/
    index.js          ← the only place pages import data access from
    session.js        ← signed-in user and tokens
    http/             ← real backend through the API Gateway (same functions as mock/)
    mock/             ← demo backend: db.js (seed data), index.js (rules)
  auth/               ← AuthProvider, RequireRole
  data/               ← team.js: the members shown on /team
  i18n/               ← TH/EN: dictionary for shared terms, L("ไทย","English") inline
  components/         ← layouts, ticket, quotation options, options editor, warranty, modal, toast
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
| bookings | Booking Service `/api/bookings` | repair requests; customer names for admins come from User Service |
| payments | Payment Service `/api/payments` | bills are derived from approved Repair-Service quotations; refunds retain the two-person approval flow |
| repairs | Repair Service `/api/repairs` | walk-ins, technician queue, assignment, diagnosis, quotation options, waiting parts, repair, testing, handover, warranty claims, cancellation and notifications use persistent work orders |
| inventory | Repair Service `/api/repairs/parts` | parts and stock movements persist in the Repair database; issue quantities are checked against approved quotations |
| dashboard | Booking, Repair, Payment and Repair parts APIs | requests, jobs, overdue pick-ups, low stock and payment summaries |

**Repair workflow needs the additive Repair-Service migration.** Copy its
`.env.example`, configure database/JWT values and `PAYMENT_SERVICE_URL`, then run
`npx knex migrate:latest --env development` from `backend/repair-service`.
Payment and handover also require Payment-Service to be running. Repair parts
use Repair-Service's database because Inventory Service has no implementation yet.

Pages only call `api.<module>.<function>()` from `src/api/index.js`; each real module in
`src/api/http/` keeps the same function names and return shapes as the demo one in `src/api/mock/`.
