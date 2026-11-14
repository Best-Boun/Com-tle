const assert = require("node:assert/strict");
const test = require("node:test");
const { createCustomerMergeExpiryWorker } = require("../src/services/customerMergeExpiryWorker");

function fakeDb(requestIds) {
    const db = () => {
        let after;
        let limit;
        return {
            select() { return this; },
            where(column, operator, value) {
                if (column === "request_id" && operator === ">") {
                    after = value;
                }
                return this;
            },
            orderBy() { return this; },
            limit(value) { limit = value; return this; },
            then(resolve, reject) {
                const rows = [...requestIds].sort()
                    .filter((id) => !after || id > after)
                    .slice(0, limit)
                    .map((request_id) => ({ request_id }));
                return Promise.resolve(rows).then(resolve, reject);
            }
        };
    };
    db.raw = () => "database time";
    return db;
}

test("expiry worker processes due requests and reports failures after attempting each", async () => {
    const calls = [];
    const worker = createCustomerMergeExpiryWorker({
        db: fakeDb(["first", "second"]),
        customerMergeService: {
            async expire(id) {
                calls.push(id);
                if (id === "first") {
                    throw new Error("failed");
                }
            }
        }
    });
    await assert.rejects(worker.runOnce(), AggregateError);
    assert.deepEqual(calls, ["first", "second"]);
});

test("expiry worker advances past a failed full batch", async () => {
    const ids = Array.from({ length: 105 }, (_, index) =>
        `request-${String(index).padStart(3, "0")}`);
    const calls = [];
    const worker = createCustomerMergeExpiryWorker({
        db: fakeDb(ids),
        customerMergeService: {
            async expire(id) {
                calls.push(id);
                if (id === ids[0]) {
                    throw new Error("failed");
                }
            }
        }
    });
    await assert.rejects(worker.runOnce(), AggregateError);
    assert.deepEqual(calls, ids);
});

test("expiry worker coalesces overlapping runs and waits for shutdown", async () => {
    let release;
    let calls = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const worker = createCustomerMergeExpiryWorker({
        db: fakeDb(["one"]),
        customerMergeService: {
            async expire() {
                calls += 1;
                await pending;
            }
        }
    });
    const first = worker.runOnce();
    const second = worker.runOnce();
    const stopped = worker.stop();
    assert.equal(first, second);
    release();
    await Promise.all([first, second, stopped]);
    assert.equal(calls, 1);
});

test("scheduled expiry failures are logged without database details", async () => {
    let report;
    const logged = new Promise((resolve) => { report = resolve; });
    const worker = createCustomerMergeExpiryWorker({
        db: fakeDb(["one"]),
        customerMergeService: {
            async expire() {
                throw new Error("sensitive database details");
            }
        },
        logger: { error: (...args) => report(args) },
        intervalMs: 1
    });
    worker.start();
    const timeout = setTimeout(() => report(["timeout"]), 1000);
    try {
        assert.deepEqual(await logged, [
            "Customer merge expiry worker failed",
            { code: "CUSTOMER_MERGE_EXPIRY_FAILED", failedRequests: 1 }
        ]);
    } finally {
        clearTimeout(timeout);
        await worker.stop();
    }
});
