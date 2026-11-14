const mysql = require("mysql2/promise");

const optIn = process.env.USER_SERVICE_ALLOW_DATABASE_INSPECTION === "1";
const requiredVariables = [
    "DB_TEST_HOST",
    "DB_TEST_PORT",
    "DB_TEST_USER",
    "DB_TEST_PASSWORD",
    "DB_TEST_NAME"
];

function getTestTarget(env = process.env) {
    if (env.USER_SERVICE_ALLOW_DATABASE_INSPECTION !== "1") {
        throw new Error("Set USER_SERVICE_ALLOW_DATABASE_INSPECTION=1 to opt in");
    }
    if (requiredVariables.some((name) => !env[name])) {
        throw new Error("Dedicated DB_TEST_* settings are required");
    }

    const host = env.DB_TEST_HOST.toLowerCase();
    const database = env.DB_TEST_NAME;
    const port = Number(env.DB_TEST_PORT);
    const forbiddenName = /(^|[_-])(prod|production|stage|staging|dev|development)([_-]|$)/i;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
        throw new Error("Database inspection requires a loopback DB_TEST_HOST");
    }
    if (!/^[A-Za-z0-9_]+$/.test(database)
        || !/(^|_)test($|_)/i.test(database)
        || forbiddenName.test(database)) {
        throw new Error("DB_TEST_NAME must be an isolated test-only database");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("DB_TEST_PORT must be a valid TCP port");
    }
    return {
        host,
        port,
        user: env.DB_TEST_USER,
        password: env.DB_TEST_PASSWORD,
        database
    };
}

async function inspectDatabase() {
    if (!optIn) {
        console.log("Database inspection skipped; explicit opt-in was not set.");
        return;
    }

    const target = getTestTarget();
    const connection = await mysql.createConnection(target);
    try {
        const [rows] = await connection.execute(
            "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
            [target.database]
        );
        if (rows.length === 1) {
            console.log("Database connection successful:", rows[0].SCHEMA_NAME);
        } else {
            throw new Error("Connected schema identity could not be verified");
        }
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    inspectDatabase().catch((error) => {
        console.error(`Database inspection failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    getTestTarget,
    inspectDatabase
};
