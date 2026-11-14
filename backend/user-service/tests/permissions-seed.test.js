const assert = require("node:assert/strict");
const test = require("node:test");
const {
    PERMISSIONS,
    USER_ROLES
} = require("../../shared/constants");
const { seed } = require("../seeds/002_permissions");
const { ADMIN_PERMISSIONS } = require("../src/constants/adminPermissions");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../src/constants/customerMergePermissions");

function createFakeKnex() {
    let state = {
        roles: Object.values(USER_ROLES).map((roleCode, index) => ({
            role_id: `role-${index}`,
            role_code: roleCode
        })),
        permissions: [],
        role_permissions: []
    };

    function queryFor(currentState, tableName) {
        const filters = [];
        return {
            select() {
                return this;
            },
            where(criteria) {
                filters.push((row) => Object.entries(criteria).every(
                    ([key, value]) => row[key] === value
                ));
                return this;
            },
            async first() {
                return currentState[tableName].find((row) =>
                    filters.every((filter) => filter(row))
                );
            },
            async insert(row) {
                if (tableName === "permissions") {
                    assert.deepEqual(Object.keys(row).sort(), [
                        "description",
                        "permission_code",
                        "permission_id",
                        "permission_name"
                    ]);
                } else {
                    assert.equal(tableName, "role_permissions");
                    assert.deepEqual(Object.keys(row).sort(), [
                        "permission_id",
                        "role_id"
                    ]);
                }

                const duplicate = currentState[tableName].some((existing) =>
                    tableName === "permissions"
                        ? existing.permission_id === row.permission_id
                            || existing.permission_code === row.permission_code
                        : existing.role_id === row.role_id
                            && existing.permission_id === row.permission_id
                );
                if (duplicate) {
                    const error = new Error("Duplicate key");
                    error.code = "ER_DUP_ENTRY";
                    throw error;
                }
                currentState[tableName].push({ ...row });
            }
        };
    }

    const knex = {
        async transaction(callback) {
            const transactionState = structuredClone(state);
            const trx = (tableName) => queryFor(transactionState, tableName);
            const result = await callback(trx);
            state = transactionState;
            return result;
        },
        getState() {
            return structuredClone(state);
        },
        async insertAssignment(row) {
            const duplicate = state.role_permissions.some((existing) =>
                existing.role_id === row.role_id
                && existing.permission_id === row.permission_id
            );
            if (duplicate) {
                const error = new Error("Duplicate assignment");
                error.code = "ER_DUP_ENTRY";
                throw error;
            }
            state.role_permissions.push(row);
        }
    };

    return knex;
}

function createIds() {
    let id = 0;
    return () => `permission-id-${++id}`;
}

function getAssignments(state) {
    return state.role_permissions.map((assignment) => ({
        role_code: state.roles.find((role) => role.role_id === assignment.role_id).role_code,
        permission_code: state.permissions.find(
            (permission) => permission.permission_id === assignment.permission_id
        ).permission_code
    })).sort((left, right) => (
        `${left.role_code}:${left.permission_code}`
            .localeCompare(`${right.role_code}:${right.permission_code}`)
    ));
}

test("permission seed preserves definitions and creates only approved mappings", async () => {
    const knex = createFakeKnex();
    const createId = createIds();

    await seed(knex, { createId });
    const first = knex.getState();
    await seed(knex, { createId });
    const second = knex.getState();

    assert.deepEqual(
        first.permissions.map((row) => row.permission_code).sort(),
        [
            ...Object.values(PERMISSIONS),
            ...Object.values(ADMIN_PERMISSIONS),
            ...Object.values(CUSTOMER_MERGE_PERMISSIONS)
        ].sort()
    );
    assert.equal(first.permissions.some((row) => row.permission_code === "can_refund"), false);
    const ownProfile = [PERMISSIONS.USER_PROFILE_VIEW_OWN, PERMISSIONS.USER_PROFILE_UPDATE_OWN];
    // Must match the approved Railway user_db role_permissions (2026-11-14).
    const expected = [
        ...[
            PERMISSIONS.PAYMENT_RECORD,
            ...Object.values(ADMIN_PERMISSIONS),
            ...Object.values(CUSTOMER_MERGE_PERMISSIONS),
            ...ownProfile
        ].map((code) => ({ role_code: USER_ROLES.ADMIN, permission_code: code })),
        ...[PERMISSIONS.PAYMENT_VIEW_OWN, ...ownProfile]
            .map((code) => ({ role_code: USER_ROLES.CUSTOMER, permission_code: code })),
        ...ownProfile.map((code) => ({ role_code: USER_ROLES.TECHNICIAN, permission_code: code }))
    ].sort((left, right) => (
        `${left.role_code}:${left.permission_code}`
            .localeCompare(`${right.role_code}:${right.permission_code}`)
    ));
    assert.deepEqual(getAssignments(first), expected);
    assert.deepEqual(second, first);
});

test("seed never grants admin, merge, or unapproved permissions to non-admin roles", async () => {
    const knex = createFakeKnex();
    await seed(knex, { createId: createIds() });
    const state = knex.getState();
    const assignments = getAssignments(state);

    for (const roleCode of [USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN]) {
        for (const permissionCode of [
            PERMISSIONS.PAYMENT_RECORD,
            PERMISSIONS.BOOKING_MANAGE,
            ...Object.values(ADMIN_PERMISSIONS),
            ...Object.values(CUSTOMER_MERGE_PERMISSIONS)
        ]) {
            assert.equal(
                assignments.some((assignment) =>
                    assignment.role_code === roleCode
                    && assignment.permission_code === permissionCode
                ),
                false,
                `${roleCode} must not receive ${permissionCode}`
            );
        }
    }
    assert.equal(
        assignments.some((assignment) => assignment.permission_code === PERMISSIONS.BOOKING_MANAGE),
        false,
        "Unapproved permissions stay unassigned"
    );
});

test("permission schema's composite key prevents duplicate assignments", async () => {
    const knex = createFakeKnex();
    await seed(knex, { createId: createIds() });
    const assignment = knex.getState().role_permissions[0];

    await assert.rejects(
        knex.insertAssignment(assignment),
        (error) => error.code === "ER_DUP_ENTRY"
    );
});
