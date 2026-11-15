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

test("reading services and categories is public; managing needs a token", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/health`)).status, 200);
        const list = await fetch(`${base}/services`);
        assert.equal(list.status, 200);
        assert.equal((await list.json()).data.length, 1);
        assert.equal((await fetch(`${base}/categories`)).status, 200);
        assert.equal((await fetch(`${base}/services/${SVC_ACTIVE}`)).status, 200);
        assert.equal((await fetch(`${base}/services`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
        assert.equal((await fetch(`${base}/audit-logs`)).status, 401);
    });
});

test("anonymous visitors cannot see inactive services", async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/services?include_inactive=true`);
        assert.equal((await res.json()).data.length, 1);
    });
});

test("an invalid token on a public read is still rejected", async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/services`, { headers: { authorization: "Bearer not-a-token" } });
        assert.equal(res.status, 401);
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

test("technician can read the catalog but not change it", async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/services`, { headers: auth(["TECHNICIAN"]) })).status, 200);
        const payload = JSON.stringify({ category_id: CAT_ACTIVE, service_code: "X-1", service_name: "X", starting_price: 1, estimated_duration_minutes: 10 });
        assert.equal((await fetch(`${base}/services`, { method: "POST", headers: auth(["TECHNICIAN"]), body: payload })).status, 403);
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

test("non-access tokens (e.g. refresh) are rejected", async () => {
    const { privateKey } = require("./helpers");
    await withServer(async (base) => {
        const token = jwt.sign({ roles: ["ADMIN"], token_use: "refresh" }, privateKey, {
            algorithm: "RS256", subject: "x", issuer: ISSUER, audience: AUDIENCE, expiresIn: 60
        });
        const res = await fetch(`${base}/audit-logs`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 401);
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
