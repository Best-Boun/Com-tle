const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/app");

const WORK_ORDER_ID = "e673bbdb-44cd-47a2-9dc4-f560793dbfb7";
const TECHNICIAN_ID = "3b49a322-b5d6-4f91-a115-ef9373c11ad4";

test("only admins can assign technicians through the Repair API", async () => {
    const calls = [];
    const app = createApp({
        workOrderService: {
            async assignTechnician(workOrderId, body, user) {
                calls.push({ workOrderId, body, user });
                return {
                    work_order_id: workOrderId,
                    technician_id: body.technician_user_id
                };
            }
        },
        authenticate(req, res, next) {
            req.user = {
                userId: "admin-user",
                roles: req.get("authorization") === "Bearer admin" ? ["ADMIN"] : ["TECHNICIAN"]
            };
            next();
        },
        healthCheck: async () => {}
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });

    try {
        const url = `http://127.0.0.1:${server.address().port}/work-orders/${WORK_ORDER_ID}/assign`;
        const body = JSON.stringify({ technician_user_id: TECHNICIAN_ID });
        const adminResponse = await fetch(url, {
            method: "POST",
            headers: { authorization: "Bearer admin", "content-type": "application/json" },
            body
        });
        assert.equal(adminResponse.status, 200);
        assert.deepEqual((await adminResponse.json()).data, {
            work_order_id: WORK_ORDER_ID,
            technician_id: TECHNICIAN_ID
        });

        const technicianResponse = await fetch(url, {
            method: "POST",
            headers: { authorization: "Bearer technician", "content-type": "application/json" },
            body
        });
        assert.equal(technicianResponse.status, 403);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], {
            workOrderId: WORK_ORDER_ID,
            body: { technician_user_id: TECHNICIAN_ID },
            user: { userId: "admin-user", roles: ["ADMIN"] }
        });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
});
