/**
 * Audit trail for booking deposits (additive).
 *
 * payment_audit_logs and outbox_events require exactly one payment or refund
 * per row (chk_payment_audit_exactly_one_target and friends), and a deposit
 * is neither, so deposits keep their own trail here instead of loosening
 * those constraints.
 */
exports.up = async function up(knex) {
    await knex.schema.createTable("deposit_audit_logs", (table) => {
        table.engine("InnoDB");
        table.specificType("audit_id", "char(36)").notNullable().primary();
        table.specificType("deposit_id", "char(36)").notNullable().index("idx_deposit_audit_deposit");
        table.specificType("actor_user_id", "char(36)").nullable();
        table.string("action", 150).notNullable();
        table.json("metadata").nullable();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
        table.foreign("deposit_id", "fk_deposit_audit_deposit")
            .references("deposit_id").inTable("deposits")
            .onDelete("RESTRICT").onUpdate("RESTRICT");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("deposit_audit_logs");
};
