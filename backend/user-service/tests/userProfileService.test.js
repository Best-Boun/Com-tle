const assert = require("node:assert/strict");
const test = require("node:test");
const { USER_ROLES } = require("../../shared/constants");
const { createUserProfileService } = require("../src/services/userProfileService");

const initialState = {
    users: [
        {
            user_id: "user-1",
            email: "one@example.com",
            password_hash: "do-not-return",
            phone: "555-0101",
            status: "ACTIVE"
        },
        {
            user_id: "user-2",
            email: "two@example.com",
            password_hash: "also-secret",
            phone: null,
            status: "ACTIVE"
        }
    ],
    customers: [
        {
            customer_id: "customer-1",
            user_id: "user-1",
            full_name: "Customer One",
            phone: "555-0101",
            email: "one@example.com",
            customer_type: "REGISTERED"
        },
        {
            customer_id: "customer-2",
            user_id: "user-2",
            full_name: "Customer Two",
            phone: null,
            email: "two@example.com",
            customer_type: "REGISTERED"
        }
    ],
    roles: [{ role_id: "role-customer", role_code: USER_ROLES.CUSTOMER }],
    user_audit_logs: [],
    user_roles: [
        { user_id: "user-1", role_id: "role-customer" },
        { user_id: "user-2", role_id: "role-customer" }
    ]
};

function cloneState(state) {
    return Object.fromEntries(
        Object.entries(state).map(([table, rows]) => [
            table,
            rows.map((row) => ({ ...row }))
        ])
    );
}

function createFakeDb(options = {}) {
    let state = cloneState(options.initialState || initialState);
    let attempts = 0;
    const locks = [];

    function queryFor(currentState, tableName) {
        const filters = [];
        let joinTable;
        const query = {
            select() {
                return this;
            },
            where(criteria) {
                filters.push((row) => Object.entries(criteria).every(([key, value]) => {
                    const column = key.split(".").pop();
                    return row[column] === value;
                }));
                return this;
            },
            forUpdate() {
                locks.push(tableName);
                return this;
            },
            join(table) {
                joinTable = table;
                return this;
            },
            orderBy(column) {
                this.sortColumn = column.split(".").pop();
                return this;
            },
            async execute() {
                let rows = currentState[tableName].filter((row) =>
                    filters.every((filter) => filter(row))
                );
                if (joinTable) {
                    rows = rows.flatMap((row) => currentState[joinTable]
                        .filter((related) => related.role_id === row.role_id)
                        .map((related) => ({ ...row, ...related })));
                }
                if (this.sortColumn) {
                    rows.sort((a, b) => a[this.sortColumn].localeCompare(b[this.sortColumn]));
                }
                return rows;
            },
            async first() {
                return (await this.execute())[0];
            },
            async update(values) {
                const failure = options.failUpdate?.(tableName, values);
                if (failure instanceof Error) throw failure;
                if (failure) {
                    throw new Error("simulated update failure");
                }
                const rows = await this.execute();
                rows.forEach((row) => Object.assign(row, values));
                return rows.length;
            },
            async insert(row) {
                if (tableName === "user_audit_logs" && options.failAuditInsert) {
                    throw new Error("simulated audit insert failure");
                }
                currentState[tableName].push({ ...row });
            },
            then(resolve, reject) {
                return this.execute().then(resolve, reject);
            }
        };
        return query;
    }

    const db = (tableName) => queryFor(state, tableName);
    db.transaction = async (callback) => {
        attempts += 1;
        if (options.transactionError) {
            const error = options.transactionError(attempts);
            if (error) throw error;
        }
        const transactionState = cloneState(state);
        const transaction = (tableName) => queryFor(transactionState, tableName);
        const result = await callback(transaction);
        state = transactionState;
        return result;
    };
    db.getState = () => cloneState(state);
    db.getAttempts = () => attempts;
    db.getLocks = () => locks;
    return db;
}

test("getProfile returns only the authenticated user's safe profile fields", async () => {
    const db = createFakeDb();
    const profile = await createUserProfileService({ db }).getProfile("user-1");

    assert.deepEqual(profile, {
        user_id: "user-1",
        email: "one@example.com",
        phone: "555-0101",
        status: "ACTIVE",
        full_name: "Customer One",
        customer_type: "REGISTERED",
        roles: ["CUSTOMER"]
    });

    assert.equal(JSON.stringify(profile).includes("password"), false);
    assert.equal(JSON.stringify(profile).includes("refresh"), false);
});

test("merged profiles reject every mutation before updating users, customers or audit", async () => {
    const merged = cloneState(initialState);
    merged.customers[0].customer_type = "MERGED";
    merged.customers[0].merged_into_customer_id = "customer-2";
    const db = createFakeDb({ initialState: merged });
    const service = createUserProfileService({ db });
    for (const update of [{ phone: "new" }, { full_name: "New" }, { phone: null, full_name: "New" }]) {
        await assert.rejects(service.updateProfile("user-1", update), (error) =>
            error.statusCode === 409 && /merged/i.test(error.message));
        assert.deepEqual(db.getState(), merged);
    }
    assert.deepEqual(db.getLocks(), ["users", "customers", "users", "customers", "users", "customers"]);
});

test("profile deadlocks retry transactions but permanent errors do not", async () => {
    const db = createFakeDb({
        transactionError: (attempt) => attempt < 3 ? { code: "ER_LOCK_DEADLOCK" } : null
    });
    await createUserProfileService({ db }).updateProfile("user-1", { phone: "123" });
    assert.equal(db.getAttempts(), 3);
    assert.equal(db.getState().user_audit_logs.length, 1);
    const failed = createFakeDb({ transactionError: () => ({ errno: 1205 }) });
    await assert.rejects(createUserProfileService({ db: failed }).updateProfile("user-1", { phone: "123" }),
        (error) => error.statusCode === 503);
    assert.equal(failed.getAttempts(), 1);
    const exhausted = createFakeDb({ transactionError: () => ({ errno: 1213 }) });
    await assert.rejects(createUserProfileService({ db: exhausted }).updateProfile("user-1", { phone: "123" }),
        (error) => error.statusCode === 503 && /deadlock retries/.test(error.message));
    assert.equal(exhausted.getAttempts(), 3);
});

test("profile deadlock after a user update rolls back the first attempt", async () => {
    let failures = 0;
    const deadlock = Object.assign(new Error("deadlock"), { errno: 1213 });
    const db = createFakeDb({
        failUpdate: (table) => table === "customers" && failures++ === 0 ? deadlock : false
    });
    await createUserProfileService({ db }).updateProfile("user-1", { phone: "123" });
    assert.equal(db.getAttempts(), 2);
    assert.equal(db.getState().users[0].phone, "123");
    assert.equal(db.getState().customers[0].phone, "123");
    assert.equal(db.getState().user_audit_logs.length, 1);
});

test("updateProfile updates only provided fields and synchronizes user and customer", async () => {
    const db = createFakeDb();
    const service = createUserProfileService({ db });

    const renamed = await service.updateProfile("user-1", { full_name: "  New Name " });
    assert.equal(renamed.full_name, "New Name");
    assert.equal(renamed.phone, "555-0101");

    const phoneOnly = await service.updateProfile("user-1", { phone: "555-0111" });
    assert.equal(phoneOnly.phone, "555-0111");
    assert.equal(db.getState().users[0].phone, "555-0111");
    assert.equal(db.getState().customers[0].phone, "555-0111");

    const both = await service.updateProfile("user-1", {
        full_name: "Updated Name",
        phone: null
    });
    assert.equal(both.full_name, "Updated Name");
    assert.equal(both.phone, null);
    assert.equal(db.getState().users[0].phone, null);
    assert.equal(db.getState().customers[0].phone, null);
    assert.equal(db.getState().user_audit_logs.length, 3);
    assert.equal(db.getState().user_audit_logs[2].resource_type, "user");
    assert.equal(db.getState().user_audit_logs[2].resource_id, "user-1");
    assert.equal(db.getState().user_audit_logs[2].reason, null);
    assert.deepEqual(db.getState().user_audit_logs[2].metadata.changed_fields, [
        "full_name",
        "phone"
    ]);
    assert.equal(db.getState().user_audit_logs[2].metadata.outcome, "SUCCESS");
});

test("profile mutation rolls back when its audit event cannot be persisted", async () => {
    const db = createFakeDb({ failAuditInsert: true });

    await assert.rejects(
        createUserProfileService({ db }).updateProfile("user-1", {
            full_name: "Uncommitted Name"
        }),
        (error) => error.statusCode === 503
    );

    assert.equal(db.getState().customers[0].full_name, "Customer One");
    assert.equal(db.getState().users[0].phone, "555-0101");
    assert.equal(db.getState().user_audit_logs.length, 0);
});

test("updateProfile rejects invalid, empty, and unsupported fields", async () => {
    const service = createUserProfileService({ db: createFakeDb() });
    const invalidUpdates = [
        {},
        { full_name: "   " },
        { full_name: "x".repeat(151) },
        { phone: 123 },
        { phone: "   " },
        { phone: "x".repeat(31) },
        { email: "changed@example.com" },
        { user_id: "user-2" },
        { status: "DISABLED" },
        { roles: ["ADMIN"] },
        { permissions: ["manage"] }
    ];

    for (const update of invalidUpdates) {
        await assert.rejects(
            service.updateProfile("user-1", update),
            (error) => error.statusCode === 400
        );
    }
});

test("updateProfile rolls back all table changes after a database failure", async () => {
    const db = createFakeDb({
        failUpdate: (tableName) => tableName === "customers"
    });
    const before = db.getState();

    await assert.rejects(
        createUserProfileService({ db }).updateProfile("user-1", {
            full_name: "Must Roll Back",
            phone: "555-0199"
        }),
        (error) => error.statusCode === 503
    );
    assert.deepEqual(db.getState(), before);
});

test("getProfile does not return another user's data for a different identity", async () => {
    const service = createUserProfileService({ db: createFakeDb() });

    assert.equal((await service.getProfile("user-2")).user_id, "user-2");
    await assert.rejects(
        service.getProfile("missing-user"),
        (error) => error.statusCode === 404
    );
});
