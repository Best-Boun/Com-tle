// MySQL DDL commits implicitly; this migration requires the canonical fresh baseline.
exports.config = { transaction: false };

exports.up = async function up(knex) {
    await knex.raw(`
        ALTER TABLE \`customers\`
        ADD COLUMN \`row_version\` BIGINT UNSIGNED NOT NULL DEFAULT 0
    `);

    await knex.raw(`
        CREATE TRIGGER \`trg_customers_merge_before_update\`
        BEFORE UPDATE ON \`customers\` FOR EACH ROW
        BEGIN
            IF OLD.\`customer_type\` = 'MERGED' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Merged customers cannot be updated';
            END IF;
            IF OLD.\`row_version\` = 18446744073709551615 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Customer row version overflow';
            END IF;
            SET NEW.\`row_version\` = OLD.\`row_version\` + 1;
        END
    `);

    await knex.raw(`
        CREATE TRIGGER \`trg_customers_merge_before_delete\`
        BEFORE DELETE ON \`customers\` FOR EACH ROW
        BEGIN
            IF OLD.\`customer_type\` = 'MERGED' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Merged customers cannot be deleted';
            END IF;
        END
    `);

    await knex.raw(`
        CREATE TABLE \`customer_merge_requests\` (
            \`request_id\` char(36) NOT NULL,
            \`source_customer_id\` char(36) NOT NULL,
            \`target_customer_id\` char(36) NOT NULL,
            \`source_user_id_snapshot\` char(36) NOT NULL,
            \`target_user_id_snapshot\` char(36) NOT NULL,
            \`source_version\` bigint unsigned NOT NULL,
            \`target_version\` bigint unsigned NOT NULL,
            \`initiated_by_user_id\` char(36) NOT NULL,
            \`idempotency_key\` varbinary(128) NOT NULL,
            \`request_digest\` binary(32) NOT NULL,
            \`digest_version\` smallint unsigned NOT NULL,
            \`merge_reason\` varchar(500) DEFAULT NULL,
            \`status\` enum('PENDING','COMPLETED','REJECTED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
            \`decided_by_user_id\` char(36) DEFAULT NULL,
            \`decision_reason\` varchar(500) DEFAULT NULL,
            \`verification_reference\` varchar(500) DEFAULT NULL,
            \`history_id\` char(36) DEFAULT NULL,
            \`initiated_audit_id\` char(36) NOT NULL,
            \`decision_audit_id\` char(36) DEFAULT NULL,
            \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`expires_at\` datetime(3) GENERATED ALWAYS AS (\`created_at\` + INTERVAL 24 HOUR) STORED,
            \`decided_at\` datetime(3) DEFAULT NULL,
            PRIMARY KEY (\`request_id\`),
            UNIQUE KEY \`uq_merge_requests_initiator_key\` (\`initiated_by_user_id\`, \`idempotency_key\`),
            UNIQUE KEY \`uq_merge_requests_history\` (\`history_id\`),
            UNIQUE KEY \`uq_merge_requests_initiated_audit\` (\`initiated_audit_id\`),
            UNIQUE KEY \`uq_merge_requests_decision_audit\` (\`decision_audit_id\`),
            KEY \`idx_merge_requests_expiry\` (\`status\`, \`expires_at\`),
            CONSTRAINT \`fk_merge_requests_source\` FOREIGN KEY (\`source_customer_id\`) REFERENCES \`customers\` (\`customer_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_target\` FOREIGN KEY (\`target_customer_id\`) REFERENCES \`customers\` (\`customer_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_source_user\` FOREIGN KEY (\`source_user_id_snapshot\`) REFERENCES \`users\` (\`user_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_target_user\` FOREIGN KEY (\`target_user_id_snapshot\`) REFERENCES \`users\` (\`user_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_initiator\` FOREIGN KEY (\`initiated_by_user_id\`) REFERENCES \`users\` (\`user_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_decider\` FOREIGN KEY (\`decided_by_user_id\`) REFERENCES \`users\` (\`user_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_history\` FOREIGN KEY (\`history_id\`) REFERENCES \`customer_merge_history\` (\`merge_history_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_initiated_audit\` FOREIGN KEY (\`initiated_audit_id\`) REFERENCES \`user_audit_logs\` (\`audit_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_requests_decision_audit\` FOREIGN KEY (\`decision_audit_id\`) REFERENCES \`user_audit_logs\` (\`audit_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`chk_merge_requests_participants\` CHECK (\`source_customer_id\` <> \`target_customer_id\`),
            CONSTRAINT \`chk_merge_requests_key\` CHECK (OCTET_LENGTH(\`idempotency_key\`) > 0),
            CONSTRAINT \`chk_merge_requests_distinct_audits\` CHECK (\`decision_audit_id\` IS NULL OR \`decision_audit_id\` <> \`initiated_audit_id\`),
            CONSTRAINT \`chk_merge_requests_lifecycle\` CHECK (
                (\`status\` = 'PENDING'
                    AND \`decided_by_user_id\` IS NULL AND \`decision_reason\` IS NULL AND \`verification_reference\` IS NULL
                    AND \`history_id\` IS NULL AND \`decision_audit_id\` IS NULL AND \`decided_at\` IS NULL)
                OR (\`status\` = 'COMPLETED'
                    AND \`decided_by_user_id\` IS NOT NULL AND \`decided_by_user_id\` <> \`initiated_by_user_id\`
                    AND \`decision_reason\` IS NULL AND \`verification_reference\` IS NOT NULL AND \`verification_reference\` REGEXP '[^[:space:]]'
                    AND \`history_id\` IS NOT NULL AND \`decision_audit_id\` IS NOT NULL
                    AND \`decided_at\` IS NOT NULL AND \`decided_at\` < \`expires_at\`)
                OR (\`status\` = 'REJECTED'
                    AND \`decided_by_user_id\` IS NOT NULL AND \`decided_by_user_id\` <> \`initiated_by_user_id\`
                    AND \`verification_reference\` IS NULL AND \`history_id\` IS NULL
                    AND \`decision_audit_id\` IS NOT NULL AND \`decided_at\` IS NOT NULL)
                OR (\`status\` = 'CANCELLED'
                    AND \`decided_by_user_id\` IS NOT NULL AND \`decided_by_user_id\` = \`initiated_by_user_id\`
                    AND \`verification_reference\` IS NULL AND \`history_id\` IS NULL
                    AND \`decision_audit_id\` IS NOT NULL AND \`decided_at\` IS NOT NULL)
                OR (\`status\` = 'EXPIRED'
                    AND \`decided_by_user_id\` IS NULL AND \`decision_reason\` IS NULL AND \`verification_reference\` IS NULL AND \`history_id\` IS NULL
                    AND \`decision_audit_id\` IS NOT NULL AND \`decided_at\` IS NOT NULL AND \`decided_at\` >= \`expires_at\`)
            )
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await knex.raw(`
        CREATE TABLE \`customer_merge_reservations\` (
            \`customer_id\` char(36) NOT NULL,
            \`request_id\` char(36) NOT NULL,
            \`participant\` enum('SOURCE','TARGET') NOT NULL,
            PRIMARY KEY (\`customer_id\`),
            UNIQUE KEY \`uq_merge_reservations_participant\` (\`request_id\`, \`participant\`),
            CONSTRAINT \`fk_merge_reservations_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`customer_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT \`fk_merge_reservations_request\` FOREIGN KEY (\`request_id\`) REFERENCES \`customer_merge_requests\` (\`request_id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await knex.raw(`
        CREATE TRIGGER \`trg_merge_requests_before_insert\`
        BEFORE INSERT ON \`customer_merge_requests\` FOR EACH ROW
        BEGIN
            IF NEW.\`status\` <> 'PENDING' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Merge requests must start pending';
            END IF;
            SET NEW.\`created_at\` = UTC_TIMESTAMP(3);
        END
    `);

    await knex.raw(`
        CREATE TRIGGER \`trg_merge_requests_before_update\`
        BEFORE UPDATE ON \`customer_merge_requests\` FOR EACH ROW
        BEGIN
            IF OLD.\`status\` <> 'PENDING' OR NEW.\`status\` NOT IN ('COMPLETED','REJECTED','CANCELLED','EXPIRED') THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid merge request transition';
            END IF;
            IF NOT (BINARY NEW.\`request_id\` <=> BINARY OLD.\`request_id\`)
                OR NOT (BINARY NEW.\`source_customer_id\` <=> BINARY OLD.\`source_customer_id\`)
                OR NOT (BINARY NEW.\`target_customer_id\` <=> BINARY OLD.\`target_customer_id\`)
                OR NOT (BINARY NEW.\`source_user_id_snapshot\` <=> BINARY OLD.\`source_user_id_snapshot\`)
                OR NOT (BINARY NEW.\`target_user_id_snapshot\` <=> BINARY OLD.\`target_user_id_snapshot\`)
                OR NOT (NEW.\`source_version\` <=> OLD.\`source_version\`)
                OR NOT (NEW.\`target_version\` <=> OLD.\`target_version\`)
                OR NOT (BINARY NEW.\`initiated_by_user_id\` <=> BINARY OLD.\`initiated_by_user_id\`)
                OR NOT (NEW.\`idempotency_key\` <=> OLD.\`idempotency_key\`)
                OR NOT (NEW.\`request_digest\` <=> OLD.\`request_digest\`)
                OR NOT (NEW.\`digest_version\` <=> OLD.\`digest_version\`)
                OR NOT (BINARY NEW.\`merge_reason\` <=> BINARY OLD.\`merge_reason\`)
                OR NOT (BINARY NEW.\`initiated_audit_id\` <=> BINARY OLD.\`initiated_audit_id\`)
                OR NOT (NEW.\`created_at\` <=> OLD.\`created_at\`) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Merge request fields are immutable';
            END IF;
            SET NEW.\`decided_at\` = UTC_TIMESTAMP(3);
        END
    `);

    await knex.raw(`
        CREATE TRIGGER \`trg_merge_requests_before_delete\`
        BEFORE DELETE ON \`customer_merge_requests\` FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Merge requests cannot be deleted';
        END
    `);
};

exports.down = async function down() {
    throw new Error("Customer merge rollback is unsafe: retained requests and guards must not be dropped");
};
