const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { USER_ROLES } = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const { createAuthService } = require("../src/services/authService");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

const jwtConfig = {
    privateKey,
    issuer: "test-issuer",
    audience: "test-audience",
    expiresIn: 60
};

function matches(row, criteria) {
    return Object.entries(criteria).every(([key, value]) => {
        const column = key.includes(".") ? key.split(".").pop() : key;
        return row[column] === value;
    });
}

function cloneState(state) {
    return Object.fromEntries(
        Object.entries(state).map(([table, rows]) => [
            table,
            rows.map((row) => ({ ...row }))
        ])
    );
}

function createFakeDb(initialState = {}, options = {}) {
    let state = cloneState({
        users: [],
        customers: [],
        roles: [
            { role_id: "role-customer", role_code: USER_ROLES.CUSTOMER },
            { role_id: "role-technician", role_code: USER_ROLES.TECHNICIAN },
            { role_id: "role-admin", role_code: USER_ROLES.ADMIN }
        ],
        user_roles: [],
        ...initialState
    });

    function queryFor(currentState, tableName) {
        const query = {
            criteria: {},
            joinDetails: null,
            sortColumn: null,
            select() {
                return this;
            },
            where(criteria) {
                this.criteria = criteria;
                return this;
            },
            join(table, left, right) {
                this.joinDetails = { table, left, right };
                return this;
            },
            orderBy(column) {
                this.sortColumn = column;
                return this;
            },
            async first() {
                return (await this.execute())[0];
            },
            async insert(row) {
                if (tableName === "customers" && options.failCustomerInsert) {
                    throw new Error("simulated customer insert failure");
                }

                if (
                    tableName === "users"
                    && currentState.users.some((user) => user.email === row.email)
                ) {
                    const error = new Error("duplicate email");
                    error.code = "ER_DUP_ENTRY";
                    throw error;
                }

                currentState[tableName].push({ ...row });
            },
            async execute() {
                let rows = currentState[tableName] || [];

                if (this.joinDetails) {
                    const related = currentState[this.joinDetails.table] || [];
                    const leftColumn = this.joinDetails.left.split(".").pop();
                    const rightColumn = this.joinDetails.right.split(".").pop();
                    rows = rows.flatMap((row) => related
                        .filter((other) => row[leftColumn] === other[rightColumn])
                        .map((other) => ({ ...row, ...other })));
                }

                rows = rows.filter((row) => matches(row, this.criteria));
                if (this.sortColumn) {
                    const column = this.sortColumn.split(".").pop();
                    rows = rows.slice().sort((left, right) =>
                        String(left[column]).localeCompare(String(right[column]))
                    );
                }
                return rows;
            },
            then(resolve, reject) {
                return this.execute().then(resolve, reject);
            }
        };

        return query;
    }

    function db(tableName) {
        return queryFor(state, tableName);
    }

    db.transaction = async (callback) => {
        const transactionState = cloneState(state);
        const transaction = (tableName) => queryFor(transactionState, tableName);
        const result = await callback(transaction);
        state = transactionState;
        return result;
    };

    db.getState = () => cloneState(state);
    return db;
}

function createService(db, options = {}) {
    return createAuthService({
        db,
        jwtConfig,
        createId: randomUUID,
        now: () => 1_700_000_000_000,
        ...options
    });
}

function registrationInput(overrides = {}) {
    return {
        full_name: "Test Customer",
        email: "Customer@example.com",
        password: "correct horse battery",
        phone: "555-0100",
        ...overrides
    };
}

async function createLoginFixture({ status = "ACTIVE", roleCodes = ["CUSTOMER"] } = {}) {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    const roleRows = roleCodes.map((roleCode, index) => ({
        role_id: `role-${index}`,
        role_code: roleCode
    }));
    const user = {
        user_id: "user-123",
        email: "customer@example.com",
        password_hash: passwordHash,
        phone: "555-0100",
        status
    };
    const db = createFakeDb({
        users: [user],
        roles: roleRows,
        user_roles: roleRows.map((role) => ({
            user_id: user.user_id,
            role_id: role.role_id
        }))
    });
    return { db, user };
}

test("register creates a customer account, hashes the password, and assigns CUSTOMER", async () => {
    const db = createFakeDb();
    const auth = createService(db);

    const result = await auth.register(registrationInput());

    const state = db.getState();
    assert.equal(state.users.length, 1);
    assert.equal(state.customers.length, 1);
    assert.equal(state.user_roles.length, 1);
    assert.equal(state.users[0].email, "customer@example.com");
    assert.notEqual(state.users[0].password_hash, "correct horse battery");
    assert.equal(await bcrypt.compare("correct horse battery", state.users[0].password_hash), true);
    assert.equal(state.customers[0].customer_type, "REGISTERED");
    assert.equal(state.customers[0].user_id, state.users[0].user_id);
    assert.equal(state.user_roles[0].role_id, "role-customer");
    assert.equal(state.users[0].status, "ACTIVE");
    assert.deepEqual(result.roles, ["CUSTOMER"]);
    assert.equal(Object.hasOwn(result.user, "password_hash"), false);
});

test("register rejects duplicate email case-insensitively", async () => {
    const db = createFakeDb({
        users: [{
            user_id: "existing",
            email: "customer@example.com",
            password_hash: "not-returned",
            status: "ACTIVE"
        }]
    });

    await assert.rejects(
        createService(db).register(registrationInput()),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    assert.equal(db.getState().users.length, 1);
});

test("register rolls back every related insert if a later insert fails", async () => {
    const db = createFakeDb({}, { failCustomerInsert: true });

    await assert.rejects(
        createService(db).register(registrationInput()),
        /simulated customer insert failure/
    );
    assert.equal(db.getState().users.length, 0);
    assert.equal(db.getState().customers.length, 0);
    assert.equal(db.getState().user_roles.length, 0);
});

test("register fails safely when the CUSTOMER role is not seeded", async () => {
    const db = createFakeDb({ roles: [] });

    await assert.rejects(
        createService(db).register(registrationInput()),
        (error) => error instanceof AppError && error.statusCode === 503
    );
    assert.equal(db.getState().users.length, 0);
});

test("register rejects invalid input and client-provided role fields", async () => {
    const db = createFakeDb();

    await assert.rejects(
        createService(db).register(registrationInput({ full_name: " " })),
        (error) => error instanceof AppError && error.statusCode === 400
    );
    await assert.rejects(
        createService(db).register(registrationInput({ roles: ["ADMIN"] })),
        (error) => error instanceof AppError && error.statusCode === 400
    );
    assert.equal(db.getState().users.length, 0);
});

test("login issues an RS256 token with issuer, audience, expiry, and all assigned roles", async () => {
    const { db } = await createLoginFixture({
        roleCodes: ["CUSTOMER", "TECHNICIAN"]
    });
    const result = await createService(db).login({
        email: "CUSTOMER@example.com",
        password: "correct horse battery"
    });

    const decoded = jwt.decode(result.access_token, { complete: true });
    assert.equal(decoded.header.alg, "RS256");
    assert.deepEqual(decoded.payload.roles, ["CUSTOMER", "TECHNICIAN"]);
    assert.equal(decoded.payload.sub, "user-123");
    assert.equal(decoded.payload.iss, jwtConfig.issuer);
    assert.equal(decoded.payload.aud, jwtConfig.audience);
    assert.equal(decoded.payload.iat, 1_700_000_000);
    assert.equal(decoded.payload.exp, decoded.payload.iat + jwtConfig.expiresIn);
    assert.equal(result.token_type, "Bearer");
    assert.equal(result.expires_in, jwtConfig.expiresIn);
    assert.equal(Object.hasOwn(result.user, "password_hash"), false);

    assert.throws(() => jwt.verify(result.access_token, publicKey, {
        algorithms: ["RS256"],
        issuer: "unexpected-issuer",
        audience: jwtConfig.audience,
        clockTimestamp: decoded.payload.iat
    }));
    assert.throws(() => jwt.verify(result.access_token, publicKey, {
        algorithms: ["RS256"],
        issuer: jwtConfig.issuer,
        audience: "unexpected-audience",
        clockTimestamp: decoded.payload.iat
    }));
});

test("login token expires after the configured lifetime", async () => {
    const { db } = await createLoginFixture();
    const result = await createService(db).login({
        email: "customer@example.com",
        password: "correct horse battery"
    });

    assert.throws(() => jwt.verify(result.access_token, publicKey, {
        algorithms: ["RS256"],
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        clockTimestamp: 1_700_000_000 + jwtConfig.expiresIn + 1
    }), /expired/);
});

test("login rejects incorrect passwords and nonexistent accounts generically", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);

    for (const credentials of [
        { email: "customer@example.com", password: "incorrect password" },
        { email: "missing@example.com", password: "correct horse battery" }
    ]) {
        await assert.rejects(
            auth.login(credentials),
            (error) => error instanceof AppError
                && error.statusCode === 401
                && error.message === "Invalid email or password"
        );
    }
});

test("login rejects DISABLED and LOCKED accounts", async (t) => {
    for (const status of ["DISABLED", "LOCKED"]) {
        await t.test(status, async () => {
            const { db } = await createLoginFixture({ status });

            await assert.rejects(
                createService(db).login({
                    email: "customer@example.com",
                    password: "correct horse battery"
                }),
                (error) => error instanceof AppError
                    && error.statusCode === 401
                    && error.message === "Invalid email or password"
            );
        });
    }
});

test("login rejects accounts without a valid assigned role", async () => {
    const { db } = await createLoginFixture({ roleCodes: [] });

    await assert.rejects(
        createService(db).login({
            email: "customer@example.com",
            password: "correct horse battery"
        }),
        (error) => error instanceof AppError && error.statusCode === 401
    );
});
