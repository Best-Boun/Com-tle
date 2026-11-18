const assert = require("node:assert/strict");
const test = require("node:test");
const { createNotificationService, NOTIFICATION_TYPES } = require("../src/services/notificationService");
const { createMailer } = require("../src/services/mailer");
const { createWorkOrderService } = require("../src/services/workOrderService");

const CUSTOMER_ID = "3b49a322-b5d6-4f91-a115-ef9373c11ad4";
const WORK_ORDER_ID = "e673bbdb-44cd-47a2-9dc4-f560793dbfb7";
const TECHNICIAN = { userId: "e16a20de-a268-43ae-8c11-6440a507edcf", roles: ["TECHNICIAN"] };
const CUSTOMER = { userId: CUSTOMER_ID, roles: ["CUSTOMER"] };

const bookedOrder = (extra = {}) => ({
    work_order_id: WORK_ORDER_ID,
    work_order_number: "WO-20261119-ABC123",
    source: "BOOKING",
    customer_id: CUSTOMER_ID,
    customer_email: "somchai@example.com",
    status: "WAITING_APPROVAL",
    ...extra
});

function harness({ mailer, failInsert = false } = {}) {
    const rows = [];
    const statuses = [];
    const logged = [];
    const repository = {
        async insert(row) {
            if (failInsert) throw new Error("db down");
            rows.push(row);
        },
        async setEmailStatus(id, status) {
            statuses.push([id, status]);
        },
        async listForCustomer(customerId) {
            const items = rows.filter((row) => row.customer_id === customerId);
            return { items, unread: items.filter((row) => !row.read_at).length };
        },
        async markRead(customerId, ids, readAt) {
            let updated = 0;
            for (const row of rows) {
                if (row.customer_id === customerId && !row.read_at && (ids.length === 0 || ids.includes(row.notification_id))) {
                    row.read_at = readAt;
                    updated += 1;
                }
            }
            return updated;
        }
    };
    let id = 0;
    const service = createNotificationService({
        notificationRepository: repository,
        mailer,
        rules: { freeStorageDays: 7, warrantyDays: 90 },
        webBaseUrl: "https://smartfix.test/",
        createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        now: () => new Date("2026-11-19T03:00:00.000Z"),
        logger: { error: (message) => logged.push(message) }
    });
    return { service, rows, statuses, logged };
}

test("the event contract covers every customer-facing step", () => {
    assert.deepEqual(NOTIFICATION_TYPES, [
        "RECEIVED",
        "QUOTATION_SENT",
        "WAITING_PARTS",
        "READY_FOR_PICKUP",
        "HANDED_OVER",
        "CLAIM_OPENED",
        "CANCELLED"
    ]);
});

test("a notification is stored for the website and emailed with a link", async () => {
    const sent = [];
    const { service, rows, statuses } = harness({
        mailer: { configured: true, async send(mail) { sent.push(mail); return "SENT"; } }
    });

    const notification = await service.notify(bookedOrder(), "QUOTATION_SENT");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].customer_id, CUSTOMER_ID);
    assert.equal(rows[0].type, "QUOTATION_SENT");
    assert.match(rows[0].title, /WO-20261119-ABC123/);
    assert.equal(sent[0].to, "somchai@example.com");
    assert.match(sent[0].subject, /^\[SmartFix\]/);
    assert.match(sent[0].text, /https:\/\/smartfix\.test\/my\/repairs\/e673bbdb/);
    assert.deepEqual(statuses, [[rows[0].notification_id, "SENT"]]);
    assert.equal(notification.email_status, "SENT");
});

test("without an email or SMTP the message still shows on the website", async () => {
    const noSmtp = harness();
    await noSmtp.service.notify(bookedOrder(), "READY_FOR_PICKUP");
    assert.equal(noSmtp.rows[0].email_status, "NOT_CONFIGURED");
    assert.match(noSmtp.rows[0].message, /7 วัน/);

    const noEmail = harness({ mailer: { configured: true, async send() { throw new Error("must not send"); } } });
    await noEmail.service.notify(bookedOrder({ customer_email: null }), "WAITING_PARTS");
    assert.equal(noEmail.rows[0].email_status, "NO_EMAIL");
});

test("walk-in customers have no account, so nothing is stored", async () => {
    const { service, rows } = harness();
    assert.equal(await service.notify(bookedOrder({ source: "WALK_IN" }), "READY_FOR_PICKUP"), null);
    assert.equal(await service.notify(bookedOrder(), "UNKNOWN_TYPE"), null);
    assert.equal(rows.length, 0);
});

test("a notification problem never fails the repair step", async () => {
    const { service, logged } = harness({ failInsert: true });
    assert.equal(await service.notify(bookedOrder(), "HANDED_OVER"), null);
    assert.match(logged[0], /HANDED_OVER/);
});

test("a failed email is recorded as FAILED", async () => {
    const { service, rows } = harness({
        mailer: createMailer(
            { SMTP_URL: "smtp://localhost:2525" },
            {
                createTransport: () => ({ async sendMail() { throw new Error("connection refused"); } }),
                logger: { error() {} }
            }
        )
    });
    const notification = await service.notify(bookedOrder(), "RECEIVED");
    assert.equal(notification.email_status, "FAILED");
    assert.equal(rows.length, 1);
});

test("customers list their own notifications and mark them read", async () => {
    const { service } = harness();
    await service.notify(bookedOrder(), "RECEIVED");
    await service.notify(bookedOrder(), "QUOTATION_SENT");

    const before = await service.listMine(CUSTOMER);
    assert.equal(before.items.length, 2);
    assert.equal(before.unread, 2);

    assert.deepEqual(await service.markRead({ ids: [before.items[0].notification_id] }, CUSTOMER), { updated: 1 });
    assert.equal((await service.listMine(CUSTOMER)).unread, 1);
    assert.deepEqual(await service.markRead({}, CUSTOMER), { updated: 1 });
    await assert.rejects(service.markRead({ ids: ["nope"] }, CUSTOMER), { statusCode: 400 });
});

test("the mailer is off without SMTP_URL", async () => {
    const mailer = createMailer({});
    assert.equal(mailer.configured, false);
    assert.equal(await mailer.send({ to: "a@b.c", subject: "x", text: "y" }), "NOT_CONFIGURED");
});

test("repair steps tell the customer: quotation, waiting for parts, ready", async () => {
    const told = [];
    const workOrderService = createWorkOrderService({
        workOrderRepository: {
            async proposeQuotation() { return { workOrder: bookedOrder() }; },
            async markWaitingParts() { return { workOrder: bookedOrder({ status: "WAITING_PARTS" }) }; },
            async recordTestResult(id, tech, passed) {
                return { workOrder: bookedOrder({ status: passed ? "RETURN_PENDING" : "IN_REPAIR" }) };
            }
        },
        notifications: { async notify(workOrder, type) { told.push([type, workOrder.status]); } },
        rules: { noRepairFee: 300, freeStorageDays: 7, warrantyDays: 90 }
    });
    const option = { title: "เปลี่ยน SSD", items: [{ type: "LABOR", description: "ค่าแรง", qty: 1, unit_price: 500 }] };

    await workOrderService.proposeQuotation(WORK_ORDER_ID, { options: [option] }, TECHNICIAN);
    await workOrderService.waitForParts(WORK_ORDER_ID, { note: "สั่ง SSD" }, TECHNICIAN);
    await workOrderService.recordTest(WORK_ORDER_ID, { passed: false, notes: "ยังร้อน" }, TECHNICIAN);
    await workOrderService.recordTest(WORK_ORDER_ID, { passed: true, notes: "ผ่าน" }, TECHNICIAN);

    assert.deepEqual(told, [
        ["QUOTATION_SENT", "WAITING_APPROVAL"],
        ["WAITING_PARTS", "WAITING_PARTS"],
        ["READY_FOR_PICKUP", "RETURN_PENDING"]
    ]);
});

test("check-in keeps the customer's email for later and says the device is in", async () => {
    let stored = null;
    const told = [];
    const workOrderService = createWorkOrderService({
        workOrderRepository: {
            async findByBookingId() { return null; },
            async create(workOrder) { stored = workOrder; }
        },
        async resolveCustomerEmail(userId, authorization) {
            assert.equal(userId, CUSTOMER_ID);
            assert.equal(authorization, "Bearer admin");
            return "somchai@example.com";
        },
        notifications: { async notify(workOrder, type) { told.push([type, workOrder.customer_email]); } }
    });

    await workOrderService.createFromBooking({
        source: "BOOKING",
        booking_id: "a673bbdb-44cd-47a2-9dc4-f560793dbfb7",
        booking_number: "RQ-20261119-ABC123",
        customer_id: CUSTOMER_ID,
        service_id: "18e874b8-af05-4d89-9d96-c8c73175a188",
        service_code: "HW-DIAG",
        service_name: "ตรวจเช็กอาการเสีย",
        device_type: "Notebook",
        reported_symptom: "เปิดไม่ติด",
        scheduled_at: "2026-11-19T03:00:00.000Z"
    }, { userId: "0728db5a-057c-4f68-bd89-b86df79c50b8", roles: ["ADMIN"] }, "Bearer admin");

    assert.equal(stored.customer_email, "somchai@example.com");
    assert.deepEqual(told, [["RECEIVED", "somchai@example.com"]]);
});
