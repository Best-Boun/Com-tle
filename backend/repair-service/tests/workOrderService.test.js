const assert = require("node:assert/strict");
const test = require("node:test");
const { createWorkOrderService } = require("../src/services/workOrderService");

const BOOKING_ID = "e673bbdb-44cd-47a2-9dc4-f560793dbfb7";
const CUSTOMER_ID = "3b49a322-b5d6-4f91-a115-ef9373c11ad4";
const SERVICE_ID = "18e874b8-af05-4d89-9d96-c8c73175a188";
const ADMIN_ID = "0728db5a-057c-4f68-bd89-b86df79c50b8";
const TECHNICIAN_ID = "e16a20de-a268-43ae-8c11-6440a507edcf";

const booking = {
    source: "BOOKING",
    booking_id: BOOKING_ID,
    booking_number: "BK-20261115-ABC123",
    customer_id: CUSTOMER_ID,
    service_id: SERVICE_ID,
    service_code: "PC-REPAIR",
    service_name: "ตรวจเช็กอาการเสีย",
    device_type: "Notebook",
    brand: "Lenovo",
    model: "ThinkPad",
    serial_number: "SERIAL-1",
    reported_symptom: "เปิดไม่ติด",
    scheduled_at: "2026-11-15T10:00:00.000Z"
};

function createHarness() {
    const workOrders = [];
    const history = [];
    const repository = {
        async findByBookingId(bookingId) {
            return workOrders.find((item) => item.booking_id === bookingId);
        },
        async create(workOrder, initialHistory) {
            workOrders.push(workOrder);
            history.push(initialHistory);
        },
        async findById(id) {
            return workOrders.find((item) => item.work_order_id === id);
        },
        async findHistory(id) {
            return history.filter((item) => item.work_order_id === id);
        },
        async listMine(id) {
            return workOrders.filter((item) => item.customer_id === id);
        },
        async listAssigned(id) {
            return workOrders.filter((item) => item.technician_id === id);
        },
        async assignTechnician(workOrderId, technicianId, { onlyIfFree = false } = {}) {
            const workOrder = workOrders.find((item) => item.work_order_id === workOrderId);
            if (!workOrder) {
                return { notFound: true };
            }
            if (["RETURN_PENDING", "HANDED_OVER", "ABANDONED"].includes(workOrder.status)) {
                return { closed: true };
            }
            if (workOrder.technician_id === technicianId) {
                return { workOrder };
            }
            if (onlyIfFree && workOrder.technician_id) {
                return { taken: true };
            }
            if (onlyIfFree && workOrder.status !== "RECEIVED") {
                return { notInQueue: true };
            }
            workOrder.technician_id = technicianId;
            return { workOrder };
        },
        async createWarrantyClaim(parentId, isEligible, buildClaim) {
            const parent = workOrders.find((item) => item.work_order_id === parentId);
            if (!parent) return { notFound: true };
            if (!isEligible(parent)) return { notEligible: true };
            const open = workOrders.find((item) => item.parent_work_order_id === parentId
                && !["HANDED_OVER", "ABANDONED"].includes(item.status));
            if (open) return { openClaim: open.work_order_number };
            const { workOrder, initialHistory } = buildClaim(parent);
            const claim = {
                ...parent,
                ...workOrder,
                parent_work_order_id: parentId,
                status: "RECEIVED",
                close_reason: null,
                handed_over_at: null,
                technician_id: null
            };
            workOrders.push(claim);
            history.push(initialHistory);
            return { workOrder: claim };
        },
        async listUnassigned() {
            return workOrders.filter((item) => !item.technician_id && item.status === "RECEIVED");
        },
        async listAll() {
            return [...workOrders];
        }
    };
    let id = 0;
    const service = createWorkOrderService({
        workOrderRepository: repository,
        createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        now: () => new Date("2026-11-15T03:00:00.000Z")
    });
    return { service, workOrders, history };
}

test("creates a received booking work order with an initial tracking event", async () => {
    const { service, workOrders, history } = createHarness();
    const result = await service.createFromBooking(booking, {
        userId: ADMIN_ID,
        roles: ["ADMIN"]
    });

    assert.equal(result.work_order_id, workOrders[0].work_order_id);
    assert.equal(result.status, "PENDING");
    assert.equal(workOrders[0].status, "RECEIVED");
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].new_status, "PENDING");
    assert.equal(result.history[0].note, "Device received");
    assert.equal(history.length, 1);
});

test("retries for the same booking return the existing work order", async () => {
    const { service, workOrders, history } = createHarness();
    const user = { userId: ADMIN_ID, roles: ["ADMIN"] };

    const first = await service.createFromBooking(booking, user);
    const retry = await service.createFromBooking(booking, user);

    assert.equal(retry.work_order_id, first.work_order_id);
    assert.equal(workOrders.length, 1);
    assert.equal(history.length, 1);
});

test("customers can only read their own repair tracking", async () => {
    const { service } = createHarness();
    const created = await service.createFromBooking(booking, {
        userId: ADMIN_ID,
        roles: ["ADMIN"]
    });

    const own = await service.get(created.work_order_id, {
        userId: CUSTOMER_ID,
        roles: ["CUSTOMER"]
    });
    assert.equal(own.work_order_id, created.work_order_id);

    await assert.rejects(
        service.get(created.work_order_id, {
            userId: "e16a20de-a268-43ae-8c11-6440a507edcf",
            roles: ["CUSTOMER"]
        }),
        { statusCode: 404 }
    );
});

test("assigns and reassigns technicians on an open work order", async () => {
    const { service } = createHarness();
    const created = await service.createFromBooking(booking, {
        userId: ADMIN_ID,
        roles: ["ADMIN"]
    });
    const admin = { userId: ADMIN_ID, roles: ["ADMIN"] };

    const assigned = await service.assignTechnician(created.work_order_id, {
        technician_user_id: TECHNICIAN_ID
    }, admin);
    assert.equal(assigned.technician_id, TECHNICIAN_ID);

    const nextTechnicianId = "6a4b2614-3ed2-4ed7-a720-f23b6b707db5";
    const reassigned = await service.assignTechnician(created.work_order_id, {
        technician_user_id: nextTechnicianId
    }, admin);
    assert.equal(reassigned.technician_id, nextTechnicianId);
});

test("rejects invalid technician IDs and closed or missing work orders", async () => {
    const { service, workOrders } = createHarness();
    const created = await service.createFromBooking(booking, {
        userId: ADMIN_ID,
        roles: ["ADMIN"]
    });
    const admin = { userId: ADMIN_ID, roles: ["ADMIN"] };

    await assert.rejects(
        service.assignTechnician(created.work_order_id, { technician_user_id: "not-a-uuid" }),
        { statusCode: 400 }
    );
    await assert.rejects(
        service.assignTechnician("8d4a9eb2-e361-4e27-aab1-64255e7d02b1", {
            technician_user_id: TECHNICIAN_ID
        }, admin),
        { statusCode: 404 }
    );

    workOrders[0].status = "HANDED_OVER";
    await assert.rejects(
        service.assignTechnician(created.work_order_id, {
            technician_user_id: TECHNICIAN_ID
        }, admin),
        { statusCode: 409 }
    );
});

test("technicians take received jobs from the queue, first come first served", async () => {
    const { service, workOrders } = createHarness();
    const admin = { userId: ADMIN_ID, roles: ["ADMIN"] };
    const technician = { userId: TECHNICIAN_ID, roles: ["TECHNICIAN"] };
    const otherTechnician = { userId: "6a4b2614-3ed2-4ed7-a720-f23b6b707db5", roles: ["TECHNICIAN"] };
    const created = await service.createFromBooking(booking, admin);

    assert.deepEqual((await service.listQueue(technician)).map((w) => w.work_order_id), [created.work_order_id]);
    assert.equal((await service.listQueue(admin)).length, 1);
    await assert.rejects(service.listQueue({ userId: CUSTOMER_ID, roles: ["CUSTOMER"] }), { statusCode: 403 });

    // Only technicians take jobs; the shop assigns instead.
    await assert.rejects(service.claim(created.work_order_id, admin), { statusCode: 403 });

    const taken = await service.claim(created.work_order_id, technician);
    assert.equal(taken.technician_id, TECHNICIAN_ID);
    assert.equal((await service.claim(created.work_order_id, technician)).technician_id, TECHNICIAN_ID);
    await assert.rejects(service.claim(created.work_order_id, otherTechnician), { statusCode: 409 });
    assert.equal((await service.listQueue(technician)).length, 0);

    await assert.rejects(service.claim("8d4a9eb2-e361-4e27-aab1-64255e7d02b1", technician), { statusCode: 404 });

    // A job that already moved on is no longer in the queue.
    workOrders[0].technician_id = null;
    workOrders[0].status = "DIAGNOSING";
    await assert.rejects(service.claim(created.work_order_id, otherTechnician), { statusCode: 409 });
});

test("technician workflow rejects a work order without an active assignment", async () => {
    const service = createWorkOrderService({
        workOrderRepository: {
            async startDiagnosis() {
                return { notAssigned: true };
            }
        }
    });

    await assert.rejects(
        service.startDiagnosis(BOOKING_ID, {
            userId: TECHNICIAN_ID,
            roles: ["TECHNICIAN"]
        }),
        { statusCode: 403 }
    );
});

test("handover checks the verified payment balance and requires an exception reason", async () => {
    let handoverArguments = null;
    const service = createWorkOrderService({
        workOrderRepository: {
            async findById() {
                return { work_order_id: BOOKING_ID };
            },
            async handover(...args) {
                handoverArguments = args;
                return {
                    workOrder: {
                        work_order_id: BOOKING_ID,
                        status: "HANDED_OVER",
                        handed_over_at: new Date("2026-11-15T10:00:00.000Z")
                    }
                };
            }
        },
        async getPaymentBalance() {
            return { outstanding_balance: 750 };
        }
    });
    const admin = { userId: ADMIN_ID, roles: ["ADMIN"] };

    await assert.rejects(
        service.handover(BOOKING_ID, { terms_acknowledged: true }, admin, "Bearer token"),
        { statusCode: 409 }
    );
    assert.equal(handoverArguments, null);

    const result = await service.handover(
        BOOKING_ID,
        { exceptionReason: "Customer will pay tomorrow", terms_acknowledged: true },
        admin,
        "Bearer token"
    );

    assert.equal(handoverArguments[0], BOOKING_ID);
    assert.equal(handoverArguments[1], ADMIN_ID);
    assert.equal(handoverArguments[2], "Customer will pay tomorrow");
    assert.equal(handoverArguments[3], 750);
    assert.equal(result.status, "COMPLETED");
});

test("handover returns not found without querying payment for a missing work order", async () => {
    let paymentBalanceRequested = false;
    const service = createWorkOrderService({
        workOrderRepository: {
            async findById() {
                return null;
            }
        },
        async getPaymentBalance() {
            paymentBalanceRequested = true;
            return { outstanding_balance: 0 };
        }
    });

    await assert.rejects(
        service.handover(BOOKING_ID, { terms_acknowledged: true }, {
            userId: ADMIN_ID,
            roles: ["ADMIN"]
        }, "Bearer token"),
        { statusCode: 404 }
    );
    assert.equal(paymentBalanceRequested, false);
});
test("a repaired device has a 90-day warranty from handover; declined jobs have none", async () => {
    const { service, workOrders } = createHarness();
    const admin = { userId: ADMIN_ID, roles: ["ADMIN"] };
    const created = await service.createFromBooking(booking, admin);

    assert.equal((await service.get(created.work_order_id, admin)).warranty, null);

    Object.assign(workOrders[0], {
        status: "HANDED_OVER",
        close_reason: "REPAIRED",
        handed_over_at: new Date("2026-11-01T03:00:00.000Z")
    });
    const repaired = await service.get(created.work_order_id, admin);
    assert.equal(repaired.warranty.days, 90);
    assert.equal(repaired.warranty.until, "2027-01-30T03:00:00.000Z");
    assert.equal(repaired.warranty.active, true);
    // The harness clock is 2026-11-15, 14 days after handover.
    assert.equal(repaired.warranty.days_left, 76);

    workOrders[0].close_reason = "REJECTED";
    assert.equal((await service.get(created.work_order_id, admin)).warranty, null);
});

test("the shop opens one warranty claim at a time, only while the warranty runs", async () => {
    const { service, workOrders } = createHarness();
    const admin = { userId: ADMIN_ID, roles: ["ADMIN"] };
    const created = await service.createFromBooking(booking, admin);
    const claimInput = { reported_symptom: "เปิดไม่ติดอีกแล้ว", accessories: "สายชาร์จ", intake_terms_acknowledged: true };

    // Not handed over yet: no warranty, no claim.
    await assert.rejects(service.createWarrantyClaim(created.work_order_id, claimInput, admin), { statusCode: 409 });

    Object.assign(workOrders[0], {
        status: "HANDED_OVER",
        close_reason: "REPAIRED",
        handed_over_at: new Date("2026-11-01T03:00:00.000Z")
    });
    await assert.rejects(
        service.createWarrantyClaim(created.work_order_id, claimInput, { userId: CUSTOMER_ID, roles: ["CUSTOMER"] }),
        { statusCode: 403 }
    );
    await assert.rejects(
        service.createWarrantyClaim(created.work_order_id, { ...claimInput, intake_terms_acknowledged: false }, admin),
        { statusCode: 400 }
    );

    const claim = await service.createWarrantyClaim(created.work_order_id, claimInput, admin);
    assert.equal(claim.parent_work_order_id, created.work_order_id);
    assert.equal(claim.status, "PENDING");
    assert.equal(claim.customer_id, CUSTOMER_ID);
    assert.equal(claim.reported_symptom, "เปิดไม่ติดอีกแล้ว");
    assert.notEqual(claim.work_order_id, created.work_order_id);

    // A second claim waits until the first is closed.
    await assert.rejects(service.createWarrantyClaim(created.work_order_id, claimInput, admin), { statusCode: 409 });
    await assert.rejects(service.createWarrantyClaim("8d4a9eb2-e361-4e27-aab1-64255e7d02b1", claimInput, admin), { statusCode: 404 });

    // After 90 days the warranty is over.
    workOrders.find((w) => w.work_order_id === claim.work_order_id).status = "HANDED_OVER";
    workOrders[0].handed_over_at = new Date("2026-08-01T03:00:00.000Z");
    await assert.rejects(service.createWarrantyClaim(created.work_order_id, claimInput, admin), { statusCode: 409 });
});
