const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuthService } = require("../src/services/authService");
const { createUserAdministrationService } = require("../src/services/userAdministrationService");

const userRow = {
    user_id: "user-1",
    email: "customer@example.com",
    phone: "555-0100",
    status: "ACTIVE",
    customer_id: "customer-1",
    full_name: "Example Customer",
    customer_phone: "555-0100",
    customer_email: "customer@example.com",
    customer_type: "REGISTERED",
    password_hash: "sensitive-hash",
    refresh_token: "sensitive-token"
};

function createFakeDb() {
    const queries = [];

    function createQuery(tableName) {
        const query = {
            tableName,
            calls: [],
            mode: "rows",
            requestedUserId: null,
            select(...columns) {
                this.calls.push(["select", ...columns]);
                return this;
            },
            leftJoin(...args) {
                this.calls.push(["leftJoin", ...args]);
                return this;
            },
            join(...args) {
                this.calls.push(["join", ...args]);
                return this;
            },
            where(...args) {
                this.calls.push(["where", ...args]);
                if (args[0] === "u.user_id") {
                    this.requestedUserId = args[1];
                }
                if (typeof args[0] === "function") {
                    args[0].call(this);
                }
                return this;
            },
            orWhere(...args) {
                this.calls.push(["orWhere", ...args]);
                return this;
            },
            whereExists(callback) {
                this.calls.push(["whereExists"]);
                callback.call(this);
                return this;
            },
            whereRaw(...args) {
                this.calls.push(["whereRaw", ...args]);
                return this;
            },
            andWhere(...args) {
                this.calls.push(["andWhere", ...args]);
                return this;
            },
            from(...args) {
                this.calls.push(["from", ...args]);
                return this;
            },
            whereIn(...args) {
                this.calls.push(["whereIn", ...args]);
                return this;
            },
            orderBy(...args) {
                this.calls.push(["orderBy", ...args]);
                return this;
            },
            limit(...args) {
                this.calls.push(["limit", ...args]);
                return this;
            },
            offset(...args) {
                this.calls.push(["offset", ...args]);
                return this;
            },
            clone() {
                return createQuery(tableName);
            },
            clearSelect() {
                return this;
            },
            clearOrder() {
                return this;
            },
            count(...args) {
                this.mode = "count";
                this.calls.push(["count", ...args]);
                return this;
            },
            async first() {
                if (
                    this.tableName.startsWith("users")
                    && this.requestedUserId
                    && this.requestedUserId !== userRow.user_id
                ) {
                    return undefined;
                }
                return this.mode === "count"
                    ? { total: 11 }
                    : { ...userRow };
            },
            then(resolve, reject) {
                const rows = tableName.startsWith("user_roles")
                    ? [{ user_id: "user-1", role_code: "CUSTOMER" }]
                    : [{ ...userRow }];
                return Promise.resolve(rows).then(resolve, reject);
            }
        };
        queries.push(query);
        return query;
    }

    const db = (tableName) => createQuery(tableName);
    db.raw = (sql) => sql;
    db.queries = queries;
    return db;
}

function createMutationDb({
    failOperation,
    initialStatusByUser = {},
    excludeUsers = []
} = {}) {
    let state = {
        users: [
            {
                user_id: "admin-1",
                email: "admin-1@example.com",
                password_hash: "hash",
                phone: null,
                status: "ACTIVE"
            },
            {
                user_id: "admin-2",
                email: "admin-2@example.com",
                password_hash: "hash",
                phone: null,
                status: "ACTIVE"
            },
            {
                user_id: "target-1",
                email: "target-1@example.com",
                password_hash: "hash",
                phone: null,
                status: "ACTIVE"
            },
            {
                user_id: "target-2",
                email: "target-2@example.com",
                password_hash: "hash",
                phone: null,
                status: "ACTIVE"
            }
        ],
        roles: [
            { role_id: "role-admin", role_code: "ADMIN" },
            { role_id: "role-customer", role_code: "CUSTOMER" },
            { role_id: "role-technician", role_code: "TECHNICIAN" }
        ],
        user_roles: [
            { user_id: "admin-1", role_id: "role-admin", assigned_by: null },
            { user_id: "admin-2", role_id: "role-admin", assigned_by: null },
            { user_id: "target-1", role_id: "role-customer", assigned_by: null },
            { user_id: "target-1", role_id: "role-technician", assigned_by: null },
            { user_id: "target-2", role_id: "role-admin", assigned_by: null }
        ],
        user_audit_logs: []
    };
    for (const [userId, status] of Object.entries(initialStatusByUser)) {
        const user = state.users.find((row) => row.user_id === userId);
        if (user) {
            user.status = status;
        }
    }
    state.users = state.users.filter((user) => !excludeUsers.includes(user.user_id));
    state.user_roles = state.user_roles.filter(
        (assignment) => !excludeUsers.includes(assignment.user_id)
    );

    function queryFor(currentState, originalTable) {
        const [tableName, alias] = originalTable.split(/\s+as\s+/i);
        const filters = [];
        const joins = [];
        let countExpression;

        function execute() {
            let rows = currentState[tableName].map((row) => ({
                ...row,
                ...Object.fromEntries(
                    Object.entries(row).map(([key, value]) => [`${alias || tableName}.${key}`, value])
                )
            }));
            for (const join of joins) {
                const [joinTable, joinAlias] = join.table.split(/\s+as\s+/i);
                const [leftAlias, leftColumn] = join.left.split(".");
                const [rightAlias, rightColumn] = join.right.split(".");
                rows = rows.flatMap((row) => currentState[joinTable]
                    .filter((right) => row[`${leftAlias}.${leftColumn}`]
                        === right[rightColumn])
                    .map((right) => ({
                        ...row,
                        ...right,
                        ...Object.fromEntries(
                            Object.entries(right).map(([key, value]) => [
                                `${joinAlias || joinTable}.${key}`,
                                value
                            ])
                        )
                    })));
            }
            return rows.filter((row) => filters.every((filter) => filter(row)));
        }

        const query = {
            select() {
                return this;
            },
            where(criteria, value) {
                if (typeof criteria === "string") {
                    filters.push((row) => row[criteria] === value);
                } else {
                    filters.push((row) => Object.entries(criteria).every(
                        ([key, expected]) => row[key] === expected
                    ));
                }
                return this;
            },
            join(table, left, right) {
                joins.push({ table, left, right });
                return this;
            },
            orderBy() {
                return this;
            },
            forUpdate() {
                return this;
            },
            countDistinct(expression) {
                countExpression = Object.values(expression)[0];
                return this;
            },
            async first() {
                const rows = execute();
                if (countExpression) {
                    return { total: new Set(rows.map((row) => row[countExpression])).size };
                }
                return rows[0];
            },
            async update(values) {
                if (failOperation === "update") {
                    throw new Error("simulated update failure");
                }
                const rows = execute();
                for (const row of rows) {
                    const target = currentState[tableName].find((candidate) => {
                        if (tableName === "users") {
                            return candidate.user_id === row.user_id;
                        }
                        if (tableName === "user_roles") {
                            return candidate.user_id === row.user_id
                                && candidate.role_id === row.role_id;
                        }
                        return candidate.role_id === row.role_id;
                    });
                    Object.assign(target, values);
                }
                return rows.length;
            },
            async insert(row) {
                if (failOperation === "insert") {
                    throw new Error("simulated insert failure");
                }
                if (tableName === "user_roles" && currentState[tableName].some((existing) =>
                    existing.user_id === row.user_id
                    && existing.role_id === row.role_id
                )) {
                    const error = new Error("duplicate role assignment");
                    error.code = "ER_DUP_ENTRY";
                    throw error;
                }
                currentState[tableName].push({ ...row });
            },
            async delete() {
                if (failOperation === "delete") {
                    throw new Error("simulated delete failure");
                }
                const matches = (row) => filters.every((filter) => filter({
                    ...row,
                    ...Object.fromEntries(
                        Object.entries(row).map(([key, value]) => [
                            `${alias || tableName}.${key}`,
                            value
                        ])
                    )
                }));
                const before = currentState[tableName].length;
                currentState[tableName] = currentState[tableName].filter(
                    (row) => !matches(row)
                );
                return before - currentState[tableName].length;
            },
            then(resolve, reject) {
                return Promise.resolve(execute()).then(resolve, reject);
            }
        };
        return query;
    }

    const db = (tableName) => queryFor(state, tableName);
    db.transaction = async (callback) => {
        const transactionState = structuredClone(state);
        const trx = (tableName) => queryFor(transactionState, tableName);
        const result = await callback(trx);
        state = transactionState;
        return result;
    };
    db.getState = () => structuredClone(state);
    return db;
}

test("listUsers validates filters, applies status/role/search and paginates safely", async () => {
    const db = createFakeDb();
    const result = await createUserAdministrationService({ db }).listUsers({
        page: "2",
        page_size: "10",
        search: "customer_%",
        status: "DISABLED",
        role: "TECHNICIAN"
    });

    assert.deepEqual(result.pagination, {
        page: 2,
        page_size: 10,
        total: 11,
        total_pages: 2
    });
    assert.deepEqual(result.items, [{
        user_id: "user-1",
        email: "customer@example.com",
        phone: "555-0100",
        status: "ACTIVE",
        full_name: "Example Customer",
        customer_type: "REGISTERED",
        roles: ["CUSTOMER"]
    }]);
    assert.equal(JSON.stringify(result).includes("password"), false);
    assert.equal(JSON.stringify(result).includes("refresh"), false);

    const calls = db.queries.flatMap((query) => query.calls);
    assert.ok(calls.some((call) =>
        call[0] === "where" && call[1] === "u.status" && call[2] === "DISABLED"
    ));
    assert.ok(calls.some((call) => call[0] === "whereExists"));
    assert.ok(calls.some((call) =>
        call[0] === "andWhere" && call[1] === "r.role_code" && call[2] === "TECHNICIAN"
    ));
    assert.ok(calls.some((call) =>
        call[0] === "where" && call[1] === "u.email" && call[2] === "like"
            && call[3] === "%customer\\_\\%%"
    ));
    for (const column of ["u.phone", "c.phone", "c.full_name"]) {
        assert.ok(calls.some((call) =>
            call[0] === "orWhere" && call[1] === column && call[2] === "like"
        ), `search includes ${column}`);
    }
    assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 10));
    assert.ok(calls.some((call) => call[0] === "offset" && call[1] === 10));
    assert.ok(calls.some((call) =>
        call[0] === "orderBy" && call[1] === "u.email"
    ));
    assert.ok(calls.some((call) =>
        call[0] === "orderBy" && call[1] === "u.user_id"
    ));
});

test("listUsers rejects invalid pagination, status, role, search, and unknown filters", async () => {
    const service = createUserAdministrationService({ db: createFakeDb() });
    const invalidFilters = [
        { page: 0 },
        { page_size: 101 },
        { page_size: 1.5 },
        { status: "PENDING" },
        { role: "SUPERADMIN" },
        { search: "x".repeat(101) },
        { unexpected: "ignored" }
    ];

    for (const filters of invalidFilters) {
        await assert.rejects(
            service.listUsers(filters),
            (error) => error.statusCode === 400
        );
    }
});

test("getUserDetails returns account, customer, and roles without sensitive columns", async () => {
    const service = createUserAdministrationService({ db: createFakeDb() });
    const details = await service.getUserDetails("user-1");

    assert.deepEqual(details, {
        user_id: "user-1",
        email: "customer@example.com",
        phone: "555-0100",
        status: "ACTIVE",
        customer: {
            customer_id: "customer-1",
            full_name: "Example Customer",
            email: "customer@example.com",
            phone: "555-0100",
            customer_type: "REGISTERED"
        },
        roles: ["CUSTOMER"]
    });
    assert.equal(JSON.stringify(details).includes("password"), false);
    assert.equal(JSON.stringify(details).includes("refresh"), false);
    await assert.rejects(
        service.getUserDetails("missing-user"),
        (error) => error.statusCode === 404
    );
});

test("status updates follow approved transitions and are idempotent", async () => {
    const db = createMutationDb();
    const service = createUserAdministrationService({ db });

    assert.deepEqual(await service.updateUserStatus(
        "target-1",
        "admin-1",
        { status: "DISABLED" }
    ), { user_id: "target-1", status: "DISABLED" });
    assert.deepEqual(await service.updateUserStatus(
        "target-1",
        "admin-1",
        { status: "DISABLED" }
    ), { user_id: "target-1", status: "DISABLED" });
    assert.deepEqual(await service.updateUserStatus(
        "target-1",
        "admin-1",
        { status: "ACTIVE" }
    ), { user_id: "target-1", status: "ACTIVE" });

    const lockedDb = createMutationDb({
        initialStatusByUser: { "target-1": "LOCKED" }
    });
    assert.deepEqual(await createUserAdministrationService({ db: lockedDb })
        .updateUserStatus("target-1", "admin-1", { status: "ACTIVE" }), {
        user_id: "target-1",
        status: "ACTIVE"
    });
});

test("disabled status changes are rejected by subsequent login", async () => {
    const db = createMutationDb();
    const administration = createUserAdministrationService({ db });
    await administration.updateUserStatus(
        "target-1",
        "admin-1",
        { status: "DISABLED" }
    );
    assert.equal(
        db.getState().users.find((user) => user.user_id === "target-1").status,
        "DISABLED"
    );
    assert.equal(db.getState().user_audit_logs[0].action, "ADMIN.USER_STATUS_CHANGED");

    const auth = createAuthService({
        db,
        jwtConfig: {
            privateKey: "unused-for-disabled-login",
            issuer: "test",
            audience: "test",
            expiresIn: 60,
            refreshExpiresIn: 3600
        },
        bcryptImplementation: { async compare() { return true; } }
    });
    await assert.rejects(
        auth.login({
            email: "target-1@example.com",
            password: "correct password"
        }),
        (error) => error.statusCode === 401
    );
});

test("status update rejects LOCKED assignment, invalid transitions, self-change, and last active ADMIN", async () => {
    const db = createMutationDb();
    const service = createUserAdministrationService({ db });

    await assert.rejects(
        service.updateUserStatus("target-1", "admin-1", { status: "LOCKED" }),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.updateUserStatus("admin-1", "admin-1", { status: "DISABLED" }),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        createUserAdministrationService({
            db: createMutationDb({ initialStatusByUser: { "target-1": "PENDING" } })
        }).updateUserStatus("target-1", "admin-1", { status: "ACTIVE" }),
        (error) => error.statusCode === 409
    );

    const lastAdminDb = createMutationDb({
        excludeUsers: ["admin-2", "target-2"]
    });
    const serviceForLastAdmin = createUserAdministrationService({ db: lastAdminDb });
    await assert.rejects(
        serviceForLastAdmin.updateUserStatus(
            "admin-1",
            "target-1",
            { status: "DISABLED" }
        ),
        (error) => error.statusCode === 409
    );
    assert.equal(
        lastAdminDb.getState().users.find((user) => user.user_id === "admin-1").status,
        "ACTIVE"
    );
});

test("role assignment records actor and validates roles, duplicates, and self changes", async () => {
    const db = createMutationDb();
    const service = createUserAdministrationService({ db });

    await assert.rejects(
        service.assignRole("target-1", "admin-1", { role_code: "TECHNICIAN" }),
        (error) => error.statusCode === 409
    );
    assert.deepEqual(await service.assignRole(
        "target-2",
        "admin-1",
        { role_code: "CUSTOMER" }
    ), { user_id: "target-2", role_code: "CUSTOMER" });
    assert.deepEqual(await service.assignRole(
        "target-2",
        "admin-1",
        { role_code: "TECHNICIAN" }
    ), { user_id: "target-2", role_code: "TECHNICIAN" });
    assert.ok(db.getState().user_audit_logs.some((event) =>
        event.action === "ADMIN.USER_ROLE_ASSIGNED"
    ));
    for (const roleId of ["role-customer", "role-technician"]) {
        assert.ok(db.getState().user_roles.some((assignment) =>
            assignment.user_id === "target-2"
            && assignment.role_id === roleId
            && assignment.assigned_by === "admin-1"
        ));
    }

    for (const roleCode of ["ADMIN", "INVALID"]) {
        await assert.rejects(
            service.assignRole("target-2", "admin-1", { role_code: roleCode }),
            (error) => error.statusCode === 400
        );
    }
    await assert.rejects(
        service.assignRole("admin-1", "admin-1", { role_code: "CUSTOMER" }),
        (error) => error.statusCode === 403
    );
});

test("role removal protects the final role and rejects self/admin role changes", async () => {
    const db = createMutationDb();
    const service = createUserAdministrationService({ db });

    await service.assignRole("target-2", "admin-1", { role_code: "CUSTOMER" });
    await service.assignRole("target-2", "admin-1", { role_code: "TECHNICIAN" });
    assert.deepEqual(await service.removeRole(
        "target-2",
        "admin-1",
        "TECHNICIAN"
    ), { user_id: "target-2", role_code: "TECHNICIAN" });
    assert.ok(db.getState().user_audit_logs.some((event) =>
        event.action === "ADMIN.USER_ROLE_REMOVED"
    ));
    assert.deepEqual(await service.removeRole(
        "target-2",
        "admin-1",
        "CUSTOMER"
    ), { user_id: "target-2", role_code: "CUSTOMER" });

    assert.deepEqual(await service.removeRole(
        "target-1",
        "admin-1",
        "CUSTOMER"
    ), { user_id: "target-1", role_code: "CUSTOMER" });
    assert.ok(db.getState().user_roles.some((row) =>
        row.user_id === "target-1" && row.role_id === "role-technician"
    ));

    await assert.rejects(
        service.removeRole("target-1", "admin-1", "TECHNICIAN"),
        (error) => error.statusCode === 409
    );
    await assert.rejects(
        service.removeRole("admin-1", "admin-1", "ADMIN"),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.removeRole("target-2", "admin-1", "ADMIN"),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.removeRole("target-2", "target-2", "TECHNICIAN"),
        (error) => error.statusCode === 403
    );
});

test("status and role mutations roll back on database failure", async () => {
    const statusDb = createMutationDb({ failOperation: "update" });
    const beforeStatus = statusDb.getState();
    await assert.rejects(
        createUserAdministrationService({ db: statusDb })
            .updateUserStatus("target-1", "admin-1", { status: "DISABLED" }),
        (error) => error.statusCode === 503
    );
    assert.deepEqual(statusDb.getState(), beforeStatus);

    const roleDb = createMutationDb({ failOperation: "insert" });
    const beforeRoles = roleDb.getState();
    await assert.rejects(
        createUserAdministrationService({ db: roleDb })
            .assignRole("target-2", "admin-1", { role_code: "CUSTOMER" }),
        (error) => error.statusCode === 503
    );
    assert.deepEqual(roleDb.getState(), beforeRoles);
});

test("rejected admin mutations are audited as failures; invalid input is not", async () => {
    const db = createMutationDb({ excludeUsers: ["admin-2", "target-2"] });
    const service = createUserAdministrationService({ db });
    const failures = [
        [() => service.updateUserStatus("admin-1", "target-1", { status: "DISABLED" }, "adm:1"),
            409, "ADMIN.USER_STATUS_CHANGED", "target-1", "admin-1",
            { to_status: "DISABLED" }, "Cannot disable the last active administrator"],
        [() => service.updateUserStatus("admin-1", "admin-1", { status: "DISABLED" }, "adm:2"),
            403, "ADMIN.USER_STATUS_CHANGED", "admin-1", "admin-1",
            { to_status: "DISABLED" }, "Administrators cannot change their own status"],
        [() => service.updateUserStatus("missing", "admin-1", { status: "DISABLED" }, "adm:3"),
            404, "ADMIN.USER_STATUS_CHANGED", "admin-1", "missing",
            { to_status: "DISABLED" }, "User not found"],
        [() => service.assignRole("target-1", "admin-1", { role_code: "TECHNICIAN" }, "adm:4"),
            409, "ADMIN.USER_ROLE_ASSIGNED", "admin-1", "target-1",
            { role_code: "TECHNICIAN" }, "User already has this role"],
        [() => service.removeRole("target-1", "admin-1", "CUSTOMER", "adm:5"),
            200, null],
        [() => service.removeRole("target-1", "admin-1", "TECHNICIAN", "adm:6"),
            409, "ADMIN.USER_ROLE_REMOVED", "admin-1", "target-1",
            { role_code: "TECHNICIAN" }, "Cannot remove the user's final role"]
    ];

    for (const [run, status, action, actor, target, metadata, reason] of failures) {
        const before = db.getState().user_audit_logs.length;
        if (status === 200) {
            await run();
            continue;
        }
        await assert.rejects(run(), (error) => error.statusCode === status);
        const audits = db.getState().user_audit_logs;
        assert.equal(audits.length, before + 1, `${action} ${status} must be audited`);
        const event = audits.at(-1);
        assert.equal(event.action, action);
        assert.equal(event.actor_user_id, actor);
        assert.equal(event.resource_type, "user");
        assert.equal(event.resource_id, target);
        assert.equal(event.reason, reason);
        assert.deepEqual(event.metadata, {
            ...metadata,
            outcome: "FAILURE",
            request_id: event.metadata.request_id
        });
        assert.match(event.metadata.request_id, /^adm:\d$/);
    }

    const beforeInvalid = db.getState().user_audit_logs.length;
    await assert.rejects(
        service.updateUserStatus("target-1", "admin-1", { status: "LOCKED" }),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.assignRole("target-1", "admin-1", { role_code: "ADMIN" }),
        (error) => error.statusCode === 400
    );
    assert.equal(db.getState().user_audit_logs.length, beforeInvalid);
});

test("an admin failure whose audit cannot be stored fails closed with 503", async () => {
    const db = createMutationDb({ failOperation: "insert" });
    await assert.rejects(
        createUserAdministrationService({ db })
            .updateUserStatus("admin-1", "admin-1", { status: "DISABLED" }),
        (error) => error.statusCode === 503
    );
});
