# SmartFix Backend

This directory contains the API Gateway and all SmartFix services.

## Prerequisites

- Docker Desktop with Docker Compose
- Node.js 22+ for local development outside Docker
- npm

## Start the complete system with Docker Compose

Run from the repository root:

```powershell
docker compose -f backend/docker-compose.yml up --build
```

Open:

- Frontend: http://localhost:5173
- API Gateway: http://localhost:3000
- MySQL: localhost:3306

The Compose setup creates separate MySQL databases for all services and generates development RSA key pairs before the User, Payment and Gateway services start.

Stop the stack:

```powershell
docker compose -f backend/docker-compose.yml down
```

Remove local database data too:

```powershell
docker compose -f backend/docker-compose.yml down -v
```

> Development keys are generated locally and are not production secrets. Never use this setup or generated keys in production.

## Run locally without Docker

1. Copy each service `.env.example` to `.env` and set the database settings.
2. Install dependencies:

```powershell
cd backend
npm run install:all
```

3. Generate every key the services need (keys are not in git):

```powershell
node generate-keys.js
```

   This writes the User-Service token key pair and copies its public key to the gateway, booking, catalog, repair and payment services, and writes the Payment-Service internal key pair (its public key goes to `user-service/keys/internal/payment-key-1.pem`).

4. Start services:

```powershell
npm run dev
```

Start selected services:

```powershell
node dev.js booking repair payment
```

The API Gateway always starts. Service ports:

| Service | Port |
|---|---:|
| API Gateway | 3000 |
| User | 3001 |
| Booking | 3002 |
| Catalog | 3003 |
| Repair | 3004 |
| Inventory | 3005 |
| Payment | 3006 |

## Important implementation decisions

- Repair Service owns repair-part inventory and stock movements. Inventory Service remains health-only; see [inventory-service/README.md](./inventory-service/README.md).
- The booking deposit was removed, but its migrations (`booking-service/migrations/20261118000001_booking_deposit_hold.js`, `payment-service/migrations/20261118000001_create_deposits.js`, `payment-service/migrations/20261118000002_create_deposit_audit_logs.js`) stay: they already ran on the shared database, and knex refuses to migrate when an applied file is missing. Their tables and columns are unused. `20261119000101_repair_requests.js` turned any leftover `AWAITING_DEPOSIT` booking into `CANCELLED`; to drop the deposit tables, add a new migration instead of deleting these files.
- Booking Service now holds repair requests ("แจ้งซ่อมล่วงหน้า", no time slots); Repair Service owns the technician queue, warranty and customer notifications. See the root [README](../README.md) for the full flow.
- Repair intake and handover acknowledgement timestamps are stored in `work_orders`.