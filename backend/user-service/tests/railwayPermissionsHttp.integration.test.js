const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { errorHandler } = require("../../shared/middleware/errorMiddleware");
const createInternalRouter = require("../src/routes/internalRoutes");
const { createInternalServiceAuthService } = require("../src/services/internalServiceAuthService");
const {
    buildChildEnvironment,
    validTokenTestsEnabled,
    preflightError,
    runPreflightQuery
} = require("./httpIntegrationHarnessConfig");
const { withHarnessCleanup } = require("./httpIntegrationHarnessCleanup");

const serviceRoot = path.resolve(__dirname, "..");
const expectedDatabaseHost = "mainline.proxy.rlwy.net";
const expectedDatabaseName = "user_db";
const expectedDatabasePort = 37896;
const expectedDatabaseServer = "3369d7bf76d2";
const expectedMysqlVersion = "8.4.13";
const harnessEnabled = process.env.USER_SERVICE_ALLOW_RAILWAY_HTTP_HARNESS === "1";

function createServiceToken({
    privateKey, keyId, issuer, audience, jti, clientId,
    issuedAt = Math.floor(Date.now() / 1000)
}) {
    const serviceId = clientId || "payment-service";
    return jwt.sign({
        token_use: "internal_service",
        client_id: serviceId,
        sub: serviceId,
        jti,
        iat: issuedAt
    }, privateKey, {
        algorithm: "RS256",
        keyid: keyId,
        issuer,
        audience,
        expiresIn: 60
    });
}

function waitForReady(child, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const lines = createInterface({ input: child.stdout });
        child.stderr.resume();

        function finish(error, port) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            lines.close();
            if (error) {
                reject(error);
            } else {
                resolve(port);
            }
        }

        timer = setTimeout(() => {
            finish(new Error("Timed out waiting for loopback User-Service readiness"));
        }, timeoutMs);

        lines.on("line", (line) => {
            const ready = /^USER_SERVICE_HTTP_TEST_READY 127\.0\.0\.1:(\d+)$/.exec(line);
            if (ready) {
                finish(null, Number(ready[1]));
            }
        });
        child.once("error", () => {
            finish(new Error("Unable to start isolated User-Service process"));
        });
        child.once("exit", (code) => {
            finish(new Error(`Isolated User-Service exited before readiness (${code})`));
        });
    });
}

async function postPermission(baseUrl, body, token) {
    const headers = { "content-type": "application/json" };
    if (token) {
        headers.authorization = `Bearer ${token}`;
    }
    return fetch(`${baseUrl}/internal/permissions/check`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
    });
}

test("isolated Railway permission HTTP harness readiness and invalid-token cases", {
    skip: !harnessEnabled
}, async (t) => {
    let db;
    let child;
    let temporaryDirectory;
    let privateKey;
    let customerUserId;
    const resources = {};

    await withHarnessCleanup(async () => {
        dotenv.config({ path: path.join(serviceRoot, ".env") });
        if (process.env.DB_HOST?.toLowerCase() !== expectedDatabaseHost
            || process.env.DB_NAME !== expectedDatabaseName
            || Number(process.env.DB_PORT) !== expectedDatabasePort) {
            throw new Error("Configured database target does not match expected Railway target");
        }

        try {
            db = require("../src/config/database");
            resources.db = db;
        } catch (error) {
            throw preflightError(error, "configuration");
        }
        const [identityRows] = await runPreflightQuery(db,
            "SELECT DATABASE() AS database_name, VERSION() AS mysql_version, "
            + "@@hostname AS server_hostname, @@port AS server_port",
            "identity query"
        );
        const identity = identityRows[0];
        if (identity?.database_name !== expectedDatabaseName
            || identity?.server_hostname !== expectedDatabaseServer
            || !String(identity?.mysql_version).startsWith(expectedMysqlVersion)) {
            throw new Error("Railway database identity verification failed");
        }

        const [customerRows] = await runPreflightQuery(db,
            `SELECT u.user_id
             FROM users u
             WHERE u.status = 'ACTIVE'
               AND EXISTS (
                   SELECT 1
                   FROM user_roles ur
                   JOIN roles r ON r.role_id = ur.role_id
                   WHERE ur.user_id = u.user_id
                     AND r.role_code = 'CUSTOMER'
               )
               AND EXISTS (
                   SELECT 1
                   FROM user_roles ur
                   JOIN roles r ON r.role_id = ur.role_id
                   JOIN role_permissions rp ON rp.role_id = r.role_id
                   JOIN permissions p ON p.permission_id = rp.permission_id
                   WHERE ur.user_id = u.user_id
                     AND p.permission_code = 'payment.view_own'
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM user_roles ur
                   JOIN role_permissions rp ON rp.role_id = ur.role_id
                   JOIN permissions p ON p.permission_id = rp.permission_id
                   WHERE ur.user_id = u.user_id
                     AND p.permission_code = 'payment.record'
               )
             ORDER BY u.user_id
             LIMIT 1`,
            "customer lookup"
        );
        customerUserId = customerRows[0]?.user_id;
        if (!customerUserId) {
            throw new Error("No eligible active CUSTOMER user is available");
        }
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "user-service-http-test-")
        );
        resources.temporaryDirectory = temporaryDirectory;
        const publicKeysDirectory = path.join(temporaryDirectory, "public-keys");
        fs.mkdirSync(publicKeysDirectory);
        const pair = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" }
        });
        privateKey = pair.privateKey;
        const keyId = `it-payment-${randomUUID()}`;
        const issuer = `user-service-http-test-${randomUUID()}`;
        const audience = "user-service-http-test";
        const privateKeyPath = path.join(temporaryDirectory, "test-private.pem");
        fs.writeFileSync(path.join(publicKeysDirectory, `${keyId}.pem`), pair.publicKey);
        fs.writeFileSync(privateKeyPath, pair.privateKey, { mode: 0o600 });

        const childEnv = buildChildEnvironment(process.env, {
            publicKeysDirectory,
            privateKeyPath,
            issuer,
            audience,
            keyId
        });
        child = spawn(process.execPath, ["server.js"], {
            cwd: serviceRoot,
            env: childEnv,
            stdio: ["ignore", "pipe", "pipe"]
        });
        resources.child = child;
        const port = await waitForReady(child);
        const baseUrl = `http://127.0.0.1:${port}`;

        const validTokenTests = validTokenTestsEnabled(process.env);

        async function assertNoReplayRows(issuers) {
            let rows;
            try {
                rows = await db("internal_token_replays")
                    .whereIn("issuer", issuers)
                    .count({ replay_count: "*" });
            } catch (error) {
                throw preflightError(error, "replay verification");
            }
            assert.equal(Number(rows[0].replay_count), 0);
        }

        async function testRejected(name, request, expectedStatus, issuers = [issuer]) {
            let failure;
            await t.test(name, async () => {
                try {
                    await assertNoReplayRows(issuers);
                    const response = await request();
                    await assertNoReplayRows(issuers);
                    assert.equal(response.status, expectedStatus);
                } catch (error) {
                    failure = error;
                    throw error;
                }
            });
            if (failure) {
                throw failure;
            }
        }

        if (!validTokenTests) {
            const healthResponse = await fetch(`${baseUrl}/health`);
            assert.equal(healthResponse.status, 200);
            assert.equal((await healthResponse.json()).database, "connected");

            await testRejected("missing Bearer token returns 401",
                () => postPermission(baseUrl, {}), 401);

            await testRejected("malformed Bearer token returns 401",
                () => fetch(`${baseUrl}/internal/permissions/check`, {
                    method: "POST",
                    headers: { authorization: "Bearer malformed token" }
                }), 401);

            await testRejected("invalid RSA signature returns 401", () => {
                const wrongPair = generateKeyPairSync("rsa", {
                    modulusLength: 2048,
                    privateKeyEncoding: { type: "pkcs8", format: "pem" },
                    publicKeyEncoding: { type: "spki", format: "pem" }
                });
                const token = createServiceToken({
                    privateKey: wrongPair.privateKey,
                    keyId,
                    issuer,
                    audience,
                    jti: `invalid-signature-${randomUUID()}`
                });
                return postPermission(baseUrl, {}, token);
            }, 401);

            const wrongIssuer = `${issuer}-invalid`;
            await testRejected("invalid issuer returns 401", () => postPermission(
                baseUrl, {}, createServiceToken({
                    privateKey, keyId, issuer: wrongIssuer, audience,
                    jti: `invalid-issuer-${randomUUID()}`
                })
            ), 401, [issuer, wrongIssuer]);

            await testRejected("invalid audience returns 401", () => postPermission(
                baseUrl, {}, createServiceToken({
                    privateKey, keyId, issuer, audience: `${audience}-invalid`,
                    jti: `invalid-audience-${randomUUID()}`
                })
            ), 401);

            await testRejected("expired token returns 401", () => postPermission(
                baseUrl, {}, createServiceToken({
                    privateKey, keyId, issuer, audience,
                    jti: `expired-${randomUUID()}`,
                    issuedAt: Math.floor(Date.now() / 1000) - 120
                })
            ), 401);

            await testRejected("wrong client identity returns 403", () => postPermission(
                baseUrl, {}, createServiceToken({
                    privateKey, keyId, issuer, audience,
                    jti: `wrong-client-${randomUUID()}`,
                    clientId: "booking-service"
                })
            ), 403);

            return;
        }

        async function replayRows() {
            try {
                return await db("internal_token_replays")
                    .select("jti", "client_id")
                    .where({ issuer });
            } catch (error) {
                throw preflightError(error, "replay verification");
            }
        }

        async function verifyReplayRows(expectedJtis, stage) {
            const rows = await replayRows();
            console.log("Controlled replay count:", stage, rows.length);
            assert.equal(rows.length, expectedJtis.length);
            assert.ok(rows.every((row) => expectedJtis.includes(row.jti)),
                "Unexpected replay row for test issuer");
            assert.ok(rows.every((row) => row.client_id === "payment-service"));
        }

        async function runApprovedCase(name, run) {
            let failure;
            await t.test(name, async () => {
                try {
                    await run();
                } catch (error) {
                    failure = error;
                    throw error;
                }
            });
            if (failure) {
                throw failure;
            }
        }

        const baseline = await replayRows();
        console.log("Controlled replay baseline:", baseline.length);
        assert.equal(baseline.length, 0, "Test issuer is not isolated");

        const viewJti = `customer-view-${randomUUID()}`;
        const recordJti = `customer-record-${randomUUID()}`;
        console.log("Controlled test identifiers:", JSON.stringify({
            issuer, viewJti, recordJti
        }));
        const viewToken = createServiceToken({
            privateKey, keyId, issuer, audience, jti: viewJti
        });
        const viewBody = {
            user_id: customerUserId,
            permission: "payment.view_own",
            resource: { payment_id: randomUUID() }
        };

        await runApprovedCase("CUSTOMER payment.view_own is allowed", async () => {
            const response = await postPermission(baseUrl, viewBody, viewToken);
            const result = await response.json();
            console.log("Controlled HTTP result: allow", response.status, result.data?.allowed);
            await verifyReplayRows([viewJti], "after allow");
            assert.equal(response.status, 200);
            assert.equal(result.data?.allowed, true);
        });

        await runApprovedCase("duplicate issuer and JTI is rejected", async () => {
            const response = await postPermission(baseUrl, viewBody, viewToken);
            const result = await response.json();
            console.log("Controlled HTTP result: replay", response.status);
            await verifyReplayRows([viewJti], "after duplicate");
            assert.equal(response.status, 401);
            assert.equal(result.message, "Internal service token has already been used");
        });

        await runApprovedCase("CUSTOMER payment.record is denied", async () => {
            const token = createServiceToken({
                privateKey, keyId, issuer, audience, jti: recordJti
            });
            const response = await postPermission(baseUrl, {
                user_id: customerUserId,
                permission: "payment.record"
            }, token);
            const result = await response.json();
            console.log("Controlled HTTP result: deny", response.status, result.data?.allowed);
            await verifyReplayRows([viewJti, recordJti], "after deny");
            assert.equal(response.status, 200);
            assert.equal(result.data?.allowed, false);
        });

        await runApprovedCase("mock replay storage failure returns 503", async () => {
            const mockIssuer = "user-service-replay-storage-mock";
            let replayCalls = 0;
            let permissionCalls = 0;
            const auth = createInternalServiceAuthService({
                publicKeys: new Map([[keyId, pair.publicKey]]),
                keyServiceIds: new Map([[keyId, "payment-service"]]),
                issuer: mockIssuer,
                audience,
                allowedServices: new Set(["payment-service"]),
                consumeJti: async () => {
                    replayCalls += 1;
                    throw new Error("mock replay storage failure");
                },
                logger: { warn() {}, error() {} }
            });
            const app = express();
            app.use("/internal", createInternalRouter({
                internalServiceAuthService: auth,
                internalPermissionService: {
                    async checkPermission() {
                        permissionCalls += 1;
                    }
                }
            }));
            app.use(errorHandler);
            const server = await new Promise((resolve, reject) => {
                const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
                listener.once("error", reject);
            });
            try {
                const mockToken = createServiceToken({
                    privateKey, keyId, issuer: mockIssuer, audience, jti: viewJti
                });
                const response = await postPermission(
                    `http://127.0.0.1:${server.address().port}`,
                    { user_id: "mock-user", permission: "payment.record" },
                    mockToken
                );
                const result = await response.json();
                console.log("Controlled HTTP result: mock storage", response.status);
                assert.equal(response.status, 503);
                assert.equal(result.message, "Internal authentication service unavailable");
                assert.equal(replayCalls, 1);
                assert.equal(permissionCalls, 0);
            } finally {
                await new Promise((resolve, reject) => {
                    server.close((error) => error ? reject(error) : resolve());
                });
            }
        });
        await verifyReplayRows([viewJti, recordJti], "final");
    }, resources);
});
