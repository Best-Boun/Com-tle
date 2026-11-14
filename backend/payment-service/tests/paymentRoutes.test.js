const assert = require("node:assert/strict");
const test = require("node:test");
const { createApplication } = require("../src/app");
const { createPaymentRouter } = require("../src/routes/paymentRoutes");
const AppError = require("../../shared/errors/AppError");

async function withApp(run) {
    const calls = [];
    const record = (name) => async (...args) => {
        calls.push([name, ...args]);
        return { ok: name };
    };
    const paymentService = Object.fromEntries([
        "registerBill", "recordPayment", "voidPayment", "getBalance", "listPayments",
        "listBalances", "listMyPayments", "requestRefund", "approveRefund", "rejectRefund",
        "executeRefund", "listRefunds", "lockWorkOrderPayments", "unlockWorkOrderPayments"
    ].map((name) => [name, record(name)]));
    paymentService.approveRefund = async () => {
        throw new AppError("A refund must be approved by someone other than the requester", 403);
    };
    const requireUserAuth = (req, res, next) => {
        if (req.get("authorization") !== "Bearer good") {
            return next(new AppError("Authentication required", 401));
        }
        req.auth = { userId: "admin-1" };
        return next();
    };
    const app = createApplication({
        db: { raw: async () => {} },
        paymentRouter: createPaymentRouter({ paymentService, requireUserAuth })
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const call = (path, { method = "GET", body, headers = {} } = {}) => fetch(
        `http://127.0.0.1:${port}${path}`,
        {
            method,
            headers: { authorization: "Bearer good", "content-type": "application/json", ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        }
    );
    try {
        await run({ call, calls });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("routes pass the verified actor, body, params and Idempotency-Key to the service", async () => {
    await withApp(async ({ call, calls }) => {
        const created = await call("/", {
            method: "POST",
            body: { work_order_id: "wo-1", amount: 100, payment_method: "CASH" },
            headers: { "idempotency-key": "key-12345678" }
        });
        assert.equal(created.status, 201);
        assert.deepEqual(await created.json(), {
            success: true, message: "Payment recorded", data: { ok: "recordPayment" }
        });
        assert.deepEqual(calls.at(-1), [
            "recordPayment",
            { userId: "admin-1" },
            { work_order_id: "wo-1", amount: 100, payment_method: "CASH" },
            "key-12345678"
        ]);

        for (const [path, method, name, extra] of [
            ["/?status=SUCCEEDED", "GET", "listPayments", [{ status: "SUCCEEDED" }]],
            ["/pay-1/void", "POST", "voidPayment", ["pay-1", { reason: "x" }]],
            ["/bills", "POST", "registerBill", [{ reason: "x" }]],
            ["/balances", "GET", "listBalances", []],
            ["/balances/wo-9", "GET", "getBalance", ["wo-9"]],
            ["/my", "GET", "listMyPayments", []],
            ["/work-orders/wo-2/lock", "POST", "lockWorkOrderPayments", ["wo-2", { reason: "x" }]],
            ["/work-orders/wo-2/unlock", "POST", "unlockWorkOrderPayments", ["wo-2", { reason: "x" }]],
            ["/refunds?status=REQUESTED", "GET", "listRefunds", [{ status: "REQUESTED" }]],
            ["/refunds/r-1/reject", "POST", "rejectRefund", ["r-1", { reason: "x" }]],
            ["/refunds/r-1/execute", "POST", "executeRefund", ["r-1"]]
        ]) {
            const response = await call(path, {
                method, body: method === "POST" ? { reason: "x" } : undefined
            });
            assert.ok([200, 201].includes(response.status), `${method} ${path}`);
            assert.deepEqual(calls.at(-1), [name, { userId: "admin-1" }, ...extra], path);
        }
    });
});

test("routes require authentication and return service errors as JSON", async () => {
    await withApp(async ({ call, calls }) => {
        const anonymous = await call("/balances", { headers: { authorization: "" } });
        assert.equal(anonymous.status, 401);
        assert.equal(calls.length, 0);

        const denied = await call("/refunds/r-1/approve", { method: "POST" });
        assert.equal(denied.status, 403);
        assert.deepEqual(await denied.json(), {
            success: false,
            message: "A refund must be approved by someone other than the requester"
        });

        const health = await call("/health", { headers: { authorization: "" } });
        assert.equal(health.status, 200);
    });
});
