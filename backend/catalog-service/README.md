# Catalog Service (port 3003)

Owns service categories, services, descriptions and starting prices (team schema: `service_categories`, `services`, `catalog_audit_logs`). Categories and services are deactivated, never deleted. Every create/update/activate/deactivate writes an audit log with old and new values. The final price comes from Repair's quotation.

## Setup

```bash
cp .env.example .env      # fill DB_* values
npm install
npm run migrate
npm run seed              # optional: 3 categories + 4 sample services
npm start
npm test
```

## Prices

`starting_price` is a **whole number of baht** with `currency` (default `THB`): `500` = 500 THB.

## Endpoints

Gateway prefix: `/api/catalog`. All need `Authorization: Bearer <token>`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/categories` | catalog.view / manage | admin may add `?include_inactive=true` |
| POST | `/categories` | catalog.manage | `{ category_code, category_name, description? }` |
| PATCH | `/categories/:categoryId` | catalog.manage | `category_name`, `description` (code cannot change) |
| PATCH | `/categories/:categoryId/status` | catalog.manage | `{ "is_active": false }` hides all its services |
| GET | `/services` | catalog.view / manage | `?category_id=&category_code=&search=&page=&limit=`; admin may add `include_inactive=true` |
| GET | `/services/:serviceId` | catalog.view / manage | inactive service/category → 404 for non-admins |
| POST | `/services` | catalog.manage | `{ category_id, service_code, service_name, starting_price, estimated_duration_minutes, description?, currency? }` |
| PATCH | `/services/:serviceId` | catalog.manage | any of category_id, service_name, description, starting_price, currency, estimated_duration_minutes |
| PATCH | `/services/:serviceId/status` | catalog.manage | `{ "is_active": false }` |
| GET | `/audit-logs` | catalog.manage | `?resource_type=SERVICE|CATEGORY&resource_id=` |

Service responses include `category_code`, `category_name` and `category_is_active`.
