const assert = require("node:assert/strict");
const test = require("node:test");
const {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    USER_ROLES
} = require("../../shared/constants");
const requirePermissions = require("../src/middleware/permissionMiddleware");

function runMiddleware(user, ...requiredPermissions) {
    const req = {};
    if (user !== undefined) {
        req.user = user;
    }
    return runRequest(req, ...requiredPermissions);
}

function runRequest(req, ...requiredPermissions) {
    let statusCode;
    let responseBody;
    let nextCalled = false;
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        }
    };

    requirePermissions(...requiredPermissions)(req, res, () => {
        nextCalled = true;
    });

    return { req, statusCode, responseBody, nextCalled };
}

test("defines only CUSTOMER, TECHNICIAN, and ADMIN roles", () => {
    assert.deepEqual(Object.values(USER_ROLES), [
        "CUSTOMER",
        "TECHNICIAN",
        "ADMIN"
    ]);
    assert.deepEqual(Object.keys(ROLE_PERMISSIONS), Object.values(USER_ROLES));
});

test("CUSTOMER receives only confirmed permissions", () => {
    assert.deepEqual(ROLE_PERMISSIONS[USER_ROLES.CUSTOMER], [
        PERMISSIONS.USER_PROFILE_VIEW_OWN,
        PERMISSIONS.USER_PROFILE_UPDATE_OWN,
        PERMISSIONS.BOOKING_CREATE,
        PERMISSIONS.BOOKING_VIEW_OWN,
        PERMISSIONS.CATALOG_VIEW,
        PERMISSIONS.QUOTATION_VIEW_OWN,
        PERMISSIONS.QUOTATION_APPROVE_OWN,
        PERMISSIONS.QUOTATION_REJECT_OWN,
        PERMISSIONS.REPAIR_HISTORY_VIEW_OWN,
        PERMISSIONS.PAYMENT_VIEW_OWN
    ]);
});

test("TECHNICIAN receives only confirmed permissions", () => {
    assert.deepEqual(ROLE_PERMISSIONS[USER_ROLES.TECHNICIAN], [
        PERMISSIONS.WORK_ORDER_VIEW_ASSIGNED,
        PERMISSIONS.DIAGNOSIS_RECORD,
        PERMISSIONS.REPAIR_ITEM_PROPOSE,
        PERMISSIONS.REPAIR_START,
        PERMISSIONS.REPAIR_RESULT_RECORD,
        PERMISSIONS.REPAIR_HISTORY_VIEW_ASSIGNED,
        PERMISSIONS.TEST_RESULT_RECORD,
        PERMISSIONS.INVENTORY_PART_PROPOSE
    ]);
});

test("ADMIN receives only confirmed permissions", () => {
    assert.deepEqual(ROLE_PERMISSIONS[USER_ROLES.ADMIN], [
        PERMISSIONS.BOOKING_MANAGE,
        PERMISSIONS.CATALOG_VIEW,
        PERMISSIONS.CATALOG_MANAGE,
        PERMISSIONS.WORK_ORDER_RECEIVE_CREATE,
        PERMISSIONS.WORK_ORDER_ASSIGN_TECHNICIAN,
        PERMISSIONS.QUOTATION_SET_PRICE,
        PERMISSIONS.QUOTATION_APPROVE_WALK_IN,
        PERMISSIONS.REPAIR_HISTORY_VIEW_ALL,
        PERMISSIONS.INVENTORY_ISSUE,
        PERMISSIONS.PAYMENT_RECORD,
        PERMISSIONS.HANDOVER_COMPLETE
    ]);
});

test("rejects unknown roles, including an unknown role mixed with a valid one", () => {
    for (const roles of [["STAFF"], ["CUSTOMER", "STAFF"]]) {
        const result = runMiddleware(
            { roles },
            PERMISSIONS.BOOKING_VIEW_OWN
        );

        assert.equal(result.statusCode, 403);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects unknown permissions and empty permission policies", () => {
    for (const permissions of [["refund.approve"], []]) {
        const result = runMiddleware(
            { roles: [USER_ROLES.ADMIN] },
            ...permissions
        );

        assert.equal(result.statusCode, 403);
        assert.equal(result.nextCalled, false);
    }
});

test("does not grant pending permissions", () => {
    const pendingPermissions = [
        "can_refund",
        "refund.request",
        "refund.approve",
        "refund.execute",
        "payment.void",
        "inventory.manage"
    ];
    const knownPermissions = new Set(Object.values(PERMISSIONS));

    for (const permission of pendingPermissions) {
        assert.equal(knownPermissions.has(permission), false);
        for (const role of Object.values(USER_ROLES)) {
            assert.equal(ROLE_PERMISSIONS[role].includes(permission), false);
            const result = runMiddleware({ roles: [role] }, permission);
            assert.equal(result.statusCode, 403);
            assert.equal(result.nextCalled, false);
        }
    }

    for (const role of [USER_ROLES.TECHNICIAN, USER_ROLES.ADMIN]) {
        for (const permission of [
            PERMISSIONS.USER_PROFILE_VIEW_OWN,
            PERMISSIONS.USER_PROFILE_UPDATE_OWN
        ]) {
            assert.equal(ROLE_PERMISSIONS[role].includes(permission), false);
        }
    }
});

test("denies requests without authenticated user context", () => {
    const result = runMiddleware(undefined, PERMISSIONS.CATALOG_VIEW);

    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.responseBody, {
        success: false,
        message: "Authentication required"
    });
    assert.equal(result.nextCalled, false);
});

test("does not allow request-supplied identity to override authenticated context", () => {
    const authenticatedUser = {
        userId: "authenticated-user",
        roles: [USER_ROLES.CUSTOMER]
    };
    const result = runRequest({
        user: authenticatedUser,
        body: { userId: "attacker-user", role: USER_ROLES.ADMIN },
        query: { userId: "attacker-user", role: USER_ROLES.ADMIN },
        headers: {
            "x-user-id": "attacker-user",
            "x-user-role": USER_ROLES.ADMIN
        }
    }, PERMISSIONS.BOOKING_MANAGE);

    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
    assert.deepEqual(result.req.user, authenticatedUser);
});

test("resolves permissions from all authenticated roles", () => {
    const result = runMiddleware(
        { roles: [USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN] },
        PERMISSIONS.CATALOG_VIEW,
        PERMISSIONS.REPAIR_ITEM_PROPOSE
    );

    assert.equal(result.nextCalled, true);
    assert.equal(result.statusCode, undefined);
});

test("requires every requested permission", () => {
    const result = runMiddleware(
        { roles: [USER_ROLES.CUSTOMER] },
        PERMISSIONS.CATALOG_VIEW,
        PERMISSIONS.BOOKING_MANAGE
    );

    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
});

test("returns the same forbidden response for invalid roles and policies", () => {
    const invalidRole = runMiddleware(
        { roles: ["STAFF"] },
        PERMISSIONS.CATALOG_VIEW
    );
    const invalidPermission = runMiddleware(
        { roles: [USER_ROLES.CUSTOMER] },
        "unknown.permission"
    );

    assert.deepEqual(invalidRole.responseBody, invalidPermission.responseBody);
    assert.deepEqual(invalidRole.responseBody, {
        success: false,
        message: "You do not have permission"
    });
});
