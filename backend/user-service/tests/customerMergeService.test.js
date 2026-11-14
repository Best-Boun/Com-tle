const assert = require("node:assert/strict");
const test = require("node:test");
const AppError = require("../../shared/errors/AppError");
const {
    createCustomerMergeService
} = require("../src/services/customerMergeService");

const now = new Date("2026-11-14T00:00:00.000Z");
const BIG_VERSION = "9007199254740993";

function createFakeDb({
    state,
    initialNow = now,
    uppercaseReturnedCustomerIds = false,
    beforeTransaction
} = {}) {
    let data = state || {
        users: [
            { user_id: "admin-1", status: "ACTIVE" },
            { user_id: "admin-2", status: "ACTIVE" },
            { user_id: "source-user", status: "ACTIVE" },
            { user_id: "target-user", status: "ACTIVE" }
        ],
        roles: [
            { role_id: "role-admin", role_code: "ADMIN" },
            { role_id: "role-customer", role_code: "CUSTOMER" }
        ],
        permissions: [
            { permission_id: "permission-request", permission_code: "customer.merge.request" },
            { permission_id: "permission-approve", permission_code: "customer.merge.approve" }
        ],
        user_roles: [
            { user_id: "admin-1", role_id: "role-admin" },
            { user_id: "admin-2", role_id: "role-admin" },
            { user_id: "admin-1", role_id: "role-customer" },
            { user_id: "admin-2", role_id: "role-customer" }
        ],
        role_permissions: [
            { role_id: "role-admin", permission_id: "permission-approve" },
            { role_id: "role-admin", permission_id: "permission-request" }
        ],
        customers: [
            {
                customer_id: "customer-source",
                user_id: "source-user",
                customer_type: "REGISTERED",
                merged_into_customer_id: null,
                row_version: BIG_VERSION,
                row_version_text: BIG_VERSION
            },
            {
                customer_id: "customer-target",
                user_id: "target-user",
                customer_type: "REGISTERED",
                merged_into_customer_id: null,
                row_version: "12",
                row_version_text: "12"
            }
        ],
        customer_merge_requests: [],
        customer_merge_reservations: [],
        customer_merge_history: [],
        user_audit_logs: []
    };
    let databaseNow = new Date(initialNow);
    let transactionCount = 0;
    const lockSequence = [];

    function raw(sql) {
        if (sql === "SELECT UTC_TIMESTAMP(3) AS db_now") {
            return Promise.resolve([[{ db_now: new Date(databaseNow) }], []]);
        }
        return { __raw: sql };
    }

    function matches(row, criteria, table) {
        return Object.entries(criteria).every(([key, value]) => {
            if (table === "customers"
                && key.endsWith("_customer_id")
                && typeof row[key] === "string"
                && typeof value === "string") {
                return row[key].toLowerCase() === value.toLowerCase();
            }
            return row[key] === value;
        });
    }

    class Query {
        constructor(current, table, inTransaction = false) {
            this.current = current;
            this.table = table;
            this.inTransaction = inTransaction;
            this.filters = [];
            this.inFilters = [];
            this.rawFilters = [];
        }

        select() { return this; }
        forUpdate() {
            lockSequence.push({
                table: this.table,
                filters: structuredClone(this.filters),
                inFilters: structuredClone(this.inFilters),
                inTransaction: this.inTransaction
            });
            return this;
        }
        orderBy() { return this; }

        where(criteria, operator, value) {
            if (typeof criteria === "string") {
                this.rawFilters.push({ column: criteria, operator, value });
            } else {
                this.filters.push(criteria);
            }
            return this;
        }

        whereIn(column, values) {
            this.inFilters.push({ column, values });
            return this;
        }

        _returned(row) {
            if (row && this.table === "customers" && uppercaseReturnedCustomerIds) {
                return { ...row, customer_id: row.customer_id.toUpperCase() };
            }
            return row;
        }

        _rows() {
            return this.current[this.table].filter((row) =>
                this.filters.every((criteria) => matches(row, criteria, this.table))
                && this.inFilters.every(({ column, values }) =>
                    values.some((value) => this.table === "customers"
                        && column === "customer_id"
                        && typeof row[column] === "string"
                        && typeof value === "string"
                        ? row[column].toLowerCase() === value.toLowerCase()
                        : row[column] === value))
                && this.rawFilters.every(({ column, operator, value }) => {
                    if (value?.__raw === "UTC_TIMESTAMP(3)") {
                        const expiresAt = new Date(row[column]).getTime();
                        const currentTime = databaseNow.getTime();
                        return operator === ">"
                            ? expiresAt > currentTime
                            : expiresAt <= currentTime;
                    }
                    return true;
                })
            );
        }

        async first() {
            return this._returned(this._rows()[0]) || undefined;
        }

        async insert(values) {
            const rows = Array.isArray(values) ? values : [values];
            for (const input of rows) {
                const row = { ...input };
                if (this.table === "customer_merge_requests") {
                    const duplicate = this.current.customer_merge_requests.some((existing) =>
                        existing.request_id === row.request_id
                        || (existing.initiated_by_user_id === row.initiated_by_user_id
                            && existing.idempotency_key === row.idempotency_key)
                    );
                    if (duplicate) {
                        throw Object.assign(new Error("Duplicate entry"), {
                            code: "ER_DUP_ENTRY",
                            errno: 1062
                        });
                    }
                    row.created_at = new Date(databaseNow);
                    row.expires_at = new Date(databaseNow.getTime() + 24 * 60 * 60 * 1000);
                    row.decided_at = null;
                    row.decided_by_user_id = null;
                    row.decision_reason = null;
                    row.verification_reference = null;
                    row.history_id = null;
                    row.decision_audit_id = null;
                    row.source_version_text = row.source_version;
                    row.target_version_text = row.target_version;
                }
                if (this.table === "customer_merge_reservations"
                    && this.current.customer_merge_reservations.some(
                        (existing) => existing.customer_id === row.customer_id
                    )) {
                    throw Object.assign(new Error("Duplicate reservation"), {
                        code: "ER_DUP_ENTRY",
                        errno: 1062
                    });
                }
                this.current[this.table].push(row);
            }
            return rows.length;
        }

        async update(values) {
            const rows = this._rows();
            for (const row of rows) {
                for (const [key, value] of Object.entries(values)) {
                    if (value?.__raw === "UTC_TIMESTAMP(3)") {
                        row[key] = new Date(databaseNow);
                    } else {
                        row[key] = value;
                    }
                }
                if (this.table === "customer_merge_requests") {
                    row.decided_at = new Date(databaseNow);
                }
                if (this.table === "customers") {
                    row.row_version = (BigInt(row.row_version) + 1n).toString();
                    row.row_version_text = row.row_version;
                }
            }
            return rows.length;
        }

        async del() {
            const rows = this._rows();
            this.current[this.table] = this.current[this.table].filter((row) =>
                !rows.includes(row)
            );
            return rows.length;
        }

        then(resolve, reject) {
            return Promise.resolve(this._rows().map((row) => this._returned(row)))
                .then(resolve, reject);
        }
    }

    function makeKnex() {
        const knex = (table) => new Query(data, table);
        knex.raw = raw;
        knex.transaction = async (callback) => {
            transactionCount += 1;
            if (beforeTransaction) {
                beforeTransaction(data, transactionCount);
            }
            const transactionState = structuredClone(data);
            const trx = (table) => new Query(transactionState, table, true);
            trx.raw = raw;
            const result = await callback(trx);
            data = transactionState;
            return result;
        };
        return knex;
    }

    const db = makeKnex();
    db.getState = () => structuredClone(data);
    db.setNow = (value) => { databaseNow = new Date(value); };
    db.getTransactionCount = () => transactionCount;
    db.getLockSequence = () => [...lockSequence];
    db.clearLockSequence = () => { lockSequence.length = 0; };
    return db;
}

function createService(db, ids = ["merge-request-1", "history-1"]) {
    let auditSequence = 0;
    return createCustomerMergeService({
        db,
        createId: () => ids.shift() || `generated-${Math.random()}`,
        auditLog: {
            async record(trx, event) {
                auditSequence += 1;
                const auditId = `audit-${auditSequence}`;
                await trx("user_audit_logs").insert({
                    audit_id: auditId,
                    actor_user_id: event.actor_user_id,
                    action: event.action,
                    resource_type: event.target_entity_type,
                    resource_id: event.target_entity_id,
                    reason: event.metadata?.reason || null,
                    outcome: event.outcome,
                    metadata: event.metadata
                });
                return auditId;
            }
        }
    });
}

const initiateInput = {
    source_customer_id: "customer-source",
    target_customer_id: "customer-target",
    merge_reason: "Duplicate account",
    idempotency_key: "merge-key-1"
};

test("initiation validates strict input and disallows self-merge", async () => {
    const service = createService(createFakeDb());
    await assert.rejects(
        service.initiate("admin-1", { ...initiateInput, actor_id: "admin-2" }),
        (error) => error instanceof AppError && error.statusCode === 400
    );
    await assert.rejects(
        service.initiate("admin-1", {
            ...initiateInput,
            target_customer_id: "customer-source"
        }),
        (error) => error instanceof AppError && error.statusCode === 400
    );
    for (const customerType of ["GUEST", "MERGED"]) {
        const state = createFakeDb().getState();
        const source = state.customers.find((row) =>
            row.customer_id === "customer-source");
        source.customer_type = customerType;
        source.user_id = customerType === "GUEST" ? null : "source-user";
        source.merged_into_customer_id = customerType === "MERGED"
            ? "customer-target"
            : null;
        await assert.rejects(
            createService(createFakeDb({ state })).initiate("admin-1", initiateInput),
            (error) => error instanceof AppError && error.statusCode === 409
        );
    }
    await assert.rejects(
        service.approve("admin-2", "merge-request-1", {
            verification_reference: "verified",
            verified_by_user_id: "admin-3"
        }),
        (error) => error instanceof AppError && error.statusCode === 400
    );
});

test("initiation snapshots exact versions, reserves both customers, and resolves idempotency", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const first = await service.initiate("admin-1", initiateInput, "request-correlation");
    const repeated = await service.initiate("admin-1", initiateInput, "request-correlation");
    const state = db.getState();

    assert.equal(first.request_id, "merge-request-1");
    assert.equal(first.status, "PENDING");
    assert.equal(repeated.request_id, first.request_id);
    assert.equal(state.customer_merge_requests.length, 1);
    assert.equal(state.customer_merge_requests[0].source_version, BIG_VERSION);
    assert.equal(state.customer_merge_requests[0].target_version, "12");
    assert.equal(
        state.customer_merge_requests[0].expires_at.getTime()
            - state.customer_merge_requests[0].created_at.getTime(),
        24 * 60 * 60 * 1000
    );
    assert.deepEqual(
        state.customer_merge_reservations.map(({ customer_id, participant }) =>
            [customer_id, participant]),
        [
            ["customer-source", "SOURCE"],
            ["customer-target", "TARGET"]
        ]
    );
    assert.equal(state.user_audit_logs.length, 1);
    assert.equal(state.customer_merge_requests[0].initiated_audit_id, "audit-1");
    assert.equal(
        state.user_audit_logs[0].metadata.merge_request_id,
        "merge-request-1"
    );
    await assert.rejects(
        service.initiate("admin-1", {
            ...initiateInput,
            idempotency_key: "merge-key-2"
        }),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    assert.equal(db.getState().customer_merge_requests.length, 1);
    // +1: the rejected (409) initiation is audited as a FAILURE.
    assert.equal(db.getState().user_audit_logs.length, 2);
    await assert.rejects(
        service.initiate("admin-1", {
            ...initiateInput,
            merge_reason: "different reason"
        }),
        (error) => error instanceof AppError && error.statusCode === 409
    );
});

test("a stale empty idempotency hint replays the committed matching request", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const first = await service.initiate("admin-1", initiateInput);
    let hideHint = true;
    const staleDb = (table) => {
        if (table === "customer_merge_requests" && hideHint) {
            return {
                select() { return this; },
                where() { return this; },
                async first() {
                    hideHint = false;
                    return undefined;
                }
            };
        }
        return db(table);
    };
    staleDb.raw = db.raw;
    staleDb.transaction = db.transaction;

    const replay = await createService(staleDb).initiate("admin-1", initiateInput);
    assert.equal(replay.request_id, first.request_id);
    assert.equal(db.getState().customer_merge_requests.length, 1);
    assert.equal(db.getState().customer_merge_reservations.length, 2);
    assert.equal(db.getState().user_audit_logs.length, 1);

    hideHint = true;
    await assert.rejects(
        createService(staleDb).initiate("admin-1", {
            ...initiateInput,
            merge_reason: "changed"
        }),
        (error) => error instanceof AppError && error.statusCode === 409
    );
});

test("request requires an active ADMIN and explicit request permission", async () => {
    const noPermissionState = createFakeDb().getState();
    noPermissionState.role_permissions =
        noPermissionState.role_permissions.filter((row) =>
            row.permission_id !== "permission-request");
    const service = createService(createFakeDb({ state: noPermissionState }));
    await assert.rejects(
        service.initiate("admin-1", initiateInput),
        (error) => error instanceof AppError && error.statusCode === 403
    );

    const approvalDb = createFakeDb();
    const approvalService = createService(approvalDb);
    const pending = await approvalService.initiate("admin-1", initiateInput);
    const noApprovalState = approvalDb.getState();
    noApprovalState.role_permissions =
        noApprovalState.role_permissions.filter((row) =>
            row.permission_id !== "permission-approve");
    await assert.rejects(
        createService(createFakeDb({ state: noApprovalState }))
            .approve("admin-2", pending.request_id, {
                verification_reference: "verified"
            }),
        (error) => error instanceof AppError && error.statusCode === 403
    );

    const inactiveState = createFakeDb().getState();
    inactiveState.users.find((row) => row.user_id === "admin-1").status = "DISABLED";
    await assert.rejects(
        createService(createFakeDb({ state: inactiveState }))
            .initiate("admin-1", initiateInput),
        (error) => error instanceof AppError && error.statusCode === 403
    );
});

test("approval requires a separate authorized admin and preserves the source user", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const request = await service.initiate("admin-1", initiateInput);

    await assert.rejects(
        service.approve("admin-1", request.request_id, {
            verification_reference: "external-evidence-42"
        }),
        (error) => error instanceof AppError && error.statusCode === 403
    );
    const completed = await service.approve("admin-2", request.request_id, {
        verification_reference: "external-evidence-42"
    });
    const state = db.getState();
    const source = state.customers.find((row) => row.customer_id === "customer-source");
    const target = state.customers.find((row) => row.customer_id === "customer-target");

    assert.equal(completed.status, "COMPLETED");
    assert.equal(source.customer_type, "MERGED");
    assert.equal(source.user_id, "source-user");
    assert.equal(source.merged_into_customer_id, "customer-target");
    assert.equal(target.customer_type, "REGISTERED");
    assert.equal(target.user_id, "target-user");
    assert.deepEqual(state.customer_merge_reservations, []);
    assert.equal(state.customer_merge_history.length, 1);
    assert.deepEqual(state.customer_merge_history[0], {
        merge_history_id: "history-1",
        source_customer_id: "customer-source",
        target_customer_id: "customer-target",
        target_user_id: "target-user",
        verified_by_user_id: "admin-2",
        verification_reference: "external-evidence-42",
        merge_reason: "Duplicate account"
    });
    // audit-2 is the FAILURE audit of the self-approval (403) above.
    assert.equal(state.user_audit_logs[1].outcome, "FAILURE");
    assert.equal(state.user_audit_logs[1].action, "CUSTOMER.MERGE_COMPLETED");
    assert.equal(
        state.user_audit_logs[1].reason,
        "A different administrator must decide the request"
    );
    assert.equal(
        state.customer_merge_requests[0].decision_audit_id,
        "audit-3"
    );
    assert.equal(state.user_audit_logs[2].metadata.reason, undefined);
    assert.equal(
        JSON.stringify(state.user_audit_logs).includes("external-evidence-42"),
        false
    );
});

test("approval rejects changed BIGINT versions and merge chains", async () => {
    const changedDb = createFakeDb();
    const changedService = createService(changedDb);
    const changedRequest = await changedService.initiate("admin-1", initiateInput);
    const changedState = changedDb.getState();
    changedState.customers[0].row_version = "9007199254740994";
    changedState.customers[0].row_version_text = "9007199254740994";
    const changedDbAfterEdit = createFakeDb({ state: changedState });
    await assert.rejects(
        createService(changedDbAfterEdit).approve("admin-2", changedRequest.request_id, {
            verification_reference: "verified"
        }),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    assert.equal(
        changedDbAfterEdit.getState().customer_merge_requests[0].status,
        "PENDING"
    );

    const chainState = createFakeDb().getState();
    chainState.customer_merge_history.push({
        merge_history_id: "old-history",
        source_customer_id: "older-source",
        target_customer_id: "customer-source"
    });
    const chainDb = createFakeDb({ state: chainState });
    const chainService = createService(chainDb);
    const chainRequest = await chainService.initiate("admin-1", initiateInput);
    await assert.rejects(
        chainService.approve("admin-2", chainRequest.request_id, {
            verification_reference: "verified"
        }),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    assert.equal(chainDb.getState().customer_merge_requests[0].status, "PENDING");
    assert.equal(chainDb.getState().customer_merge_reservations.length, 2);
});

test("reject and cancel release both reservations with terminal audits", async () => {
    const rejectedDb = createFakeDb();
    const rejectedService = createService(rejectedDb);
    const request = await rejectedService.initiate("admin-1", initiateInput);
    const rejected = await rejectedService.reject("admin-2", request.request_id, {
        reason: "Not a duplicate"
    });
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejectedDb.getState().customer_merge_reservations.length, 0);
    assert.equal(rejectedDb.getState().customer_merge_requests[0].decision_reason, "Not a duplicate");

    const cancelledDb = createFakeDb();
    const cancelledService = createService(cancelledDb);
    const pending = await cancelledService.initiate("admin-1", initiateInput);
    await assert.rejects(
        cancelledService.cancel("admin-2", pending.request_id),
        (error) => error instanceof AppError && error.statusCode === 403
    );
    const cancelled = await cancelledService.cancel(
        "admin-1",
        pending.request_id,
        { reason: "Initiator withdrew" }
    );
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelledDb.getState().customer_merge_reservations.length, 0);
});

test("expiration is a no-op until due and is idempotent after a terminal transition", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const request = await service.initiate("admin-1", initiateInput);
    db.setNow(new Date(now.getTime() + 23 * 60 * 60 * 1000));

    const early = await service.expire(request.request_id, "worker-run-1");
    assert.equal(early.status, "PENDING");
    assert.equal(early.performed, false);
    assert.equal(db.getState().user_audit_logs.length, 1);
    assert.equal(db.getState().customer_merge_reservations.length, 2);

    db.setNow(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const expired = await service.expire(request.request_id, "worker-run-2");
    const repeated = await service.expire(request.request_id, "worker-run-3");
    assert.equal(expired.status, "EXPIRED");
    assert.equal(expired.performed, true);
    assert.equal(repeated.status, "EXPIRED");
    assert.equal(repeated.performed, false);
    assert.equal(db.getState().customer_merge_reservations.length, 0);
    assert.equal(db.getState().customer_merge_requests[0].decision_reason, null);
    assert.equal(db.getState().user_audit_logs.length, 2);
    assert.equal(db.getState().user_audit_logs[1].actor_user_id, null);
});

test("expiration fails atomically on corrupt reservations", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const request = await service.initiate("admin-1", initiateInput);
    const state = db.getState();
    state.customer_merge_reservations.pop();
    const corruptDb = createFakeDb({ state });
    corruptDb.setNow(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    await assert.rejects(
        createService(corruptDb).expire(request.request_id, "worker-run"),
        (error) => error instanceof AppError && error.statusCode === 503
    );
    assert.equal(corruptDb.getState().customer_merge_requests[0].status, "PENDING");
    assert.equal(corruptDb.getState().user_audit_logs.length, 1);
    assert.equal(corruptDb.getState().customer_merge_reservations.length, 1);
});

test("rejected merge operations write FAILURE audits; invalid input does not", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const pending = await service.initiate("admin-1", initiateInput, "merge-corr-1");

    await assert.rejects(
        service.approve("admin-1", pending.request_id, { verification_reference: "ref" }, "merge-corr-2"),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        service.cancel("admin-2", pending.request_id, {}, "merge-corr-3"),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        service.reject("admin-2", "missing-request", {}, "merge-corr-4"),
        (error) => error.statusCode === 404
    );
    await assert.rejects(
        service.initiate("admin-2", { ...initiateInput, idempotency_key: "other" }, "merge-corr-5"),
        (error) => error.statusCode === 409
    );
    const failures = db.getState().user_audit_logs.slice(1);
    assert.deepEqual(failures.map((row) => [
        row.action,
        row.actor_user_id,
        row.resource_type,
        row.resource_id,
        row.outcome,
        row.metadata.merge_request_id
    ]), [
        ["CUSTOMER.MERGE_COMPLETED", "admin-1", "customer", null, "FAILURE", "merge-request-1"],
        ["CUSTOMER.MERGE_CANCELLED", "admin-2", "customer", null, "FAILURE", "merge-request-1"],
        ["CUSTOMER.MERGE_REJECTED", "admin-2", "customer", null, "FAILURE", "missing-request"],
        ["CUSTOMER.MERGE_REQUESTED", "admin-2", "customer", "customer-source", "FAILURE", undefined]
    ]);
    assert.deepEqual(failures.map((row) => row.reason), [
        "A different administrator must decide the request",
        "Only the initiator can cancel this request",
        "Merge request not found",
        "Customer is already reserved by another merge"
    ]);
    assert.equal(JSON.stringify(failures).includes("\"ref\""), false);

    const before = db.getState().user_audit_logs.length;
    await assert.rejects(
        service.initiate("admin-1", { ...initiateInput, actor_id: "x" }),
        (error) => error.statusCode === 400
    );
    assert.equal(db.getState().user_audit_logs.length, before);
});

test("a merge failure whose audit cannot be stored fails closed with 503", async () => {
    const db = createFakeDb();
    const service = createCustomerMergeService({
        db,
        createId: () => "merge-request-1",
        auditLog: {
            async record() {
                throw new Error("audit storage unavailable");
            }
        }
    });
    await assert.rejects(
        service.reject("admin-2", "missing-request", {}),
        (error) => error instanceof AppError && error.statusCode === 503
    );
});

function moveGrantToOtherRole(state, permissionId, otherRole) {
    const otherRoleId = `role-${otherRole.toLowerCase()}`;
    if (!state.roles.some((row) => row.role_id === otherRoleId)) {
        state.roles.push({ role_id: otherRoleId, role_code: otherRole });
    }
    for (const userId of ["admin-1", "admin-2"]) {
        if (!state.user_roles.some((row) =>
            row.user_id === userId && row.role_id === otherRoleId)) {
            state.user_roles.push({ user_id: userId, role_id: otherRoleId });
        }
    }
    state.role_permissions = state.role_permissions.filter((row) =>
        row.permission_id !== permissionId);
    state.role_permissions.push({ role_id: otherRoleId, permission_id: permissionId });
    return state;
}

test("initiation denies ADMIN when customer.merge.request is granted only to another role", async () => {
    for (const otherRole of ["TECHNICIAN", "CUSTOMER"]) {
        const state = moveGrantToOtherRole(
            createFakeDb().getState(), "permission-request", otherRole
        );
        const db = createFakeDb({ state });
        await assert.rejects(
            createService(db).initiate("admin-1", initiateInput),
            (error) => error instanceof AppError && error.statusCode === 403,
            otherRole
        );
        const after = db.getState();
        assert.equal(after.customer_merge_requests.length, 0, otherRole);
        assert.equal(after.customer_merge_reservations.length, 0, otherRole);
        // Only the FAILURE audit of the denied initiation is written.
        assert.equal(after.user_audit_logs.length, 1, otherRole);
        assert.equal(after.user_audit_logs[0].action, "CUSTOMER.MERGE_REQUESTED");
        assert.equal(after.user_audit_logs[0].outcome, "FAILURE");
        assert.equal(after.user_audit_logs[0].reason, "You do not have permission");
    }
});

test("approval and rejection deny ADMIN when customer.merge.approve is granted only to another role", async () => {
    for (const otherRole of ["TECHNICIAN", "CUSTOMER"]) {
        const initialDb = createFakeDb();
        const pending = await createService(initialDb).initiate("admin-1", initiateInput);
        const state = moveGrantToOtherRole(
            initialDb.getState(), "permission-approve", otherRole
        );
        const db = createFakeDb({ state });
        const service = createService(db);
        await assert.rejects(
            service.approve("admin-2", pending.request_id, {
                verification_reference: "verified"
            }),
            (error) => error instanceof AppError && error.statusCode === 403,
            `approve with ${otherRole} grant`
        );
        await assert.rejects(
            service.reject("admin-2", pending.request_id, { reason: "Not a duplicate" }),
            (error) => error instanceof AppError && error.statusCode === 403,
            `reject with ${otherRole} grant`
        );
        const after = db.getState();
        assert.equal(after.customer_merge_requests[0].status, "PENDING");
        assert.equal(after.customer_merge_reservations.length, 2);
        assert.equal(after.customer_merge_history.length, 0);
        // Initiation SUCCESS + FAILURE audits for the denied approve and reject.
        assert.equal(after.user_audit_logs.length, 3);
        assert.deepEqual(after.user_audit_logs.slice(1).map((row) => row.action), [
            "CUSTOMER.MERGE_COMPLETED",
            "CUSTOMER.MERGE_REJECTED"
        ]);
    }
});

test("ADMIN with other roles proceeds when merge grants are on ADMIN", async () => {
    const state = createFakeDb().getState();
    state.roles.push({ role_id: "role-technician", role_code: "TECHNICIAN" });
    state.user_roles.push(
        { user_id: "admin-1", role_id: "role-technician" },
        { user_id: "admin-2", role_id: "role-technician" }
    );
    const db = createFakeDb({ state });
    const service = createService(db, ["merge-request-1", "merge-request-2", "history-1"]);
    const request = await service.initiate("admin-1", initiateInput);
    assert.equal(request.status, "PENDING");
    const rejected = await service.reject("admin-2", request.request_id, { reason: "Recheck" });
    assert.equal(rejected.status, "REJECTED");
    const second = await service.initiate("admin-1", {
        ...initiateInput,
        idempotency_key: "merge-key-2"
    });
    const completed = await service.approve("admin-2", second.request_id, {
        verification_reference: "verified"
    });
    assert.equal(completed.status, "COMPLETED");
});

test("merge locks ADMIN, sorted users, authorization, sorted customers, then request and dependent rows", async () => {
    const state = createFakeDb().getState();
    state.users.find((row) => row.user_id === "source-user").user_id = "a-source-user";
    state.customers[0].user_id = "a-source-user";
    const db = createFakeDb({ state });
    const service = createService(db);

    function checkLocks(locks, actor, expectHistory) {
        assert.ok(locks.every((lock) => lock.inTransaction));
        const tables = locks.map((lock) => lock.table);
        assert.deepEqual(locks[0].filters, [{ role_code: "ADMIN" }]);
        assert.equal(locks[0].table, "roles");
        assert.equal(locks[1].table, "permissions");
        const userLocks = locks.filter((lock) => lock.table === "users");
        assert.deepEqual(userLocks.map((lock) => lock.filters[0].user_id),
            ["a-source-user", actor, "target-user"]);
        const lastUserLock = tables.lastIndexOf("users");
        const assignmentLock = tables.indexOf("user_roles");
        const permissionAssignmentLock = tables.indexOf("role_permissions");
        const firstCustomerLock = tables.indexOf("customers");
        const requestLock = tables.indexOf("customer_merge_requests");
        const reservationLock = tables.indexOf("customer_merge_reservations");
        assert.ok(lastUserLock > 0);
        assert.ok(assignmentLock > lastUserLock);
        assert.deepEqual(locks[assignmentLock].filters, [{ user_id: actor }]);
        assert.ok(permissionAssignmentLock > assignmentLock);
        assert.ok(firstCustomerLock > permissionAssignmentLock);
        const customerLocks = locks.filter((lock) =>
            lock.table === "customers" && lock.filters.length > 0);
        assert.deepEqual(customerLocks.map((lock) => lock.filters[0].customer_id),
            ["customer-source", "customer-target"]);
        assert.ok(requestLock > tables.lastIndexOf("customers"));
        assert.ok(reservationLock > requestLock);
        assert.equal(tables.slice(firstCustomerLock).includes("user_roles"), false);
        assert.equal(tables.slice(firstCustomerLock).includes("role_permissions"), false);
        if (expectHistory) {
            assert.ok(tables.indexOf("customer_merge_history") > reservationLock);
        }
    }

    await service.initiate("admin-1", {
        ...initiateInput,
        source_customer_id: "customer-target",
        target_customer_id: "customer-source"
    });
    checkLocks(db.getLockSequence(), "admin-1", false);

    db.clearLockSequence();
    await service.approve("admin-2", "merge-request-1", {
        verification_reference: "verified"
    });
    checkLocks(db.getLockSequence(), "admin-2", true);
});

test("merge locks the actor only once when the actor also owns a customer", async () => {
    const state = createFakeDb().getState();
    state.customers[0].user_id = "admin-1";
    const db = createFakeDb({ state });
    await createService(db).initiate("admin-1", initiateInput);
    const userIds = db.getLockSequence()
        .filter((lock) => lock.table === "users")
        .map((lock) => lock.filters[0].user_id);
    assert.deepEqual(userIds, ["admin-1", "target-user"]);
});

test("initiation and approval revalidate revoked authorization inside the transaction", async () => {
    for (const operation of ["initiate", "approve"]) {
        for (const revocation of ["ADMIN", "permission", "status"]) {
            const initialDb = createFakeDb();
            if (operation === "approve") {
                await createService(initialDb).initiate("admin-1", initiateInput);
            }
            const actor = operation === "initiate" ? "admin-1" : "admin-2";
            const permission = operation === "initiate"
                ? "permission-request"
                : "permission-approve";
            const db = createFakeDb({
                state: initialDb.getState(),
                beforeTransaction(data) {
                    if (revocation === "ADMIN") {
                        data.user_roles = data.user_roles.filter((row) =>
                            row.user_id !== actor || row.role_id !== "role-admin");
                    } else if (revocation === "permission") {
                        data.role_permissions = data.role_permissions.filter((row) =>
                            row.permission_id !== permission);
                    } else {
                        data.users.find((row) => row.user_id === actor).status = "DISABLED";
                    }
                }
            });
            const service = createService(db);
            const action = operation === "initiate"
                ? service.initiate(actor, initiateInput)
                : service.approve(actor, "merge-request-1", {
                    verification_reference: "verified"
                });
            await assert.rejects(
                action,
                (error) => error instanceof AppError && error.statusCode === 403,
                `${operation} after ${revocation} revocation`
            );
            const state = db.getState();
            assert.equal(state.customer_merge_requests.length, operation === "initiate" ? 0 : 1);
            // +1: the revoked-authorization rejection (403) is audited as a FAILURE.
            assert.equal(state.user_audit_logs.length, operation === "initiate" ? 1 : 2);
            assert.equal(state.user_audit_logs.at(-1).outcome, "FAILURE");
            if (operation === "approve") {
                assert.equal(state.customer_merge_requests[0].status, "PENDING");
                assert.equal(state.customer_merge_reservations.length, 2);
            }
        }
    }
});

test("uppercase database customer IDs normalize hints and locked row versions", async () => {
    const db = createFakeDb({ uppercaseReturnedCustomerIds: true });
    const service = createService(db);
    const request = await service.initiate("admin-1", initiateInput);

    assert.equal(request.status, "PENDING");
    assert.equal(db.getTransactionCount(), 1);
    let state = db.getState();
    assert.equal(state.customer_merge_requests[0].source_version, BIG_VERSION);
    assert.equal(state.customer_merge_requests[0].target_version, "12");

    const approved = await service.approve("admin-2", request.request_id, {
        verification_reference: "verified"
    });
    assert.equal(approved.status, "COMPLETED");
    assert.equal(db.getTransactionCount(), 2);
    state = db.getState();
    assert.equal(state.customer_merge_requests[0].status, "COMPLETED");
    assert.equal(state.customers[0].merged_into_customer_id, "customer-target");
});

test("approval is allowed only strictly before expiry", async () => {
    const beforeExpiryDb = createFakeDb();
    const beforeExpiryService = createService(beforeExpiryDb);
    const beforeExpiryRequest = await beforeExpiryService.initiate("admin-1", initiateInput);
    const deadline = beforeExpiryRequest.expires_at.getTime();
    beforeExpiryDb.setNow(new Date(deadline - 1));
    const approved = await beforeExpiryService.approve(
        "admin-2",
        beforeExpiryRequest.request_id,
        { verification_reference: "verified" }
    );
    assert.equal(approved.status, "COMPLETED");

    for (const offset of [0, 1]) {
        const db = createFakeDb();
        const service = createService(db);
        const request = await service.initiate("admin-1", initiateInput);
        db.setNow(new Date(request.expires_at.getTime() + offset));
        await assert.rejects(
            service.approve("admin-2", request.request_id, {
                verification_reference: "verified"
            }),
            (error) => error instanceof AppError
                && error.statusCode === 409
                && error.message === "Merge request has expired"
        );
        const state = db.getState();
        assert.equal(state.customer_merge_requests[0].status, "PENDING");
        assert.equal(state.customer_merge_reservations.length, 2);
        // +1: the rejected (409) approval is audited as a FAILURE.
        assert.equal(state.user_audit_logs.length, 2);
    }
});

test("expired pending requests can be rejected or cancelled exactly once", async () => {
    const rejectedDb = createFakeDb();
    const rejectedService = createService(rejectedDb);
    const rejectedRequest = await rejectedService.initiate("admin-1", initiateInput);
    rejectedDb.setNow(rejectedRequest.expires_at);
    const rejected = await rejectedService.reject("admin-2", rejectedRequest.request_id, {
        reason: "Expired duplicate review"
    });
    assert.equal(rejected.status, "REJECTED");
    let state = rejectedDb.getState();
    assert.equal(state.customer_merge_reservations.length, 0);
    assert.equal(state.customer_merge_requests[0].decision_audit_id, "audit-2");
    assert.equal(state.user_audit_logs[1].action, "CUSTOMER.MERGE_REJECTED");
    assert.equal((await rejectedService.expire(rejectedRequest.request_id)).performed, false);
    await assert.rejects(
        rejectedService.reject("admin-2", rejectedRequest.request_id),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    state = rejectedDb.getState();
    assert.equal(state.customer_merge_requests[0].status, "REJECTED");
    assert.equal(state.customer_merge_reservations.length, 0);
    // +1: the repeated (409) rejection is audited as a FAILURE.
    assert.equal(state.user_audit_logs.length, 3);

    const cancelledDb = createFakeDb();
    const cancelledService = createService(cancelledDb);
    const cancelledRequest = await cancelledService.initiate("admin-1", initiateInput);
    cancelledDb.setNow(cancelledRequest.expires_at);
    const cancelled = await cancelledService.cancel(
        "admin-1",
        cancelledRequest.request_id,
        { reason: "Initiator withdrew after expiry" }
    );
    assert.equal(cancelled.status, "CANCELLED");
    state = cancelledDb.getState();
    assert.equal(state.customer_merge_reservations.length, 0);
    assert.equal(state.customer_merge_requests[0].decision_audit_id, "audit-2");
    assert.equal(state.user_audit_logs[1].action, "CUSTOMER.MERGE_CANCELLED");
    assert.equal((await cancelledService.expire(cancelledRequest.request_id)).performed, false);
    await assert.rejects(
        cancelledService.cancel("admin-1", cancelledRequest.request_id),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    state = cancelledDb.getState();
    assert.equal(state.customer_merge_requests[0].status, "CANCELLED");
    assert.equal(state.customer_merge_reservations.length, 0);
    // +1: the repeated (409) cancellation is audited as a FAILURE.
    assert.equal(state.user_audit_logs.length, 3);
});

test("rejection and cancellation cannot change requests already expired", async () => {
    const rejectedDb = createFakeDb();
    const rejectedService = createService(rejectedDb);
    const rejectedRequest = await rejectedService.initiate("admin-1", initiateInput);
    rejectedDb.setNow(rejectedRequest.expires_at);
    await rejectedService.expire(rejectedRequest.request_id);
    await assert.rejects(
        rejectedService.reject("admin-2", rejectedRequest.request_id),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    let state = rejectedDb.getState();
    assert.equal(state.customer_merge_requests[0].status, "EXPIRED");
    assert.equal(state.customer_merge_reservations.length, 0);
    // +1: the rejected (409) rejection is audited as a FAILURE.
    assert.equal(state.user_audit_logs.length, 3);

    const cancelledDb = createFakeDb();
    const cancelledService = createService(cancelledDb);
    const cancelledRequest = await cancelledService.initiate("admin-1", initiateInput);
    cancelledDb.setNow(cancelledRequest.expires_at);
    await cancelledService.expire(cancelledRequest.request_id);
    await assert.rejects(
        cancelledService.cancel("admin-1", cancelledRequest.request_id),
        (error) => error instanceof AppError && error.statusCode === 409
    );
    state = cancelledDb.getState();
    assert.equal(state.customer_merge_requests[0].status, "EXPIRED");
    assert.equal(state.customer_merge_reservations.length, 0);
    // +1: the rejected (409) cancellation is audited as a FAILURE.
    assert.equal(state.user_audit_logs.length, 3);
});
