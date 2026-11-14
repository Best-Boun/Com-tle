const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createGatewayApp } = require("../src/app");

const testConfig = {
    allowedOrigins: ["https://frontend.example.test"],
    loginRateLimit: { windowMs: 60_000, max: 2 },
    serviceUrls: { user: "http://user-service.test" }
};

async function withGateway(run) {
    let proxyCount = 0;
    const app = createGatewayApp(testConfig, {
        proxyFactory: (target) => (req, res) => {
            proxyCount += 1;
            res.status(200).json({
                target,
                method: req.method,
                path: req.url
            });
        }
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });

    try {
        const { port } = server.address();
        await run({
            request: (path, options = {}) => fetch(
                `http://127.0.0.1:${port}${path}`,
                options
            ),
            getProxyCount: () => proxyCount
        });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

function postOptions(headers = {}) {
    return {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}"
    };
}

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
        server.listen(0, "127.0.0.1");
    });
    return server.address().port;
}

async function close(server) {
    if (!server.listening) {
        return;
    }
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

async function withMockUserService(run) {
    const received = [];
    const userService = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            received.push({
                method: req.method,
                url: req.url,
                contentType: req.headers["content-type"],
                requestMarker: req.headers["x-request-marker"],
                body
            });

            if (body === "{}") {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({
                    success: false,
                    message: "Invalid registration details"
                }));
                return;
            }

            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
                method: req.method,
                url: req.url,
                contentType: req.headers["content-type"],
                requestMarker: req.headers["x-request-marker"],
                body
            }));
        });
    });
    const userServicePort = await listen(userService);
    const app = createGatewayApp({
        ...testConfig,
        serviceUrls: {
            ...testConfig.serviceUrls,
            user: `http://127.0.0.1:${userServicePort}`
        }
    });
    const gateway = app.listen(0, "127.0.0.1");
    const gatewayPort = await new Promise((resolve, reject) => {
        gateway.once("listening", () => resolve(gateway.address().port));
        gateway.once("error", reject);
    });

    try {
        await run({
            request: (path, options = {}) => fetch(
                `http://127.0.0.1:${gatewayPort}${path}`,
                options
            ),
            received
        });
    } finally {
        await close(gateway);
        await close(userService);
    }
}

test("public register and login are proxied without authentication", async () => {
    await withGateway(async ({ request, getProxyCount }) => {
        const register = await request(
            "/api/users/auth/register",
            postOptions()
        );
        const login = await request(
            "/api/users/auth/login",
            postOptions()
        );

        assert.equal(register.status, 200);
        assert.equal(login.status, 200);
        assert.equal((await register.json()).path, "/auth/register");
        assert.equal((await login.json()).path, "/auth/login");
        assert.equal(getProxyCount(), 2);
    });
});

test("forwards POST JSON {} and returns the User Service validation response", async () => {
    await withMockUserService(async ({ request, received }) => {
        const response = await request(
            "/api/users/auth/register",
            postOptions()
        );

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            success: false,
            message: "Invalid registration details"
        });
        assert.equal(received.length, 1);
        assert.deepEqual(received[0], {
            method: "POST",
            url: "/auth/register",
            contentType: "application/json",
            requestMarker: undefined,
            body: "{}"
        });
    });
});

test("forwards an example JSON registration body without creating an account", async () => {
    const example = {
        full_name: "Integration Test",
        email: "integration-test@example.test",
        password: "example-only-password",
        phone: "555-0101"
    };

    await withMockUserService(async ({ request, received }) => {
        const response = await request(
            "/api/users/auth/register",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-request-marker": "proxy-forwarding-test"
                },
                body: JSON.stringify(example)
            }
        );

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            method: "POST",
            url: "/auth/register",
            contentType: "application/json",
            requestMarker: "proxy-forwarding-test",
            body: JSON.stringify(example)
        });
        assert.equal(received.length, 1);
        assert.equal(received[0].body, JSON.stringify(example));
        assert.equal(received[0].contentType, "application/json");
        assert.equal(received[0].requestMarker, "proxy-forwarding-test");
    });
});

test("forwards bodyless POST requests without adding a body", async () => {
    await withMockUserService(async ({ request, received }) => {
        const response = await request("/api/users/auth/register", {
            method: "POST"
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            method: "POST",
            url: "/auth/register",
            body: ""
        });
        assert.equal(received.length, 1);
        assert.equal(received[0].method, "POST");
        assert.equal(received[0].url, "/auth/register");
        assert.equal(received[0].body, "");
    });
});

test("returns a gateway error when the User Service proxy target is unavailable", async () => {
    const unavailableTarget = http.createServer();
    const unavailablePort = await listen(unavailableTarget);
    await close(unavailableTarget);

    const app = createGatewayApp({
        ...testConfig,
        serviceUrls: {
            ...testConfig.serviceUrls,
            user: `http://127.0.0.1:${unavailablePort}`
        }
    });
    const gateway = app.listen(0, "127.0.0.1");
    const gatewayPort = await new Promise((resolve, reject) => {
        gateway.once("listening", () => resolve(gateway.address().port));
        gateway.once("error", reject);
    });

    try {
        const response = await fetch(
            `http://127.0.0.1:${gatewayPort}/api/users/auth/register`,
            postOptions()
        );
        assert.ok(response.status >= 500);
        assert.equal((await response.text()).includes("example-only-password"), false);
    } finally {
        await close(gateway);
    }
});

test("approved User-Service routes are proxied while internal and unmapped routes are denied", async () => {
    await withGateway(async ({ request, getProxyCount }) => {
        const approvedRequests = [
            ["/api/users/auth/refresh", postOptions()],
            ["/api/users/auth/logout", postOptions()],
            ["/api/users/users/me", {}],
            ["/api/users/users/me/permissions", {}],
            ["/api/users/users/me", { ...postOptions(), method: "PATCH" }],
            ["/api/users/admin/users", {}],
            ["/api/users/admin/users/user-1", {}],
            ["/api/users/admin/users/user-1/status", {
                ...postOptions(),
                method: "PATCH"
            }],
            ["/api/users/admin/users/user-1/roles/TECHNICIAN", {
                ...postOptions(),
                method: "PUT"
            }],
            ["/api/users/admin/users/user-1/roles/TECHNICIAN", {
                method: "DELETE"
            }]
        ];
        for (const [path, options] of approvedRequests) {
            const response = await request(path, options);
            assert.equal(response.status, 200, path);
        }

        for (const [path, options] of [
            ["/api/users/profile", {}],
            ["/api/users/internal/permissions/check", postOptions()],
            ["/api/bookings/health", {}],
            ["/api/catalog/health", {}],
            ["/api/repairs/health", {}],
            ["/api/inventory/health", {}],
            ["/api/payments/health", {}]
        ]) {
            const response = await request(path, options);
            assert.equal(response.status, 404, path);
        }

        const wrongMethod = await request(
            "/api/users/auth/login",
            { method: "GET" }
        );
        assert.equal(wrongMethod.status, 404);
        const invalidAdminMethod = await request(
            "/api/users/admin/users/user-1",
            { method: "DELETE" }
        );
        assert.equal(invalidAdminMethod.status, 404);
        assert.equal(getProxyCount(), approvedRequests.length);
    });
});

test("does not proxy service health endpoints through user routes", async () => {
    await withGateway(async ({ request, getProxyCount }) => {
        for (const path of [
            "/api/users/profile",
            "/api/users/health",
            "/api/users/internal/customers/resolve"
        ]) {
            const response = await request(path);
            assert.equal(response.status, 404, path);
        }
        assert.equal(getProxyCount(), 0);
    });
});

test("limits login attempts per IP without limiting register or unrelated paths", async () => {
    await withGateway(async ({ request, getProxyCount }) => {
        const first = await request("/api/users/auth/login", postOptions());
        const second = await request("/api/users/auth/login", postOptions());
        const limited = await request("/api/users/auth/login", postOptions());
        const register = await request(
            "/api/users/auth/register",
            postOptions()
        );

        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(limited.status, 429);
        assert.equal((await limited.json()).success, false);
        assert.equal(limited.headers.get("retry-after"), "60");
        assert.equal(register.status, 200);
        assert.equal(getProxyCount(), 3);
    });
});

test("allows exact CORS origins, rejects others, and supports preflight without credentials", async () => {
    await withGateway(async ({ request, getProxyCount }) => {
        const allowed = await request("/health", {
            headers: { origin: "https://frontend.example.test" }
        });
        assert.equal(allowed.status, 200);
        assert.equal(
            allowed.headers.get("access-control-allow-origin"),
            "https://frontend.example.test"
        );

        const disallowed = await request("/health", {
            headers: { origin: "https://other.example.test" }
        });
        assert.equal(disallowed.status, 403);

        const noOrigin = await request("/health");
        assert.equal(noOrigin.status, 200);
        assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);

        const preflight = await request("/api/users/auth/login", {
            method: "OPTIONS",
            headers: {
                origin: "https://frontend.example.test",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type,authorization"
            }
        });
        assert.equal(preflight.status, 204);
        assert.equal(
            preflight.headers.get("access-control-allow-origin"),
            "https://frontend.example.test"
        );
        assert.equal(
            preflight.headers.get("access-control-allow-credentials"),
            null
        );
        assert.equal(getProxyCount(), 0);
    });
});
