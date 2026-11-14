const assert = require("node:assert/strict");
const test = require("node:test");
const {
    expectedTables,
    getBaselineStatements,
    getFreshBaselineTarget,
    loadBaselineStatements
} = require("../scripts/apply-fresh-baseline");

function baselineEnvironment(overrides = {}) {
    return {
        USER_SERVICE_ALLOW_FRESH_BASELINE: "1",
        DB_BASELINE_TEST_HOST: "127.0.0.1",
        DB_BASELINE_TEST_PORT: "3306",
        DB_BASELINE_TEST_USER: "user_service_test",
        DB_BASELINE_TEST_PASSWORD: "test-password",
        DB_BASELINE_TEST_NAME: "user_service_test_db",
        DB_HOST: "must-not-be-used",
        DB_NAME: "production",
        ...overrides
    };
}

test("fresh baseline contains only the ten canonical CREATE TABLE statements", () => {
    const statements = loadBaselineStatements();
    const tableNames = statements.map((statement) =>
        /^CREATE TABLE `([a-z_]+)` \(/i.exec(statement)[1]
    );

    assert.deepEqual(tableNames, expectedTables);
    assert.equal(
        statements.some((statement) => /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|USE)\b/i.test(statement)),
        false
    );
    assert.equal(statements.length, 10);
});

test("fresh baseline preserves dump constraints and runtime-specific replay storage", () => {
    const sql = loadBaselineStatements().join("\n");

    assert.match(sql, /`customer_type` enum\('REGISTERED','GUEST','MERGED'\) NOT NULL/i);
    assert.match(sql, /`merged_into_customer_id` char\(36\) DEFAULT NULL/i);
    assert.match(sql, /`chk_customers_type_consistency` CHECK/i);
    assert.match(sql, /`session_id` char\(36\) NOT NULL,[\s\S]*PRIMARY KEY \(`session_id`\)/i);
    assert.match(sql, /`token_family_id` char\(36\) NOT NULL/i);
    assert.match(sql, /REFERENCES `refresh_token_sessions` \(`session_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/i);
    assert.match(sql, /CREATE TABLE `user_audit_logs`/i);
    assert.doesNotMatch(sql, /CREATE TABLE `audit_logs`/i);
    assert.match(sql, /CREATE TABLE `role_permissions` \([\s\S]*?`assigned_at` datetime\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)[\s\S]*?\) ENGINE=/i);
    assert.doesNotMatch(
        sql.match(/CREATE TABLE `role_permissions` \([\s\S]*?\) ENGINE=/i)[0],
        /assigned_by/i
    );
    assert.match(sql, /`internal_token_replays_issuer_jti_unique` \(`issuer`,`jti`\)/i);
    assert.match(sql, /`internal_token_replays_expires_at_index` \(`expires_at`\)/i);
    assert.match(sql, /CREATE TABLE `internal_token_replays`[\s\S]*COLLATE=utf8mb4_bin/i);
});

test("baseline statement parser rejects non-create, missing, or duplicate tables", () => {
    assert.throws(
        () => getBaselineStatements("DROP TABLE `users`;"),
        /CREATE TABLE statements only/
    );
    assert.throws(
        () => getBaselineStatements("CREATE TABLE `users` (`id` int);"),
        /inventory/
    );
    assert.throws(
        () => getBaselineStatements([
            "CREATE TABLE `users` (`id` int)",
            "CREATE TABLE `users` (`id` int)",
            ...expectedTables.slice(2).map((name) => `CREATE TABLE \`${name}\` (\`id\` int)`)
        ].join(";")),
        /inventory/
    );
});

test("fresh baseline requires explicit opt-in and dedicated isolated settings", () => {
    assert.throws(
        () => getFreshBaselineTarget({ DB_HOST: "127.0.0.1", DB_NAME: "local_test" }),
        /USER_SERVICE_ALLOW_FRESH_BASELINE/
    );
    assert.throws(
        () => getFreshBaselineTarget({
            ...baselineEnvironment(),
            DB_BASELINE_TEST_HOST: "remote.example.test"
        }),
        /loopback/
    );
    assert.throws(
        () => getFreshBaselineTarget({
            ...baselineEnvironment(),
            DB_BASELINE_TEST_NAME: "user_service_dev_test"
        }),
        /isolated test-only/
    );
    assert.throws(
        () => getFreshBaselineTarget({
            ...baselineEnvironment(),
            DB_BASELINE_TEST_PORT: "0"
        }),
        /valid TCP port/
    );
    assert.deepEqual(getFreshBaselineTarget(baselineEnvironment()), {
        host: "127.0.0.1",
        port: 3306,
        user: "user_service_test",
        password: "test-password",
        database: "user_service_test_db"
    });
});
