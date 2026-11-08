const assert = require("node:assert/strict");
const test = require("node:test");
const requireRole = require("../src/middleware/roleMiddleware");

function runMiddleware(user, ...allowedRoles) {
    let statusCode;
    let responseBody;
    let nextCalled = false;

    const req = {};
    if (user !== undefined) {
        req.user = user;
    }

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

    requireRole(...allowedRoles)(req, res, () => {
        nextCalled = true;
    });

    return { statusCode, responseBody, nextCalled };
}

test("allows a user with one matching role", () => {
    const result = runMiddleware({ roles: ["CUSTOMER"] }, "CUSTOMER");

    assert.equal(result.nextCalled, true);
    assert.equal(result.statusCode, undefined);
});

test("allows a user with multiple roles when one matches", () => {
    const result = runMiddleware(
        { roles: ["CUSTOMER", "TECHNICIAN"] },
        "ADMIN",
        "TECHNICIAN"
    );

    assert.equal(result.nextCalled, true);
});

test("rejects a user when none of the assigned roles match", () => {
    const result = runMiddleware({ roles: ["CUSTOMER"] }, "ADMIN");

    assert.equal(result.statusCode, 403);
    assert.equal(result.responseBody.message, "You do not have permission");
    assert.equal(result.nextCalled, false);
});

test("rejects a missing roles claim", () => {
    const result = runMiddleware({}, "CUSTOMER");

    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
});

test("rejects an empty roles array", () => {
    const result = runMiddleware({ roles: [] }, "CUSTOMER");

    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
});

test("rejects roles claims that are not arrays", () => {
    for (const roles of ["CUSTOMER", null, {}, 1]) {
        const result = runMiddleware({ roles }, "CUSTOMER");

        assert.equal(result.statusCode, 403);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects arrays containing unknown role codes", () => {
    const result = runMiddleware({ roles: ["CUSTOMER", "STAFF"] }, "CUSTOMER");

    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
});

test("rejects a missing authenticated user", () => {
    const result = runMiddleware(undefined, "CUSTOMER");

    assert.equal(result.statusCode, 401);
    assert.equal(result.responseBody.message, "Authentication required");
    assert.equal(result.nextCalled, false);
});

test("rejects an empty or unknown role policy", () => {
    for (const allowedRoles of [[], ["STAFF"]]) {
        const result = runMiddleware({ roles: ["ADMIN"] }, ...allowedRoles);

        assert.equal(result.statusCode, 403);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects multiple assigned roles when none match the policy", () => {
    const result = runMiddleware(
        { roles: ["CUSTOMER", "TECHNICIAN"] },
        "ADMIN"
    );

    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
});
