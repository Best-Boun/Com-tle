const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const { errorHandler, notFoundHandler } = require("../../shared/middleware/errorMiddleware");
const { USER_ROLES } = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const { ADMIN_PERMISSIONS } = require("../src/constants/adminPermissions");
const { createAuthService } = require("../src/services/authService");
const createAdminUsersRouter = require("../src/routes/adminUsersRoutes");

const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const jwtConfig = {
    privateKey,
    issuer: "admin-users-test",
    audience: "admin-users-api",
    expiresIn: 300,
    refreshExpiresIn: 3600
};
const now = 1_800_000_000_000;

function createToken(userId, role = "CUSTOMER") {
    return jwt.sign(
        {
            roles: [role],
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

async function withServer(callback, permissionService) {
    const calls = [];
    const userStatuses = new Map([["admin-1", "ACTIVE"]]);
    const userRoles = new Map([["admin-1", [USER_ROLES.ADMIN]]]);
    const userPermissions = new Map([[
        "admin-1",
        new Set(Object.values(ADMIN_PERMISSIONS))
    ]]);
    const authService = createAuthService({
        db: () => {
            throw new Error("Admin route test must not query auth database");
        },
        jwtConfig,
        now: () => now
    });
    const resolvedPermissionService = {
        async isActiveUser(userId) {
            return !userStatuses.has(userId) || userStatuses.get(userId) === "ACTIVE";
        },
        async userHasPermission(userId, permissionCode, options = {}) {
            const permitted = userPermissions.get(userId)?.has(permissionCode) === true;
            const hasRole = options.requiredRole === undefined
                || (userRoles.get(userId) || []).includes(options.requiredRole);
            return permitted && hasRole;
        },
        ...permissionService
    };
    const userAdministrationService = {
        async listUsers(query) {
            calls.push(["listUsers", query]);
            return { items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } };
        },
        async getUserDetails(userId) {
            calls.push(["getUserDetails", userId]);
            return { user_id: userId, roles: [] };
        },
        async updateUserStatus(userId, actorId, input) {
            calls.push(["updateUserStatus", userId, actorId, input]);
            return { user_id: userId, status: input.status };
        },
        async assignRole(userId, actorId, input) {
            calls.push(["assignRole", userId, actorId, input]);
            return { user_id: userId, role_code: input.role_code };
        },
        async removeRole(userId, actorId, roleCode) {
            calls.push(["removeRole", userId, actorId, roleCode]);
            return { user_id: userId, role_code: roleCode };
        }
    };

    const app = express();
    app.use(express.json());
    app.use("/admin/users", createAdminUsersRouter({
        authService,
        permissionService: resolvedPermissionService,
        userAdministrationService
    }));
    app.use(notFoundHandler);
    app.use(errorHandler);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(
            `http://127.0.0.1:${server.address().port}`,
            calls,
            (userId, status) => userStatuses.set(userId, status),
            (userId, roles) => userRoles.set(userId, roles),
            (userId, permissionCode) => {
                if (!userPermissions.has(userId)) {
                    userPermissions.set(userId, new Set());
                }
                userPermissions.get(userId).add(permissionCode);
            }
        );
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

const operations = [
    {
        name: "list",
        method: "GET",
        path: "/admin/users?page=1",
        permission: ADMIN_PERMISSIONS.USER_LIST
    },
    {
        name: "view",
        method: "GET",
        path: "/admin/users/target-1",
        permission: ADMIN_PERMISSIONS.USER_VIEW
    },
    {
        name: "status",
        method: "PATCH",
        path: "/admin/users/target-1/status",
        permission: ADMIN_PERMISSIONS.USER_STATUS_MANAGE,
        body: { status: "DISABLED" }
    },
    {
        name: "assign role",
        method: "PUT",
        path: "/admin/users/target-1/roles/CUSTOMER",
        permission: ADMIN_PERMISSIONS.USER_ROLE_MANAGE
    },
    {
        name: "remove role",
        method: "DELETE",
        path: "/admin/users/target-1/roles/TECHNICIAN",
        permission: ADMIN_PERMISSIONS.USER_ROLE_MANAGE
    }
];

test("admin route dispatch follows the current permission-service decision", async () => {
    await withServer(async (baseUrl, calls) => {
        for (const operation of operations) {
            const response = await fetch(`${baseUrl}${operation.path}`, {
                method: operation.method,
                headers: {
                    authorization: `Bearer ${createToken("admin-1", "CUSTOMER")}`,
                    "content-type": "application/json"
                },
                ...(operation.body ? { body: JSON.stringify(operation.body) } : {})
            });
            assert.equal(response.status, 200, operation.name);
            assert.equal((await response.json()).success, true);
        }

        assert.deepEqual(calls.map((call) => call[0]), [
            "listUsers",
            "getUserDetails",
            "updateUserStatus",
            "assignRole",
            "removeRole"
        ]);
        assert.equal(calls[2][2], "admin-1");
        assert.equal(calls[3][2], "admin-1");
        assert.equal(calls[4][2], "admin-1");
    });
});

test("CUSTOMER and TECHNICIAN with admin permissions are denied by current role", async () => {
    await withServer(async (baseUrl, calls, setUserStatus, setUserRoles, grantPermission) => {
        for (const role of ["CUSTOMER", "TECHNICIAN"]) {
            const userId = `${role}-1`;
            setUserStatus(userId, "ACTIVE");
            setUserRoles(userId, [role]);
            for (const operation of operations) {
                grantPermission(userId, operation.permission);
            }
            for (const operation of operations) {
                const response = await fetch(`${baseUrl}${operation.path}`, {
                    method: operation.method,
                    headers: {
                        authorization: `Bearer ${createToken(userId, role)}`,
                        "content-type": "application/json"
                    },
                    ...(operation.body ? { body: JSON.stringify(operation.body) } : {})
                });

                assert.equal(response.status, 403, `${role}: ${operation.name}`);
            }
        }
        assert.deepEqual(calls, []);
    });
});

test("stale ADMIN token is denied when current database role is not ADMIN", async () => {
    await withServer(async (baseUrl, calls, setUserStatus, setUserRoles) => {
        setUserRoles("admin-1", [USER_ROLES.CUSTOMER]);
        const response = await fetch(`${baseUrl}${operations[0].path}`, {
            headers: { authorization: `Bearer ${createToken("admin-1", USER_ROLES.ADMIN)}` }
        });
        assert.equal(response.status, 403);
        assert.deepEqual(calls, []);
    });
});

test("current role lookup failure fails closed with 503", async () => {
    await withServer(async (baseUrl, calls) => {
        const response = await fetch(`${baseUrl}${operations[0].path}`, {
            headers: { authorization: `Bearer ${createToken("admin-1", USER_ROLES.ADMIN)}` }
        });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).message, "Authorization service unavailable");
        assert.deepEqual(calls, []);
    }, {
        async userHasPermission() {
            throw new AppError("Authorization service unavailable", 503);
        }
    });
});

test("pending admin permissions remain denied even for an ADMIN token", async () => {
    await withServer(async (baseUrl, calls) => {
        for (const operation of operations) {
            const response = await fetch(`${baseUrl}${operation.path}`, {
                method: operation.method,
                headers: {
                    authorization: `Bearer ${createToken("admin-1", "ADMIN")}`,
                    "content-type": "application/json"
                },
                ...(operation.body ? { body: JSON.stringify(operation.body) } : {})
            });
            assert.equal(response.status, 403, operation.name);
        }
        assert.deepEqual(calls, []);
    }, {
        async userHasPermission() {
            return false;
        }
    });
});

test("an unexpired ADMIN token is denied immediately after account status changes", async () => {
    await withServer(async (baseUrl, calls, setUserStatus) => {
        const headers = {
            authorization: `Bearer ${createToken("admin-1", "ADMIN")}`
        };
        for (const status of ["DISABLED", "LOCKED"]) {
            setUserStatus("admin-1", status);
            const response = await fetch(`${baseUrl}/admin/users`, { headers });
            assert.equal(response.status, 401, status);
        }
        assert.deepEqual(calls, []);
    });
});

test("active-user database failure fails closed without exposing database details", async () => {
    await withServer(async (baseUrl, calls) => {
        const response = await fetch(`${baseUrl}/admin/users`, {
            headers: {
                authorization: `Bearer ${createToken("admin-1", "ADMIN")}`
            }
        });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).message, "Authorization service unavailable");
        assert.deepEqual(calls, []);
    }, {
        async isActiveUser() {
            throw new AppError("Authorization service unavailable", 503);
        }
    });
});

test("admin operations return 401 for missing and invalid tokens", async () => {
    await withServer(async (baseUrl, calls) => {
        for (const headers of [{}, { authorization: "Bearer invalid-token" }]) {
            const response = await fetch(`${baseUrl}/admin/users`, { headers });
            assert.equal(response.status, 401);
        }
        assert.deepEqual(calls, []);
    });
});
