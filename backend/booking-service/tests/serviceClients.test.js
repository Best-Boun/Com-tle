const assert = require("node:assert/strict");
const test = require("node:test");
const { createCatalogClient, createRepairClient } = require("../src/clients/serviceClients");

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";

function fakeFetch(handler) {
    const calls = [];
    const impl = async (url, options) => {
        calls.push({ url, options });
        return handler(url, options);
    };
    impl.calls = calls;
    return impl;
}

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
    });
}

test("catalog client forwards the token and returns the active service", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, {
        success: true,
        data: { service_id: SERVICE_ID, name: "PC Cleaning", is_active: true }
    }));
    const client = createCatalogClient({ baseUrl: "http://catalog", fetchImpl });
    const service = await client.getActiveService(SERVICE_ID, { authorization: "Bearer abc" });
    assert.equal(service.name, "PC Cleaning");
    assert.equal(fetchImpl.calls[0].url, `http://catalog/services/${SERVICE_ID}`);
    assert.equal(fetchImpl.calls[0].options.headers.authorization, "Bearer abc");
});

test("catalog client maps 404 to 400 and network errors to 503", async () => {
    const notFound = createCatalogClient({
        baseUrl: "http://catalog",
        fetchImpl: fakeFetch(() => jsonResponse(404, { success: false }))
    });
    await assert.rejects(notFound.getActiveService(SERVICE_ID, {}), { statusCode: 400 });

    const down = createCatalogClient({
        baseUrl: "http://catalog",
        fetchImpl: fakeFetch(() => { throw new TypeError("fetch failed"); })
    });
    await assert.rejects(down.getActiveService(SERVICE_ID, {}), { statusCode: 503 });
});

test("repair client sends the idempotency key and returns the work order id", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(201, { success: true, data: { work_order_id: "wo-1" } }));
    const client = createRepairClient({ baseUrl: "http://repair", fetchImpl });
    const result = await client.createWorkOrderFromBooking(
        { booking_id: "b1" },
        { authorization: "Bearer admin", idempotencyKey: "booking-b1" }
    );
    assert.deepEqual(result, { workOrderId: "wo-1" });
    const { url, options } = fetchImpl.calls[0];
    assert.equal(url, "http://repair/work-orders");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["idempotency-key"], "booking-b1");
    assert.deepEqual(JSON.parse(options.body), { booking_id: "b1" });
});

test("repair client reports unavailable and bad responses", async () => {
    const down = createRepairClient({
        baseUrl: "http://repair",
        fetchImpl: fakeFetch(() => { throw new TypeError("fetch failed"); })
    });
    await assert.rejects(down.createWorkOrderFromBooking({}, { idempotencyKey: "k" }), { statusCode: 503 });

    const broken = createRepairClient({
        baseUrl: "http://repair",
        fetchImpl: fakeFetch(() => jsonResponse(500, { success: false }))
    });
    await assert.rejects(broken.createWorkOrderFromBooking({}, { idempotencyKey: "k" }), { statusCode: 502 });
});
