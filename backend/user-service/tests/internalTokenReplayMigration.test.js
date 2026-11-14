const assert = require("node:assert/strict");
const test = require("node:test");
const knex = require("knex")({ client: "mysql2" });
const migration = require("../migrations/202611110005_create_internal_token_replays");

async function compileMigration(method) {
    const statements = [];
    const schema = {
        createTable(tableName, callback) {
            statements.push(...knex.schema.createTable(tableName, callback)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        },
        dropTableIfExists(tableName) {
            statements.push(...knex.schema.dropTableIfExists(tableName)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        }
    };
    await migration[method]({ schema });
    return statements;
}

test("internal replay migration compiles unique issuer-jti and expiry cleanup indexes", async () => {
    const sql = (await compileMigration("up")).join("\n");
    assert.match(sql, /create table `internal_token_replays`/i);
    assert.match(sql, /`issuer` varchar\(255\) not null/i);
    assert.match(sql, /`jti` varchar\(128\) not null/i);
    assert.match(sql, /`client_id` varchar\(64\) not null/i);
    assert.match(sql, /`expires_at` datetime\(3\) not null/i);
    assert.match(sql, /`created_at` datetime\(3\) not null/i);
    assert.match(sql, /unique `internal_token_replays_issuer_jti_unique`\(`issuer`, `jti`\)/i);
    assert.match(sql, /`internal_token_replays_expires_at_index`/i);
    assert.match(sql, /engine = innodb/i);
    assert.match(sql, /collate utf8mb4_bin/i);
});

test("internal replay migration rollback drops only the replay table", async () => {
    assert.deepEqual(await compileMigration("down"), [
        "drop table if exists `internal_token_replays`"
    ]);
});
