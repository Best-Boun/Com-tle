const assert = require("node:assert/strict");
const test = require("node:test");
const { createBookingService } = require("../src/services/bookingService");
const { zonedToUtc, utcToZoned } = require("../src/utils/time");
const {
    FIXED_NOW,
    TEST_CONFIG,
    SERVICE_ID,
    DIAGNOSIS_SERVICE_ID,
    createFakeBookingRepository,
    createFakeClients
} = require("./helpers");

const CUSTOMER = { userId: "aaaaaaaa-0000-4000-8000-000000000001", roles: ["CUSTOMER"] };
const OTHER_CUSTOMER = { userId: "aaaaaaaa-0000-4000-8000-000000000002", roles: ["CUSTOMER"] };
const ADMIN = { userId: "aaaaaaaa-0000-4000-8000-000000000009", roles: ["ADMIN"] };
const CTX = { authorization: "Bearer token" };

function setup({ now = FIXED_NOW, ...extra } = {}) {
    const repo = createFakeBookingRepository({ now: () => now });
    const clients = createFakeClients();
    const service = createBookingService({
        ...extra,
        bookingRepository: repo,
        catalogClient: clients.catalogClient,
        repairClient: clients.repairClient,
        config: TEST_CONFIG,
        now: () => now
    });
    return { repo, clients, service };
}

function requestInput(overrides = {}) {
    return {
        device_type: "NOTEBOOK",
        brand: "Asus",
        model: "VivoBook 15",
        serial_number: "SN-123",
        symptom_group: "OVERHEATING_OR_NOISE",
        reported_symptom: "เครื่องร้อนและดับเอง",
        contact_name: "สมชาย ใจดี",
        contact_phone: "081-234-5678",
        ...overrides
    };
}

test("time helpers convert Bangkok wall-clock time to UTC and back", () => {
    const utc = zonedToUtc("2026-11-12", "10:00", "Asia/Bangkok");
    assert.equal(utc.toISOString(), "2026-11-12T03:00:00.000Z");
    assert.deepEqual(utcToZoned(utc, "Asia/Bangkok"), { date: "2026-11-12", time: "10:00" });
});

test("a request gets an RQ number, no time slot, and is for a diagnosis by default", async () => {
    const { service, repo, clients } = setup();
    const request = await service.createBooking(requestInput(), CUSTOMER, CTX);

    assert.equal(request.status, "PENDING");
    assert.match(request.booking_number, /^RQ-20261111-[A-Z2-9]{6}$/);
    assert.equal(request.customer_id, CUSTOMER.userId);
    assert.equal(request.scheduled_at, null);
    assert.equal(request.appointment_date, undefined);
    assert.equal(request.device_type, "NOTEBOOK");
    assert.equal(request.symptom_group, "OVERHEATING_OR_NOISE");
    assert.equal(request.reported_symptom, "เครื่องร้อนและดับเอง");
    assert.equal(request.contact_name, "สมชาย ใจดี");
    assert.equal(request.contact_phone, "0812345678");
    assert.equal(request.service_id, DIAGNOSIS_SERVICE_ID);
    assert.equal(request.service_code, "HW-DIAG");
    assert.equal(request.service_starting_price, 300);
    assert.equal(clients.calls.catalog[0].ctx.authorization, "Bearer token");
    assert.deepEqual(repo.history.map((h) => [h.old_status, h.new_status]), [[null, "PENDING"]]);
});

test("a customer may pick a known service instead of a diagnosis", async () => {
    const { service } = setup();
    const request = await service.createBooking(requestInput({ service_id: SERVICE_ID }), CUSTOMER, CTX);
    assert.equal(request.service_code, "PC-CLEAN");
    assert.equal(request.service_starting_price, 500);

    await assert.rejects(
        service.createBooking(requestInput({ service_id: "99999999-9999-4999-8999-999999999999" }), CUSTOMER, CTX),
        { statusCode: 400 }
    );
});

test("invalid requests are rejected, including the old appointment fields", async () => {
    const { service } = setup();
    for (const bad of [
        { device_type: "PHONE" },
        { symptom_group: "BROKEN" },
        { reported_symptom: " " },
        { contact_name: "" },
        { contact_phone: "12345" },
        { appointment_date: "2026-11-12" },
        { status: "COMPLETED" }
    ]) {
        await assert.rejects(service.createBooking(requestInput(bad), CUSTOMER, CTX), { statusCode: 400 }, JSON.stringify(bad));
    }
    const ok = await service.createBooking(requestInput({ contact_phone: "+66 81 234 5678" }), CUSTOMER, CTX);
    assert.equal(ok.contact_phone, "0812345678");
});

test("one customer can only have a few open requests at a time", async () => {
    const { service } = setup();
    const first = await service.createBooking(requestInput(), CUSTOMER, CTX);
    await service.createBooking(requestInput(), CUSTOMER, CTX);
    await service.createBooking(requestInput(), CUSTOMER, CTX);
    await assert.rejects(service.createBooking(requestInput(), CUSTOMER, CTX), { statusCode: 409 });

    // Another customer is not affected; cancelling one frees a place.
    await service.createBooking(requestInput(), OTHER_CUSTOMER, CTX);
    await service.cancelBooking(first.booking_id, {}, CUSTOMER);
    await service.createBooking(requestInput(), CUSTOMER, CTX);
});

test("other customers cannot see or cancel a request (404); the owner sees its history", async () => {
    const { service } = setup();
    const request = await service.createBooking(requestInput(), CUSTOMER, CTX);

    await assert.rejects(service.getBooking(request.booking_id, OTHER_CUSTOMER), { statusCode: 404 });
    await assert.rejects(service.cancelBooking(request.booking_id, {}, OTHER_CUSTOMER), { statusCode: 404 });
    await assert.rejects(service.getBooking("not-a-uuid", CUSTOMER), { statusCode: 404 });

    const mine = await service.getBooking(request.booking_id, CUSTOMER);
    assert.equal(mine.status_history.length, 1);
});

test("listMyBookings only returns the caller's requests", async () => {
    const { service } = setup();
    await service.createBooking(requestInput(), CUSTOMER, CTX);
    await service.createBooking(requestInput(), OTHER_CUSTOMER, CTX);

    const mine = await service.listMyBookings({}, CUSTOMER);
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].customer_id, CUSTOMER.userId);
    assert.equal(mine.meta.totalItems, 1);
    assert.equal((await service.listMyBookings({ date: "2026-11-11" }, CUSTOMER)).items.length, 1);
    assert.equal((await service.listMyBookings({ date: "2026-11-12" }, CUSTOMER)).items.length, 0);
});

test("the counter finds a request by its number or by the customer's phone", async () => {
    const { service } = setup();
    const a = await service.createBooking(requestInput({ contact_phone: "0812345678" }), CUSTOMER, CTX);
    const b = await service.createBooking(requestInput({ contact_phone: "0899999999" }), OTHER_CUSTOMER, CTX);

    const ids = async (search) => (await service.listBookings({ search })).items.map((r) => r.booking_id);
    assert.deepEqual(await ids(a.booking_number), [a.booking_id]);
    assert.deepEqual(await ids(a.booking_number.toLowerCase()), [a.booking_id]);
    assert.deepEqual(await ids("081-234"), [a.booking_id]);
    assert.deepEqual(await ids("5678"), [a.booking_id]);
    assert.deepEqual(await ids("0899999999"), [b.booking_id]);
    assert.deepEqual(await ids("abc"), []);
    assert.equal((await service.listBookings({})).items.length, 2);
});

test("check-in creates exactly one work order with the request's details", async () => {
    const { service, clients } = setup();
    const request = await service.createBooking(requestInput(), CUSTOMER, CTX);

    const done = await service.checkIn(request.booking_id, ADMIN, CTX, {
        accessories: "  สายชาร์จ  ",
        intake_terms_acknowledged: true
    });
    assert.equal(done.status, "COMPLETED");
    assert.ok(done.work_order_id);

    assert.equal(clients.calls.repair.length, 1);
    const { payload, ctx } = clients.calls.repair[0];
    assert.equal(ctx.idempotencyKey, `booking-${request.booking_id}`);
    assert.equal(payload.source, "BOOKING");
    assert.equal(payload.booking_id, request.booking_id);
    assert.equal(payload.booking_number, request.booking_number);
    assert.equal(payload.customer_id, CUSTOMER.userId);
    assert.equal(payload.service_code, "HW-DIAG");
    // Same text as the walk-in form, and the symptom group in front for the technician.
    assert.equal(payload.device_type, "โน้ตบุ๊ก");
    assert.equal(payload.reported_symptom, "[ร้อนผิดปกติ / พัดลมดัง] เครื่องร้อนและดับเอง");
    assert.equal(payload.accessories, "สายชาร์จ");
    assert.equal(payload.intake_terms_acknowledged, true);
    // No appointment: Repair gets the time the request was made.
    assert.equal(payload.scheduled_at, FIXED_NOW.toISOString());
    assert.equal(payload.technician_user_id, undefined);

    await assert.rejects(service.checkIn(request.booking_id, ADMIN, CTX), { statusCode: 409 });
    assert.equal(clients.calls.repair.length, 1);
    await assert.rejects(service.checkIn(request.booking_id, ADMIN, CTX, { surprise: 1 }), { statusCode: 400 });
});

test("check-in keeps the request open when Repair fails; the retry reuses the key", async () => {
    const { service, clients } = setup();
    const request = await service.createBooking(requestInput(), CUSTOMER, CTX);

    clients.state.repairFails = true;
    await assert.rejects(service.checkIn(request.booking_id, ADMIN, CTX), { statusCode: 503 });
    assert.equal((await service.getBooking(request.booking_id, ADMIN)).status, "PENDING");

    clients.state.repairFails = false;
    const done = await service.checkIn(request.booking_id, ADMIN, CTX);
    assert.equal(done.status, "COMPLETED");
    assert.equal(clients.calls.repair[0].ctx.idempotencyKey, clients.calls.repair[1].ctx.idempotencyKey);
});

test("cancel: the customer any time while open, the shop with a reason; closed requests stay closed", async () => {
    const { service } = setup();
    const own = await service.createBooking(requestInput(), CUSTOMER, CTX);
    const cancelled = await service.cancelBooking(own.booking_id, { reason: "ซ่อมเองได้แล้ว" }, CUSTOMER);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.cancelled_by, CUSTOMER.userId);
    assert.equal(cancelled.cancellation_reason, "ซ่อมเองได้แล้ว");
    await assert.rejects(service.cancelBooking(own.booking_id, {}, CUSTOMER), { statusCode: 409 });

    const other = await service.createBooking(requestInput(), CUSTOMER, CTX);
    await assert.rejects(service.cancelBooking(other.booking_id, {}, ADMIN), { statusCode: 400 });
    const byShop = await service.cancelBooking(other.booking_id, { reason: "ลูกค้าโทรมายกเลิก" }, ADMIN);
    assert.equal(byShop.cancelled_by, ADMIN.userId);

    const checkedIn = await service.createBooking(requestInput(), CUSTOMER, CTX);
    await service.checkIn(checkedIn.booking_id, ADMIN, CTX);
    await assert.rejects(service.cancelBooking(checkedIn.booking_id, {}, CUSTOMER), { statusCode: 409 });
});

test("a request-number collision is retried with a new number", async () => {
    const numbers = ["RQ-20261111-AAAAAA", "RQ-20261111-AAAAAA", "RQ-20261111-BBBBBB"];
    const { service } = setup({ createRequestNumber: () => numbers.shift() });
    const first = await service.createBooking(requestInput(), CUSTOMER, CTX);
    const second = await service.createBooking(requestInput(), OTHER_CUSTOMER, CTX);
    assert.equal(first.booking_number, "RQ-20261111-AAAAAA");
    assert.equal(second.booking_number, "RQ-20261111-BBBBBB");
});

test("old appointment bookings still show their time and can be checked in or cancelled", async () => {
    const { service, repo, clients } = setup();
    const legacyId = "dddddddd-0000-4000-8000-000000000001";
    repo.bookings.set(legacyId, {
        booking_id: legacyId,
        booking_number: "BK-20261112-OLDOLD",
        customer_id: CUSTOMER.userId,
        contact_name: null,
        contact_phone: null,
        service_id: SERVICE_ID,
        service_code: "PC-CLEAN",
        service_name: "PC Cleaning",
        service_starting_price: 500,
        service_currency: "THB",
        device_type: "PC",
        symptom_group: null,
        reported_symptom: "เปิดไม่ติด",
        scheduled_at: new Date("2026-11-12T03:00:00Z"),
        status: "CONFIRMED",
        technician_id: "bbbbbbbb-0000-4000-8000-000000000001",
        work_order_id: null,
        created_at: new Date("2026-11-01T03:00:00Z")
    });

    const shown = await service.getBooking(legacyId, CUSTOMER);
    assert.equal(shown.appointment_date, "2026-11-12");
    assert.equal(shown.appointment_time, "10:00");
    assert.deepEqual((await service.listBookings({ search: "BK-20261112" })).items.map((b) => b.booking_id), [legacyId]);

    const done = await service.checkIn(legacyId, ADMIN, CTX);
    assert.equal(done.status, "COMPLETED");
    assert.equal(clients.calls.repair[0].payload.scheduled_at, "2026-11-12T03:00:00.000Z");
    assert.equal(clients.calls.repair[0].payload.technician_user_id, "bbbbbbbb-0000-4000-8000-000000000001");
});

test("statuses left by the old flow cannot be checked in", async () => {
    const { service, repo } = setup();
    for (const [n, status] of [[1, "NO_SHOW"], [2, "AWAITING_DEPOSIT"], [3, "EXPIRED"]]) {
        const id = `eeeeeeee-0000-4000-8000-00000000000${n}`;
        repo.bookings.set(id, {
            booking_id: id,
            booking_number: `BK-OLD-${n}`,
            customer_id: CUSTOMER.userId,
            status,
            scheduled_at: null,
            created_at: FIXED_NOW
        });
        await assert.rejects(service.checkIn(id, ADMIN, CTX), { statusCode: 409 }, status);
        await assert.rejects(service.cancelBooking(id, { reason: "x" }, ADMIN), { statusCode: 409 }, status);
    }
});

test("the form options list the device types and symptom groups", () => {
    const { service } = setup();
    const options = service.getOptions();
    assert.deepEqual(options.device_types, ["NOTEBOOK", "DESKTOP", "ALL_IN_ONE", "OTHER"]);
    assert.ok(options.symptom_groups.includes("WONT_POWER_ON"));
    assert.ok(options.symptom_groups.includes("OTHER"));
});

test("requests nobody brought in within 30 days expire; newer and closed ones stay", async () => {
    let clock = FIXED_NOW;
    const { service, repo } = setup({ now: FIXED_NOW });

    const timed = createBookingService({
        bookingRepository: repo,
        catalogClient: createFakeClients().catalogClient,
        repairClient: createFakeClients().repairClient,
        config: TEST_CONFIG,
        now: () => clock
    });

    const old = await service.createBooking(requestInput(), CUSTOMER, CTX);
    const done = await service.createBooking(requestInput(), CUSTOMER, CTX);
    await service.checkIn(done.booking_id, ADMIN, CTX);
    // A request made 29 days later than the first one.
    repo.bookings.set("ffffffff-0000-4000-8000-000000000001", {
        ...repo.bookings.get(old.booking_id),
        booking_id: "ffffffff-0000-4000-8000-000000000001",
        booking_number: "RQ-NEWER",
        created_at: new Date(FIXED_NOW.getTime() + 29 * 86400000)
    });


    clock = new Date(FIXED_NOW.getTime() + 30 * 86400000 + 1000);
    assert.equal(await timed.expireStaleRequests(), 1);
    assert.equal(repo.bookings.get(old.booking_id).status, "EXPIRED");
    assert.equal(repo.bookings.get(done.booking_id).status, "COMPLETED");
    assert.equal(repo.bookings.get("ffffffff-0000-4000-8000-000000000001").status, "PENDING");
    const entry = repo.history.find((h) => h.booking_id === old.booking_id && h.new_status === "EXPIRED");
    assert.equal(entry.changed_by, null);
    assert.match(entry.reason, /30 days/);

    // Running again changes nothing; an expired request cannot be checked in.
    assert.equal(await timed.expireStaleRequests(), 0);
    await assert.rejects(timed.checkIn(old.booking_id, ADMIN, CTX), { statusCode: 409 });
});
