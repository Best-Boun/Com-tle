process.env.TZ = "UTC";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const knexFactory = require("knex");
const { createPaymentService } = require("../src/services/paymentService");

// Runs the service against a real MySQL loaded with the Railway baseline schema.
// Opt-in: PAYMENT_SERVICE_ALLOW_DATABASE_TESTS=1 plus DB_TEST_* pointing at a
// loopback, test-only database. The tables in that database are recreated.
const enabled = process.env.PAYMENT_SERVICE_ALLOW_DATABASE_TESTS === "1";
const TABLES = [
    "payment_audit_logs", "outbox_events", "refunds", "payments",
    "inbox_events", "idempotency_records", "payment_locks"
];

function testTarget() {
    if (!enabled) {
        return null;
    }
    for (const name of ["DB_TEST_HOST", "DB_TEST_PORT", "DB_TEST_USER", "DB_TEST_PASSWORD", "DB_TEST_NAME"]) {
        if (!process.env[name]) {
            throw new Error("Dedicated DB_TEST_* settings are required");
        }
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(process.env.DB_TEST_HOST.toLowerCase())) {
        throw new Error("Payment database tests require a loopback DB_TEST_HOST");
    }
    if (!/^[A-Za-z0-9_]+$/.test(process.env.DB_TEST_NAME)
        || !/(^|_)test($|_)/i.test(process.env.DB_TEST_NAME)) {
        throw new Error("DB_TEST_NAME must be an isolated test-only database");
    }
    return {
        host: process.env.DB_TEST_HOST,
        port: Number(process.env.DB_TEST_PORT),
        user: process.env.DB_TEST_USER,
        password: process.env.DB_TEST_PASSWORD,
        database: process.env.DB_TEST_NAME,
        multipleStatements: true
    };
}

const target = testTarget();
const options = target ? {} : { skip: "set PAYMENT_SERVICE_ALLOW_DATABASE_TESTS=1 and DB_TEST_*" };

const ADMIN_A = "00000000-0000-4000-8000-00000000000a";
const ADMIN_B = "00000000-0000-4000-8000-00000000000b";
const CUSTOMER_USER = "00000000-0000-4000-8000-0000000000c1";
const OTHER_USER = "00000000-0000-4000-8000-0000000000c2";
const CUSTOMER = "00000000-0000-4000-8000-00000000cc01";
const OTHER_CUSTOMER = "00000000-0000-4000-8000-00000000cc02";
const ADMIN_PERMISSIONS = ["payment.record", "payment.refund", "payment.view_all"];
const grants = new Map([
    [ADMIN_A, ADMIN_PERMISSIONS],
    [ADMIN_B, ADMIN_PERMISSIONS],
    [CUSTOMER_USER, ["payment.view_own"]],
    [OTHER_USER, ["payment.view_own"]]
]);
const customers = new Map([[CUSTOMER_USER, CUSTOMER], [OTHER_USER, OTHER_CUSTOMER]]);
const as = (userId) => ({ userId });

let db;
let payments;
let workOrderCounter = 0;

function newWorkOrderId() {
    workOrderCounter += 1;
    return `00000000-0000-4000-9000-${String(workOrderCounter).padStart(12, "0")}`;
}

async function issueBill(workOrderId, totalAmount, { version = 1, customerId = CUSTOMER } = {}) {
    return payments.registerBill(as(ADMIN_A), {
        work_order_id: workOrderId,
        bill_id: workOrderId.replace("9000", "b111"),
        bill_version: version,
        customer_id: customerId,
        total_amount: totalAmount
    });
}

let keyCounter = 0;
const nextKey = () => `test-key-${++keyCounter}-${Date.now()}`;

function pay(workOrderId, amount, { actor = ADMIN_A, key = nextKey(), method = "CASH" } = {}) {
    return payments.recordPayment(as(actor), {
        work_order_id: workOrderId, amount, payment_method: method
    }, key);
}

test.before(async () => {
    if (!target) {
        return;
    }
    db = knexFactory({ client: "mysql2", connection: target, pool: { min: 0, max: 6 } });
    await db.raw("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) {
        await db.schema.dropTableIfExists(table);
    }
    await db.raw("SET FOREIGN_KEY_CHECKS = 1");
    const baseline = fs.readFileSync(
        path.resolve(__dirname, "../baseline/001_payment_service_fresh_schema.sql"),
        "utf8"
    );
    await db.raw(baseline);
    payments = createPaymentService({
        db,
        requestPermission: async (context, permission) =>
            (grants.get(context.userId) || []).includes(permission),
        requestCustomerId: async (context) => customers.get(context.userId) || null
    });
});

test.after(async () => {
    await db?.destroy();
});

test("bills: registration, versioning and balance", options, async () => {
    const workOrderId = newWorkOrderId();
    const first = await issueBill(workOrderId, 1500);
    assert.equal(first.outstanding_balance, 1500);

    await assert.rejects(issueBill(workOrderId, 1800), (error) => error.statusCode === 409);
    await assert.rejects(
        issueBill(workOrderId, 1800, { version: 2, customerId: OTHER_CUSTOMER }),
        (error) => error.statusCode === 409
    );
    await issueBill(workOrderId, 1800, { version: 2 });

    const balance = await payments.getBalance(as(ADMIN_B), workOrderId);
    assert.deepEqual(
        { version: balance.bill_version, total: balance.bill_total, due: balance.outstanding_balance },
        { version: 2, total: 1800, due: 1800 }
    );
    await assert.rejects(payments.getBalance(as(ADMIN_A), newWorkOrderId()), (error) => error.statusCode === 404);
});

test("payments: partial payments, overpayment, audit and outbox in one transaction", options, async () => {
    const workOrderId = newWorkOrderId();
    await assert.rejects(pay(workOrderId, 100), (error) => error.statusCode === 404);
    await issueBill(workOrderId, 1000);

    const first = await pay(workOrderId, 400, { method: "TRANSFER" });
    assert.equal(first.status, "SUCCEEDED");
    assert.equal(first.recorded_by, ADMIN_A);
    assert.equal(first.bill_version, 1);
    assert.equal(first.outstanding_balance, 600);
    await assert.rejects(pay(workOrderId, 601), (error) => error.statusCode === 409);
    await pay(workOrderId, 600);
    await assert.rejects(pay(workOrderId, 1), (error) => error.statusCode === 409);

    const balance = await payments.getBalance(as(ADMIN_A), workOrderId);
    assert.equal(balance.paid_total, 1000);
    assert.equal(balance.outstanding_balance, 0);

    const audits = await db("payment_audit_logs").where({ payment_id: first.payment_id });
    assert.deepEqual(audits.map((row) => [row.action, row.actor_user_id]), [["payment.recorded", ADMIN_A]]);
    const events = await db("outbox_events").where({ payment_id: first.payment_id });
    assert.deepEqual(events.map((row) => [row.event_type, row.status]), [["payment.succeeded", "PENDING"]]);
});

test("payments: a revised bill version is what new payments are recorded against", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 500);
    await pay(workOrderId, 500);
    await issueBill(workOrderId, 700, { version: 2 });
    const topUp = await pay(workOrderId, 200);
    assert.equal(topUp.bill_version, 2);
    assert.equal(topUp.outstanding_balance, 0);
});

test("payments: locked work orders refuse new payments", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 300);
    await db("payment_locks").where({ work_order_id: workOrderId })
        .update({ is_locked: true, lock_reason: "Dispute", locked_at: new Date() });
    await assert.rejects(pay(workOrderId, 100), (error) => error.statusCode === 423);
    assert.equal((await payments.getBalance(as(ADMIN_A), workOrderId)).is_locked, true);
});

test("idempotency: replay returns the first result, a changed body is refused", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 900);
    const key = nextKey();
    const first = await pay(workOrderId, 300, { key });
    const replay = await pay(workOrderId, 300, { key });
    assert.equal(replay.replayed, true);
    assert.equal(replay.payment_id, first.payment_id);
    await assert.rejects(pay(workOrderId, 301, { key }), (error) => error.statusCode === 422);
    // The same key from another admin is a separate scope.
    const other = await pay(workOrderId, 300, { key, actor: ADMIN_B });
    assert.notEqual(other.payment_id, first.payment_id);
    assert.equal((await db("payments").where({ work_order_id: workOrderId })).length, 2);

    // A failed attempt leaves no record, so the same key can be retried.
    const retryKey = nextKey();
    await assert.rejects(pay(workOrderId, 5000, { key: retryKey }), (error) => error.statusCode === 409);
    const retried = await pay(workOrderId, 300, { key: retryKey });
    assert.equal(retried.outstanding_balance, 0);
});

test("concurrency: simultaneous payments cannot exceed the bill", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 1000);
    const results = await Promise.allSettled([
        pay(workOrderId, 1000), pay(workOrderId, 1000, { actor: ADMIN_B }), pay(workOrderId, 600)
    ]);
    const succeeded = results.filter((result) => result.status === "fulfilled");
    assert.equal(succeeded.length, 1);
    for (const failed of results.filter((result) => result.status === "rejected")) {
        assert.equal(failed.reason.statusCode, 409);
    }
    const [{ total }] = await db("payments").sum({ total: "amount" })
        .where({ work_order_id: workOrderId, status: "SUCCEEDED" });
    assert.ok(Number(total) <= 1000);
});

test("void: needs a reason, restores the balance and is blocked by refunds", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 800);
    const payment = await pay(workOrderId, 800);
    const voided = await payments.voidPayment(as(ADMIN_B), payment.payment_id, { reason: "Wrong work order" });
    assert.equal(voided.status, "VOIDED");
    assert.equal(voided.voided_by, ADMIN_B);
    await assert.rejects(
        payments.voidPayment(as(ADMIN_B), payment.payment_id, { reason: "again" }),
        (error) => error.statusCode === 409
    );
    assert.equal((await payments.getBalance(as(ADMIN_A), workOrderId)).outstanding_balance, 800);
    const events = await db("outbox_events").where({ payment_id: payment.payment_id }).orderBy("created_at");
    assert.deepEqual(events.map((row) => row.event_type).sort(), ["payment.succeeded", "payment.voided"]);

    const refunded = await pay(workOrderId, 800);
    await payments.requestRefund(as(ADMIN_A), {
        payment_id: refunded.payment_id, amount: 100, reason: "Part returned"
    }, nextKey());
    await assert.rejects(
        payments.voidPayment(as(ADMIN_B), refunded.payment_id, { reason: "x" }),
        (error) => error.statusCode === 409
    );
    await assert.rejects(
        payments.voidPayment(as(ADMIN_B), newWorkOrderId(), { reason: "x" }),
        (error) => error.statusCode === 404
    );
});

test("refunds: two-person approval and execution with the manual provider", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 1000);
    const payment = await pay(workOrderId, 1000);

    const refund = await payments.requestRefund(as(ADMIN_A), {
        payment_id: payment.payment_id, amount: 300, reason: "Part not installed"
    }, nextKey());
    assert.equal(refund.status, "REQUESTED");
    await assert.rejects(
        payments.requestRefund(as(ADMIN_B), {
            payment_id: payment.payment_id, amount: 701, reason: "Too much"
        }, nextKey()),
        (error) => error.statusCode === 409
    );

    await assert.rejects(payments.approveRefund(as(ADMIN_A), refund.refund_id), (error) => error.statusCode === 403);
    await assert.rejects(payments.executeRefund(as(ADMIN_B), refund.refund_id), (error) => error.statusCode === 409);
    const approved = await payments.approveRefund(as(ADMIN_B), refund.refund_id);
    assert.equal(approved.approved_by, ADMIN_B);
    await assert.rejects(payments.executeRefund(as(ADMIN_A), refund.refund_id), (error) => error.statusCode === 403);
    const completed = await payments.executeRefund(as(ADMIN_B), refund.refund_id);
    assert.equal(completed.status, "COMPLETED");

    const balance = await payments.getBalance(as(ADMIN_A), workOrderId);
    assert.deepEqual([balance.paid_total, balance.refunded_total, balance.outstanding_balance], [1000, 300, 300]);

    const actions = (await db("payment_audit_logs").where({ refund_id: refund.refund_id }))
        .map((row) => row.action).sort();
    assert.deepEqual(actions, ["refund.approved", "refund.completed", "refund.requested"]);
    const events = await db("outbox_events").where({ refund_id: refund.refund_id });
    assert.deepEqual(events.map((row) => row.event_type), ["refund.completed"]);

    const second = await payments.requestRefund(as(ADMIN_B), {
        payment_id: payment.payment_id, amount: 700, reason: "Customer cancelled"
    }, nextKey());
    await assert.rejects(payments.rejectRefund(as(ADMIN_A), second.refund_id, {}), (error) => error.statusCode === 400);
    const rejected = await payments.rejectRefund(as(ADMIN_A), second.refund_id, { reason: "Policy" });
    assert.equal(rejected.status, "REJECTED");
    await assert.rejects(payments.approveRefund(as(ADMIN_A), second.refund_id), (error) => error.statusCode === 409);
    // A rejected refund frees the reserved amount.
    await payments.requestRefund(as(ADMIN_B), {
        payment_id: payment.payment_id, amount: 700, reason: "Customer cancelled"
    }, nextKey());
});

test("customers see only their own balances and payments", options, async () => {
    const mine = newWorkOrderId();
    const theirs = newWorkOrderId();
    await issueBill(mine, 400);
    await issueBill(theirs, 900, { customerId: OTHER_CUSTOMER });
    await pay(mine, 150);
    await pay(theirs, 900);

    assert.equal((await payments.getBalance(as(CUSTOMER_USER), mine)).outstanding_balance, 250);
    await assert.rejects(payments.getBalance(as(CUSTOMER_USER), theirs), (error) => error.statusCode === 403);
    // An unknown work order looks the same as someone else's.
    await assert.rejects(payments.getBalance(as(CUSTOMER_USER), newWorkOrderId()), (error) => error.statusCode === 403);
    await assert.rejects(pay(mine, 10, { actor: CUSTOMER_USER }), (error) => error.statusCode === 403);
    await assert.rejects(payments.listPayments(as(CUSTOMER_USER), {}), (error) => error.statusCode === 403);

    const own = await payments.listMyPayments(as(CUSTOMER_USER));
    const ownWorkOrders = own.items.map((item) => item.work_order_id);
    assert.ok(ownWorkOrders.includes(mine));
    assert.ok(!ownWorkOrders.includes(theirs));
    const item = own.items.find((entry) => entry.work_order_id === mine);
    assert.equal(item.payments.length, 1);
    assert.equal(item.payments[0].recorded_by, undefined);
});

test("admin lists: payments, balances and refunds with filters", options, async () => {
    const workOrderId = newWorkOrderId();
    await issueBill(workOrderId, 500);
    await pay(workOrderId, 200, { method: "CARD" });

    const list = await payments.listPayments(as(ADMIN_A), { work_order_id: workOrderId });
    assert.deepEqual(list.items.map((row) => [row.amount, row.payment_method]), [[200, "CARD"]]);
    const cardOnly = await payments.listPayments(as(ADMIN_A), { payment_method: "CARD", page_size: "1" });
    assert.equal(cardOnly.items.length, 1);

    const balances = await payments.listBalances(as(ADMIN_B));
    assert.equal(balances.items.find((row) => row.work_order_id === workOrderId).outstanding_balance, 300);

    const refunds = await payments.listRefunds(as(ADMIN_A), { status: "COMPLETED" });
    assert.ok(refunds.items.every((row) => row.status === "COMPLETED"));
});
