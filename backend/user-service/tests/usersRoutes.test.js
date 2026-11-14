const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const { errorHandler, notFoundHandler } = require("../../shared/middleware/errorMiddleware");
const AppError = require("../../shared/errors/AppError");
const { PERMISSIONS } = require("../../shared/constants");
const { createAuthService } = require("../src/services/authService");
const createUsersRouter = require("../src/routes/usersRoutes");

const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const jwtConfig = {
    privateKey,
    issuer: "profile-test",
    audience: "profile-test-api",
    expiresIn: 300,
    refreshExpiresIn: 3600
};
const now = 1_800_000_000_000;

function createToken(userId) {
    return jwt.sign(
        {
            roles: ["CUSTOMER"],
            iat: Math.floor(now / 1000),
            token_use: "user_access"
        },
        privateKey,
        {
            algorithm: "RS256",
            subject: userId,
            issuer: jwtConfig.issuer,
            audience: jwtConfig.audience,
            expiresIn: 300
        }
    );
}

async function withServer(profileService, callback, permissionService) {
    const resolvedPermissionService = {
        async isActiveUser() {
            return true;
        },
        async getUserAccess() {
            return {
                roles: ["CUSTOMER"],
                permissions: [
                    PERMISSIONS.USER_PROFILE_VIEW_OWN,
                    PERMISSIONS.USER_PROFILE_UPDATE_OWN
                ]
            };
        },
        async userHasPermission(_userId, permissionCode) {
            return [
                PERMISSIONS.USER_PROFILE_VIEW_OWN,
                PERMISSIONS.USER_PROFILE_UPDATE_OWN
            ].includes(permissionCode);
        },
        ...permissionService
    };
    const authService = createAuthService({
        db: () => {
            throw new Error("Profile routes must not query auth database directly");
        },
        jwtConfig,
        now: () => now
    });
    const app = express();
    app.use(express.json());
    app.use("/users", createUsersRouter({
        authService,
        profileService,
        permissionService: resolvedPermissionService
    }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
        await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

test("GET /users/me requires a valid token and returns the caller's profile", async () => {
    const requestedIds = [];
    const profileService = {
        async getProfile(userId) {
            requestedIds.push(userId);
            return {
                user_id: userId,
                email: "customer@example.com",
                phone: null,
                status: "ACTIVE",
                full_name: "Customer",
                customer_type: "REGISTERED",
                roles: ["CUSTOMER"]
            };
        }
    };

    await withServer(profileService, async (baseUrl) => {
        const missing = await fetch(`${baseUrl}/users/me`);
        assert.equal(missing.status, 401);

        const invalid = await fetch(`${baseUrl}/users/me`, {
            headers: { authorization: "Bearer not-a-jwt" }
        });
        assert.equal(invalid.status, 401);

        const response = await fetch(`${baseUrl}/users/me`, {
            headers: { authorization: `Bearer ${createToken("user-1")}` }
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.data, {
            user_id: "user-1",
            email: "customer@example.com",
            phone: null,
            status: "ACTIVE",
            full_name: "Customer",
            customer_type: "REGISTERED",
            roles: ["CUSTOMER"]
        });
        assert.equal(JSON.stringify(body).includes("password"), false);
        assert.equal(JSON.stringify(body).includes("refresh"), false);
        assert.deepEqual(requestedIds, ["user-1"]);
    });
});

test("PATCH /users/me uses the token identity and never trusts a body user_id", async () => {
    const updates = [];
    const profileService = {
        async updateProfile(userId, input) {
            if (Object.keys(input).some((key) => !["full_name", "phone"].includes(key))) {
                const error = new Error("Invalid profile update");
                error.statusCode = 400;
                error.isOperational = true;
                throw error;
            }
            updates.push({ userId, input });
            return { user_id: userId, full_name: input.full_name };
        }
    };

    await withServer(profileService, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/users/me`, {
            method: "PATCH",
            headers: {
                authorization: `Bearer ${createToken("user-1")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ full_name: "Updated", user_id: "user-2" })
        });
        assert.equal(response.status, 400);
        assert.deepEqual(updates, []);

        const validUpdate = await fetch(`${baseUrl}/users/me`, {
            method: "PATCH",
            headers: {
                authorization: `Bearer ${createToken("user-1")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ full_name: "Updated" })
        });
        assert.equal(validUpdate.status, 200);
        assert.deepEqual(updates, [{
            userId: "user-1",
            input: { full_name: "Updated" }
        }]);
    });
});

test("a token for another account resolves only that token's own profile", async () => {
    const requestedIds = [];
    const profileService = {
        async getProfile(userId) {
            requestedIds.push(userId);
            return { user_id: userId };
        },
        async updateProfile(userId, input) {
            requestedIds.push(userId);
            return { user_id: userId, ...input };
        }
    };

    await withServer(profileService, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/users/me`, {
            headers: { authorization: `Bearer ${createToken("user-2")}` }
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.user_id, "user-2");
        assert.deepEqual(requestedIds, ["user-2"]);
    });
});

test("GET /users/me/permissions returns database-derived access for the token subject", async () => {
    const requestedIds = [];
    const permissionService = {
        async getUserAccess(userId) {
            requestedIds.push(userId);
            return {
                roles: ["CUSTOMER"],
                permissions: [PERMISSIONS.USER_PROFILE_VIEW_OWN]
            };
        },
        async userHasPermission() {
            return false;
        }
    };

    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/users/me/permissions`, {
            headers: { authorization: `Bearer ${createToken("user-2")}` }
        });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data, {
            roles: ["CUSTOMER"],
            permissions: [PERMISSIONS.USER_PROFILE_VIEW_OWN]
        });
        assert.deepEqual(requestedIds, ["user-2"]);
    }, permissionService);
});

test("JWT role claims cannot grant a database permission", async () => {
    const permissionService = {
        async getUserAccess() {
            return { roles: ["CUSTOMER"], permissions: [] };
        },
        async userHasPermission(userId, permissionCode) {
            assert.equal(userId, "user-1");
            assert.equal(permissionCode, PERMISSIONS.USER_PROFILE_VIEW_OWN);
            return false;
        }
    };
    const token = jwt.sign(
        {
            roles: ["ADMIN"],
            permissions: [PERMISSIONS.USER_PROFILE_VIEW_OWN],
            iat: Math.floor(now / 1000),
            token_use: "user_access"
        },
        privateKey,
        {
            algorithm: "RS256",
            subject: "user-1",
            issuer: jwtConfig.issuer,
            audience: jwtConfig.audience,
            expiresIn: 300
        }
    );

    await withServer({
        async getProfile() {
            assert.fail("Denied requests must not reach the profile handler");
        }
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/users/me`, {
            headers: { authorization: `Bearer ${token}` }
        });
        assert.equal(response.status, 403);
    }, permissionService);
});

test("an unexpired token stops working immediately after the user is disabled or locked", async () => {
    const statuses = new Map([["user-2", "ACTIVE"]]);
    const profileCalls = [];
    const permissionService = {
        async isActiveUser(userId) {
            return statuses.get(userId) === "ACTIVE";
        }
    };

    await withServer({
        async getProfile(userId) {
            profileCalls.push(userId);
            return { user_id: userId };
        }
    }, async (baseUrl) => {
        const headers = { authorization: `Bearer ${createToken("user-2")}` };
        const active = await fetch(`${baseUrl}/users/me`, { headers });
        assert.equal(active.status, 200);

        for (const status of ["DISABLED", "LOCKED"]) {
            statuses.set("user-2", status);
            for (const path of ["/users/me", "/users/me/permissions"]) {
                const response = await fetch(`${baseUrl}${path}`, { headers });
                assert.equal(response.status, 401, `${status} access to ${path}`);
            }
        }
        assert.deepEqual(profileCalls, ["user-2"]);
    }, permissionService);
});

test("status lookup failure blocks protected routes without exposing database errors", async () => {
    const permissionService = {
        async isActiveUser() {
            throw new AppError("Authorization service unavailable", 503);
        },
        async getUserAccess() {
            assert.fail("A failed status lookup must stop before access loading");
        }
    };

    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/users/me/permissions`, {
            headers: { authorization: `Bearer ${createToken("user-2")}` }
        });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).message, "Authorization service unavailable");
    }, permissionService);
});
