const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, randomUUID } = require("node:crypto");
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
    expiresIn: 60,
    refreshExpiresIn: 3600
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
        refresh_token_sessions: [],
        user_audit_logs: [],
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
            filters: [],
            joinDetails: null,
            sortColumn: null,
            select() {
                return this;
            },
            where(criteria) {
                if (typeof criteria === "string") {
                    const [, column, operator, value] = arguments;
                    this.filters.push((row) => {
                        const actual = row[column.split(".").pop()];
                        if (operator === "<=") {
                            return new Date(actual).getTime() <= new Date(value).getTime();
                        }
                        if (operator === ">") {
                            return new Date(actual).getTime() > new Date(value).getTime();
                        }
                        return actual === value;
                    });
                } else {
                    this.filters.push((row) => matches(row, criteria));
                }
                return this;
            },
            whereNull(column) {
                this.filters.push((row) => row[column.split(".").pop()] === null);
                return this;
            },
            whereNotNull(column) {
                this.filters.push((row) => row[column.split(".").pop()] !== null);
                return this;
            },
            forUpdate() {
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
                    tableName === "user_audit_logs"
                    && (options.failAuditInsert === true
                        || (typeof options.failAuditInsert === "function"
                            && options.failAuditInsert(row)))
                ) {
                    throw new Error("simulated audit insert failure");
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
            async update(values) {
                const rows = await this.execute();
                for (const row of rows) {
                    Object.assign(row, values);
                }
                return rows.length;
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

                rows = rows.filter((row) => this.filters.every((filter) => filter(row)));
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

    let transactionTail = Promise.resolve();
    db.transaction = async (callback) => {
        const previousTransaction = transactionTail;
        let releaseTransaction;
        transactionTail = new Promise((resolve) => {
            releaseTransaction = resolve;
        });
        await previousTransaction;
        try {
            const transactionState = cloneState(state);
            const transaction = (tableName) => queryFor(transactionState, tableName);
            const result = await callback(transaction);
            state = transactionState;
            return result;
        } finally {
            releaseTransaction();
        }
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
    assert.equal(state.user_audit_logs.length, 1);
    assert.equal(state.user_audit_logs[0].action, "USER.REGISTERED");
    assert.equal(state.user_audit_logs[0].actor_user_id, state.users[0].user_id);
    assert.equal(state.user_audit_logs[0].resource_type, "user");
    assert.equal(state.user_audit_logs[0].resource_id, state.users[0].user_id);
    assert.deepEqual(state.user_audit_logs[0].metadata, {
        role_codes: ["CUSTOMER"],
        outcome: "SUCCESS",
        request_id: null
    });
    assert.equal(JSON.stringify(state.user_audit_logs).includes("correct horse battery"), false);
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
        (error) => error instanceof AppError && error.statusCode === 503
    );
    assert.equal(db.getState().users.length, 0);
    assert.equal(db.getState().customers.length, 0);
    assert.equal(db.getState().user_roles.length, 0);
});

test("registration rolls back when its audit event cannot be persisted", async () => {
    const db = createFakeDb({}, { failAuditInsert: true });

    await assert.rejects(
        createService(db).register(registrationInput()),
        (error) => error instanceof AppError && error.statusCode === 503
    );
    assert.equal(db.getState().users.length, 0);
    assert.equal(db.getState().customers.length, 0);
    assert.equal(db.getState().user_roles.length, 0);
    assert.equal(db.getState().user_audit_logs.length, 0);
});

test("duplicate registration is audited as a failure without account details", async () => {
    const db = createFakeDb({
        users: [{
            user_id: "existing",
            email: "customer@example.com",
            password_hash: "not-returned",
            status: "ACTIVE"
        }]
    });

    await assert.rejects(
        createService(db).register(registrationInput(), "register:dup-1"),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    const audits = db.getState().user_audit_logs;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "USER.REGISTERED");
    assert.equal(audits[0].actor_user_id, null);
    assert.equal(audits[0].resource_type, "user");
    assert.equal(audits[0].resource_id, null);
    assert.equal(audits[0].reason, "DUPLICATE_EMAIL");
    assert.deepEqual(audits[0].metadata, {
        outcome: "FAILURE",
        request_id: "register:dup-1"
    });
    assert.equal(JSON.stringify(audits).includes("customer@example.com"), false);
    assert.equal(JSON.stringify(audits).includes("correct horse battery"), false);
});

test("duplicate registration fails closed when its failure audit cannot be stored", async () => {
    const db = createFakeDb({
        users: [{
            user_id: "existing",
            email: "customer@example.com",
            password_hash: "not-returned",
            status: "ACTIVE"
        }]
    }, { failAuditInsert: true });

    await assert.rejects(
        createService(db).register(registrationInput()),
        (error) => error instanceof AppError && error.statusCode === 503
    );
    assert.equal(db.getState().users.length, 1);
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

test("login issues and verifies an RS256 token with issuer, audience, expiry, and all assigned roles", async () => {
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
    assert.equal(decoded.payload.token_use, "user_access");
    assert.equal(decoded.payload.sub, "user-123");
    assert.equal(decoded.payload.iss, jwtConfig.issuer);
    assert.equal(decoded.payload.aud, jwtConfig.audience);
    assert.equal(decoded.payload.iat, 1_700_000_000);
    assert.equal(decoded.payload.exp, decoded.payload.iat + jwtConfig.expiresIn);
    assert.equal(result.token_type, "Bearer");
    assert.equal(result.expires_in, jwtConfig.expiresIn);
    assert.equal(result.refresh_expires_in, jwtConfig.refreshExpiresIn);
    assert.equal(result.refresh_token.length, 43);
    const storedToken = db.getState().refresh_token_sessions[0];
    assert.equal(storedToken.token_hash, createHash("sha256")
        .update(result.refresh_token, "utf8")
        .digest("hex"));
    assert.notEqual(storedToken.token_hash, result.refresh_token);
    assert.equal(storedToken.user_id, "user-123");
    assert.equal(storedToken.revoked_at, null);
    assert.equal(db.getState().user_audit_logs[0].action, "AUTH.LOGIN");
    assert.equal(db.getState().user_audit_logs[0].metadata.outcome, "SUCCESS");
    assert.equal(Object.hasOwn(result.user, "password_hash"), false);
    assert.equal(createService(db).verifyAccessToken(result.access_token).sub, "user-123");
    const legacyToken = jwt.sign(
        { roles: ["CUSTOMER"], iat: 1_700_000_000 },
        privateKey,
        {
            algorithm: "RS256",
            subject: "legacy-user",
            issuer: jwtConfig.issuer,
            audience: jwtConfig.audience,
            expiresIn: 60
        }
    );
    assert.equal(createService(db).verifyAccessToken(legacyToken).sub, "legacy-user");

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
    assert.throws(() => createService(db).verifyAccessToken(jwt.sign(
        { roles: ["CUSTOMER"] },
        "not-the-private-key",
        { algorithm: "HS256" }
    )), (error) => error.statusCode === 401);
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
    assert.equal(db.getState().user_audit_logs.length, 2);
    assert.ok(db.getState().user_audit_logs.every((event) =>
        event.action === "AUTH.LOGIN" && event.metadata.outcome === "FAILURE"
    ));
    assert.equal(JSON.stringify(db.getState().user_audit_logs).includes("incorrect password"), false);
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

test("login creates a new token family and a unique session for each login", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);
    const firstLogin = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });
    const secondLogin = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });

    const rows = db.getState().refresh_token_sessions;
    const firstStored = rows.find((row) => row.token_hash === createHash("sha256")
        .update(firstLogin.refresh_token, "utf8")
        .digest("hex"));
    const secondStored = rows.find((row) => row.token_hash === createHash("sha256")
        .update(secondLogin.refresh_token, "utf8")
        .digest("hex"));

    assert.notEqual(firstStored.token_family_id, secondStored.token_family_id);
    assert.notEqual(firstStored.session_id, secondStored.session_id);
    assert.equal(firstStored.user_id, secondStored.user_id);
    assert.notEqual(firstStored.token_hash, firstLogin.refresh_token);
    assert.equal(firstStored.token_hash, createHash("sha256")
        .update(firstLogin.refresh_token, "utf8")
        .digest("hex"));
});

test("refresh creates a new session in the same family and links the old token", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);
    const login = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });

    const refreshed = await auth.refresh({ refresh_token: login.refresh_token });
    const rows = db.getState().refresh_token_sessions;
    const previous = rows.find((row) => row.token_hash === createHash("sha256")
        .update(login.refresh_token, "utf8")
        .digest("hex"));
    const replacement = rows.find((row) => row.token_hash === createHash("sha256")
        .update(refreshed.refresh_token, "utf8")
        .digest("hex"));

    assert.ok(previous.revoked_at instanceof Date);
    assert.notEqual(replacement.session_id, previous.session_id);
    assert.equal(previous.replaced_by_token_id, replacement.session_id);
    assert.equal(replacement.token_family_id, previous.token_family_id);
    assert.equal(replacement.revoked_at, null);
    assert.notEqual(replacement.token_hash, refreshed.refresh_token);
    assert.ok(db.getState().user_audit_logs.some((event) =>
        event.action === "AUTH.REFRESH_ROTATED"
    ));
    assert.equal(refreshed.user.user_id, login.user.user_id);
    assert.equal(refreshed.roles[0], "CUSTOMER");
    assert.equal(auth.verifyAccessToken(refreshed.access_token).sub, "user-123");

    const nextRotation = await auth.refresh({ refresh_token: refreshed.refresh_token });
    assert.notEqual(nextRotation.refresh_token, refreshed.refresh_token);
});

test("refresh audit failure rolls back the replacement and old-token revocation", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);
    const login = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });
    const failingAuth = createService(db, {
        auditLog: {
            record: async (trx, event) => {
                if (event.action === "AUTH.REFRESH_ROTATED") {
                    await trx("user_audit_logs").insert({
                        audit_id: randomUUID(),
                        actor_user_id: event.actor_user_id,
                        action: event.action,
                        resource_type: event.target_entity_type,
                        resource_id: event.target_entity_id,
                        reason: null,
                        metadata: null
                    });
                    throw new Error("simulated audit failure");
                }
            }
        }
    });

    await assert.rejects(
        failingAuth.refresh({ refresh_token: login.refresh_token }),
        (error) => error instanceof AppError && error.statusCode === 503
    );

    const rows = db.getState().refresh_token_sessions;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_at, null);
    assert.equal(rows[0].replaced_by_token_id, null);
    const refreshed = await auth.refresh({ refresh_token: login.refresh_token });
    assert.notEqual(refreshed.refresh_token, login.refresh_token);
});

test("refresh-token reuse revokes only the affected family", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);
    const firstLogin = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });
    const otherDeviceLogin = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });
    const rotated = await auth.refresh({ refresh_token: firstLogin.refresh_token });

    await assert.rejects(
        auth.refresh({ refresh_token: firstLogin.refresh_token }),
        (error) => error instanceof AppError
            && error.statusCode === 401
            && error.message === "Invalid or expired refresh token"
    );

    const rows = db.getState().refresh_token_sessions;
    const affectedFamily = rows.filter(
        (row) => row.token_family_id === rows[0].token_family_id
    );
    const otherFamily = rows.filter(
        (row) => row.token_family_id !== rows[0].token_family_id
    );
    assert.ok(affectedFamily.every((row) => row.revoked_at instanceof Date));
    assert.ok(otherFamily.every((row) => row.revoked_at === null));
    assert.ok(db.getState().user_audit_logs.some((event) =>
        event.action === "AUTH.REFRESH_REUSE_DETECTED"
    ));
    assert.notEqual(rotated.refresh_token, firstLogin.refresh_token);
    const otherDeviceRotation = await auth.refresh({
        refresh_token: otherDeviceLogin.refresh_token
    });
    assert.notEqual(otherDeviceRotation.refresh_token, otherDeviceLogin.refresh_token);
});

test.todo("Concurrent refresh retry behavior remains pending approval");

test("logout revokes only the current device family and is idempotent", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);
    const currentDeviceLogin = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });
    const otherDeviceLogin = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });
    const currentDeviceRotated = await auth.refresh({
        refresh_token: currentDeviceLogin.refresh_token
    });

    assert.deepEqual(await auth.logout({
        refresh_token: currentDeviceLogin.refresh_token
    }), {
        revoked: true
    });
    assert.deepEqual(await auth.logout({
        refresh_token: currentDeviceLogin.refresh_token
    }), {
        revoked: false
    });
    assert.deepEqual(await auth.logout({ refresh_token: "unknown-refresh-token" }), {
        revoked: false
    });
    const rows = db.getState().refresh_token_sessions;
    const currentDeviceRows = rows.filter((row) =>
        row.token_family_id === rows[0].token_family_id
    );
    const otherDeviceRows = rows.filter((row) =>
        row.token_family_id !== rows[0].token_family_id
    );
    assert.ok(currentDeviceRows.every((row) => row.revoked_at instanceof Date));
    assert.ok(otherDeviceRows.every((row) => row.revoked_at === null));
    assert.equal(db.getState().user_audit_logs.filter((event) =>
        event.action === "AUTH.LOGOUT"
    ).length, 3);
    await assert.rejects(
        auth.refresh({ refresh_token: currentDeviceRotated.refresh_token }),
        (error) => error.statusCode === 401
    );
    const otherDeviceRotated = await auth.refresh({
        refresh_token: otherDeviceLogin.refresh_token
    });
    assert.notEqual(otherDeviceRotated.refresh_token, otherDeviceLogin.refresh_token);
    await assert.rejects(
        auth.logout({}),
        (error) => error.statusCode === 400
    );
});

test("expired refresh token is rejected and its session is revoked", async () => {
    const { db } = await createLoginFixture();
    let clock = 1_700_000_000_000;
    const auth = createService(db, { now: () => clock });
    const login = await auth.login({
        email: "customer@example.com",
        password: "correct horse battery"
    });

    clock += jwtConfig.refreshExpiresIn * 1000 + 1;
    await assert.rejects(
        auth.refresh({ refresh_token: login.refresh_token }),
        (error) => error.statusCode === 401
    );
    assert.ok(db.getState().refresh_token_sessions[0].revoked_at instanceof Date);
});

test("access token verification rejects incorrect issuer, audience, and required claims", async () => {
    const { db } = await createLoginFixture();
    const auth = createService(db);
    const invalidTokens = [
        jwt.sign(
            { roles: ["CUSTOMER"] },
            privateKey,
            {
                algorithm: "RS256",
                subject: "user-123",
                issuer: "wrong-issuer",
                audience: jwtConfig.audience,
                expiresIn: 60
            }
        ),
        jwt.sign(
            { roles: ["CUSTOMER"] },
            privateKey,
            {
                algorithm: "RS256",
                subject: "user-123",
                issuer: jwtConfig.issuer,
                audience: "wrong-audience",
                expiresIn: 60
            }
        ),
        jwt.sign(
            { roles: [] },
            privateKey,
            {
                algorithm: "RS256",
                subject: "user-123",
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience,
                expiresIn: 60
            }
        ),
        jwt.sign(
            { roles: ["CUSTOMER"], token_use: "internal_service" },
            privateKey,
            {
                algorithm: "RS256",
                subject: "service-user",
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience,
                expiresIn: 60
            }
        )
    ];

    for (const token of invalidTokens) {
        assert.throws(
            () => auth.verifyAccessToken(token),
            (error) => error.statusCode === 401
        );
    }

    const expiredToken = jwt.sign(
        { roles: ["CUSTOMER"], iat: 1_700_000_000 },
        privateKey,
        {
            algorithm: "RS256",
            subject: "user-123",
            issuer: jwtConfig.issuer,
            audience: jwtConfig.audience,
            expiresIn: -1
        }
    );
    assert.throws(
        () => auth.verifyAccessToken(expiredToken),
        (error) => error.statusCode === 401
    );
});
