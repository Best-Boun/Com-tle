const assert = require("node:assert/strict");
const test = require("node:test");
const { createPaymentService } = require("../src/services/paymentService");

// No database here: these rules must hold before any query runs.
// Database behaviour is covered by paymentService.database.integration.test.js.

function untouchableDb() {
    const db = () => {
        throw new Error("database must not be touched");
    };
    db.transaction = () => {
        throw new Error("database must not be touched");
    };
    return db;
}

function service({ db = untouchableDb(), allowed = [], customerId = null } = {}) {
    return createPaymentService({
        db,
        requestPermission: async (_context, permission) => allowed.includes(permission),
        requestCustomerId: async () => customerId
    });
}

const admin = { userId: "admin-1" };

test("service requires a database, permission checker and customer resolver", () => {
    assert.throws(() => createPaymentService({}), /required/);
    assert.throws(() => createPaymentService({ db: untouchableDb(), requestPermission() {} }), /required/);
});

test("every write is denied without the matching permission before the database is used", async () => {
    const payments = service({ allowed: ["payment.view_own"] });
    const denied = (error) => error.statusCode === 403;
    await assert.rejects(payments.registerBill(admin, {}), denied);
    await assert.rejects(payments.recordPayment(admin, {}, "key-12345"), denied);
    await assert.rejects(payments.voidPayment(admin, "p-1", { reason: "x" }), denied);
    await assert.rejects(payments.lockWorkOrderPayments(admin, "wo-1", { reason: "x" }), denied);
    await assert.rejects(payments.unlockWorkOrderPayments(admin, "wo-1", { reason: "x" }), denied);
    await assert.rejects(payments.requestRefund(admin, {}, "key-12345"), denied);
    await assert.rejects(payments.approveRefund(admin, "r-1"), denied);
    await assert.rejects(payments.rejectRefund(admin, "r-1", { reason: "x" }), denied);
    await assert.rejects(payments.executeRefund(admin, "r-1"), denied);
    await assert.rejects(payments.listPayments(admin, {}), denied);
    await assert.rejects(payments.listBalances(admin), denied);
    await assert.rejects(payments.listRefunds(admin, {}), denied);
});

test("payment.record does not grant refund operations", async () => {
    const payments = service({ allowed: ["payment.record"] });
    await assert.rejects(payments.approveRefund(admin, "r-1"), (error) => error.statusCode === 403);
});

test("missing authentication is 401", async () => {
    const payments = service({ allowed: ["payment.record"] });
    await assert.rejects(payments.recordPayment({}, {}, "key-12345"), (error) => error.statusCode === 401);
});

test("invalid input is rejected with 400 before the database is used", async () => {
    const payments = service({ allowed: ["payment.record", "payment.refund", "payment.view_all"] });
    const bad = (error) => error.statusCode === 400;
    const valid = { work_order_id: "wo-1", amount: 100, payment_method: "CASH" };
    for (const input of [
        { ...valid, amount: 0 },
        { ...valid, amount: -5 },
        { ...valid, amount: 10.5 },
        { ...valid, amount: "10.50" },
        { ...valid, amount: 10_000_000_001 },
        { ...valid, payment_method: "BITCOIN" },
        { ...valid, recorded_by: "someone-else" },
        { ...valid, currency: "USD" }
    ]) {
        await assert.rejects(payments.recordPayment(admin, input, "key-12345"), bad);
    }
    await assert.rejects(payments.voidPayment(admin, "p-1", { reason: "  " }), bad);
    await assert.rejects(payments.rejectRefund(admin, "r-1", {}), bad);
    await assert.rejects(payments.lockWorkOrderPayments(admin, "wo-1", {}), bad);
    await assert.rejects(payments.unlockWorkOrderPayments(admin, "wo-1", { reason: " " }), bad);
    await assert.rejects(payments.requestRefund(admin, { payment_id: "p-1", amount: 5 }, "key-12345"), bad);
    await assert.rejects(payments.registerBill(admin, {
        work_order_id: "wo-1", bill_id: "b-1", bill_version: 1, customer_id: "c-1",
        total_amount: 100, currency: "USD"
    }), bad);
    await assert.rejects(payments.listPayments(admin, { page_size: "500" }), bad);
    await assert.rejects(payments.listRefunds(admin, { status: "CANCELLED" }), bad);
});

test("POST payment and refund require a well-formed Idempotency-Key", async () => {
    const payments = service({ allowed: ["payment.record", "payment.refund"] });
    const bad = (error) => error.statusCode === 400 && /Idempotency-Key/.test(error.message);
    const payment = { work_order_id: "wo-1", amount: 100, payment_method: "CASH" };
    for (const key of [undefined, "", "short", "has space in it", "x".repeat(101)]) {
        await assert.rejects(payments.recordPayment(admin, payment, key), bad);
    }
    await assert.rejects(
        payments.requestRefund(admin, { payment_id: "p-1", amount: 5, reason: "x" }, undefined),
        bad
    );
});

test("database and dependency failures surface as 503 without internal details", async () => {
    const brokenDb = () => {
        throw new Error("connect ECONNREFUSED secret-host:3306");
    };
    brokenDb.transaction = async () => {
        throw new Error("connect ECONNREFUSED secret-host:3306");
    };
    const payments = service({ db: brokenDb, allowed: ["payment.record", "payment.view_all"] });
    const unavailable = (error) => error.statusCode === 503 && !/secret-host/.test(error.message);
    await assert.rejects(
        payments.recordPayment(admin, { work_order_id: "wo-1", amount: 1, payment_method: "CASH" }, "key-12345"),
        unavailable
    );
    await assert.rejects(payments.listPayments(admin, {}), unavailable);

    const flaky = createPaymentService({
        db: untouchableDb(),
        requestPermission: async () => {
            throw new Error("socket hang up");
        },
        requestCustomerId: async () => null
    });
    await assert.rejects(flaky.listBalances(admin), (error) => error.statusCode === 503);
});
