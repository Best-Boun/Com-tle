const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const { createBookingService } = require("../src/services/bookingService");
const { createAuthenticate } = require("../../shared/middleware/serviceAuth");
const {
    ISSUER,
    AUDIENCE,
    publicKey,
    signToken,
    FIXED_NOW,
    TEST_CONFIG,
    SERVICE_ID,
    createFakeBookingRepository,
    createFakeClients
} = require("./helpers");

const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A1 = "aaaaaaaa-0000-4000-8000-000000000009";

async function withServer(fn) {
    const clients = createFakeClients();
    const app = createApp({
        bookingService: createBookingService({
            bookingRepository: createFakeBookingRepository(),
            catalogClient: clients.catalogClient,
            repairClient: clients.repairClient,
            config: TEST_CONFIG,
            now: () => FIXED_NOW
        }),
        authenticate: createAuthenticate({ jwt, publicKey, issuer: ISSUER, audience: AUDIENCE }),
        healthCheck: async () => {}
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await fn(base);
    } finally {
        server.close();
    }
}

const headers = (userId, roles) => ({
    authorization: `Bearer ${signToken(userId, roles)}`,
    "content-type": "application/json"
});

const payload = JSON.stringify({
    service_id: SERVICE_ID,
    appointment_date: "2026-11-12",
    appointment_time: "10:00",
    device_type: "PC",
    reported_symptom: "เปิดไม่ติด"
});

test("health is public, booking routes need a token", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/health`)).status, 200);
        assert.equal((await fetch(`${base}/me`)).status, 401);
    });
});

test("customer can create and list own bookings, but not list all", async () => {
    await withServer(async (base) => {
        const created = await fetch(base, { method: "POST", headers: headers(C1, ["CUSTOMER"]), body: payload });
        assert.equal(created.status, 201);
        const booking = (await created.json()).data;

        const mine = await fetch(`${base}/me`, { headers: headers(C1, ["CUSTOMER"]) });
        assert.equal((await mine.json()).data.length, 1);

        assert.equal((await fetch(base, { headers: headers(C1, ["CUSTOMER"]) })).status, 403);
        assert.equal((await fetch(`${base}/${booking.booking_id}`, { headers: headers(C1, ["CUSTOMER"]) })).status, 200);
    });
});

test("admin cannot create bookings; technician has no booking access", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(base, { method: "POST", headers: headers(A1, ["ADMIN"]), body: payload })).status, 403);
        assert.equal((await fetch(`${base}/me`, { headers: headers("t1", ["TECHNICIAN"]) })).status, 403);
    });
});

test("full flow: create -> confirm -> check-in (COMPLETED)", async () => {
    await withServer(async (base) => {
        const created = await fetch(base, { method: "POST", headers: headers(C1, ["CUSTOMER"]), body: payload });
        const { booking_id: id } = (await created.json()).data;

        assert.equal((await fetch(`${base}/${id}/confirm`, { method: "PATCH", headers: headers(C1, ["CUSTOMER"]) })).status, 403);
        assert.equal((await fetch(`${base}/${id}/confirm`, { method: "PATCH", headers: headers(A1, ["ADMIN"]) })).status, 200);

        const checkIn = await fetch(`${base}/${id}/check-in`, { method: "POST", headers: headers(A1, ["ADMIN"]) });
        assert.equal(checkIn.status, 200);
        const body = await checkIn.json();
        assert.equal(body.data.status, "COMPLETED");
        assert.ok(body.data.work_order_id);
    });
});

test("availability route returns configured slots", async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/availability?date=2026-11-12`, { headers: headers(C1, ["CUSTOMER"]) });
        assert.equal(res.status, 200);
        assert.deepEqual((await res.json()).data.slots.map((s) => s.time), TEST_CONFIG.slotTimes);
    });
});
