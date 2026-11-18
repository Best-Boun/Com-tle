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
    device_type: "DESKTOP",
    symptom_group: "WONT_POWER_ON",
    reported_symptom: "เปิดไม่ติด",
    contact_name: "สมชาย",
    contact_phone: "0812345678"
});

test("health is public, request routes need a token", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/health`)).status, 200);
        assert.equal((await fetch(`${base}/me`)).status, 401);
    });
});

test("customer can create and list own requests, but not list all", async () => {
    await withServer(async (base) => {
        const created = await fetch(base, { method: "POST", headers: headers(C1, ["CUSTOMER"]), body: payload });
        assert.equal(created.status, 201);
        const request = (await created.json()).data;
        assert.equal(request.status, "PENDING");
        assert.match(request.booking_number, /^RQ-/);

        const mine = await fetch(`${base}/me`, { headers: headers(C1, ["CUSTOMER"]) });
        assert.equal((await mine.json()).data.length, 1);

        assert.equal((await fetch(base, { headers: headers(C1, ["CUSTOMER"]) })).status, 403);
        assert.equal((await fetch(`${base}/${request.booking_id}`, { headers: headers(C1, ["CUSTOMER"]) })).status, 200);
    });
});

test("admin cannot create requests; technician has no request access", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(base, { method: "POST", headers: headers(A1, ["ADMIN"]), body: payload })).status, 403);
        assert.equal((await fetch(`${base}/me`, { headers: headers("t1", ["TECHNICIAN"]) })).status, 403);
        assert.equal((await fetch(`${base}/options`, { headers: headers("t1", ["TECHNICIAN"]) })).status, 403);
    });
});

test("full flow: create -> counter search by phone -> check-in (COMPLETED)", async () => {
    await withServer(async (base) => {
        const created = await fetch(base, { method: "POST", headers: headers(C1, ["CUSTOMER"]), body: payload });
        const { booking_id: id } = (await created.json()).data;

        const found = await fetch(`${base}/?search=081-234-5678`, { headers: headers(A1, ["ADMIN"]) });
        assert.equal(found.status, 200);
        assert.deepEqual((await found.json()).data.map((r) => r.booking_id), [id]);

        assert.equal((await fetch(`${base}/${id}/check-in`, { method: "POST", headers: headers(C1, ["CUSTOMER"]) })).status, 403);
        const checkIn = await fetch(`${base}/${id}/check-in`, {
            method: "POST",
            headers: headers(A1, ["ADMIN"]),
            body: JSON.stringify({ accessories: "สายชาร์จ", intake_terms_acknowledged: true })
        });
        assert.equal(checkIn.status, 200);
        const body = await checkIn.json();
        assert.equal(body.data.status, "COMPLETED");
        assert.ok(body.data.work_order_id);
    });
});

test("options are served; the old appointment routes are gone", async () => {
    await withServer(async (base) => {
        const options = await fetch(`${base}/options`, { headers: headers(C1, ["CUSTOMER"]) });
        assert.equal(options.status, 200);
        assert.ok((await options.json()).data.symptom_groups.includes("WONT_POWER_ON"));

        const id = "11111111-1111-4111-8111-111111111111";
        assert.equal((await fetch(`${base}/availability?date=2026-11-12`, { headers: headers(C1, ["CUSTOMER"]) })).status, 404);
        assert.equal((await fetch(`${base}/queue`, { headers: headers(A1, ["ADMIN"]) })).status, 404);
        for (const [path, method] of [[`/${id}/confirm`, "PATCH"], [`/${id}/no-show`, "PATCH"], [`/${id}/claim`, "POST"]]) {
            assert.equal((await fetch(`${base}${path}`, { method, headers: headers(A1, ["ADMIN"]) })).status, 404, path);
        }
    });
});
