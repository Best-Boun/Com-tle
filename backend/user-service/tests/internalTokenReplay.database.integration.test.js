// The canonical MySQL schema stores DATETIME values as UTC; pin Node to UTC so
// mysql2 reads them without a local-timezone shift.
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const knexFactory = require("knex");
const {
    createInternalTokenReplayRepository
} = require("../src/services/internalTokenReplayRepository");
const {
    INTERNAL_JWT_CLOCK_SKEW_SECONDS
} = require("../src/constants/internalServiceAuth");

const enabled = process.env.USER_SERVICE_ALLOW_REPLAY_DATABASE_TESTS === "1";
const requiredVariables = [
    "DB_TEST_HOST",
    "DB_TEST_PORT",
    "DB_TEST_USER",
    "DB_TEST_PASSWORD",
    "DB_TEST_NAME"
];

function getTestTarget(env = process.env) {
    if (env.USER_SERVICE_ALLOW_REPLAY_DATABASE_TESTS !== "1") {
        throw new Error("Set USER_SERVICE_ALLOW_REPLAY_DATABASE_TESTS=1 to opt in");
    }
    if (requiredVariables.some((name) => !env[name])) {
        throw new Error("Dedicated DB_TEST_* settings are required");
    }

    const host = env.DB_TEST_HOST.toLowerCase();
    const database = env.DB_TEST_NAME;
    const port = Number(env.DB_TEST_PORT);
    const forbiddenName = /(^|[_-])(prod|production|stage|staging|dev|development)([_-]|$)/i;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
        throw new Error("Replay database tests require a loopback DB_TEST_HOST");
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

const target = enabled ? getTestTarget() : null;

test("replay storage is atomic and cleans only expired rows on canonical MySQL", {
    skip: enabled
        ? false
        : "Set USER_SERVICE_ALLOW_REPLAY_DATABASE_TESTS=1 with isolated DB_TEST_* settings"
}, async () => {
    const db = knexFactory({
        client: "mysql2",
        connection: target,
        pool: { min: 0, max: 2 },
        acquireConnectionTimeout: 10000
    });
    const issuer = `replay-test-${randomUUID()}`;
    const currentTime = Date.now();
    const currentSecond = Math.floor(currentTime / 1000);
    const repository = createInternalTokenReplayRepository({
        db,
        now: () => currentTime
    });

    try {
        const [schemaRows] = await db.raw(
            "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
            [target.database]
        );
        const tables = new Map(schemaRows.map((row) => [row.TABLE_NAME, row]));
        assert.ok(tables.has("internal_token_replays"));
        assert.ok(tables.has("user_audit_logs"));
        assert.equal(tables.has("audit_logs"), false);
        assert.equal(tables.get("internal_token_replays").ENGINE, "InnoDB");
        assert.equal(tables.get("internal_token_replays").TABLE_COLLATION, "utf8mb4_bin");

        const columns = await db("information_schema.COLUMNS")
            .select("COLUMN_NAME")
            .where({
                TABLE_SCHEMA: target.database,
                TABLE_NAME: "internal_token_replays"
            });
        assert.deepEqual(columns.map((row) => row.COLUMN_NAME).sort(), [
            "client_id",
            "created_at",
            "expires_at",
            "internal_token_replay_id",
            "issuer",
            "jti"
        ]);
        assert.equal(
            await db("internal_token_replays").count({ total: "*" }).first()
                .then((row) => Number(row.total)),
            0,
            "Replay integration test requires an empty replay table"
        );

        const activeJti = randomUUID();
        const activeExpiry = currentSecond + 60;
        const duplicateOutcomes = await Promise.all([
            repository.consumeJti({
                issuer,
                jti: activeJti,
                clientId: "user-service-test",
                expiresAt: activeExpiry
            }),
            repository.consumeJti({
                issuer,
                jti: activeJti,
                clientId: "user-service-test",
                expiresAt: activeExpiry
            })
        ]);
        assert.deepEqual(duplicateOutcomes.sort(), [false, true]);

        const stored = await db("internal_token_replays")
            .where({ issuer, jti: activeJti })
            .first();
        assert.equal(stored.client_id, "user-service-test");
        assert.equal(
            new Date(stored.expires_at).getTime(),
            (activeExpiry + INTERNAL_JWT_CLOCK_SKEW_SECONDS) * 1000
        );
        assert.ok(stored.created_at);

        const expiredJti = randomUUID();
        assert.equal(await repository.consumeJti({
            issuer,
            jti: expiredJti,
            clientId: "user-service-test",
            expiresAt: currentSecond - 60
        }), true);
        assert.equal(await repository.cleanupExpired(currentTime), 1);
        assert.equal(
            await db("internal_token_replays").where({ issuer, jti: expiredJti }).first(),
            undefined
        );
        assert.ok(await db("internal_token_replays").where({ issuer, jti: activeJti }).first());
    } finally {
        await db("internal_token_replays").where({ issuer }).delete();
        await db.destroy();
    }
});

module.exports = {
    getTestTarget
};
