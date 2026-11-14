const assert = require("node:assert/strict");
const test = require("node:test");
const AppError = require("../../shared/errors/AppError");
const { createPaymentService } = require("../src/services/paymentService");

function createTestRefundProvider(execute = async (request) => ({
    outcome: "succeeded",
    external_reference_id: `test-refund-${request.refund_id}`
})) {
    const confirmedResults = new Map();
    return {
        async executeRefund(request) {
            if (confirmedResults.has(request.idempotency_key)) {
                return confirmedResults.get(request.idempotency_key);
            }
            const result = await execute(request);
            if (result?.outcome === "succeeded") {
                confirmedResults.set(request.idempotency_key, result);
            }
            return result;
        }
    };
}

function createFakeDb({
    accounts = [{
        work_order_id: "work-order-1",
        customer_id: "customer-1",
        amount_due: "100.00",
        currency: "THB"
    }],
    payments = [],
    refunds = [],
    failInsert = false,
    failUpdate = false,
    failAuditInsert = false
} = {}) {
    let updateFailureEnabled = failUpdate;
    let auditInsertFailureEnabled = failAuditInsert;
    let state = {
        work_order_payment_accounts: accounts,
        payments,
        refunds,
        audit_logs: []
    };
    let transactionTail = Promise.resolve();

    function queryFor(currentState, tableName) {
        const filters = [];
        const inFilters = [];
        const orderings = [];
        const selectedAliases = [];
        let joinInfo;
        let rowLimit;
        let rowOffset = 0;
        let countAlias;

        function rowsForQuery() {
            let rows = currentState[tableName] || [];
            if (joinInfo) {
                rows = rows.flatMap((row) =>
                    (currentState[joinInfo.table] || [])
                        .filter((joined) =>
                            row[joinInfo.leftColumn] === joined[joinInfo.rightColumn]
                        )
                        .map((joined) => ({
                            ...row,
                            ...Object.fromEntries(
                                Object.entries(row).map(([key, value]) => [
                                    `${tableName}.${key}`,
                                    value
                                ])
                            ),
                            ...Object.fromEntries(
                                Object.entries(joined).map(([key, value]) => [
                                    `${joinInfo.table}.${key}`,
                                    value
                                ])
                            )
                        }))
                );
            }
            rows = rows.filter((row) =>
                filters.every((filter) => {
                    if (Array.isArray(filter)) {
                        const [key, operator, value] = filter;
                        if (operator === ">=") {
                            return new Date(row[key]).getTime() >= value.getTime();
                        }
                        if (operator === "<=") {
                            return new Date(row[key]).getTime() <= value.getTime();
                        }
                        return row[key] === value;
                    }
                    return Object.entries(filter).every(([key, value]) =>
                        row[key] === value
                    );
                })
                && inFilters.every(([column, values]) => values.includes(row[column]))
            );
            for (const [source, alias] of selectedAliases) {
                rows = rows.map((row) => ({
                    ...row,
                    [alias]: row[source]
                }));
            }
            for (const [column, direction] of orderings.slice().reverse()) {
                rows = rows.slice().sort((left, right) => {
                    const a = left[column];
                    const b = right[column];
                    const comparison = a < b ? -1 : a > b ? 1 : 0;
                    return direction === "desc" ? -comparison : comparison;
                });
            }
            if (rowOffset) {
                rows = rows.slice(rowOffset);
            }
            if (rowLimit !== undefined) {
                rows = rows.slice(0, rowLimit);
            }
            if (countAlias) {
                return [{ [countAlias]: rows.length }];
            }
            return rows;
        }

        const query = {
            select(...columns) {
                for (const column of columns) {
                    if (typeof column !== "string" || !column.includes(" as ")) {
                        continue;
                    }
                    const [source, alias] = column.split(" as ");
                    selectedAliases.push([source, alias]);
                }
                return this;
            },
            where(criteria, operator, value) {
                filters.push(arguments.length === 3
                    ? [criteria, operator, value]
                    : criteria);
                return this;
            },
            whereIn(column, values) {
                inFilters.push([column, values]);
                return this;
            },
            forUpdate() {
                return this;
            },
            join(joinTable, leftColumn, rightColumn) {
                joinInfo = {
                    table: joinTable,
                    leftColumn: leftColumn.split(".").pop(),
                    rightColumn: rightColumn.split(".").pop()
                };
                return this;
            },
            count(countSpec) {
                countAlias = Object.keys(countSpec)[0];
                return this;
            },
            orderBy(column, direction) {
                orderings.push([column, direction]);
                return this;
            },
            limit(value) {
                rowLimit = value;
                return this;
            },
            offset(value) {
                rowOffset = value;
                return this;
            },
            clone() {
                const cloned = queryFor(currentState, tableName);
                selectedAliases.forEach(([source, alias]) =>
                    cloned.select(`${source} as ${alias}`)
                );
                filters.forEach((filter) => {
                    if (Array.isArray(filter)) {
                        cloned.where(...filter);
                    } else {
                        cloned.where(filter);
                    }
                });
                inFilters.forEach(([column, values]) =>
                    cloned.whereIn(column, values)
                );
                if (joinInfo) {
                    cloned.join(
                        joinInfo.table,
                        `${tableName}.${joinInfo.leftColumn}`,
                        `${joinInfo.table}.${joinInfo.rightColumn}`
                    );
                }
                orderings.forEach(([column, direction]) =>
                    cloned.orderBy(column, direction)
                );
                if (rowLimit !== undefined) {
                    cloned.limit(rowLimit);
                }
                cloned.offset(rowOffset);
                if (countAlias) {
                    cloned.count({ [countAlias]: "*" });
                }
                return cloned;
            },
            async first() {
                return rowsForQuery()[0];
            },
            async insert(row) {
                if (tableName === "audit_logs") {
                    if (auditInsertFailureEnabled) {
                        throw new Error("simulated audit insert failure");
                    }
                    if (currentState.audit_logs.some(
                        (event) => event.event_key === row.event_key
                    )) {
                        const error = new Error("duplicate audit event");
                        error.code = "ER_DUP_ENTRY";
                        error.errno = 1062;
                        throw error;
                    }
                }
                if (failInsert) {
                    throw new Error("simulated insert failure");
                }
                currentState[tableName].push({ ...row });
            },
            async update(values) {
                if (updateFailureEnabled) {
                    throw new Error("simulated update failure");
                }
                let updatedRows = 0;
                for (const row of currentState[tableName] || []) {
                    if (filters.every((filter) => Object.entries(filter).every(
                        ([key, value]) => row[key] === value
                    ))) {
                        Object.assign(row, values);
                        updatedRows += 1;
                    }
                }
                return updatedRows;
            },
            then(resolve, reject) {
                const rows = rowsForQuery();
                return Promise.resolve(rows).then(resolve, reject);
            }
        };
        return query;
    }

    const db = (tableName) => queryFor(state, tableName);
    db.transaction = async (callback) => {
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
    db.setUpdateFailure = (enabled) => {
        updateFailureEnabled = enabled;
    };
    db.setAuditInsertFailure = (enabled) => {
        auditInsertFailureEnabled = enabled;
    };
    return db;
}

function createService(db, overrides = {}) {
    const refundProvider = Object.hasOwn(overrides, "refundProvider")
        ? overrides.refundProvider
        : createTestRefundProvider();
    return createPaymentService({
        db,
        authorizePaymentRecorder: async (context) =>
            context?.trusted === true ? "staff-1" : null,
        authorizeRefundActor: async (context, permission) =>
            context?.trusted === true && permission === "can_refund"
                ? context.actorUserId || "staff-1"
                : null,
        authorizePaymentQuery: async (context) =>
            context?.trusted === true
                ? { allowed: true, include_recorded_by: true }
                : false,
        authorizeRefundQuery: async (context) => context?.trusted === true,
        verifyApprovedPaymentAccount: async () => true,
        isApprovedPaymentMethod: async (method) => method === "approved-method",
        createId: () => `payment-${db.getState().payments.length + 1}`,
        now: () => 1_800_000_000_000,
        ...overrides,
        refundProvider: refundProvider && {
            ...refundProvider,
            testOnly: true
        },
        allowTestRefundProvider: true
    });
}

function paymentInput(overrides = {}) {
    return {
        work_order_id: "work-order-1",
        amount: "20.25",
        currency: "THB",
        payment_method: "approved-method",
        ...overrides
    };
}

function refundInput(overrides = {}) {
    return {
        payment_id: "payment-1",
        amount: "20.25",
        reason: "Duplicate charge",
        ...overrides
    };
}

async function createApprovedRefund(service) {
    const refund = await service.createRefundRequest(
        { trusted: true, actorUserId: "initiator-1" },
        refundInput()
    );
    await service.decideRefundRequest(
        { trusted: true, actorUserId: "reviewer-1" },
        { refund_id: refund.refund_id, decision: "APPROVED" }
    );
    return refund.refund_id;
}

test("payment recording requires all trusted integration dependencies", () => {
    const db = createFakeDb();
    assert.throws(
        () => createPaymentService({ db }),
        /trusted payment authorization/
    );
});

test("test refund provider deduplicates confirmed successes by idempotency key", async () => {
    let transferCount = 0;
    const provider = createTestRefundProvider(async () => {
        transferCount += 1;
        return { outcome: "succeeded", external_reference_id: "test-reference" };
    });
    const request = {
        refund_id: "refund-test",
        payment_id: "payment-test",
        amount: "10.00",
        currency: "THB",
        idempotency_key: "refund:refund-test"
    };

    assert.deepEqual(await provider.executeRefund(request), {
        outcome: "succeeded",
        external_reference_id: "test-reference"
    });
    assert.deepEqual(await provider.executeRefund(request), {
        outcome: "succeeded",
        external_reference_id: "test-reference"
    });
    assert.equal(transferCount, 1);
});

test("records a completed payment using trusted actor identity and returns balance", async () => {
    const db = createFakeDb();
    const service = createService(db);
    const result = await service.recordPayment(
        { trusted: true, requestId: "payment-request-1" },
        paymentInput()
    );

    assert.deepEqual(result, {
        payment_id: "payment-1",
        work_order_id: "work-order-1",
        amount: "20.25",
        currency: "THB",
        payment_method: "approved-method",
        status: "COMPLETED",
        recorded_by: "staff-1",
        paid_total: "20.25",
        outstanding_balance: "79.75",
        created_at: new Date(1_800_000_000_000)
    });
    assert.equal(db.getState().payments[0].recorded_by, "staff-1");
    assert.equal(db.getState().payments[0].status, "COMPLETED");
    const auditEvent = db.getState().audit_logs[0];
    assert.equal(auditEvent.action, "payment.recorded");
    assert.equal(auditEvent.target_entity_id, "payment-1");
    assert.equal(auditEvent.actor_user_id, "staff-1");
    assert.equal(auditEvent.request_id, "payment-request-1");
    assert.deepEqual(auditEvent.metadata, {
        amount: "20.25",
        currency: "THB",
        payment_method: "approved-method"
    });
    assert.equal(JSON.stringify(auditEvent).includes("token"), false);
});

test("financial payment rejection is audited without recording arbitrary input", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "existing",
            work_order_id: "work-order-1",
            amount: "90.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    await assert.rejects(
        createService(db).recordPayment(
            { trusted: true, requestId: "invalid-payment-request" },
            paymentInput({ extra: "private" })
        ),
        (error) => error.statusCode === 400
    );
    assert.deepEqual(db.getState().audit_logs[0].metadata, {
        reason_code: "invalid_request"
    });
    assert.equal(JSON.stringify(db.getState().audit_logs).includes("private"), false);

    await assert.rejects(
        createService(db).recordPayment(
            { trusted: true, requestId: "overpayment-request" },
            paymentInput({ amount: "20.00" })
        ),
        (error) => error.statusCode === 409
    );
    assert.equal(db.getState().audit_logs[1].metadata.reason_code, "overpayment");
});

test("payment and audit insert roll back together when audit persistence fails", async () => {
    const db = createFakeDb({ failAuditInsert: true });
    await assert.rejects(
        createService(db).recordPayment({ trusted: true }, paymentInput()),
        (error) => error.statusCode === 503
            && error.message === "Audit log persistence failed"
    );
    assert.equal(db.getState().payments.length, 0);
    assert.equal(db.getState().audit_logs.length, 0);
});

test("supports multiple partial payments without floating-point arithmetic", async () => {
    const db = createFakeDb();
    const service = createService(db);

    const first = await service.recordPayment(
        { trusted: true },
        paymentInput({ amount: "0.10" })
    );
    const second = await service.recordPayment(
        { trusted: true },
        paymentInput({ amount: "0.20" })
    );

    assert.equal(first.outstanding_balance, "99.90");
    assert.equal(second.paid_total, "0.30");
    assert.equal(second.outstanding_balance, "99.70");
    assert.equal(db.getState().payments.length, 2);
});

test("rejects invalid amount formats, zero, negative, and unsupported currencies", async () => {
    const service = createService(createFakeDb());
    for (const amount of ["0", "0.00", "-1.00", "1.001", 1.25, "10000000000.00"]) {
        await assert.rejects(
            service.recordPayment({ trusted: true }, paymentInput({ amount })),
            (error) => error.statusCode === 400
        );
    }
    for (const currency of ["thb", "US", "USDD", "123"]) {
        await assert.rejects(
            service.recordPayment({ trusted: true }, paymentInput({ currency })),
            (error) => error.statusCode === 400
        );
    }
});

test("rejects overpayment and currency mismatch", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "existing",
            work_order_id: "work-order-1",
            amount: "80.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db);
    await assert.rejects(
        service.recordPayment(
            { trusted: true },
            paymentInput({ amount: "20.01" })
        ),
        (error) => error.statusCode === 409
    );
    await assert.rejects(
        service.recordPayment(
            { trusted: true },
            paymentInput({ currency: "USD" })
        ),
        (error) => error.statusCode === 400
    );
    assert.equal(db.getState().payments.length, 1);
});

test("only completed payments and refunds affect the outstanding balance", async () => {
    const db = createFakeDb({
        accounts: [{
            work_order_id: "work-order-1",
            amount_due: "100.00",
            currency: "THB"
        }],
        payments: [
            { payment_id: "paid", work_order_id: "work-order-1", amount: "80.00", currency: "THB", status: "COMPLETED" },
            { payment_id: "pending", work_order_id: "work-order-1", amount: "15.00", currency: "THB", status: "PENDING" }
        ],
        refunds: [
            { refund_id: "done", payment_id: "paid", amount: "30.00", currency: "THB", status: "COMPLETED" },
            { refund_id: "pending-refund", payment_id: "paid", amount: "10.00", currency: "THB", status: "APPROVED" }
        ]
    });
    const result = await createService(db).recordPayment(
        { trusted: true },
        paymentInput({ amount: "50.00" })
    );
    assert.equal(result.paid_total, "130.00");
    assert.equal(result.outstanding_balance, "0.00");
});

test("getBalance reports exact component totals and zero outstanding balance", async () => {
    const db = createFakeDb({
        accounts: [{
            work_order_id: "work-order-1",
            amount_due: "100.00",
            currency: "THB"
        }],
        payments: [{
            payment_id: "paid",
            work_order_id: "work-order-1",
            amount: "125.00",
            currency: "THB",
            status: "COMPLETED"
        }],
        refunds: [{
            refund_id: "completed-refund",
            payment_id: "paid",
            amount: "25.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });

    const service = createService(db);
    assert.deepEqual(await service.getBalance("work-order-1"), {
        work_order_id: "work-order-1",
        currency: "THB",
        amount_due: "100.00",
        completed_payments_total: "125.00",
        completed_refunds_total: "25.00",
        outstanding_balance: "0.00"
    });
    await assert.rejects(
        service.recordPayment(
            { trusted: true },
            paymentInput({ amount: "0.01" })
        ),
        (error) => error.statusCode === 409
    );
});

test("getBalance excludes pending, failed, and cancelled financial records", async () => {
    const db = createFakeDb({
        payments: [
            { payment_id: "pending", work_order_id: "work-order-1", amount: "10.00", currency: "THB", status: "PENDING" },
            { payment_id: "failed", work_order_id: "work-order-1", amount: "20.00", currency: "THB", status: "FAILED" },
            { payment_id: "cancelled", work_order_id: "work-order-1", amount: "30.00", currency: "THB", status: "CANCELLED" }
        ],
        refunds: [
            { refund_id: "requested", payment_id: "pending", amount: "1.00", currency: "THB", status: "REQUESTED" },
            { refund_id: "approved", payment_id: "pending", amount: "2.00", currency: "THB", status: "APPROVED" },
            { refund_id: "rejected", payment_id: "pending", amount: "3.00", currency: "THB", status: "REJECTED" },
            { refund_id: "failed", payment_id: "pending", amount: "4.00", currency: "THB", status: "FAILED" },
            { refund_id: "cancelled", payment_id: "pending", amount: "5.00", currency: "THB", status: "CANCELLED" }
        ]
    });
    const balance = await createService(db).getBalance("work-order-1");

    assert.equal(balance.completed_payments_total, "0.00");
    assert.equal(balance.completed_refunds_total, "0.00");
    assert.equal(balance.outstanding_balance, "100.00");
});

test("getBalance detects negative balances and inconsistent record currencies", async () => {
    const negativeBalanceDb = createFakeDb({
        payments: [{
            payment_id: "overpaid",
            work_order_id: "work-order-1",
            amount: "100.01",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    await assert.rejects(
        createService(negativeBalanceDb).getBalance("work-order-1"),
        (error) => error.statusCode === 409
            && error.message === "Payment account balance is inconsistent"
    );

    const mismatchedPaymentDb = createFakeDb({
        payments: [{
            payment_id: "wrong-currency",
            work_order_id: "work-order-1",
            amount: "10.00",
            currency: "USD",
            status: "COMPLETED"
        }]
    });
    await assert.rejects(
        createService(mismatchedPaymentDb).getBalance("work-order-1"),
        (error) => error.statusCode === 409
            && error.message === "Payment account balance has inconsistent currencies"
    );

    const overRefundedDb = createFakeDb({
        payments: [{
            payment_id: "paid",
            work_order_id: "work-order-1",
            amount: "10.00",
            currency: "THB",
            status: "COMPLETED"
        }],
        refunds: [{
            refund_id: "over-refunded",
            payment_id: "paid",
            amount: "10.01",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    await assert.rejects(
        createService(overRefundedDb).getBalance("work-order-1"),
        (error) => error.statusCode === 409
            && error.message === "Payment account balance is inconsistent"
    );
});

test("balance retrieval validates account and reports missing or unverified accounts", async () => {
    const service = createService(createFakeDb());
    await assert.rejects(
        service.getBalance(""),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.getBalance("x".repeat(37)),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.getBalance("missing"),
        (error) => error.statusCode === 404
    );

    const unverifiedService = createService(createFakeDb(), {
        verifyApprovedPaymentAccount: async () => false
    });
    await assert.rejects(
        unverifiedService.getBalance("work-order-1"),
        (error) => error.statusCode === 409
    );
});

test("rejects unknown payment accounts and unverified quotation snapshots", async () => {
    await assert.rejects(
        createService(createFakeDb()).recordPayment(
            { trusted: true },
            paymentInput({ work_order_id: "missing" })
        ),
        (error) => error.statusCode === 404
    );

    await assert.rejects(
        createService(createFakeDb(), {
            verifyApprovedPaymentAccount: async () => false
        }).recordPayment({ trusted: true }, paymentInput()),
        (error) => error.statusCode === 409
    );
});

test("does not accept actor identity from request data and denies unauthorized recording", async () => {
    const db = createFakeDb();
    const service = createService(db);
    await assert.rejects(
        service.recordPayment({ trusted: false }, paymentInput()),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        service.recordPayment({ trusted: true }, paymentInput({ recorded_by: "attacker" })),
        (error) => error.statusCode === 400
    );
    assert.equal(db.getState().payments.length, 0);
});

test("rejects methods not present in the approved method provider", async () => {
    await assert.rejects(
        createService(createFakeDb()).recordPayment(
            { trusted: true },
            paymentInput({ payment_method: "unknown" })
        ),
        (error) => error.statusCode === 400
    );
});

test("serializes concurrent payments against one account", async () => {
    const db = createFakeDb({
        accounts: [{
            work_order_id: "work-order-1",
            amount_due: "100.00",
            currency: "THB"
        }]
    });
    const service = createService(db);
    const outcomes = await Promise.allSettled([
        service.recordPayment({ trusted: true }, paymentInput({ amount: "70.00" })),
        service.recordPayment({ trusted: true }, paymentInput({ amount: "70.00" }))
    ]);

    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    assert.equal(db.getState().payments.length, 1);
});

test("payment insertion failure leaves the transaction unchanged", async () => {
    const db = createFakeDb({ failInsert: true });
    await assert.rejects(
        createService(db).recordPayment({ trusted: true }, paymentInput()),
        (error) => error.statusCode === 503
    );
    assert.equal(db.getState().payments.length, 0);
});

test("preserves authentication errors from the trusted authorization provider", async () => {
    const service = createService(createFakeDb(), {
        authorizePaymentRecorder: async () => {
            throw new AppError("Authentication required", 401);
        }
    });
    await assert.rejects(
        service.recordPayment({}, paymentInput()),
        (error) => error.statusCode === 401
    );
});

test("creates a requested refund using trusted identity and preserves the payment", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, { createId: () => "refund-1" });
    const result = await service.createRefundRequest(
        { trusted: true, actorUserId: "requester-1" },
        refundInput({ amount: "12.34" })
    );

    assert.equal(result.refund_id, "refund-1");
    assert.equal(result.payment_id, "payment-1");
    assert.equal(result.amount, "12.34");
    assert.equal(result.status, "REQUESTED");
    assert.equal(result.reason, "Duplicate charge");
    assert.equal(result.initiated_by, "requester-1");
    assert.equal(result.reviewer_user_id, null);
    assert.deepEqual(db.getState().payments[0], {
        payment_id: "payment-1",
        work_order_id: "work-order-1",
        amount: "50.00",
        currency: "THB",
        status: "COMPLETED"
    });
    assert.equal(db.getState().audit_logs[0].action, "refund.requested");
    assert.equal(db.getState().audit_logs[0].actor_user_id, "requester-1");
    assert.equal(db.getState().audit_logs[0].target_entity_id, "refund-1");
});

test("refund request and decision audit records commit with their state changes", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, { createId: () => "refund-1" });
    const request = await service.createRefundRequest(
        { trusted: true, actorUserId: "initiator-1", correlationId: "refund-corr" },
        refundInput()
    );
    await service.decideRefundRequest(
        { trusted: true, actorUserId: "reviewer-1", correlationId: "refund-corr" },
        { refund_id: request.refund_id, decision: "APPROVED" }
    );
    const events = db.getState().audit_logs;
    assert.deepEqual(events.map((event) => event.action), [
        "refund.requested",
        "refund.approved"
    ]);
    assert.deepEqual(events.map((event) => event.actor_user_id), [
        "initiator-1",
        "reviewer-1"
    ]);
    assert.ok(events.every((event) => event.request_id === "refund-corr"));
    assert.equal(events[1].metadata.from_status, "REQUESTED");
    assert.equal(events[1].metadata.to_status, "APPROVED");
});

test("refund decision and audit insert roll back together on audit failure", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, { createId: () => "refund-1" });
    await service.createRefundRequest(
        { trusted: true, actorUserId: "initiator-1" },
        refundInput()
    );
    db.setAuditInsertFailure(true);
    await assert.rejects(
        service.decideRefundRequest(
            { trusted: true, actorUserId: "reviewer-1" },
            { refund_id: "refund-1", decision: "APPROVED" }
        ),
        (error) => error.statusCode === 503
            && error.message === "Audit log persistence failed"
    );
    assert.equal(db.getState().refunds[0].status, "REQUESTED");
    assert.equal(db.getState().audit_logs.length, 1);
});

test("refund requests require an eligible payment, positive amount, and reason", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "PENDING"
        }]
    });
    const service = createService(db);

    await assert.rejects(
        service.createRefundRequest({ trusted: true }, refundInput({ payment_id: "missing" })),
        (error) => error.statusCode === 404
    );
    await assert.rejects(
        service.createRefundRequest({ trusted: true }, refundInput({ amount: "0.00" })),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.createRefundRequest({ trusted: true }, refundInput({ amount: "-1.00" })),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.createRefundRequest({ trusted: true }, refundInput({ reason: "  " })),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.createRefundRequest({ trusted: true }, refundInput()),
        (error) => error.statusCode === 409
    );
    assert.equal(db.getState().refunds.length, 0);
});

test("refund reservations include requested, approved, processing, and completed amounts", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "100.00",
            currency: "THB",
            status: "COMPLETED"
        }],
        refunds: [
            { refund_id: "requested", payment_id: "payment-1", amount: "10.00", currency: "THB", status: "REQUESTED" },
            { refund_id: "approved", payment_id: "payment-1", amount: "20.00", currency: "THB", status: "APPROVED" },
            { refund_id: "processing", payment_id: "payment-1", amount: "5.00", currency: "THB", status: "PROCESSING" },
            { refund_id: "completed", payment_id: "payment-1", amount: "15.00", currency: "THB", status: "COMPLETED" },
            { refund_id: "rejected", payment_id: "payment-1", amount: "90.00", currency: "THB", status: "REJECTED" }
        ]
    });
    let id = 0;
    const service = createService(db, { createId: () => `refund-new-${++id}` });

    await service.createRefundRequest(
        { trusted: true },
        refundInput({ amount: "50.00" })
    );
    await assert.rejects(
        service.createRefundRequest(
            { trusted: true },
            refundInput({ amount: "0.01" })
        ),
        (error) => error.statusCode === 409
    );
    assert.equal(db.getState().refunds.length, 6);
});

test("review requires a different authorized user and prevents repeat decisions", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, { createId: () => "refund-1" });
    await service.createRefundRequest(
        { trusted: true, actorUserId: "initiator-1" },
        refundInput()
    );

    await assert.rejects(
        service.decideRefundRequest(
            { trusted: true, actorUserId: "initiator-1" },
            { refund_id: "refund-1", decision: "APPROVED" }
        ),
        (error) => error.statusCode === 403
    );
    const decision = await service.decideRefundRequest(
        { trusted: true, actorUserId: "reviewer-1" },
        { refund_id: "refund-1", decision: "APPROVED" }
    );
    assert.equal(decision.status, "APPROVED");
    assert.equal(decision.review_decision, "APPROVED");
    assert.equal(decision.reviewer_user_id, "reviewer-1");
    assert.ok(decision.reviewed_at instanceof Date);
    assert.equal(db.getState().refunds[0].initiated_by, "initiator-1");
    assert.equal(db.getState().refunds[0].reviewer_user_id, "reviewer-1");

    await assert.rejects(
        service.decideRefundRequest(
            { trusted: true, actorUserId: "reviewer-2" },
            { refund_id: "refund-1", decision: "REJECTED" }
        ),
        (error) => error.statusCode === 409
    );
});

test("review can reject a request but cannot decide a rejected or invalid-status request again", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, { createId: () => "refund-1" });
    await service.createRefundRequest({ trusted: true }, refundInput());
    const decision = await service.decideRefundRequest(
        { trusted: true, actorUserId: "reviewer-1" },
        { refund_id: "refund-1", decision: "REJECTED" }
    );
    assert.equal(decision.status, "REJECTED");
    assert.equal(db.getState().refunds[0].review_decision, "REJECTED");
    await assert.rejects(
        service.decideRefundRequest(
            { trusted: true, actorUserId: "reviewer-2" },
            { refund_id: "refund-1", decision: "APPROVED" }
        ),
        (error) => error.statusCode === 409
    );
    await assert.rejects(
        service.decideRefundRequest(
            { trusted: true },
            { refund_id: "missing", decision: "APPROVED" }
        ),
        (error) => error.statusCode === 404
    );
});

test("refund operations require trusted can_refund authorization", async () => {
    let requestedPermission;
    const service = createService(createFakeDb(), {
        authorizeRefundActor: async (context, permission) => {
            requestedPermission = permission;
            return context?.trusted === true ? "authorized-user" : null;
        }
    });
    await assert.rejects(
        service.createRefundRequest({ trusted: false }, refundInput()),
        (error) => error.statusCode === 403
    );
    assert.equal(requestedPermission, "can_refund");

    const unavailableService = createService(createFakeDb(), {
        authorizeRefundActor: undefined
    });
    await assert.rejects(
        unavailableService.createRefundRequest({ trusted: true }, refundInput()),
        (error) => error.statusCode === 503
    );
});

test("concurrent refund requests cannot reserve more than the payment amount", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "100.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    let id = 0;
    const service = createService(db, { createId: () => `refund-${++id}` });
    const outcomes = await Promise.allSettled([
        service.createRefundRequest(
            { trusted: true, actorUserId: "requester-1" },
            refundInput({ amount: "70.00" })
        ),
        service.createRefundRequest(
            { trusted: true, actorUserId: "requester-2" },
            refundInput({ amount: "70.00" })
        )
    ]);

    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    assert.equal(db.getState().refunds.length, 1);
});

test("refund insert failure rolls back the request", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }],
        failInsert: true
    });
    await assert.rejects(
        createService(db).createRefundRequest({ trusted: true }, refundInput()),
        (error) => error.statusCode === 503
    );
    assert.equal(db.getState().refunds.length, 0);
});

test("only completed refunds affect Step 3 balance, not reservations", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "100.00",
            currency: "THB",
            status: "COMPLETED"
        }],
        refunds: [
            { refund_id: "requested", payment_id: "payment-1", amount: "10.00", currency: "THB", status: "REQUESTED" },
            { refund_id: "approved", payment_id: "payment-1", amount: "20.00", currency: "THB", status: "APPROVED" },
            { refund_id: "processing", payment_id: "payment-1", amount: "5.00", currency: "THB", status: "PROCESSING" },
            { refund_id: "rejected", payment_id: "payment-1", amount: "25.00", currency: "THB", status: "REJECTED" },
            { refund_id: "completed", payment_id: "payment-1", amount: "15.00", currency: "THB", status: "COMPLETED" }
        ]
    });
    const balance = await createService(db).getBalance("work-order-1");
    assert.equal(balance.completed_refunds_total, "15.00");
    assert.equal(balance.outstanding_balance, "15.00");
});

test("payment history filters by work order and paginates with stable sorting", async () => {
    const db = createFakeDb({
        payments: [
            {
                payment_id: "pay-a",
                work_order_id: "work-order-1",
                amount: "10.00",
                currency: "THB",
                payment_method: "approved-method",
                status: "COMPLETED",
                recorded_by: "staff-a",
                created_at: new Date("2026-01-02T00:00:00.000Z"),
                access_token: "do-not-return"
            },
            {
                payment_id: "pay-c",
                work_order_id: "work-order-1",
                amount: "30.00",
                currency: "THB",
                payment_method: "approved-method",
                status: "COMPLETED",
                recorded_by: "staff-c",
                created_at: new Date("2026-01-02T00:00:00.000Z")
            },
            {
                payment_id: "pay-b",
                work_order_id: "work-order-1",
                amount: "20.00",
                currency: "THB",
                payment_method: "approved-method",
                status: "FAILED",
                recorded_by: "staff-b",
                created_at: new Date("2026-01-01T00:00:00.000Z")
            },
            {
                payment_id: "other-work-order-payment",
                work_order_id: "work-order-2",
                amount: "40.00",
                currency: "THB",
                payment_method: "approved-method",
                status: "COMPLETED",
                created_at: new Date("2026-01-03T00:00:00.000Z")
            }
        ]
    });
    const service = createService(db);
    const result = await service.getPaymentHistory(
        { trusted: true },
        "work-order-1",
        { status: "COMPLETED", page: "1", page_size: "1" }
    );

    assert.deepEqual(result, {
        items: [{
            payment_id: "pay-c",
            work_order_id: "work-order-1",
            amount: "30.00",
            currency: "THB",
            payment_method: "approved-method",
            status: "COMPLETED",
            created_at: new Date("2026-01-02T00:00:00.000Z"),
            recorded_by: "staff-c"
        }],
        pagination: {
            page: 1,
            page_size: 1,
            total: 2,
            total_pages: 2
        }
    });
    assert.equal(
        Object.hasOwn(result.items[0], "access_token"),
        false
    );
});

test("payment history validates ranges and filters by date, status, and approved method", async () => {
    const db = createFakeDb({
        payments: [
            {
                payment_id: "new",
                work_order_id: "work-order-1",
                amount: "10.00",
                currency: "THB",
                payment_method: "approved-method",
                status: "COMPLETED",
                created_at: new Date("2026-03-10T12:00:00.000Z")
            },
            {
                payment_id: "old",
                work_order_id: "work-order-1",
                amount: "20.00",
                currency: "THB",
                payment_method: "approved-method",
                status: "FAILED",
                created_at: new Date("2026-03-01T12:00:00.000Z")
            }
        ]
    });
    const service = createService(db);
    const filtered = await service.getPaymentHistory(
        { trusted: true },
        "work-order-1",
        {
            from: "2026-03-10T00:00:00.000Z",
            to: "2026-03-11T00:00:00.000Z",
            status: "COMPLETED",
            payment_method: "approved-method"
        }
    );
    assert.deepEqual(filtered.items.map((row) => row.payment_id), ["new"]);
    assert.equal(filtered.pagination.total, 1);
    await assert.rejects(
        service.getPaymentHistory(
            { trusted: true },
            "work-order-1",
            { payment_method: "unapproved" }
        ),
        (error) => error.statusCode === 400
    );
});

test("payment detail returns only safe fields and requires query authorization", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            payment_method: "approved-method",
            status: "COMPLETED",
            recorded_by: "staff-1",
            created_at: new Date("2026-01-01T00:00:00.000Z"),
            raw_token: "secret"
        }]
    });
    const service = createService(db);
    const result = await service.getPaymentDetails(
        { trusted: true },
        "payment-1"
    );
    assert.deepEqual(result, {
        payment_id: "payment-1",
        work_order_id: "work-order-1",
        amount: "50.00",
        currency: "THB",
        payment_method: "approved-method",
        status: "COMPLETED",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        recorded_by: "staff-1"
    });
    await assert.rejects(
        service.getPaymentDetails({ trusted: false }, "payment-1"),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        service.getPaymentDetails({ trusted: true }, "unknown"),
        (error) => error.statusCode === 404
    );
});

test("payment history rejects records with a currency inconsistent with the account", async () => {
    const service = createService(createFakeDb({
        payments: [{
            payment_id: "bad-currency",
            work_order_id: "work-order-1",
            amount: "10.00",
            currency: "USD",
            payment_method: "approved-method",
            status: "COMPLETED",
            created_at: new Date("2026-01-01T00:00:00.000Z")
        }]
    }));
    await assert.rejects(
        service.getPaymentHistory({ trusted: true }, "work-order-1"),
        (error) => error.statusCode === 409
    );
});

test("payment history rejects malformed filters, ranges, pagination, and unknown work orders", async () => {
    const service = createService(createFakeDb());
    for (const query of [
        { status: "UNKNOWN" },
        { page: "0" },
        { page_size: "101" },
        { page_size: "1; DROP TABLE payments" },
        { from: "not-a-date" },
        {
            from: "2026-04-02T00:00:00.000Z",
            to: "2026-04-01T00:00:00.000Z"
        },
        { unexpected: "parameter" }
    ]) {
        await assert.rejects(
            service.getPaymentHistory({ trusted: true }, "work-order-1", query),
            (error) => error.statusCode === 400
        );
    }
    await assert.rejects(
        service.getPaymentHistory({ trusted: true }, "missing"),
        (error) => error.statusCode === 404
    );
});

test("refund history filters by payment and work order and excludes execution metadata", async () => {
    const db = createFakeDb({
        accounts: [
            {
                work_order_id: "work-order-1",
                customer_id: "customer-1",
                amount_due: "100.00",
                currency: "THB"
            },
            {
                work_order_id: "work-order-2",
                customer_id: "customer-2",
                amount_due: "100.00",
                currency: "THB"
            }
        ],
        payments: [
            {
                payment_id: "payment-1",
                work_order_id: "work-order-1",
                amount: "50.00",
                currency: "THB",
                status: "COMPLETED"
            },
            {
                payment_id: "payment-2",
                work_order_id: "work-order-2",
                amount: "30.00",
                currency: "THB",
                status: "COMPLETED"
            }
        ],
        refunds: [
            {
                refund_id: "refund-a",
                payment_id: "payment-1",
                amount: "10.00",
                currency: "THB",
                reason: "Customer request",
                status: "COMPLETED",
                initiated_by: "initiator-1",
                reviewer_user_id: "reviewer-1",
                review_decision: "APPROVED",
                reviewed_at: new Date("2026-04-01T00:00:00.000Z"),
                execution_result: "SUCCEEDED",
                external_reference_id: "private-provider-data",
                idempotency_key: "secret-key",
                created_at: new Date("2026-04-01T00:00:00.000Z"),
                updated_at: new Date("2026-04-01T01:00:00.000Z")
            },
            {
                refund_id: "refund-b",
                payment_id: "payment-2",
                amount: "5.00",
                currency: "THB",
                reason: "Other",
                status: "REQUESTED",
                initiated_by: "initiator-2",
                created_at: new Date("2026-04-02T00:00:00.000Z"),
                updated_at: new Date("2026-04-02T00:00:00.000Z")
            }
        ]
    });
    const service = createService(db);
    const byPayment = await service.getRefundHistory(
        { trusted: true },
        { payment_id: "payment-1" }
    );
    assert.equal(byPayment.pagination.total, 1);
    assert.deepEqual(byPayment.items[0], {
        refund_id: "refund-a",
        payment_id: "payment-1",
        amount: "10.00",
        currency: "THB",
        reason: "Customer request",
        status: "COMPLETED",
        initiated_by: "initiator-1",
        reviewer_user_id: "reviewer-1",
        review_decision: "APPROVED",
        reviewed_at: new Date("2026-04-01T00:00:00.000Z"),
        execution_result: "SUCCEEDED",
        created_at: new Date("2026-04-01T00:00:00.000Z"),
        updated_at: new Date("2026-04-01T01:00:00.000Z")
    });
    assert.equal(Object.hasOwn(byPayment.items[0], "external_reference_id"), false);
    assert.equal(Object.hasOwn(byPayment.items[0], "idempotency_key"), false);

    const byWorkOrder = await service.getRefundHistory(
        { trusted: true },
        {
            work_order_id: "work-order-2",
            status: "REQUESTED",
            from: "2026-04-01T00:00:00.000Z",
            to: "2026-04-03T00:00:00.000Z",
            page: "1",
            page_size: "1"
        }
    );
    assert.deepEqual(byWorkOrder.items.map((refund) => refund.refund_id), ["refund-b"]);
    assert.deepEqual(byWorkOrder.pagination, {
        page: 1,
        page_size: 1,
        total: 1,
        total_pages: 1
    });
});

test("refund detail is scoped through trusted query authorization", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }],
        refunds: [{
            refund_id: "refund-1",
            payment_id: "payment-1",
            amount: "10.00",
            currency: "THB",
            reason: "Requested",
            status: "APPROVED",
            initiated_by: "initiator",
            reviewer_user_id: "reviewer",
            review_decision: "APPROVED",
            reviewed_at: new Date("2026-05-01T00:00:00.000Z"),
            execution_result: "UNKNOWN",
            external_reference_id: "must-not-be-returned",
            idempotency_key: "must-not-be-returned",
            created_at: new Date("2026-05-01T00:00:00.000Z"),
            updated_at: new Date("2026-05-01T00:00:00.000Z")
        }]
    });
    const service = createService(db);
    const detail = await service.getRefundDetails({ trusted: true }, "refund-1");
    assert.equal(detail.execution_result, "UNKNOWN");
    assert.equal(detail.initiated_by, "initiator");
    assert.equal(Object.hasOwn(detail, "external_reference_id"), false);
    assert.equal(Object.hasOwn(detail, "idempotency_key"), false);
    await assert.rejects(
        service.getRefundDetails({ trusted: false }, "refund-1"),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        service.getRefundDetails({ trusted: true }, "missing"),
        (error) => error.statusCode === 404
    );
});

test("refund history validates scope, filters, and trusted authorization", async () => {
    const service = createService(createFakeDb());
    await assert.rejects(
        service.getRefundHistory({ trusted: true }, {}),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.getRefundHistory(
            { trusted: true },
            { payment_id: "payment-1", status: "UNKNOWN" }
        ),
        (error) => error.statusCode === 400
    );
    await assert.rejects(
        service.getRefundHistory(
            { trusted: true },
            { payment_id: "missing" }
        ),
        (error) => error.statusCode === 404
    );
    await assert.rejects(
        service.getRefundHistory(
            { trusted: false },
            { work_order_id: "work-order-1" }
        ),
        (error) => error.statusCode === 403
    );
});

test("history methods fail closed when trusted authorization providers are absent", async () => {
    const service = createService(createFakeDb(), {
        authorizePaymentQuery: undefined,
        authorizeRefundQuery: undefined
    });
    await assert.rejects(
        service.getPaymentHistory({}, "work-order-1"),
        (error) => error.statusCode === 503
    );
    await assert.rejects(
        service.getRefundHistory({}, { payment_id: "payment-1" }),
        (error) => error.statusCode === 503
    );
});

test("approved refund executes through processing to confirmed completion", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, {
        createId: (() => {
            let nextId = 0;
            return () => `generated-${++nextId}`;
        })()
    });
    const refundId = await createApprovedRefund(service);

    const result = await service.executeRefund(
        { trusted: true, actorUserId: "executor-1" },
        { refund_id: refundId }
    );
    const refund = db.getState().refunds[0];
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.execution_result, "SUCCEEDED");
    assert.equal(result.external_reference_id, `test-refund-${refundId}`);
    assert.equal(refund.status, "COMPLETED");
    assert.equal(refund.executing_by, "executor-1");
    assert.equal(refund.execution_attempts, 1);
    assert.equal(refund.idempotency_key, `refund:${refundId}`);
    assert.ok(refund.execution_started_at instanceof Date);
    assert.deepEqual(db.getState().audit_logs.map((event) => event.action), [
        "refund.requested",
        "refund.approved",
        "refund.execution.started",
        "refund.execution.completed"
    ]);
    assert.equal(
        db.getState().audit_logs.at(-1).metadata.execution_result,
        "SUCCEEDED"
    );

    const balance = await service.getBalance("work-order-1");
    assert.equal(balance.completed_refunds_total, "20.25");
    assert.equal(balance.outstanding_balance, "70.25");
    await assert.rejects(
        service.executeRefund(
            { trusted: true, actorUserId: "executor-2" },
            { refund_id: refundId }
        ),
        (error) => error.statusCode === 409
    );
});

test("execution rejects unapproved and rejected refunds", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, { createId: () => "refund-1" });
    await service.createRefundRequest(
        { trusted: true, actorUserId: "initiator-1" },
        refundInput()
    );
    await assert.rejects(
        service.executeRefund({ trusted: true }, { refund_id: "refund-1" }),
        (error) => error.statusCode === 409
    );
    await service.decideRefundRequest(
        { trusted: true, actorUserId: "reviewer-1" },
        { refund_id: "refund-1", decision: "REJECTED" }
    );
    await assert.rejects(
        service.executeRefund({ trusted: true }, { refund_id: "refund-1" }),
        (error) => error.statusCode === 409
    );
    assert.equal(db.getState().refunds[0].status, "REJECTED");
});

test("confirmed provider failure releases reservation and supports idempotent retry", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    let callCount = 0;
    const receivedKeys = [];
    const service = createService(db, {
        createId: (() => {
            let nextId = 0;
            return () => `generated-${++nextId}`;
        })(),
        refundProvider: {
            async executeRefund(request) {
                receivedKeys.push(request.idempotency_key);
                callCount += 1;
                return callCount === 1
                    ? { outcome: "failed" }
                    : { outcome: "succeeded", external_reference_id: "provider-ref-2" };
            }
        }
    });
    const refundId = await createApprovedRefund(service);

    const failed = await service.executeRefund(
        { trusted: true, actorUserId: "executor-1" },
        { refund_id: refundId }
    );
    assert.equal(failed.status, "FAILED");
    assert.equal(db.getState().refunds[0].execution_result, "FAILED");
    const retried = await service.executeRefund(
        { trusted: true, actorUserId: "executor-2" },
        { refund_id: refundId }
    );
    assert.equal(retried.status, "COMPLETED");
    assert.deepEqual(receivedKeys, [`refund:${refundId}`, `refund:${refundId}`]);
    assert.equal(db.getState().refunds[0].execution_attempts, 2);
    assert.deepEqual(
        db.getState().audit_logs
            .filter((event) => event.action.startsWith("refund.execution."))
            .map((event) => event.action),
        [
            "refund.execution.started",
            "refund.execution.failed",
            "refund.execution.started",
            "refund.execution.retry_attempted",
            "refund.execution.completed"
        ]
    );
});

test("confirmed failure releases refundable capacity for a new request", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, {
        createId: (() => {
            let nextId = 0;
            return () => `generated-${++nextId}`;
        })(),
        refundProvider: {
            async executeRefund() {
                return { outcome: "failed" };
            }
        }
    });
    const refundId = await createApprovedRefund(service);
    await service.executeRefund(
        { trusted: true, actorUserId: "executor-1" },
        { refund_id: refundId }
    );

    const replacement = await service.createRefundRequest(
        { trusted: true, actorUserId: "requester-2" },
        refundInput({ amount: "29.75" })
    );
    assert.equal(replacement.status, "REQUESTED");
    assert.equal(db.getState().refunds[0].status, "FAILED");
    assert.equal(db.getState().refunds[1].amount, "29.75");
});

test("unknown provider outcome remains PROCESSING and can be retried with same idempotency key", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    let attempt = 0;
    const keys = [];
    const service = createService(db, {
        createId: (() => {
            let nextId = 0;
            return () => `generated-${++nextId}`;
        })(),
        refundProvider: {
            async executeRefund(request) {
                keys.push(request.idempotency_key);
                attempt += 1;
                if (attempt === 1) {
                    throw new Error("provider timed out");
                }
                return { outcome: "succeeded", external_reference_id: "provider-ref" };
            }
        }
    });
    const refundId = await createApprovedRefund(service);

    const uncertain = await service.executeRefund(
        { trusted: true, actorUserId: "executor-1" },
        { refund_id: refundId }
    );
    assert.equal(uncertain.status, "PROCESSING");
    assert.equal(uncertain.execution_result, "UNKNOWN");
    assert.equal(db.getState().refunds[0].execution_lease_token, null);
    assert.equal(db.getState().refunds[0].status, "PROCESSING");

    const completed = await service.executeRefund(
        { trusted: true, actorUserId: "executor-2" },
        { refund_id: refundId }
    );
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(keys, [`refund:${refundId}`, `refund:${refundId}`]);
    assert.deepEqual(
        db.getState().audit_logs
            .filter((event) => event.action.startsWith("refund.execution."))
            .map((event) => event.action),
        [
            "refund.execution.started",
            "refund.execution.unknown",
            "refund.execution.started",
            "refund.execution.retry_attempted",
            "refund.execution.completed"
        ]
    );
});

test("concurrent execution is rejected while another worker holds its lease", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    let releaseProvider;
    let providerStarted;
    const started = new Promise((resolve) => {
        providerStarted = resolve;
    });
    const providerGate = new Promise((resolve) => {
        releaseProvider = resolve;
    });
    const service = createService(db, {
        createId: (() => {
            let nextId = 0;
            return () => `generated-${++nextId}`;
        })(),
        refundProvider: {
            async executeRefund() {
                providerStarted();
                await providerGate;
                return { outcome: "succeeded" };
            }
        }
    });
    const refundId = await createApprovedRefund(service);

    const firstExecution = service.executeRefund(
        { trusted: true, actorUserId: "executor-1" },
        { refund_id: refundId }
    );
    await started;
    await assert.rejects(
        service.executeRefund(
            { trusted: true, actorUserId: "executor-2" },
            { refund_id: refundId }
        ),
        (error) => error.statusCode === 409
    );
    releaseProvider();
    assert.equal((await firstExecution).status, "COMPLETED");
});

test("execution requires trusted authorization and a configured real provider boundary", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, {
        createId: () => "refund-1",
        refundProvider: undefined
    });
    const refundId = await createApprovedRefund(service);

    await assert.rejects(
        service.executeRefund({ trusted: false }, { refund_id: refundId }),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        service.executeRefund({ trusted: true }, { refund_id: refundId }),
        (error) => error.statusCode === 503
    );
    assert.equal(db.getState().refunds[0].status, "APPROVED");
});

test("execution claim transaction rolls back when the status update fails", async () => {
    const db = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const service = createService(db, {
        createId: (() => {
            let nextId = 0;
            return () => `generated-${++nextId}`;
        })()
    });
    const refundId = await createApprovedRefund(service);
    db.setUpdateFailure(true);
    await assert.rejects(
        service.executeRefund(
            { trusted: true, actorUserId: "executor-1" },
            { refund_id: refundId }
        ),
        (error) => error.statusCode === 503
    );
    assert.equal(db.getState().refunds[0].status, "APPROVED");
});

test("execution start and completion audit failures preserve reconcilable state", async () => {
    const startFailureDb = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const startFailureService = createService(startFailureDb);
    const startFailureRefund = await createApprovedRefund(startFailureService);
    startFailureDb.setAuditInsertFailure(true);
    await assert.rejects(
        startFailureService.executeRefund(
            { trusted: true, actorUserId: "executor-1" },
            { refund_id: startFailureRefund }
        ),
        (error) => error.statusCode === 503
    );
    assert.equal(startFailureDb.getState().refunds[0].status, "APPROVED");

    const completionFailureDb = createFakeDb({
        payments: [{
            payment_id: "payment-1",
            work_order_id: "work-order-1",
            amount: "50.00",
            currency: "THB",
            status: "COMPLETED"
        }]
    });
    const completionFailureService = createService(completionFailureDb, {
        refundProvider: {
            async executeRefund() {
                completionFailureDb.setAuditInsertFailure(true);
                return { outcome: "succeeded" };
            }
        }
    });
    const completionFailureRefund = await createApprovedRefund(
        completionFailureService
    );
    await assert.rejects(
        completionFailureService.executeRefund(
            { trusted: true, actorUserId: "executor-1" },
            { refund_id: completionFailureRefund }
        ),
        (error) => error.statusCode === 503
            && error.message === "Audit log persistence failed"
    );
    const state = completionFailureDb.getState();
    assert.equal(state.refunds[0].status, "PROCESSING");
    assert.equal(state.refunds[0].execution_result, "UNKNOWN");
    assert.ok(state.refunds[0].execution_lease_token);
    assert.equal(
        state.audit_logs.some((event) =>
            event.action === "refund.execution.completed"
        ),
        false
    );
});
