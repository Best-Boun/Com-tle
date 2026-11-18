/**
 * Task 13: customer notifications, in the website and by email (additive).
 *
 * - customer_notifications: one row per message to a registered customer
 *   (walk-in customers have no account; the shop calls them instead).
 *   email_status records what happened to the email copy.
 * - work_orders.customer_email: the customer's email at check-in, so an email
 *   can be sent later by whoever moves the job on (a technician cannot read
 *   other users' accounts).
 */
exports.up = async function up(knex) {
    if (!await knex.schema.hasTable("customer_notifications")) {
        await knex.schema.createTable("customer_notifications", (table) => {
            table.specificType("notification_id", "char(36)").notNullable().primary();
            table.specificType("customer_id", "char(36)").notNullable();
            table.specificType("work_order_id", "char(36)").nullable().index();
            table.string("type", 40).notNullable();
            table.string("title", 200).notNullable();
            table.text("message").notNullable();
            table.enu("email_status", ["PENDING", "SENT", "FAILED", "NO_EMAIL", "NOT_CONFIGURED"])
                .notNullable()
                .defaultTo("PENDING");
            table.datetime("read_at", { precision: 3 }).nullable();
            table.datetime("created_at", { precision: 3 }).notNullable()
                .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
            table.index(["customer_id", "created_at"]);
        });
    }
    if (!await knex.schema.hasColumn("work_orders", "customer_email")) {
        await knex.schema.alterTable("work_orders", (table) => {
            table.string("customer_email", 254).nullable();
        });
    }
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("customer_notifications");
    if (await knex.schema.hasColumn("work_orders", "customer_email")) {
        await knex.schema.alterTable("work_orders", (table) => {
            table.dropColumn("customer_email");
        });
    }
};
