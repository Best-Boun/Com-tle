const assert = require("node:assert/strict");
const test = require("node:test");
const { createWorkOrderService } = require("../src/services/workOrderService");
const { loadWorkflowConfig } = require("../src/config/workflowConfig");

const WORK_ORDER_ID = "e673bbdb-44cd-47a2-9dc4-f560793dbfb7";
const QUOTATION_ID = "4c0f7c1e-2f53-4a59-9f1d-2d7d3c1b9a01";
const OPTION_ID = "8b9e5a64-1c0e-4f8a-9e0b-6a2b2d9c5f11";
const CUSTOMER_ID = "3b49a322-b5d6-4f91-a115-ef9373c11ad4";
const ADMIN = { userId: "0728db5a-057c-4f68-bd89-b86df79c50b8", roles: ["ADMIN"] };
const TECHNICIAN = { userId: "e16a20de-a268-43ae-8c11-6440a507edcf", roles: ["TECHNICIAN"] };
const CUSTOMER = { userId: CUSTOMER_ID, roles: ["CUSTOMER"] };
const RULES = { noRepairFee: 300, freeStorageDays: 7 };

const option = (items, extra = {}) => ({ title: "เปลี่ยน SSD", items, ...extra });
const labor = (unitPrice) => ({ type: "LABOR", description: "ค่าแรง", qty: 1, unit_price: unitPrice });

function serviceWith(repository, extra = {}) {
    return createWorkOrderService({
        workOrderRepository: repository,
        rules: RULES,
        now: () => new Date("2026-11-20T03:00:00.000Z"),
        ...extra
    });
}

test("workflow rules default to a 300 THB no-repair fee, 7 free storage days and a 90-day warranty", () => {
    assert.deepEqual(loadWorkflowConfig({}), { noRepairFee: 300, freeStorageDays: 7, warrantyDays: 90 });
    assert.deepEqual(
        loadWorkflowConfig({ NO_REPAIR_FEE: "250", FREE_STORAGE_DAYS: "10", WARRANTY_DAYS: "180" }),
        { noRepairFee: 250, freeStorageDays: 10, warrantyDays: 180 }
    );
    assert.throws(() => loadWorkflowConfig({ NO_REPAIR_FEE: "-1" }), /whole number/);
});

test("a technician sends priced options and the shop rules go to the repository", async () => {
    let call = null;
    const service = serviceWith({
        async proposeQuotation(...args) {
            call = args;
            return { workOrder: { work_order_id: WORK_ORDER_ID, status: "WAITING_APPROVAL" } };
        }
    });

    const result = await service.proposeQuotation(WORK_ORDER_ID, {
        note: "SSD อ่านไม่ได้",
        options: [
            option([labor(500), { type: "PART", description: "SSD 512GB", part_id: OPTION_ID, qty: 1, unit_price: 1500 }]),
            option([labor(500)], { title: "ย้ายข้อมูลอย่างเดียว" })
        ]
    }, TECHNICIAN);

    assert.equal(result.status, "WAITING_APPROVAL");
    assert.equal(call[0], WORK_ORDER_ID);
    assert.equal(call[1], TECHNICIAN.userId);
    assert.equal(call[2].options.length, 2);
    assert.deepEqual(call[3], RULES);
});

test("every option needs a price and a part needs a part_id", async () => {
    const service = serviceWith({
        async proposeQuotation() {
            throw new Error("must not be called");
        }
    });

    await assert.rejects(
        service.proposeQuotation(WORK_ORDER_ID, { options: [option([labor(0)])] }, TECHNICIAN),
        { statusCode: 400 }
    );
    await assert.rejects(
        service.proposeQuotation(WORK_ORDER_ID, {
            options: [option([{ type: "PART", description: "SSD", qty: 1, unit_price: 100 }])]
        }, TECHNICIAN),
        { statusCode: 400 }
    );
    await assert.rejects(
        service.proposeQuotation(WORK_ORDER_ID, { options: [] }, TECHNICIAN),
        { statusCode: 400 }
    );
    // Admins no longer price quotations; the technician does.
    await assert.rejects(
        service.proposeQuotation(WORK_ORDER_ID, { options: [option([labor(500)])] }, ADMIN),
        { statusCode: 403 }
    );
});

test("customers and walk-in admins choose one option by id", async () => {
    const calls = [];
    const service = serviceWith({
        async decideQuotation(...args) {
            calls.push(args);
            return { workOrder: { work_order_id: WORK_ORDER_ID, status: "APPROVED" } };
        }
    });

    await service.decideQuotation(QUOTATION_ID, { option_id: OPTION_ID }, CUSTOMER);
    await service.decideQuotation(QUOTATION_ID, { option_id: OPTION_ID, note: "ตกลงทางโทรศัพท์" }, ADMIN);

    assert.deepEqual(calls[0], [QUOTATION_ID, CUSTOMER, OPTION_ID, undefined]);
    assert.deepEqual(calls[1], [QUOTATION_ID, ADMIN, OPTION_ID, "ตกลงทางโทรศัพท์"]);
    await assert.rejects(
        service.decideQuotation(QUOTATION_ID, { approve: true }, CUSTOMER),
        { statusCode: 400 }
    );
    await assert.rejects(
        service.decideQuotation(QUOTATION_ID, { option_id: OPTION_ID }, TECHNICIAN),
        { statusCode: 403 }
    );
});

test("an option from another quotation is not found", async () => {
    const service = serviceWith({
        async decideQuotation() {
            return { optionNotFound: true };
        }
    });
    await assert.rejects(
        service.decideQuotation(QUOTATION_ID, { option_id: OPTION_ID }, CUSTOMER),
        { statusCode: 404 }
    );
});

test("waiting for parts needs a note and shows as its own status", async () => {
    const service = serviceWith({
        async markWaitingParts(workOrderId, technicianId, note) {
            assert.equal(note, "สั่งจอจากศูนย์ 3 วัน");
            return { workOrder: { work_order_id: workOrderId, status: "WAITING_PARTS" } };
        }
    });

    await assert.rejects(service.waitForParts(WORK_ORDER_ID, {}, TECHNICIAN), { statusCode: 400 });
    const result = await service.waitForParts(
        WORK_ORDER_ID,
        { note: "สั่งจอจากศูนย์ 3 วัน" },
        TECHNICIAN
    );
    assert.equal(result.status, "WAITING_PARTS");
});

test("free storage runs 7 days from ready, then the device is overdue", async () => {
    const items = [
        { work_order_id: "a", status: "RETURN_PENDING", ready_at: "2026-11-15T03:00:00.000Z" },
        { work_order_id: "b", status: "RETURN_PENDING", ready_at: "2026-11-10T03:00:00.000Z" },
        { work_order_id: "c", status: "IN_REPAIR", ready_at: null }
    ];
    const service = serviceWith({ async listAll() { return items; } });

    const [fresh, late, open] = await service.listAll({});

    assert.equal(fresh.status, "COMPLETED");
    assert.equal(fresh.pickup.free_until, "2026-11-22T03:00:00.000Z");
    assert.equal(fresh.pickup.overdue, false);
    assert.equal(late.pickup.overdue, true);
    assert.equal(late.pickup.days_overdue, 3);
    assert.equal(open.pickup, null);
    assert.equal(open.status, "REPAIRING");
});

function billingHarness(workOrder, currentBalance) {
    const registered = [];
    const resolved = [];
    const service = serviceWith({
        async findById() {
            return workOrder;
        },
        async handover() {
            return { workOrder: { ...workOrder, status: "HANDED_OVER" } };
        }
    }, {
        payment: {
            async getBalance() {
                return currentBalance;
            },
            async registerBill(bill, authorization) {
                registered.push({ bill, authorization });
                return { ...bill, bill_total: bill.total_amount, outstanding_balance: bill.total_amount };
            }
        },
        async resolveCustomerId(userId) {
            resolved.push(userId);
            return "c0ffee00-0000-4000-8000-000000000001";
        },
        async getPaymentBalance() {
            return { outstanding_balance: 0 };
        }
    });
    return { service, registered, resolved };
}

const approvedQuotation = (total) => ({ status: "APPROVED", total });

test("the bill is worked out on the server from approved quotations", async () => {
    const { service, registered, resolved } = billingHarness({
        work_order_id: WORK_ORDER_ID,
        source: "BOOKING",
        customer_id: CUSTOMER_ID,
        status: "APPROVED",
        quotations: [approvedQuotation(2000), approvedQuotation(500), { status: "REJECTED", total: 0 }]
    }, { bill_total: 2000, bill_version: 1 });

    await service.syncBill(WORK_ORDER_ID, ADMIN, "Bearer admin");

    assert.deepEqual(resolved, [CUSTOMER_ID]);
    assert.deepEqual(registered, [{
        authorization: "Bearer admin",
        bill: {
            work_order_id: WORK_ORDER_ID,
            bill_id: WORK_ORDER_ID,
            bill_version: 2,
            customer_id: "c0ffee00-0000-4000-8000-000000000001",
            total_amount: 2500
        }
    }]);
});

test("an unchanged bill is not registered again, and walk-ins bill their own id", async () => {
    const walkIn = {
        work_order_id: WORK_ORDER_ID,
        source: "WALK_IN",
        customer_id: CUSTOMER_ID,
        status: "RETURN_PENDING",
        quotations: [approvedQuotation(300)]
    };
    const same = billingHarness(walkIn, { bill_total: 300, bill_version: 1 });
    await same.service.syncBill(WORK_ORDER_ID, ADMIN, "Bearer admin");
    assert.equal(same.registered.length, 0);

    const fresh = billingHarness(walkIn, null);
    await fresh.service.syncBill(WORK_ORDER_ID, ADMIN, "Bearer admin");
    assert.equal(fresh.resolved.length, 0);
    assert.equal(fresh.registered[0].bill.customer_id, CUSTOMER_ID);
    assert.equal(fresh.registered[0].bill.bill_version, 1);
});

test("nothing approved means no bill to sync", async () => {
    const { service } = billingHarness({
        work_order_id: WORK_ORDER_ID,
        source: "WALK_IN",
        customer_id: CUSTOMER_ID,
        status: "DIAGNOSING",
        quotations: []
    }, null);
    await assert.rejects(service.syncBill(WORK_ORDER_ID, ADMIN, "Bearer admin"), { statusCode: 409 });
    await assert.rejects(service.syncBill(WORK_ORDER_ID, TECHNICIAN, "Bearer tech"), { statusCode: 403 });
});

test("handover brings the bill up to date before checking the balance", async () => {
    const declined = {
        work_order_id: WORK_ORDER_ID,
        source: "WALK_IN",
        customer_id: CUSTOMER_ID,
        status: "RETURN_PENDING",
        repair_declined: true,
        quotations: [approvedQuotation(300)]
    };
    const { service, registered } = billingHarness(declined, null);

    const result = await service.handover(WORK_ORDER_ID, { terms_acknowledged: true }, ADMIN, "Bearer admin");

    assert.equal(registered[0].bill.total_amount, 300);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.repair_declined, true);
});
