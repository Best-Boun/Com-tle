const assert = require("node:assert/strict");
const test = require("node:test");
const { getServerBindHost } = require("../src/config/serverBinding");

test("normal server startup leaves the existing listen overload unchanged", () => {
    assert.equal(getServerBindHost({}), null);
    assert.equal(getServerBindHost({
        USER_SERVICE_HTTP_INTEGRATION_TEST: "0"
    }), null);
});

test("HTTP integration startup binds exclusively to loopback", () => {
    assert.equal(getServerBindHost({
        USER_SERVICE_HTTP_INTEGRATION_TEST: "1"
    }), "127.0.0.1");
});
