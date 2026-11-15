const WORK_ORDER_STATUSES = [
    "RECEIVED",
    "DIAGNOSING",
    "WAITING_APPROVAL",
    "APPROVED",
    "WAITING_PARTS",
    "IN_REPAIR",
    "TESTING",
    "RETURN_PENDING",
    "HANDED_OVER",
    "ABANDONED"
];

async function createBaseTables(knex) {
    const now3 = knex.raw("CURRENT_TIMESTAMP(3)");

    if (!await knex.schema.hasTable("work_orders")) {
        await knex.schema.createTable("work_orders", (table) => {
            table.specificType("work_order_id", "char(36)").notNullable().primary();
            table.specificType("booking_id", "char(36)").nullable().index();
            table.specificType("customer_id", "char(36)").notNullable().index();
            table.specificType("parent_work_order_id", "char(36)").nullable().index()
                .references("work_order_id").inTable("work_orders").onDelete("RESTRICT");
            table.enu("status", WORK_ORDER_STATUSES).notNullable().defaultTo("RECEIVED").index();
            table.enu("close_reason", ["REPAIRED", "REJECTED", "CANCELLED", "UNREPAIRABLE"]).nullable();
            table.datetime("received_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.datetime("updated_at", { precision: 3 }).notNullable().defaultTo(now3);
        });
    }

    if (!await knex.schema.hasTable("work_order_devices")) {
        await knex.schema.createTable("work_order_devices", (table) => {
            table.specificType("device_id", "char(36)").notNullable().primary();
            table.specificType("work_order_id", "char(36)").notNullable().unique()
                .references("work_order_id").inTable("work_orders").onDelete("RESTRICT");
            table.string("device_type", 100).notNullable();
            table.string("brand", 100).nullable();
            table.string("model", 150).nullable();
            table.string("serial_number", 150).nullable();
            table.text("device_condition").nullable();
            table.json("accessories_received").nullable();
            table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
        });
    }

    if (!await knex.schema.hasTable("work_order_status_history")) {
        await knex.schema.createTable("work_order_status_history", (table) => {
            table.specificType("history_id", "char(36)").notNullable().primary();
            table.specificType("work_order_id", "char(36)").notNullable()
                .references("work_order_id").inTable("work_orders").onDelete("RESTRICT");
            table.enu("old_status", WORK_ORDER_STATUSES).nullable();
            table.enu("new_status", WORK_ORDER_STATUSES).notNullable();
            table.specificType("changed_by_user_id", "char(36)").nullable().index();
            table.string("reason", 1000).nullable();
            table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.index(["work_order_id", "created_at"]);
        });
    }

    if (!await knex.schema.hasTable("work_order_assignments")) {
        await knex.schema.createTable("work_order_assignments", (table) => {
            table.specificType("assignment_id", "char(36)").notNullable().primary();
            table.specificType("work_order_id", "char(36)").notNullable()
                .references("work_order_id").inTable("work_orders").onDelete("RESTRICT");
            table.specificType("technician_user_id", "char(36)").notNullable().index();
            table.datetime("assigned_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.datetime("unassigned_at", { precision: 3 }).nullable();
            table.index(["work_order_id", "unassigned_at"]);
        });
    }
}

async function addTrackingColumns(knex) {
    const columns = [
        ["work_order_number", (table) => table.string("work_order_number", 40).nullable()],
        ["source", (table) => table.string("source", 20).nullable()],
        ["booking_number", (table) => table.string("booking_number", 30).nullable().index()],
        ["customer_name", (table) => table.string("customer_name", 150).nullable()],
        ["customer_phone", (table) => table.string("customer_phone", 40).nullable()],
        ["service_id", (table) => table.specificType("service_id", "char(36)").nullable().index()],
        ["service_code", (table) => table.string("service_code", 50).nullable()],
        ["service_name", (table) => table.string("service_name", 150).nullable()]
    ];
    const missing = [];

    for (const [name, addColumn] of columns) {
        if (!await knex.schema.hasColumn("work_orders", name)) {
            missing.push(addColumn);
        }
    }

    if (missing.length > 0) {
        await knex.schema.alterTable("work_orders", (table) => {
            for (const addColumn of missing) {
                addColumn(table);
            }
        });
    }

    const [indexes] = await knex.raw("SHOW INDEX FROM work_orders");
    const hasNumberIndex = indexes.some((index) => index.Key_name === "uq_work_orders_number");
    if (!hasNumberIndex) {
        await knex.schema.alterTable("work_orders", (table) => {
            table.unique(["work_order_number"], "uq_work_orders_number");
        });
    }
}

async function createBookingIdempotencyTable(knex) {
    if (!await knex.schema.hasTable("repair_booking_work_order_keys")) {
        await knex.schema.createTable("repair_booking_work_order_keys", (table) => {
            table.specificType("booking_id", "char(36)").notNullable().primary();
            table.specificType("work_order_id", "char(36)").notNullable().unique()
                .references("work_order_id").inTable("work_orders").onDelete("RESTRICT");
            table.datetime("created_at", { precision: 3 })
                .notNullable()
                .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
        });
    }

    const existing = await knex("work_orders")
        .select("booking_id", "work_order_id")
        .whereNotNull("booking_id")
        .orderBy("created_at", "asc");
    const mapped = new Set(await knex("repair_booking_work_order_keys").pluck("booking_id"));
    for (const row of existing) {
        if (!mapped.has(row.booking_id)) {
            await knex("repair_booking_work_order_keys").insert({
                booking_id: row.booking_id,
                work_order_id: row.work_order_id
            });
            mapped.add(row.booking_id);
        }
    }
}

exports.up = async function up(knex) {
    await createBaseTables(knex);
    await addTrackingColumns(knex);
    await createBookingIdempotencyTable(knex);
};

exports.down = async function down() {
    throw new Error(
        "This migration is additive to the existing Repair schema and is intentionally not reversible."
    );
};
