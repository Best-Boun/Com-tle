const assert = require("node:assert/strict");
const test = require("node:test");
const { createUuid } = require("../src/utils/uuid");

test("createUuid returns a UUID v4 string", () => {
    const uuid = createUuid();

    assert.match(
        uuid,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
});
