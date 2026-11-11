const assert = require("node:assert/strict");
const test = require("node:test");
const { createBookingService } = require("../src/services/bookingService");
const { zonedToUtc, utcToZoned } = require("../src/utils/time");
const {
    FIXED_NOW,
    TEST_CONFIG,
    SERVICE_ID,
    createFakeBookingRepository,
    createFakeClients
} = require("./helpers");

const CUSTOMER = { userId: "aaaaaaaa-0000-4000-8000-000000000001", roles: ["CUSTOMER"] };
const OTHER_CUSTOMER = { userId: "aaaaaaaa-0000-4000-8000-000000000002", roles: ["CUSTOMER"] };
const ADMIN = { userId: "aaaaaaaa-0000-4000-8000-000000000009", roles: ["ADMIN"] };
const CTX = { authorization: "Bearer token" };

function makeService(repo, clients, now = FIXED_NOW, extra = {}) {
    return createBookingService({
        ...extra,
        bookingRepository: repo,
        catalogClient: clients.catalogClient,
        repairClient: clients.repairClient,
        config: TEST_CONFIG,
        now: () => now
    });
}

function setup(now = FIXED_NOW) {
    const repo = createFakeBookingRepository();
    const clients = createFakeClients();
    return { repo, clients, service: makeService(repo, clients, now) };
}

function bookingInput(overrides = {}) {
    return {
        service_id: SERVICE_ID,
        appointment_date: "2026-11-12",
        appointment_time: "10:00",
        device_type: "Notebook",
        brand: "Asus",
        serial_number: "SN-123",
        reported_symptom: "เครื่องร้อนและดับเอง",
        ...overrides
    };
}

test("time helpers convert Bangkok wall-clock time to UTC and back", () => {
    const utc = zonedToUtc("2026-11-12", "10:00", "Asia/Bangkok");
    assert.equal(utc.toISOString(), "2026-11-12T03:00:00.000Z");
    assert.deepEqual(utcToZoned(utc, "Asia/Bangkok"), { date: "2026-11-12", time: "10:00" });
});

test("createBooking stores UTC scheduled_at, team columns, and starts as PENDING", async () => {
    const { service, repo, clients } = setup();
    const booking = await service.createBooking(bookingInput(), CUSTOMER, CTX);

    assert.equal(booking.status, "PENDING");
    assert.equal(booking.customer_id, CUSTOMER.userId);
    assert.equal(booking.scheduled_at, "2026-11-12T03:00:00.000Z");
    assert.equal(booking.appointment_date, "2026-11-12");
    assert.equal(booking.appointment_time, "10:00");
    assert.equal(booking.serial_number, "SN-123");
    assert.equal(booking.reported_symptom, "เครื่องร้อนและดับเอง");
    assert.match(booking.booking_number, /^BK-20261112-[A-Z2-9]{6}$/);
    assert.equal(booking.service_code, "PC-CLEAN");
    assert.equal(booking.service_name, "PC Cleaning");
    assert.equal(booking.service_starting_price, 500);
    assert.equal(booking.service_currency, "THB");
    assert.equal(clients.calls.catalog[0].ctx.authorization, "Bearer token");
    assert.equal(repo.history.length, 1);
    assert.equal(repo.history[0].new_status, "PENDING");
    assert.equal(repo.history[0].old_status, null);
});

test("createBooking rejects non-slot times, past slots and far-future dates", async () => {
    const { service } = setup();
    await assert.rejects(service.createBooking(bookingInput({ appointment_time: "10:30" }), CUSTOMER, CTX), { statusCode: 400 });
    await assert.rejects(service.createBooking(bookingInput({ appointment_date: "2026-11-11", appointment_time: "10:00" }), CUSTOMER, CTX), { statusCode: 400 });
    await assert.rejects(service.createBooking(bookingInput({ appointment_date: "2026-11-10" }), CUSTOMER, CTX), { statusCode: 400 });
    await assert.rejects(service.createBooking(bookingInput({ appointment_date: "2026-12-12" }), CUSTOMER, CTX), { statusCode: 400 });
    const ok = await service.createBooking(bookingInput({ appointment_date: "2026-11-11", appointment_time: "11:00" }), CUSTOMER, CTX);
    assert.equal(ok.status, "PENDING");
});

test("createBooking rejects invalid dates and fields the client must not set", async () => {
    const { service } = setup();
    await assert.rejects(service.createBooking(bookingInput({ appointment_date: "2026-02-30" }), CUSTOMER, CTX), { statusCode: 400 });
    await assert.rejects(service.createBooking(bookingInput({ customer_id: OTHER_CUSTOMER.userId }), CUSTOMER, CTX), { statusCode: 400 });
    await assert.rejects(service.createBooking(bookingInput({ status: "CONFIRMED" }), CUSTOMER, CTX), { statusCode: 400 });
});

test("createBooking fails when the catalog service is not available", async () => {
    const { service, repo } = setup();
    await assert.rejects(
        service.createBooking(bookingInput({ service_id: "99999999-9999-4999-8999-999999999999" }), CUSTOMER, CTX),
        { statusCode: 400 }
    );
    assert.equal(repo.bookings.size, 0);
});

test("slot capacity is enforced and cancelled bookings free the slot", async () => {
    const { service } = setup();
    const first = await service.createBooking(bookingInput(), CUSTOMER, CTX);
    await service.createBooking(bookingInput(), OTHER_CUSTOMER, CTX);
    await assert.rejects(service.createBooking(bookingInput(), CUSTOMER, CTX), { statusCode: 409 });

    await service.cancelBooking(first.booking_id, {}, CUSTOMER);
    const again = await service.createBooking(bookingInput(), CUSTOMER, CTX);
    assert.equal(again.status, "PENDING");
});

test("availability reports remaining capacity and closes past slots", async () => {
    const { service } = setup();
    await service.createBooking(bookingInput({ appointment_date: "2026-11-11", appointment_time: "11:00" }), CUSTOMER, CTX);
    const { slots } = await service.getAvailability({ date: "2026-11-11" });
    const byTime = Object.fromEntries(slots.map((s) => [s.time, s]));
    assert.equal(byTime["09:00"].available, false);
    assert.equal(byTime["10:00"].available, false);
    assert.equal(byTime["11:00"].remaining, 1);
    assert.equal(byTime["13:00"].remaining, 2);
});

test("other customers cannot see or cancel a booking (404); owner sees history", async () => {
    const { service } = setup();
    const booking = await service.createBooking(bookingInput(), CUSTOMER, CTX);
    await assert.rejects(service.getBooking(booking.booking_id, OTHER_CUSTOMER), { statusCode: 404 });
    await assert.rejects(service.cancelBooking(booking.booking_id, {}, OTHER_CUSTOMER), { statusCode: 404 });

    const own = await service.getBooking(booking.booking_id, CUSTOMER);
    assert.equal(own.status_history.length, 1);
    assert.equal((await service.getBooking(booking.booking_id, ADMIN)).booking_id, booking.booking_id);
});

test("listMyBookings only returns the caller's bookings and filters by local date", async () => {
    const { service } = setup();
    await service.createBooking(bookingInput(), CUSTOMER, CTX);
    await service.createBooking(bookingInput({ appointment_date: "2026-11-13" }), CUSTOMER, CTX);
    await service.createBooking(bookingInput({ appointment_time: "11:00" }), OTHER_CUSTOMER, CTX);

    const all = await service.listMyBookings({}, CUSTOMER);
    assert.equal(all.meta.totalItems, 2);
    const day = await service.listMyBookings({ date: "2026-11-13" }, CUSTOMER);
    assert.equal(day.items.length, 1);
    assert.equal(day.items[0].appointment_date, "2026-11-13");
});

test("confirm then check-in creates exactly one work order and completes the booking", async () => {
    const { service, clients, repo } = setup();
    const booking = await service.createBooking(bookingInput(), CUSTOMER, CTX);

    await assert.rejects(service.checkIn(booking.booking_id, ADMIN, CTX), { statusCode: 409 });

    const confirmed = await service.confirmBooking(booking.booking_id, ADMIN);
    assert.equal(confirmed.status, "CONFIRMED");

    const completed = await service.checkIn(booking.booking_id, ADMIN, CTX);
    assert.equal(completed.status, "COMPLETED");
    assert.ok(completed.work_order_id);
    assert.equal(clients.calls.repair[0].ctx.idempotencyKey, `booking-${booking.booking_id}`);
    assert.equal(clients.calls.repair[0].payload.serial_number, "SN-123");

    await assert.rejects(service.checkIn(booking.booking_id, ADMIN, CTX), { statusCode: 409 });
    assert.equal(clients.calls.repair.length, 1);
    assert.deepEqual(repo.history.map((h) => h.new_status), ["PENDING", "CONFIRMED", "COMPLETED"]);
    assert.ok(repo.history.every((h) => h.changed_by));
});

test("check-in keeps the booking CONFIRMED when Repair fails; retry reuses the key", async () => {
    const { service, clients } = setup();
    const booking = await service.createBooking(bookingInput(), CUSTOMER, CTX);
    await service.confirmBooking(booking.booking_id, ADMIN);

    clients.state.repairFails = true;
    await assert.rejects(service.checkIn(booking.booking_id, ADMIN, CTX), { statusCode: 503 });
    assert.equal((await service.getBooking(booking.booking_id, ADMIN)).status, "CONFIRMED");

    clients.state.repairFails = false;
    const completed = await service.checkIn(booking.booking_id, ADMIN, CTX);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(clients.calls.repair[0].ctx.idempotencyKey, clients.calls.repair[1].ctx.idempotencyKey);
});

test("cancel records cancelled_at/by/reason; admin needs a reason; customer only before appointment", async () => {
    const { service, repo, clients } = setup();
    const booking = await service.createBooking(bookingInput({ appointment_date: "2026-11-11", appointment_time: "11:00" }), CUSTOMER, CTX);
    await assert.rejects(service.cancelBooking(booking.booking_id, {}, ADMIN), { statusCode: 400 });

    const afterStart = makeService(repo, clients, new Date("2026-11-11T04:30:00Z")); // 11:30 Bangkok
    await assert.rejects(afterStart.cancelBooking(booking.booking_id, {}, CUSTOMER), { statusCode: 409 });

    const cancelled = await afterStart.cancelBooking(booking.booking_id, { reason: "ลูกค้าไม่มาตามนัด" }, ADMIN);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.cancelled_by, ADMIN.userId);
    assert.equal(cancelled.cancellation_reason, "ลูกค้าไม่มาตามนัด");
    assert.ok(cancelled.cancelled_at);
    assert.equal(repo.history.at(-1).reason, "ลูกค้าไม่มาตามนัด");

    await assert.rejects(afterStart.confirmBooking(booking.booking_id, ADMIN), { statusCode: 409 });
});

test("a booking-number collision is retried with a new number", async () => {
    const repo = createFakeBookingRepository();
    const clients = createFakeClients();
    const numbers = ["BK-DUP", "BK-DUP", "BK-OK"];
    const service = makeService(repo, clients, FIXED_NOW, { createBookingNumber: () => numbers.shift() });
    const first = await service.createBooking(bookingInput(), CUSTOMER, CTX);
    const second = await service.createBooking(bookingInput(), OTHER_CUSTOMER, CTX);
    assert.equal(first.booking_number, "BK-DUP");
    assert.equal(second.booking_number, "BK-OK");
    assert.equal(repo.bookings.size, 2);
});

test("the service snapshot keeps the price from booking time", async () => {
    const { service, clients } = setup();
    const booking = await service.createBooking(bookingInput(), CUSTOMER, CTX);
    // catalog price changes later
    clients.catalogClient.getActiveService = async () => ({
        service_id: SERVICE_ID, service_code: "PC-CLEAN", service_name: "PC Cleaning", starting_price: 900, currency: "THB", is_active: true
    });
    const later = await service.getBooking(booking.booking_id, CUSTOMER);
    assert.equal(later.service_starting_price, 500);
});
