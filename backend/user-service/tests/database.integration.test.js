const assert = require("node:assert/strict");
const test = require("node:test");
const mysql = require("mysql2/promise");
const {
    applyFreshBaseline,
    expectedTables,
    getFreshBaselineTarget
} = require("../scripts/apply-fresh-baseline");

const enabled = process.env.USER_SERVICE_ALLOW_FRESH_BASELINE === "1";
const target = enabled ? getFreshBaselineTarget(process.env) : null;

const expectedColumns = {
    users: [
        "user_id", "email", "password_hash", "phone", "status", "created_at", "updated_at"
    ],
    customers: [
        "customer_id", "user_id", "full_name", "phone", "email", "customer_type",
        "merged_into_customer_id", "created_at", "updated_at"
    ],
    roles: ["role_id", "role_code", "role_name", "description", "created_at"],
    user_roles: ["user_id", "role_id", "assigned_by", "assigned_at"],
    permissions: [
        "permission_id", "permission_code", "permission_name", "description", "created_at"
    ],
    role_permissions: ["role_id", "permission_id", "assigned_at"],
    refresh_token_sessions: [
        "session_id", "user_id", "token_hash", "token_family_id", "expires_at",
        "revoked_at", "replaced_by_token_id", "created_at", "last_used_at"
    ],
    user_audit_logs: [
        "audit_id", "actor_user_id", "action", "resource_type", "resource_id",
        "reason", "metadata", "created_at"
    ],
    customer_merge_history: [
        "merge_history_id", "source_customer_id", "target_customer_id", "target_user_id",
        "verified_by_user_id", "verification_reference", "merge_reason", "merged_at"
    ],
    internal_token_replays: [
        "internal_token_replay_id", "issuer", "jti", "client_id", "expires_at", "created_at"
    ]
};

const expectedIndexes = {
    customers: {
        PRIMARY: ["customer_id"],
        uq_customers_user_id: ["user_id"],
        idx_customers_phone: ["phone"],
        idx_customers_email: ["email"],
        idx_customers_merged_into: ["merged_into_customer_id"]
    },
    customer_merge_history: {
        PRIMARY: ["merge_history_id"],
        fk_merge_target_user: ["target_user_id"],
        idx_merge_source_customer: ["source_customer_id", "merged_at"],
        idx_merge_target_customer: ["target_customer_id", "merged_at"],
        idx_merge_verified_by: ["verified_by_user_id", "merged_at"]
    },
    users: {
        PRIMARY: ["user_id"],
        uq_users_email: ["email"],
        idx_users_status: ["status"],
        idx_users_created_at: ["created_at"]
    },
    roles: {
        PRIMARY: ["role_id"],
        uq_roles_role_code: ["role_code"],
        uq_roles_role_name: ["role_name"]
    },
    user_roles: {
        PRIMARY: ["user_id", "role_id"],
        idx_user_roles_role_id: ["role_id"],
        idx_user_roles_assigned_by: ["assigned_by"]
    },
    permissions: {
        PRIMARY: ["permission_id"],
        uq_permissions_code: ["permission_code"],
        uq_permissions_name: ["permission_name"]
    },
    role_permissions: {
        PRIMARY: ["role_id", "permission_id"],
        idx_role_permissions_permission_id: ["permission_id"]
    },
    refresh_token_sessions: {
        PRIMARY: ["session_id"],
        uq_refresh_token_hash: ["token_hash"],
        idx_refresh_user: ["user_id", "created_at"],
        idx_refresh_family: ["token_family_id", "revoked_at"],
        idx_refresh_expiry: ["expires_at"],
        idx_refresh_replaced_by: ["replaced_by_token_id"]
    },
    user_audit_logs: {
        PRIMARY: ["audit_id"],
        idx_user_audit_actor_created: ["actor_user_id", "created_at"],
        idx_user_audit_resource_created: ["resource_type", "resource_id", "created_at"],
        idx_user_audit_created: ["created_at"]
    },
    internal_token_replays: {
        PRIMARY: ["internal_token_replay_id"],
        internal_token_replays_issuer_jti_unique: ["issuer", "jti"],
        internal_token_replays_expires_at_index: ["expires_at"]
    }
};

function assertForeignKeyRules(foreignKeys) {
    for (const foreignKey of foreignKeys) {
        const nullableReference = (foreignKey.TABLE_NAME === "user_roles"
            && foreignKey.COLUMN_NAME === "assigned_by")
            || (foreignKey.TABLE_NAME === "user_audit_logs"
                && foreignKey.COLUMN_NAME === "actor_user_id");
        assert.equal(foreignKey.DELETE_RULE, nullableReference ? "SET NULL" : "RESTRICT");
        assert.equal(foreignKey.UPDATE_RULE, "RESTRICT");
    }
}

test("foreign key rules distinguish nullable audit and role actors", () => {
    const foreignKeys = [
        {
            TABLE_NAME: "user_audit_logs",
            COLUMN_NAME: "actor_user_id",
            DELETE_RULE: "SET NULL",
            UPDATE_RULE: "RESTRICT"
        },
        {
            TABLE_NAME: "user_roles",
            COLUMN_NAME: "assigned_by",
            DELETE_RULE: "SET NULL",
            UPDATE_RULE: "RESTRICT"
        },
        {
            TABLE_NAME: "user_roles",
            COLUMN_NAME: "user_id",
            DELETE_RULE: "RESTRICT",
            UPDATE_RULE: "RESTRICT"
        }
    ];

    assertForeignKeyRules(foreignKeys);
    for (const foreignKey of foreignKeys) {
        const wrongRule = foreignKey.DELETE_RULE === "SET NULL" ? "RESTRICT" : "SET NULL";
        assert.throws(() => assertForeignKeyRules([{ ...foreignKey, DELETE_RULE: wrongRule }]));
        assert.throws(() => assertForeignKeyRules([{ ...foreignKey, UPDATE_RULE: "CASCADE" }]));
    }
});

test("fresh baseline initializes and verifies an empty isolated MySQL schema", {
    skip: enabled
        ? false
        : "Set USER_SERVICE_ALLOW_FRESH_BASELINE=1 with dedicated isolated DB_BASELINE_TEST_* settings"
}, async () => {
    const appliedTables = await applyFreshBaseline();
    assert.deepEqual(appliedTables, expectedTables);

    const connection = await mysql.createConnection({
        host: target.host,
        port: target.port,
        user: target.user,
        password: target.password,
        database: target.database,
        multipleStatements: false
    });

    try {
        const [tables] = await connection.execute(
            "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            [target.database]
        );
        assert.deepEqual(
            tables.map((row) => row.TABLE_NAME).sort(),
            expectedTables.slice().sort()
        );
        for (const table of tables) {
            assert.equal(table.ENGINE, "InnoDB");
            assert.match(table.TABLE_COLLATION, /^utf8mb4_/);
        }

        const [columns] = await connection.execute(
            "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION",
            [target.database]
        );
        const columnsByTable = new Map();
        for (const column of columns) {
            if (!columnsByTable.has(column.TABLE_NAME)) {
                columnsByTable.set(column.TABLE_NAME, new Set());
            }
            columnsByTable.get(column.TABLE_NAME).add(column.COLUMN_NAME);
        }
        assert.deepEqual(
            [...columnsByTable.keys()].sort(),
            Object.keys(expectedColumns).sort()
        );
        for (const [tableName, expected] of Object.entries(expectedColumns)) {
            assert.deepEqual(
                [...columnsByTable.get(tableName)],
                expected,
                `Unexpected columns for ${tableName}`
            );
        }
        assert.ok(columnsByTable.get("user_audit_logs").has("resource_type"));
        assert.equal(columnsByTable.has("audit_logs"), false);
        assert.ok(columnsByTable.get("role_permissions").has("assigned_at"));
        assert.equal(columnsByTable.get("role_permissions").has("assigned_by"), false);
        assert.ok(columnsByTable.get("refresh_token_sessions").has("session_id"));
        assert.ok(columnsByTable.get("refresh_token_sessions").has("token_family_id"));
        assert.equal(columnsByTable.get("refresh_token_sessions").has("token_id"), false);

        const [indexRows] = await connection.execute(
            "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
            [target.database]
        );
        const indexesByTable = new Map();
        for (const index of indexRows) {
            if (!indexesByTable.has(index.TABLE_NAME)) {
                indexesByTable.set(index.TABLE_NAME, new Map());
            }
            const tableIndexes = indexesByTable.get(index.TABLE_NAME);
            if (!tableIndexes.has(index.INDEX_NAME)) {
                tableIndexes.set(index.INDEX_NAME, []);
            }
            tableIndexes.get(index.INDEX_NAME).push(index);
        }
        assert.deepEqual(
            [...indexesByTable.keys()].sort(),
            Object.keys(expectedIndexes).sort()
        );
        for (const [tableName, indexDefinitions] of Object.entries(expectedIndexes)) {
            assert.deepEqual(
                Object.fromEntries([...indexesByTable.get(tableName)].map(([name, rows]) => [
                    name,
                    rows.map((row) => row.COLUMN_NAME)
                ])),
                indexDefinitions,
                `Unexpected indexes for ${tableName}`
            );
        }
        const replayUnique = indexRows.filter((index) =>
            index.TABLE_NAME === "internal_token_replays"
            && index.INDEX_NAME === "internal_token_replays_issuer_jti_unique"
        );
        assert.deepEqual(
            replayUnique.map((index) => index.COLUMN_NAME),
            ["issuer", "jti"]
        );
        assert.ok(replayUnique.every((index) => index.NON_UNIQUE === 0));
        assert.ok(indexRows.some((index) =>
            index.TABLE_NAME === "internal_token_replays"
            && index.INDEX_NAME === "internal_token_replays_expires_at_index"
            && index.COLUMN_NAME === "expires_at"
        ));

        const [constraints] = await connection.execute(
            "SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?",
            [target.database]
        );
        const names = new Set(constraints.map((row) => row.CONSTRAINT_NAME));
        for (const constraintName of [
            "chk_customers_not_merged_into_self",
            "chk_customers_type_consistency",
            "chk_refresh_token_expiry",
            "chk_refresh_token_not_self_replaced",
            "chk_merge_source_not_target"
        ]) {
            assert.ok(names.has(constraintName), `Missing constraint: ${constraintName}`);
        }

        const [foreignKeys] = await connection.execute(
            "SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE AS k INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME WHERE k.CONSTRAINT_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME",
            [target.database]
        );
        assert.equal(foreignKeys.length, 14);
        assertForeignKeyRules(foreignKeys);
    } finally {
        await connection.end();
    }
});
