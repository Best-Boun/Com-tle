const assert = require("node:assert/strict");
const test = require("node:test");
const {
    PERMISSIONS,
    USER_ROLES
} = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const { ADMIN_PERMISSIONS } = require("../src/constants/adminPermissions");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../src/constants/customerMergePermissions");
const { createRequirePermission } = require("../src/middleware/requirePermission");
const { createPermissionService } = require("../src/services/permissionService");

function createFakeDb(roleCodeOrCodes = USER_ROLES.CUSTOMER, userStatus = "ACTIVE") {
    const assignedRoleCodes = Array.isArray(roleCodeOrCodes)
        ? roleCodeOrCodes
        : [roleCodeOrCodes];
    const roleCode = assignedRoleCodes[0];
    const roleIds = Object.fromEntries(
        Object.values(USER_ROLES).map((code) => [code, `role-${code}`])
    );
    const permissionCodes = {
        [USER_ROLES.ADMIN]: [PERMISSIONS.PAYMENT_RECORD],
        [USER_ROLES.CUSTOMER]: [PERMISSIONS.PAYMENT_VIEW_OWN],
        [USER_ROLES.TECHNICIAN]: []
    };
    const state = {
        users: [{ user_id: "user-1", status: userStatus }],
        user_roles: assignedRoleCodes.map((code) => ({
            user_id: "user-1",
            role_id: roleIds[code]
        })),
        roles: Object.values(USER_ROLES).map((code) => ({
            role_id: roleIds[code],
            role_code: code
        })),
        permissions: [],
        role_permissions: []
    };

    for (const code of Object.values(USER_ROLES).flatMap(
        (role) => permissionCodes[role]
    )) {
        if (!state.permissions.some((permission) => permission.permission_code === code)) {
            state.permissions.push({
                permission_id: `permission-${code}`,
                permission_code: code
            });
        }
    }
    for (const assignedRoleCode of assignedRoleCodes) {
        for (const code of permissionCodes[assignedRoleCode]) {
            state.role_permissions.push({
                role_id: roleIds[assignedRoleCode],
                permission_id: `permission-${code}`
            });
        }
    }

    let statusLookupFails = false;
    let accessLookupFails = false;
    function db(tableName) {
        let criteria = {};
        const query = {
            join() {
                return this;
            },
            leftJoin() {
                return this;
            },
            select() {
                return this;
            },
            where(value) {
                criteria = value;
                return this;
            },
            orderBy() {
                return this;
            },
            async execute() {
                if (tableName === "users") {
                    if (statusLookupFails) {
                        throw new Error("database unavailable");
                    }
                    return state.users.filter(
                        (user) => user.user_id === criteria.user_id
                    );
                }
                if (tableName !== "user_roles") {
                    throw new Error(`Unexpected table ${tableName}`);
                }
                if (accessLookupFails) {
                    throw new Error("database unavailable");
                }
                const assignments = state.user_roles.filter(
                    (row) => row.user_id === criteria["user_roles.user_id"]
                );
                return assignments.flatMap((assignment) => {
                    const role = state.roles.find(
                        (row) => row.role_id === assignment.role_id
                    );
                    const rolePermissions = state.role_permissions.filter(
                        (row) => row.role_id === assignment.role_id
                    );
                    if (rolePermissions.length === 0) {
                        return [{ role_code: role?.role_code, permission_code: null }];
                    }
                    return rolePermissions.map((rolePermission) => ({
                        role_code: role?.role_code,
                        permission_code: state.permissions.find(
                            (row) => row.permission_id === rolePermission.permission_id
                        )?.permission_code
                    }));
                });
            },
            async first() {
                return (await this.execute())[0];
            },
            then(resolve, reject) {
                return this.execute().then(resolve, reject);
            }
        };
        return query;
    }

    db.setStatus = (status) => {
        state.users[0].status = status;
    };
    db.failStatusLookups = (value) => {
        statusLookupFails = value;
    };
    db.failAccessLookups = (value) => {
        accessLookupFails = value;
    };
    db.grant = (permissionCode, grantedRoleCode = roleCode) => {
        const permissionId = `permission-${permissionCode}`;
        if (!state.permissions.some((row) => row.permission_id === permissionId)) {
            state.permissions.push({
                permission_id: permissionId,
                permission_code: permissionCode
            });
        }
        if (!state.role_permissions.some((row) =>
            row.role_id === roleIds[grantedRoleCode] && row.permission_id === permissionId
        )) {
            state.role_permissions.push({
                role_id: roleIds[grantedRoleCode],
                permission_id: permissionId
            });
        }
    };
    db.revoke = (permissionCode, revokedRoleCode = roleCode) => {
        const permission = state.permissions.find(
            (row) => row.permission_code === permissionCode
        );
        if (permission) {
            state.role_permissions = state.role_permissions.filter((row) =>
                row.role_id !== roleIds[revokedRoleCode]
                || row.permission_id !== permission.permission_id
            );
        }
    };

    return db;
}

test("permission service resolves only current database role and permission assignments", async () => {
    const db = createFakeDb(USER_ROLES.ADMIN);
    const service = createPermissionService({ db });

    assert.deepEqual(await service.getUserAccess("user-1"), {
        roles: [USER_ROLES.ADMIN],
        permissions: [PERMISSIONS.PAYMENT_RECORD]
    });
    assert.equal(
        await service.userHasPermission("user-1", PERMISSIONS.PAYMENT_RECORD),
        true
    );
    assert.equal(
        await service.userHasPermission("user-1", PERMISSIONS.PAYMENT_VIEW_OWN),
        false
    );
    assert.equal(
        await service.userHasPermission("user-1", ADMIN_PERMISSIONS.USER_LIST),
        false
    );

    db.grant(PERMISSIONS.BOOKING_MANAGE);
    assert.equal(
        await service.userHasPermission("user-1", PERMISSIONS.BOOKING_MANAGE),
        true
    );
    db.revoke(PERMISSIONS.BOOKING_MANAGE);
    assert.equal(
        await service.userHasPermission("user-1", PERMISSIONS.BOOKING_MANAGE),
        false
    );
});

test("approved role mappings are enforced without ADMIN or token-claim bypasses", async () => {
    const approvedCases = [
        [USER_ROLES.ADMIN, PERMISSIONS.PAYMENT_RECORD, true],
        [USER_ROLES.CUSTOMER, PERMISSIONS.PAYMENT_VIEW_OWN, true],
        [USER_ROLES.CUSTOMER, PERMISSIONS.PAYMENT_RECORD, false],
        [USER_ROLES.TECHNICIAN, PERMISSIONS.PAYMENT_RECORD, false],
        [USER_ROLES.ADMIN, ADMIN_PERMISSIONS.USER_LIST, false]
    ];

    for (const [roleCode, permissionCode, expected] of approvedCases) {
        const permissionService = createPermissionService({
            db: createFakeDb(roleCode)
        });
        assert.equal(
            await permissionService.userHasPermission("user-1", permissionCode),
            expected,
            `${roleCode} decision for ${permissionCode}`
        );
    }
});

test("admin permission requires a current ADMIN role and that permission", async () => {
    for (const roleCode of [USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN]) {
        const db = createFakeDb(roleCode);
        db.grant(ADMIN_PERMISSIONS.USER_LIST);
        const service = createPermissionService({ db });
        assert.equal(
            await service.userHasPermission(
                "user-1",
                ADMIN_PERMISSIONS.USER_LIST,
                { requiredRole: USER_ROLES.ADMIN }
            ),
            false
        );
    }

    const adminDb = createFakeDb(USER_ROLES.ADMIN);
    const service = createPermissionService({ db: adminDb });
    assert.equal(
        await service.userHasPermission(
            "user-1",
            ADMIN_PERMISSIONS.USER_LIST,
            { requiredRole: USER_ROLES.ADMIN }
        ),
        false
    );
    adminDb.grant(ADMIN_PERMISSIONS.USER_LIST);
    assert.equal(
        await service.userHasPermission(
            "user-1",
            ADMIN_PERMISSIONS.USER_LIST,
            { requiredRole: USER_ROLES.ADMIN }
        ),
        true
    );
});

test("merge request and approval require separate current permissions", async () => {
    const db = createFakeDb(USER_ROLES.ADMIN);
    const service = createPermissionService({ db });
    db.grant(CUSTOMER_MERGE_PERMISSIONS.REQUEST);
    assert.equal(await service.userHasPermission(
        "user-1", CUSTOMER_MERGE_PERMISSIONS.REQUEST, { requiredRole: USER_ROLES.ADMIN }
    ), true);
    assert.equal(await service.userHasPermission(
        "user-1", CUSTOMER_MERGE_PERMISSIONS.APPROVE, { requiredRole: USER_ROLES.ADMIN }
    ), false);
    db.grant(CUSTOMER_MERGE_PERMISSIONS.APPROVE);
    db.revoke(CUSTOMER_MERGE_PERMISSIONS.REQUEST);
    assert.equal(await service.userHasPermission(
        "user-1", CUSTOMER_MERGE_PERMISSIONS.REQUEST, { requiredRole: USER_ROLES.ADMIN }
    ), false);
    assert.equal(await service.userHasPermission(
        "user-1", CUSTOMER_MERGE_PERMISSIONS.APPROVE, { requiredRole: USER_ROLES.ADMIN }
    ), true);
});

test("all protected permission decisions deny disabled and locked users", async () => {
    for (const status of ["DISABLED", "LOCKED"]) {
        const db = createFakeDb(USER_ROLES.ADMIN, status);
        const permissionService = createPermissionService({ db });

        assert.equal(await permissionService.isActiveUser("user-1"), false);
        assert.equal(
            await permissionService.userHasPermission("user-1", PERMISSIONS.PAYMENT_RECORD),
            false
        );
        assert.equal(
            await permissionService.activeUserHasPermission(
                "user-1",
                PERMISSIONS.PAYMENT_RECORD
            ),
            false
        );
    }
});

test("unknown users, invalid identifiers, and unknown permissions deny by default", async () => {
    const permissionService = createPermissionService({
        db: createFakeDb(USER_ROLES.ADMIN)
    });

    assert.equal(await permissionService.isActiveUser("missing-user"), false);
    assert.equal(await permissionService.isActiveUser(" "), false);
    assert.equal(
        await permissionService.userHasPermission("missing-user", PERMISSIONS.PAYMENT_RECORD),
        false
    );
    assert.equal(
        await permissionService.userHasPermission("user-1", "unknown.permission"),
        false
    );
});

test("authorization database failures return service unavailable", async () => {
    const statusDb = createFakeDb();
    statusDb.failStatusLookups(true);
    const statusService = createPermissionService({ db: statusDb });
    await assert.rejects(
        statusService.isActiveUser("user-1"),
        (error) => error instanceof AppError && error.statusCode === 503
    );

    const accessDb = createFakeDb();
    accessDb.failAccessLookups(true);
    const accessService = createPermissionService({ db: accessDb });
    await assert.rejects(
        accessService.getUserAccess("user-1"),
        (error) => error instanceof AppError && error.statusCode === 503
    );
    await assert.rejects(
        accessService.userHasPermission(
            "user-1",
            ADMIN_PERMISSIONS.USER_LIST,
            { requiredRole: USER_ROLES.ADMIN }
        ),
        (error) => error instanceof AppError && error.statusCode === 503
    );
});

const adminOnly = { requiredRole: USER_ROLES.ADMIN };

test("ADMIN_ONLY allows a direct ADMIN grant and denies an ADMIN without one", async () => {
    const granted = createFakeDb(USER_ROLES.ADMIN);
    granted.grant(ADMIN_PERMISSIONS.USER_LIST, USER_ROLES.ADMIN);
    assert.equal(await createPermissionService({ db: granted }).userHasPermission(
        "user-1", ADMIN_PERMISSIONS.USER_LIST, adminOnly
    ), true);

    const ungranted = createFakeDb(USER_ROLES.ADMIN);
    assert.equal(await createPermissionService({ db: ungranted }).userHasPermission(
        "user-1", ADMIN_PERMISSIONS.USER_LIST, adminOnly
    ), false);
});

test("ADMIN_ONLY ignores permissions granted only through the user's other roles", async () => {
    for (const otherRole of [USER_ROLES.TECHNICIAN, USER_ROLES.CUSTOMER]) {
        const db = createFakeDb([USER_ROLES.ADMIN, otherRole]);
        db.grant(ADMIN_PERMISSIONS.USER_LIST, otherRole);
        db.grant(CUSTOMER_MERGE_PERMISSIONS.REQUEST, otherRole);
        const service = createPermissionService({ db });
        for (const permissionCode of [
            ADMIN_PERMISSIONS.USER_LIST,
            CUSTOMER_MERGE_PERMISSIONS.REQUEST
        ]) {
            assert.equal(
                await service.userHasPermission("user-1", permissionCode, adminOnly),
                false,
                `ADMIN + ${otherRole} must not use ${otherRole}'s ${permissionCode}`
            );
        }
    }
});

test("ADMIN_ONLY denies CUSTOMER-only and TECHNICIAN-only users holding the permission", async () => {
    for (const roleCode of [USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN]) {
        const db = createFakeDb(roleCode);
        db.grant(ADMIN_PERMISSIONS.USER_LIST, roleCode);
        assert.equal(await createPermissionService({ db }).userHasPermission(
            "user-1", ADMIN_PERMISSIONS.USER_LIST, adminOnly
        ), false, roleCode);
    }
});

test("ADMIN_ONLY allows ADMIN + TECHNICIAN when the grant is on ADMIN", async () => {
    const db = createFakeDb([USER_ROLES.ADMIN, USER_ROLES.TECHNICIAN]);
    db.grant(ADMIN_PERMISSIONS.USER_LIST, USER_ROLES.ADMIN);
    assert.equal(await createPermissionService({ db }).userHasPermission(
        "user-1", ADMIN_PERMISSIONS.USER_LIST, adminOnly
    ), true);
});

test("non-admin checks without requiredRole keep the multi-role permission union", async () => {
    const db = createFakeDb([USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN]);
    db.grant(PERMISSIONS.WORK_ORDER_VIEW_ASSIGNED, USER_ROLES.TECHNICIAN);
    const service = createPermissionService({ db });
    for (const permissionCode of [
        PERMISSIONS.PAYMENT_VIEW_OWN,
        PERMISSIONS.WORK_ORDER_VIEW_ASSIGNED
    ]) {
        assert.equal(await service.userHasPermission("user-1", permissionCode), true);
        assert.equal(await service.activeUserHasPermission("user-1", permissionCode), true);
    }

    const adminDb = createFakeDb([USER_ROLES.ADMIN, USER_ROLES.CUSTOMER]);
    adminDb.grant(ADMIN_PERMISSIONS.USER_LIST, USER_ROLES.CUSTOMER);
    const adminService = createPermissionService({ db: adminDb });
    assert.equal(
        await adminService.userHasPermission("user-1", ADMIN_PERMISSIONS.USER_LIST),
        true
    );
    assert.equal(
        await adminService.activeUserHasPermission("user-1", ADMIN_PERMISSIONS.USER_LIST),
        true
    );
});

test("DISABLED and LOCKED multi-role users are denied for admin and non-admin checks", async () => {
    for (const status of ["DISABLED", "LOCKED"]) {
        const db = createFakeDb([USER_ROLES.ADMIN, USER_ROLES.TECHNICIAN], status);
        db.grant(ADMIN_PERMISSIONS.USER_LIST, USER_ROLES.ADMIN);
        const service = createPermissionService({ db });
        assert.equal(await service.userHasPermission(
            "user-1", ADMIN_PERMISSIONS.USER_LIST, adminOnly
        ), false, status);
        assert.equal(await service.userHasPermission(
            "user-1", PERMISSIONS.PAYMENT_RECORD
        ), false, status);
        assert.equal(await service.activeUserHasPermission(
            "user-1", PERMISSIONS.PAYMENT_RECORD
        ), false, status);
    }
});

test("getUserAccess still returns the sorted multi-role union in the same shape", async () => {
    const db = createFakeDb([USER_ROLES.TECHNICIAN, USER_ROLES.ADMIN, USER_ROLES.CUSTOMER]);
    db.grant(PERMISSIONS.WORK_ORDER_VIEW_ASSIGNED, USER_ROLES.TECHNICIAN);
    assert.deepEqual(await createPermissionService({ db }).getUserAccess("user-1"), {
        roles: [USER_ROLES.ADMIN, USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN],
        permissions: [
            PERMISSIONS.PAYMENT_RECORD,
            PERMISSIONS.PAYMENT_VIEW_OWN,
            PERMISSIONS.WORK_ORDER_VIEW_ASSIGNED
        ]
    });
});

test("permission middleware denies unauthenticated, missing, and unknown permissions", async () => {
    const permissionService = {
        async userHasPermission(_userId, permissionCode) {
            return permissionCode === PERMISSIONS.PAYMENT_RECORD;
        }
    };
    const requirePermission = createRequirePermission(permissionService);

    async function run(req, permissionCode) {
        let error;
        let nextCalled = false;
        await requirePermission(permissionCode)(req, {}, (value) => {
            error = value;
            nextCalled = !value;
        });
        return { error, nextCalled };
    }

    const unauthenticated = await run({}, PERMISSIONS.PAYMENT_RECORD);
    assert.equal(unauthenticated.error.statusCode, 401);
    assert.equal(unauthenticated.nextCalled, false);

    const insufficient = await run(
        { auth: { userId: "user-1", roles: ["ADMIN"], permissions: ["booking.manage"] } },
        PERMISSIONS.BOOKING_MANAGE
    );
    assert.equal(insufficient.error.statusCode, 403);
    assert.equal(insufficient.nextCalled, false);

    const unknown = await run({ auth: { userId: "user-1" } }, "unknown.permission");
    assert.equal(unknown.error.statusCode, 403);
    assert.equal(unknown.nextCalled, false);

    const allowed = await run(
        { auth: { userId: "user-1", roles: ["CUSTOMER"] } },
        PERMISSIONS.PAYMENT_RECORD
    );
    assert.equal(allowed.nextCalled, true);
});
