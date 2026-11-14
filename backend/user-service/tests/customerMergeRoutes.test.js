const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { errorHandler, notFoundHandler } = require("../../shared/middleware/errorMiddleware");
const { USER_ROLES } = require("../../shared/constants");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../src/constants/customerMergePermissions");
const createCustomerMergeRouter = require("../src/routes/customerMergeRoutes");

async function withServer(run) {
    const calls = [];
    const permissions = new Map([
        ["requester", new Set([CUSTOMER_MERGE_PERMISSIONS.REQUEST])],
        ["approver", new Set([CUSTOMER_MERGE_PERMISSIONS.APPROVE])]
    ]);
    const service = Object.fromEntries(
        ["initiate", "approve", "reject", "cancel"].map((method) => [
            method,
            async (...args) => {
                calls.push([method, ...args]);
                return { request_id: "request-1" };
            }
        ])
    );
    const app = express();
    app.use(express.json());
    app.use("/admin/customer-merge-requests", createCustomerMergeRouter({
        authService: { verifyAccessToken: (token) => ({ sub: token }) },
        permissionService: {
            async isActiveUser(userId) {
                return permissions.has(userId);
            },
            async userHasPermission(userId, permission, options) {
                return options.requiredRole === USER_ROLES.ADMIN
                    && permissions.get(userId)?.has(permission) === true;
            }
        },
        customerMergeService: service
    }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}/admin/customer-merge-requests`, calls);
    } finally {
        await new Promise((resolve, reject) => server.close((error) =>
            error ? reject(error) : resolve()));
    }
}

function request(url, actor, body, extraHeaders = {}) {
    return fetch(url, {
        method: "POST",
        headers: {
            authorization: `Bearer ${actor}`,
            "content-type": "application/json",
            ...extraHeaders
        },
        body: JSON.stringify(body)
    });
}

test("merge routes separate request and approval permissions and use the authenticated actor", async () => {
    await withServer(async (baseUrl, calls) => {
        const body = { source_customer_id: "source", target_customer_id: "target" };
        assert.equal((await request(baseUrl, "approver", body)).status, 403);
        assert.equal((await request(`${baseUrl}/request-1/approve`, "requester", {
            verification_reference: "evidence"
        })).status, 403);
        assert.deepEqual(calls, []);

        assert.equal((await request(baseUrl, "requester", body, {
            "idempotency-key": "key-1",
            "x-request-id": "correlation-1"
        })).status, 201);
        assert.deepEqual(calls[0], ["initiate", "requester", {
            ...body, idempotency_key: "key-1"
        }, "correlation-1"]);
        assert.equal((await request(`${baseUrl}/request-1/approve`, "approver", {
            verification_reference: "evidence"
        })).status, 200);
        assert.deepEqual(calls[1], ["approve", "approver", "request-1", {
            verification_reference: "evidence"
        }, null]);
    });
});

test("merge rejection requires approval permission and cancellation passes the authenticated actor", async () => {
    await withServer(async (baseUrl, calls) => {
        assert.equal((await request(`${baseUrl}/request-1/reject`, "requester", {})).status, 403);
        assert.equal((await request(`${baseUrl}/request-1/reject`, "approver", {})).status, 200);
        assert.equal((await request(`${baseUrl}/request-1/cancel`, "requester", {})).status, 200);
        assert.deepEqual(calls.map((call) => [call[0], call[1]]), [
            ["reject", "approver"], ["cancel", "requester"]
        ]);
    });
});

test("merge request rejects a body-supplied idempotency key before service dispatch", async () => {
    await withServer(async (baseUrl, calls) => {
        assert.equal((await request(baseUrl, "requester", {
            source_customer_id: "source",
            target_customer_id: "target",
            idempotency_key: "forged"
        })).status, 400);
        assert.deepEqual(calls, []);
    });
});

test("merge routes reject requests without an authenticated user", async () => {
    await withServer(async (baseUrl, calls) => {
        const response = await fetch(`${baseUrl}/request-1/cancel`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
        });
        assert.equal(response.status, 401);
        assert.deepEqual(calls, []);
    });
});
