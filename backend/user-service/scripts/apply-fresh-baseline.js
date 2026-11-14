const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const expectedTables = [
    "users",
    "roles",
    "customers",
    "user_roles",
    "permissions",
    "role_permissions",
    "refresh_token_sessions",
    "user_audit_logs",
    "customer_merge_history",
    "internal_token_replays"
];

function getFreshBaselineTarget(env = process.env) {
    if (env.USER_SERVICE_ALLOW_FRESH_BASELINE !== "1") {
        throw new Error("Set USER_SERVICE_ALLOW_FRESH_BASELINE=1 to opt in");
    }

    const variables = [
        "DB_BASELINE_TEST_HOST",
        "DB_BASELINE_TEST_PORT",
        "DB_BASELINE_TEST_USER",
        "DB_BASELINE_TEST_PASSWORD",
        "DB_BASELINE_TEST_NAME"
    ];
    if (variables.some((name) => !env[name])) {
        throw new Error("Dedicated DB_BASELINE_TEST_* settings are required");
    }

    const host = env.DB_BASELINE_TEST_HOST.toLowerCase();
    const database = env.DB_BASELINE_TEST_NAME;
    const port = Number(env.DB_BASELINE_TEST_PORT);
    const forbiddenName = /(^|[_-])(prod|production|stage|staging|dev|development)([_-]|$)/i;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
        throw new Error("Fresh baseline requires a loopback DB_BASELINE_TEST_HOST");
    }
    if (!/^[A-Za-z0-9_]+$/.test(database)
        || !/(^|_)test($|_)/i.test(database)
        || forbiddenName.test(database)) {
        throw new Error("DB_BASELINE_TEST_NAME must be an isolated test-only database");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("DB_BASELINE_TEST_PORT must be a valid TCP port");
    }

    return {
        host,
        port,
        user: env.DB_BASELINE_TEST_USER,
        password: env.DB_BASELINE_TEST_PASSWORD,
        database
    };
}

function getBaselineStatements(sql) {
    const statements = sql.split(/;\s*/).map((statement) => statement.trim()).filter(Boolean);
    const tableNames = [];

    for (const statement of statements) {
        const match = /^CREATE TABLE `([a-z_]+)` \(/i.exec(statement);
        if (!match) {
            throw new Error("Fresh baseline may contain CREATE TABLE statements only");
        }
        tableNames.push(match[1]);
    }

    if (tableNames.length !== expectedTables.length
        || new Set(tableNames).size !== expectedTables.length
        || expectedTables.some((tableName) => !tableNames.includes(tableName))) {
        throw new Error("Fresh baseline table inventory does not match the approved ten-table contract");
    }
    return statements;
}

function loadBaselineStatements() {
    const baselinePath = path.resolve(
        __dirname,
        "../baseline/001_user_service_fresh_schema.sql"
    );
    return getBaselineStatements(fs.readFileSync(baselinePath, "utf8"));
}

async function applyFreshBaseline({
    env = process.env,
    createConnection = mysql.createConnection
} = {}) {
    const target = getFreshBaselineTarget(env);
    const statements = loadBaselineStatements();
    const connection = await createConnection({
        host: target.host,
        port: target.port,
        user: target.user,
        password: target.password,
        database: target.database,
        multipleStatements: false
    });

    try {
        const [identityRows] = await connection.query(
            "SELECT DATABASE() AS database_name"
        );
        if (identityRows.length !== 1
            || identityRows[0].database_name !== target.database) {
            throw new Error("Connected database identity did not match DB_BASELINE_TEST_NAME");
        }

        const [existingTables] = await connection.execute(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
            [target.database]
        );
        if (existingTables.length !== 0) {
            throw new Error(
                `Refusing fresh baseline; schema is not empty: ${existingTables
                    .map((row) => row.TABLE_NAME)
                    .sort()
                    .join(", ")}`
            );
        }

        for (const statement of statements) {
            await connection.query(statement);
        }
        return expectedTables.slice();
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    applyFreshBaseline()
        .then((tables) => {
            console.log(`Fresh User-Service baseline applied: ${tables.join(", ")}`);
        })
        .catch((error) => {
            console.error(`Fresh User-Service baseline failed: ${error.message}`);
            process.exitCode = 1;
        });
}

module.exports = {
    applyFreshBaseline,
    expectedTables,
    getBaselineStatements,
    getFreshBaselineTarget,
    loadBaselineStatements
};
