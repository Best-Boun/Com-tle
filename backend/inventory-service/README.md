# Inventory Service - Ownership Decision

The team decision is: **do not migrate stock management out of Repair Service**.

Repair Service already owns `repair_parts_inventory`, `repair_stock_movements`,
approved quotation allowances, stock receive/issue/return operations, and
work-order stock presentation.

Moving stock now would require a new cross-service API and data migration while
the Inventory Service is only a `/health` service. Keeping the source of truth
in Repair Service avoids duplicate stock state.

Inventory Service remains a health-only service until a dedicated inventory
domain is implemented.
