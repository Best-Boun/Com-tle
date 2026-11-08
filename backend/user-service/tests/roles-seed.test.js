const assert = require("node:assert/strict");
const test = require("node:test");
const { seed } = require("../seeds/001_roles");

const expectedRoles = [
    { role_code: "CUSTOMER", role_name: "Customer", description: null },
    { role_code: "TECHNICIAN", role_name: "Technician", description: null },
    { role_code: "ADMIN", role_name: "Admin", description: null }
];

function createFakeKnex(initialRoles = []) {
    const roleRows = initialRoles.map((role) => ({ ...role }));

    function createTransactionTable(transactionRows, tableName) {
        assert.equal(tableName, "roles");
        const query = {
            criteria: {},
            select() {
                return this;
            },
            where(criteria) {
                this.criteria = criteria;
                return this;
            },
            async first() {
                return transactionRows.find((role) =>
                    Object.entries(this.criteria).every(
                        ([key, value]) => role[key] === value
                    )
                );
            },
            async insert(role) {
                const hasDuplicate = transactionRows.some((existing) =>
                    existing.role_id === role.role_id
                    || existing.role_code === role.role_code
                    || existing.role_name === role.role_name
                );
                if (hasDuplicate) {
                    const error = new Error("Duplicate role key");
                    error.code = "ER_DUP_ENTRY";
                    throw error;
                }
                transactionRows.push({ ...role });
            }
        };
        return query;
    }

    const knex = {
        async transaction(callback) {
            const transactionRows = roleRows.map((role) => ({ ...role }));
            const trx = (tableName) =>
                createTransactionTable(transactionRows, tableName);
            const result = await callback(trx);
            roleRows.splice(0, roleRows.length, ...transactionRows);
            return result;
        }
    };

    return { knex, roleRows };
}

function createUuidSequence(...uuids) {
    let index = 0;
    return () => uuids[index++];
}

function deterministicUuids() {
    return createUuidSequence(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003"
    );
}

test("inserts exactly the three configured roles with UUID v4 IDs", async () => {
    const { knex, roleRows } = createFakeKnex();

    await seed(knex);

    assert.equal(roleRows.length, 3);
    assert.deepEqual(
        roleRows.map(({ role_code, role_name, description }) => ({
            role_code,
            role_name,
            description
        })),
        expectedRoles
    );
    assert.equal(roleRows.some((role) => role.role_code === "STAFF"), false);
    for (const role of roleRows) {
        assert.match(
            role.role_id,
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
    }
});

test("skips existing roles when both code and name match without changing rows", async () => {
    const existing = expectedRoles.map((role, index) => ({
        role_id: `existing-${index}`,
        ...role,
        description: `Existing description ${index}`
    }));
    const original = existing.map((role) => ({ ...role }));
    const { knex, roleRows } = createFakeKnex(existing);

    await seed(knex);

    assert.deepEqual(roleRows, original);
});

test("throws when an existing role code has a different name", async () => {
    const conflictingRole = {
        role_id: "existing-customer",
        role_code: "CUSTOMER",
        role_name: "Existing customer label",
        description: null
    };
    const { knex, roleRows } = createFakeKnex([conflictingRole]);

    await assert.rejects(seed(knex), /Role code "CUSTOMER" is assigned to role name/);
    assert.deepEqual(roleRows, [conflictingRole]);
});

test("throws when an expected role name is assigned to another code", async () => {
    const conflictingRole = {
        role_id: "other-role",
        role_code: "OTHER",
        role_name: "Customer",
        description: null
    };
    const { knex, roleRows } = createFakeKnex([conflictingRole]);

    await assert.rejects(
        seed(knex),
        /Role name "Customer" is already assigned to another role code/
    );
    assert.deepEqual(roleRows, [conflictingRole]);
});

test("surfaces a duplicate role_id error without overwriting the existing row", async () => {
    const existing = {
        role_id: "00000000-0000-4000-8000-000000000001",
        role_code: "UNRELATED",
        role_name: "Unrelated",
        description: null
    };
    const { knex, roleRows } = createFakeKnex([existing]);

    await assert.rejects(
        seed(knex, { createUuid: deterministicUuids() }),
        (error) => error.code === "ER_DUP_ENTRY"
    );
    assert.deepEqual(roleRows, [existing]);
});

test("is idempotent and preserves existing role IDs and data", async () => {
    const { knex, roleRows } = createFakeKnex();

    await seed(knex);
    const firstRunRows = roleRows.map((role) => ({ ...role }));
    await seed(knex);

    assert.equal(roleRows.length, 3);
    assert.deepEqual(roleRows, firstRunRows);
});

test("rolls back earlier inserts when a later role conflicts", async () => {
    const conflictingRole = {
        role_id: "existing-technician",
        role_code: "TECHNICIAN",
        role_name: "Existing technician label",
        description: null
    };
    const { knex, roleRows } = createFakeKnex([conflictingRole]);

    await assert.rejects(
        seed(knex, { createUuid: deterministicUuids() }),
        /Role code "TECHNICIAN" is assigned to role name/
    );
    assert.deepEqual(roleRows, [conflictingRole]);
});
