const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const { createCatalogService } = require("../src/services/catalogService");
const { createAuthenticate } = require("../../shared/middleware/serviceAuth");
const {
    ISSUER,
    AUDIENCE,
    publicKey,
    signToken,
    CAT_ACTIVE,
    SVC_ACTIVE,
    createFakeServiceRepository
} = require("./helpers");

async function withServer(fn) {
    const app = createApp({
        catalogService: createCatalogService({ serviceRepository: createFakeServiceRepository() }),
        authenticate: createAuthenticate({ jwt, publicKey, issuer: ISSUER, audience: AUDIENCE }),
        healthCheck: async () => {}
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await fn(base);
    } finally {
        server.close();
    }
}

const auth = (roles) => ({ authorization: `Bearer ${signToken("user-1", roles)}`, "content-type": "application/json" });

test("health is public; catalog routes need a token", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/health`)).status, 200);
        assert.equal((await fetch(`${base}/services`)).status, 401);
        assert.equal((await fetch(`${base}/categories`)).status, 401);
    });
});

test("customer can list services and categories and view one service", async () => {
    await withServer(async (base) => {
        const list = await fetch(`${base}/services`, { headers: auth(["CUSTOMER"]) });
        assert.equal(list.status, 200);
        const body = await list.json();
        assert.equal(body.data.length, 1);
        assert.equal(body.meta.totalItems, 1);

        assert.equal((await fetch(`${base}/services/${SVC_ACTIVE}`, { headers: auth(["CUSTOMER"]) })).status, 200);
        assert.equal((await fetch(`${base}/categories`, { headers: auth(["CUSTOMER"]) })).status, 200);
        assert.equal((await fetch(`${base}/audit-logs`, { headers: auth(["CUSTOMER"]) })).status, 403);
    });
});

test("technician has no catalog permission", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/services`, { headers: auth(["TECHNICIAN"]) })).status, 403);
    });
});

test("only admin can create services and read audit logs", async () => {
    await withServer(async (base) => {
        const payload = JSON.stringify({
            category_id: CAT_ACTIVE,
            service_code: "OS-INSTALL",
            service_name: "OS Installation",
            starting_price: 400,
            estimated_duration_minutes: 90
        });
        assert.equal((await fetch(`${base}/services`, { method: "POST", headers: auth(["CUSTOMER"]), body: payload })).status, 403);

        const created = await fetch(`${base}/services`, { method: "POST", headers: auth(["ADMIN"]), body: payload });
        assert.equal(created.status, 201);
        assert.equal((await created.json()).data.currency, "THB");

        const logs = await fetch(`${base}/audit-logs`, { headers: auth(["ADMIN"]) });
        assert.equal(logs.status, 200);
        assert.equal((await logs.json()).data.length, 1);
    });
});

test("token signed with another key is rejected", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = jwt.sign({ roles: ["ADMIN"] }, privateKey, {
        algorithm: "RS256", subject: "x", issuer: ISSUER, audience: AUDIENCE, expiresIn: 60
    });
    await withServer(async (base) => {
        const res = await fetch(`${base}/services`, { headers: { authorization: `Bearer ${forged}` } });
        assert.equal(res.status, 401);
    });
});
