function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_unicode_ci");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("work_order_payment_accounts", (table) => {
        configureTable(table);

        table.string("work_order_id", 36).notNullable().primary();
        table.string("customer_id", 36).notNullable();
        table.decimal("amount_due", 12, 2).notNullable();
        table.string("currency", 3).notNullable();
        table.dateTime("created_at", { precision: 3 }).notNullable();
        table.dateTime("updated_at", { precision: 3 }).notNullable();

        table.index("customer_id", "payment_accounts_customer_id_index");
        table.check("amount_due > 0", [], "payment_accounts_amount_due_positive");
        table.check(
            "CHAR_LENGTH(currency) = 3 AND BINARY currency = BINARY UPPER(currency)",
            [],
            "payment_accounts_currency_format"
        );
    });

    await knex.schema.createTable("payments", (table) => {
        configureTable(table);

        table.string("payment_id", 36).notNullable().primary();
        table.string("work_order_id", 36).notNullable();
        table.decimal("amount", 12, 2).notNullable();
        table.string("currency", 3).notNullable();
        table.enu("status", ["PENDING", "COMPLETED", "FAILED", "CANCELLED"])
            .notNullable();
        table.dateTime("created_at", { precision: 3 }).notNullable();
        table.dateTime("updated_at", { precision: 3 }).notNullable();

        table.index(["work_order_id", "status"], "payments_work_order_status_index");
        table.index("created_at", "payments_created_at_index");
        table.check("amount > 0", [], "payments_amount_positive");
        table.check(
            "CHAR_LENGTH(currency) = 3 AND BINARY currency = BINARY UPPER(currency)",
            [],
            "payments_currency_format"
        );
        table.foreign("work_order_id", "payments_work_order_id_foreign")
            .references("work_order_id")
            .inTable("work_order_payment_accounts")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
    });

    await knex.schema.createTable("refunds", (table) => {
        configureTable(table);

        table.string("refund_id", 36).notNullable().primary();
        table.string("payment_id", 36).notNullable();
        table.decimal("amount", 12, 2).notNullable();
        table.string("currency", 3).notNullable();
        table.enu(
            "status",
            ["REQUESTED", "APPROVED", "REJECTED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]
        ).notNullable();
        table.string("initiated_by", 36).notNullable();
        table.string("reviewer_user_id", 36).nullable();
        table.enu("review_decision", ["APPROVED", "REJECTED"]).nullable();
        table.dateTime("reviewed_at", { precision: 3 }).nullable();
        table.dateTime("created_at", { precision: 3 }).notNullable();
        table.dateTime("updated_at", { precision: 3 }).notNullable();

        table.index(["payment_id", "status"], "refunds_payment_status_index");
        table.index("initiated_by", "refunds_initiated_by_index");
        table.index("reviewer_user_id", "refunds_reviewer_user_id_index");
        table.index("created_at", "refunds_created_at_index");
        table.check("amount > 0", [], "refunds_amount_positive");
        table.check(
            "CHAR_LENGTH(currency) = 3 AND BINARY currency = BINARY UPPER(currency)",
            [],
            "refunds_currency_format"
        );
        table.check(
            "(reviewer_user_id IS NULL AND review_decision IS NULL AND reviewed_at IS NULL) OR (reviewer_user_id IS NOT NULL AND review_decision IS NOT NULL AND reviewed_at IS NOT NULL)",
            [],
            "refunds_review_fields_consistent"
        );
        table.check(
            "reviewer_user_id IS NULL OR reviewer_user_id <> initiated_by",
            [],
            "refunds_two_person_review"
        );
        table.foreign("payment_id", "refunds_payment_id_foreign")
            .references("payment_id")
            .inTable("payments")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("refunds");
    await knex.schema.dropTableIfExists("payments");
    await knex.schema.dropTableIfExists("work_order_payment_accounts");
};
