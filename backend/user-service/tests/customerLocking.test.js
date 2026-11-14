const assert = require("node:assert/strict");
const test = require("node:test");
const { lockUsers, lockCustomers, withDeadlockRetry } = require("../src/services/customerLocking");

test("lock helpers deduplicate and lock sorted IDs with targeted and requested columns", async () => {
    const calls = [];
    const trx = (table) => ({
        select(...columns) { this.columns = columns; return this; },
        where(filter) { this.filter = filter; return this; },
        forUpdate() { this.locked = true; return this; },
        async first() {
            calls.push({ table, columns: this.columns, filter: this.filter, locked: this.locked });
            const [column, id] = Object.entries(this.filter)[0];
            return id === "missing" ? undefined : { [column]: id, marker: id };
        }
    });
    const users = await lockUsers(trx, ["z", "a", "z", "missing"]);
    const customers = await lockCustomers(trx, ["z", "a", "z"], ["row_version", "user_id"]);
    assert.deepEqual([...users.keys()], ["a", "z"]);
    assert.deepEqual([...customers.keys()], ["a", "z"]);
    assert.deepEqual(calls.map((call) => Object.values(call.filter)[0]), ["a", "missing", "z", "a", "z"]);
    assert.deepEqual(calls[0].columns, ["user_id", "status"]);
    assert.deepEqual(calls[3].columns, [
        "customer_id", "user_id", "customer_type", "merged_into_customer_id", "row_version"
    ]);
    assert.ok(calls.every((call) => call.locked));
    assert.equal(customers.get("a").marker, "a");
});

test("lock helpers key results by requested ID while retaining the returned row", async () => {
    const user = { user_id: "abc", status: "ACTIVE" };
    const customer = { customer_id: "def", customer_type: "GUEST" };
    const trx = (table) => ({
        select() { return this; },
        where() { return this; },
        forUpdate() { return this; },
        async first() { return table === "users" ? user : customer; }
    });

    const users = await lockUsers(trx, ["ABC"]);
    const customers = await lockCustomers(trx, ["DEF"]);
    assert.deepEqual([...users.keys()], ["ABC"]);
    assert.deepEqual([...customers.keys()], ["DEF"]);
    assert.strictEqual(users.get("ABC"), user);
    assert.strictEqual(customers.get("DEF"), customer);
});

test("lock ordering is case-normalized with deterministic tie-breaking", async () => {
    const calls = [];
    const trx = () => ({
        select() { return this; },
        where(filter) { this.filter = filter; return this; },
        forUpdate() { return this; },
        async first() {
            const [column, id] = Object.entries(this.filter)[0];
            calls.push(id);
            return { [column]: id.toLowerCase() };
        }
    });
    const users = await lockUsers(trx, ["b", "A", "a", "B"]);
    assert.deepEqual(calls, ["A", "a", "B", "b"]);
    assert.deepEqual([...users.keys()], ["A", "a", "B", "b"]);
    calls.length = 0;
    await lockCustomers(trx, ["b2", "A1"]);
    assert.deepEqual(calls, ["A1", "b2"]);
    calls.length = 0;
    await lockCustomers(trx, ["B2", "a1"]);
    assert.deepEqual(calls, ["a1", "B2"]);
});

test("deadlock retry is bounded and preserves final or non-deadlock errors", async () => {
    let attempts = 0;
    const final = { code: "ER_LOCK_DEADLOCK" };
    await assert.rejects(withDeadlockRetry(async () => {
        attempts += 1;
        throw final;
    }), (error) => error === final);
    assert.equal(attempts, 3);

    attempts = 0;
    const permanent = { errno: 1205 };
    await assert.rejects(withDeadlockRetry(async () => {
        attempts += 1;
        throw permanent;
    }), (error) => error === permanent);
    assert.equal(attempts, 1);

    attempts = 0;
    const result = await withDeadlockRetry(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("wrapped", { cause: { errno: 1213 } });
        return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(attempts, 2);
});
