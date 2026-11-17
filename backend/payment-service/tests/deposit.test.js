const assert = require("node:assert/strict");
const test = require("node:test");
const AppError = require("../../shared/errors/AppError");
const { createPaymentService } = require("../src/services/paymentService");

// Booking deposits against a small in-memory stand-in for the tables they use.

const UNIQUE = {
    deposits: ["booking_id"],
    idempotency_records: ["scope_key", "operation", "idempotency_key"]
};

function memoryDb() {
    const tables = { deposits: [], deposit_audit_logs: [], idempotency_records: [] };

    function query(name) {
        const filters = [];
        let limit = Infinity;
        const rows = () => (tables[name] || []).filter((row) => filters.every((f) => f(row))).slice(0, limit);
        const builder = {
            select() { return builder; },
            forUpdate() { return builder; },
            orderBy() { return builder; },
            limit(n) { limit = n; return builder; },
            where(criteria) {
                if (typeof criteria === "function") {
                    const nested = [];
                    criteria({ where(obj) { nested.push(obj); return this; } });
                    for (const obj of nested) filters.push((row) => Object.entries(obj).every(([k, v]) => row[k] === v));
                } else {
                    filters.push((row) => Object.entries(criteria).every(([k, v]) => row[k] === v));
                }
                return builder;
            },
            async first() { return rows()[0] ? { ...rows()[0] } : undefined; },
            async insert(row) {
                const keys = UNIQUE[name] || [];
                if (keys.length && tables[name].some((r) => keys.every((k) => r[k] === row[k]))) {
                    throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
                }
                tables[name].push({ ...row });
            },
            async update(changes) {
                const hit = rows();
                hit.forEach((row) => Object.assign(row, changes));
                return hit.length;
            },
            then(resolve, reject) { return Promise.resolve(rows().map((r) => ({ ...r }))).then(resolve, reject); }
        };
        return builder;
    }

    const db = (name) => query(name);
    db.transaction = async (work) => work(db);
    db.tables = tables;
    return db;
}

const NOW = Date.parse("2026-11-18T03:00:00Z");
const CUSTOMER = { userId: "cust-1" };
const OTHER = { userId: "cust-2" };
const SHOP = { userId: "admin-1" };
const AUTH = "Bearer t";

function setup({ booking } = {}) {
    const db = memoryDb();
    const bookings = new Map();
    const put = (b) => bookings.set(b.booking_id, { customer_id: CUSTOMER.userId, status: "AWAITING_DEPOSIT", deposit_due_at: new Date(NOW + 5 * 60e3).toISOString(), work_order_id: null, ...b });
    if (booking) put(booking);
    const payments = createPaymentService({
        db,
        requestPermission: async (ctx, permission) => (ctx.userId === SHOP.userId
            ? ["payment.record", "payment.view_all"].includes(permission)
            : permission === "payment.view_own"),
        requestCustomerId: async () => null,
        loadBooking: async (bookingId) => {
            if (!bookings.has(bookingId)) throw new AppError("Booking not found", 404);
            return { booking_id: bookingId, ...bookings.get(bookingId) };
        },
        depositAmount: 200,
        now: () => NOW
    });
    return { db, payments, bookings, put };
}

test("a customer pays the deposit once for their own held booking", async () => {
    const { db, payments } = setup({ booking: { booking_id: "b-1" } });
    const paid = await payments.payDeposit(CUSTOMER, { booking_id: "b-1", payment_method: "PROMPTPAY" }, "key-0000001", AUTH);
    assert.equal(paid.status, "PAID");
    assert.equal(paid.amount, 200);
    assert.match(paid.reference_number, /^MOCK-[A-Z0-9]{12}$/);
    assert.equal(db.tables.deposit_audit_logs[0].action, "deposit.paid");
    assert.equal(db.tables.deposit_audit_logs[0].deposit_id, paid.deposit_id);

    // Paying again returns the same deposit; a different person never can.
    assert.equal((await payments.payDeposit(CUSTOMER, { booking_id: "b-1", payment_method: "CARD" }, "key-0000002", AUTH)).deposit_id, paid.deposit_id);
    await assert.rejects(payments.payDeposit(OTHER, { booking_id: "b-1", payment_method: "CARD" }, "key-0000003", AUTH), { statusCode: 404 });
    assert.equal(db.tables.deposits.length, 1);
});

test("deposit payment is refused for bookings not waiting for one, expired holds and bad input", async () => {
    const { payments, put } = setup();
    put({ booking_id: "b-done", status: "CONFIRMED" });
    put({ booking_id: "b-late", deposit_due_at: new Date(NOW - 1000).toISOString() });
    put({ booking_id: "b-ok" });
    await assert.rejects(payments.payDeposit(CUSTOMER, { booking_id: "b-done", payment_method: "CARD" }, "key-0000004", AUTH), { statusCode: 409 });
    await assert.rejects(payments.payDeposit(CUSTOMER, { booking_id: "b-late", payment_method: "CARD" }, "key-0000005", AUTH), { statusCode: 409 });
    await assert.rejects(payments.payDeposit(CUSTOMER, { booking_id: "b-ok", payment_method: "CASH" }, "key-0000006", AUTH), { statusCode: 400 });
    await assert.rejects(payments.payDeposit(CUSTOMER, { booking_id: "b-ok", payment_method: "CARD" }, "bad", AUTH), { statusCode: 400 });
    await assert.rejects(payments.payDeposit(SHOP, { booking_id: "b-ok", payment_method: "CARD" }, "key-0000007", AUTH), { statusCode: 403 });
});

test("the payer and the shop can see a deposit; other customers cannot", async () => {
    const { payments } = setup({ booking: { booking_id: "b-1" } });
    await payments.payDeposit(CUSTOMER, { booking_id: "b-1", payment_method: "CARD" }, "key-0000008", AUTH);
    assert.equal((await payments.getDeposit(CUSTOMER, "b-1")).status, "PAID");
    assert.equal((await payments.getDeposit(SHOP, "b-1")).status, "PAID");
    await assert.rejects(payments.getDeposit(OTHER, "b-1"), { statusCode: 404 });
    await assert.rejects(payments.getDeposit(SHOP, "b-none"), { statusCode: 404 });
    assert.equal((await payments.listDeposits(SHOP, {})).items.length, 1);
    assert.equal((await payments.listDeposits(OTHER, {})).items.length, 0);
});

test("settle follows the booking: refund on cancel, forfeit on no-show, apply on check-in; idempotent", async () => {
    const { db, payments, bookings, put } = setup();
    for (const id of ["b-cancel", "b-noshow", "b-done", "b-open"]) {
        put({ booking_id: id });
        await payments.payDeposit(CUSTOMER, { booking_id: id, payment_method: "CARD" }, `key-${id}-0001`, AUTH);
    }
    bookings.get("b-cancel").status = "CANCELLED";
    bookings.get("b-noshow").status = "NO_SHOW";
    Object.assign(bookings.get("b-done"), { status: "COMPLETED", work_order_id: "wo-9" });
    bookings.get("b-open").status = "CONFIRMED";

    assert.equal((await payments.settleDeposit(CUSTOMER, "b-cancel", AUTH)).status, "REFUNDED");
    assert.equal((await payments.settleDeposit(SHOP, "b-noshow", AUTH)).status, "FORFEITED");
    const applied = await payments.settleDeposit(SHOP, "b-done", AUTH);
    assert.equal(applied.status, "APPLIED");
    assert.equal(applied.work_order_id, "wo-9");
    assert.equal((await payments.settleDeposit(SHOP, "b-open", AUTH)).status, "PAID");

    // Settled once: later calls change nothing, even if the booking changed.
    bookings.get("b-cancel").status = "NO_SHOW";
    assert.equal((await payments.settleDeposit(SHOP, "b-cancel", AUTH)).status, "REFUNDED");
    assert.deepEqual(db.tables.deposit_audit_logs.map((a) => a.action).filter((a) => a !== "deposit.paid"),
        ["deposit.refunded", "deposit.forfeited", "deposit.applied"]);
    await assert.rejects(payments.settleDeposit(OTHER, "b-open", AUTH), { statusCode: 404 });
});
