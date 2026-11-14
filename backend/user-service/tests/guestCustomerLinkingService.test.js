const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createGuestCustomerLinkingService
} = require("../src/services/guestCustomerLinkingService");

function createFakeDb({
    customers = [{
        customer_id: "guest-1",
        user_id: null,
        full_name: "Guest Customer",
        phone: "555-0123",
        email: "guest@example.com",
        customer_type: "GUEST"
    }],
    users = [
        { user_id: "user-1", status: "ACTIVE" },
        { user_id: "user-2", status: "ACTIVE" },
        { user_id: "disabled-user", status: "DISABLED" }
    ],
    history = [{ work_order_id: "work-order-1", customer_id: "guest-1" }],
    failUpdate = false,
    transactionError,
    mappingRead,
    failAudit = false
} = {}) {
    let state = { customers, users, history, user_audit_logs: [] };
    let transactionTail = Promise.resolve();
    let attempts = 0;
    const locks = [];
    const isolationLevels = [];

    function queryFor(currentState, tableName) {
        const filters = [];
        let isLocked = false;
        const query = {
            where(criteria) {
                filters.push(criteria);
                return this;
            },
            select() {
                return this;
            },
            forUpdate() {
                isLocked = true;
                locks.push({ table: tableName, ...filters[0] });
                return this;
            },
            async first() {
                if (tableName === "customers" && !isLocked && filters[0]?.user_id && mappingRead) {
                    return mappingRead(attempts);
                }
                return currentState[tableName].find((row) =>
                    filters.every((filter) => Object.entries(filter).every(
                        ([key, value]) => row[key] === value
                    ))
                );
            },
            async update(values) {
                if (failUpdate) {
                    if (failUpdate instanceof Error) throw failUpdate;
                    throw new Error("simulated update failure");
                }
                const matched = currentState[tableName].filter((row) =>
                    filters.every((filter) => Object.entries(filter).every(
                        ([key, value]) => row[key] === value
                    ))
                );
                for (const row of matched) {
                    Object.assign(row, values);
                }
                return matched.length;
            },
            async insert(row) {
                const failure = typeof failAudit === "function" ? failAudit(attempts) : failAudit;
                if (failure instanceof Error) throw failure;
                if (failure) throw new Error("simulated audit failure");
                currentState[tableName].push({ ...row });
            }
        };
        return query;
    }

    const db = (tableName) => queryFor(state, tableName);
    db.transaction = async (callback, config) => {
        attempts += 1;
        isolationLevels.push(config?.isolationLevel);
        const error = transactionError?.(attempts);
        if (error) throw error;
        let release;
        const previous = transactionTail;
        transactionTail = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            const transactionState = structuredClone(state);
            const trx = (tableName) => queryFor(transactionState, tableName);
            const result = await callback(trx);
            state = transactionState;
            return result;
        } finally {
            release();
        }
    };
    db.getState = () => structuredClone(state);
    db.getAttempts = () => attempts;
    db.getLocks = () => locks;
    db.getIsolationLevels = () => isolationLevels;
    return db;
}

function createService(db, verifyIdentity = async () => "user-1") {
    return createGuestCustomerLinkingService({ db, verifyIdentity });
}

test("guest linking requires a configured trusted identity verifier", () => {
    assert.throws(
        () => createGuestCustomerLinkingService({ db: createFakeDb() }),
        /trusted identity verifier/
    );
});

test("verified link preserves customer identity and historical references", async () => {
    const db = createFakeDb();
    const service = createService(db, async (evidence) =>
        evidence?.proof === "verified" ? "user-1" : null
    );
    const result = await service.linkGuestCustomer("guest-1", { proof: "verified" });

    assert.deepEqual(result, {
        customer_id: "guest-1",
        user_id: "user-1",
        customer_type: "REGISTERED"
    });
    const state = db.getState();
    assert.deepEqual(state.customers[0], {
        customer_id: "guest-1",
        user_id: "user-1",
        full_name: "Guest Customer",
        phone: "555-0123",
        email: "guest@example.com",
        customer_type: "REGISTERED"
    });
    assert.deepEqual(state.history, [{
        work_order_id: "work-order-1",
        customer_id: "guest-1"
    }]);
    assert.equal(state.user_audit_logs[0].action, "CUSTOMER.GUEST_LINKED");
    assert.equal(state.user_audit_logs[0].resource_type, "customer");
    assert.equal(state.user_audit_logs[0].resource_id, "guest-1");
    assert.equal(state.user_audit_logs[0].reason, null);
    assert.deepEqual(state.user_audit_logs[0].metadata, {
        linked_user_id: "user-1",
        outcome: "SUCCESS",
        request_id: null
    });
});

test("linking rejects missing or unverified identity evidence", async () => {
    const service = createService(createFakeDb(), async () => null);
    await assert.rejects(
        service.linkGuestCustomer("guest-1"),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.linkGuestCustomer("guest-1", { unverified: true }),
        (error) => error.statusCode === 403
    );
});

test("linking rejects registered guests, unknown customers or users, and ineligible users", async () => {
    const registeredDb = createFakeDb({
        customers: [{
            customer_id: "registered-1",
            user_id: "user-2",
            customer_type: "REGISTERED"
        }]
    });
    await assert.rejects(
        createService(registeredDb).linkGuestCustomer("registered-1", {}),
        (error) => error.statusCode === 409
    );

    const mergedDb = createFakeDb({
        customers: [{
            customer_id: "merged-1",
            user_id: "user-2",
            customer_type: "MERGED"
        }]
    });
    await assert.rejects(
        createService(mergedDb).linkGuestCustomer("merged-1", {}),
        (error) => error.statusCode === 409
    );

    await assert.rejects(
        createService(createFakeDb()).linkGuestCustomer("unknown", {}),
        (error) => error.statusCode === 404
    );
    await assert.rejects(
        createService(createFakeDb(), async () => "missing-user")
            .linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 404
    );
    await assert.rejects(
        createService(createFakeDb(), async () => "disabled-user")
            .linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 409
    );
    await assert.rejects(
        createService(createFakeDb(), async () => "missing-user").linkGuestCustomer("unknown", {}),
        (error) => error.statusCode === 404 && error.message === "Customer not found"
    );
    await assert.rejects(
        createService(registeredDb, async () => "missing-user").linkGuestCustomer("registered-1", {}),
        (error) => error.statusCode === 409 && error.message === "Customer is already registered"
    );
});

test("linking rejects a user who already has a customer profile", async () => {
    const db = createFakeDb({
        customers: [
            {
                customer_id: "guest-1",
                user_id: null,
                customer_type: "GUEST"
            },
            {
                customer_id: "registered-1",
                user_id: "user-1",
                customer_type: "REGISTERED"
            }
        ]
    });
    await assert.rejects(
        createService(db).linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 409
    );
});

test("concurrent attempts cannot link one guest customer twice", async () => {
    const db = createFakeDb();
    const service = createService(db, async (evidence) => evidence.userId);
    const outcomes = await Promise.allSettled([
        service.linkGuestCustomer("guest-1", { userId: "user-1" }),
        service.linkGuestCustomer("guest-1", { userId: "user-2" })
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    assert.equal(db.getState().customers[0].customer_type, "REGISTERED");
});

test("linking rolls back on database failure", async () => {
    const db = createFakeDb({ failUpdate: true });
    await assert.rejects(
        createService(db).linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 503
    );
    assert.equal(db.getState().customers[0].user_id, null);
    assert.equal(db.getState().customers[0].customer_type, "GUEST");
});

test("linking locks user then both customers in ID order using read committed", async () => {
    const db = createFakeDb({
        customers: [
            { customer_id: "z-guest", user_id: null, customer_type: "GUEST" },
            { customer_id: "a-existing", user_id: "user-1", customer_type: "REGISTERED" }
        ]
    });
    await assert.rejects(createService(db).linkGuestCustomer("z-guest", {}),
        (error) => error.statusCode === 409 && error.message === "User already has a customer profile");
    assert.deepEqual(db.getLocks(), [
        { table: "users", user_id: "user-1" },
        { table: "customers", customer_id: "a-existing" },
        { table: "customers", customer_id: "z-guest" }
    ]);
    assert.deepEqual(db.getIsolationLevels(), ["read committed"]);
});

test("mapping changes roll back and restart with the newly discovered mapping", async () => {
    let reads = 0;
    const db = createFakeDb({
        customers: [
            { customer_id: "z-guest", user_id: null, customer_type: "GUEST" },
            { customer_id: "a-existing", user_id: "user-1", customer_type: "REGISTERED" }
        ],
        mappingRead: () => (++reads === 1 ? undefined : { customer_id: "a-existing" })
    });
    await assert.rejects(createService(db).linkGuestCustomer("z-guest", {}),
        (error) => error.statusCode === 409 && error.message === "User already has a customer profile");
    assert.equal(db.getAttempts(), 2);
    assert.deepEqual(db.getLocks().map((entry) => entry.customer_id).filter(Boolean),
        ["z-guest", "a-existing", "z-guest"]);
    assert.equal(db.getState().user_audit_logs.length, 0);
    assert.equal(db.getState().customers[0].user_id, null);
});

test("repeated mapping changes exhaust retries without mutation", async () => {
    let reads = 0;
    const db = createFakeDb({ mappingRead: () => ++reads % 2 ? undefined : { customer_id: "new" } });
    await assert.rejects(createService(db).linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 503 && error.message === "Guest customer linking unavailable after mapping retries");
    assert.equal(db.getAttempts(), 3);
    assert.equal(db.getState().customers[0].user_id, null);
    assert.equal(db.getState().user_audit_logs.length, 0);
});

test("deadlocks retry, duplicate keys and permanent failures do not", async () => {
    const db = createFakeDb({
        transactionError: (attempt) => attempt < 3 ? { errno: 1213 } : null
    });
    await createService(db).linkGuestCustomer("guest-1", {});
    assert.equal(db.getAttempts(), 3);
    assert.equal(db.getState().user_audit_logs.length, 1);
    const duplicate = Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    const duplicateDb = createFakeDb({ failUpdate: duplicate });
    await assert.rejects(createService(duplicateDb).linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 409 && error.message === "User already has a customer profile");
    assert.equal(duplicateDb.getAttempts(), 1);
    const auditDb = createFakeDb({ failAudit: true });
    await assert.rejects(createService(auditDb).linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 503);
    assert.equal(auditDb.getAttempts(), 1);
    assert.equal(auditDb.getState().customers[0].user_id, null);
});

test("an audit deadlock retries the whole linking transaction", async () => {
    const deadlock = Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
    const db = createFakeDb({ failAudit: (attempt) => attempt === 1 ? deadlock : false });
    await createService(db).linkGuestCustomer("guest-1", {});
    assert.equal(db.getAttempts(), 2);
    assert.equal(db.getState().customers[0].user_id, "user-1");
    assert.equal(db.getState().user_audit_logs.length, 1);
});

test("deadlock exhaustion reports unavailable after three attempts", async () => {
    const db = createFakeDb({ transactionError: () => ({ errno: 1213 }) });
    await assert.rejects(createService(db).linkGuestCustomer("guest-1", {}),
        (error) => error.statusCode === 503 && error.message === "Guest customer linking unavailable after deadlock retries");
    assert.equal(db.getAttempts(), 3);
    assert.equal(db.getState().customers[0].user_id, null);
});
