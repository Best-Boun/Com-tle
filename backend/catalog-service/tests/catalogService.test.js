const assert = require("node:assert/strict");
const test = require("node:test");
const { createCatalogService } = require("../src/services/catalogService");
const {
    CAT_ACTIVE,
    CAT_INACTIVE,
    SVC_ACTIVE,
    SVC_INACTIVE,
    SVC_IN_INACTIVE_CAT,
    createFakeServiceRepository
} = require("./helpers");

const ADMIN = { userId: "admin-1", roles: ["ADMIN"] };
const CUSTOMER = { userId: "cust-1", roles: ["CUSTOMER"] };

function setup() {
    const repo = createFakeServiceRepository();
    let n = 0;
    const service = createCatalogService({
        serviceRepository: repo,
        createId: () => `99999999-9999-4999-8999-${String(++n).padStart(12, "0")}`
    });
    return { repo, service };
}

test("customers only see active services in active categories", async () => {
    const { service } = setup();
    const { items, meta } = await service.listServices({ include_inactive: "true" }, CUSTOMER);
    assert.deepEqual(items.map((s) => s.service_code), ["PC-CLEAN"]);
    assert.equal(meta.totalItems, 1);
    assert.equal(items[0].category_code, "MAINTENANCE");
});

test("admins can include inactive services", async () => {
    const { service } = setup();
    const { items } = await service.listServices({ include_inactive: "true" }, ADMIN);
    assert.equal(items.length, 3);
});

test("inactive service or category is hidden from customers but visible to admins", async () => {
    const { service } = setup();
    await assert.rejects(service.getService(SVC_INACTIVE, CUSTOMER), { statusCode: 404 });
    await assert.rejects(service.getService(SVC_IN_INACTIVE_CAT, CUSTOMER), { statusCode: 404 });
    assert.equal((await service.getService(SVC_INACTIVE, ADMIN)).service_code, "RETIRED");
    await assert.rejects(service.getService("not-a-uuid", ADMIN), { statusCode: 404 });
});

test("createService stores whole-baht price, default THB, and writes an audit log", async () => {
    const { service, repo } = setup();
    const created = await service.createService({
        category_id: CAT_ACTIVE,
        service_code: "os-install",
        service_name: "OS Installation",
        starting_price: 400,
        estimated_duration_minutes: 90
    }, ADMIN);

    assert.equal(created.service_code, "OS-INSTALL");
    assert.equal(created.starting_price, 400);
    assert.equal(created.currency, "THB");
    assert.equal(repo.auditLogs.length, 1);
    assert.equal(repo.auditLogs[0].action, "SERVICE_CREATED");
    assert.equal(repo.auditLogs[0].actor_user_id, "admin-1");
    assert.equal(repo.auditLogs[0].old_values, null);
});

test("createService validates category, price and required duration", async () => {
    const { service } = setup();
    const base = { category_id: CAT_ACTIVE, service_code: "X1", service_name: "X", starting_price: 100, estimated_duration_minutes: 30 };
    await assert.rejects(service.createService({ ...base, category_id: CAT_INACTIVE }, ADMIN), { statusCode: 400 });
    await assert.rejects(service.createService({ ...base, starting_price: 10.5 }, ADMIN), { statusCode: 400 });
    await assert.rejects(service.createService({ ...base, starting_price: -1 }, ADMIN), { statusCode: 400 });
    const { estimated_duration_minutes: _omit, ...noDuration } = base;
    await assert.rejects(service.createService(noDuration, ADMIN), { statusCode: 400 });
    await assert.rejects(service.createService({ ...base, service_code: "PC-CLEAN" }, ADMIN), { statusCode: 409 });
});

test("updateService records old and new values; code cannot be changed", async () => {
    const { service, repo } = setup();
    await assert.rejects(service.updateService(SVC_ACTIVE, { service_code: "NEW" }, ADMIN), { statusCode: 400 });
    await assert.rejects(service.updateService(SVC_ACTIVE, {}, ADMIN), { statusCode: 400 });

    const updated = await service.updateService(SVC_ACTIVE, { starting_price: 650 }, ADMIN);
    assert.equal(updated.starting_price, 650);
    const log = repo.auditLogs.at(-1);
    assert.equal(log.action, "SERVICE_UPDATED");
    assert.equal(log.old_values.starting_price, 500);
    assert.equal(log.new_values.starting_price, 650);
    assert.equal(log.old_values.category_name, undefined);
});

test("setServiceStatus deactivates instead of deleting, with audit", async () => {
    const { service, repo } = setup();
    const updated = await service.setServiceStatus(SVC_ACTIVE, { is_active: false }, ADMIN);
    assert.equal(updated.is_active, false);
    assert.equal(repo.services.size, 3);
    assert.equal(repo.auditLogs.at(-1).action, "SERVICE_DEACTIVATED");
});

test("categories: create, reject duplicates, deactivate hides its services", async () => {
    const { service, repo } = setup();
    const cat = await service.createCategory({ category_code: "software", category_name: "Software" }, ADMIN);
    assert.equal(cat.category_code, "SOFTWARE");
    await assert.rejects(service.createCategory({ category_code: "SOFTWARE", category_name: "Other" }, ADMIN), { statusCode: 409 });
    await assert.rejects(service.createCategory({ category_code: "NEW", category_name: "Software" }, ADMIN), { statusCode: 409 });

    await service.setCategoryStatus(CAT_ACTIVE, { is_active: false }, ADMIN);
    const { items } = await service.listServices({}, CUSTOMER);
    assert.equal(items.length, 0);
    assert.ok(repo.auditLogs.some((a) => a.action === "CATEGORY_DEACTIVATED"));

    const visible = await service.listCategories({ include_inactive: "true" }, CUSTOMER);
    assert.deepEqual(visible.map((c) => c.category_code), ["SOFTWARE"]);
});

test("audit logs can be filtered by resource", async () => {
    const { service } = setup();
    await service.updateService(SVC_ACTIVE, { service_name: "Deep Cleaning" }, ADMIN);
    await service.createCategory({ category_code: "NET", category_name: "Network" }, ADMIN);
    const { items } = await service.listAuditLogs({ resource_type: "SERVICE", resource_id: SVC_ACTIVE });
    assert.equal(items.length, 1);
    assert.equal(items[0].new_values.service_name, "Deep Cleaning");
});
