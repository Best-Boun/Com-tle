const {
    PERMISSIONS,
    USER_ROLES
} = require("../../shared/constants");
const { createUuid } = require("../src/utils/uuid");
const { ADMIN_PERMISSIONS } = require("../src/constants/adminPermissions");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../src/constants/customerMergePermissions");

const knownPermissions = new Set([
    ...Object.values(PERMISSIONS),
    ...Object.values(ADMIN_PERMISSIONS),
    ...Object.values(CUSTOMER_MERGE_PERMISSIONS)
]);
const ownProfilePermissions = [
    PERMISSIONS.USER_PROFILE_VIEW_OWN,
    PERMISSIONS.USER_PROFILE_UPDATE_OWN
];
// Approved grants; mirrors the Railway user_db role_permissions (2026-11-14).
// Admin operations require grants made directly to ADMIN (ADMIN_ONLY).
const approvedRolePermissions = new Map([
    [USER_ROLES.ADMIN, [
        PERMISSIONS.PAYMENT_RECORD,
        ...Object.values(ADMIN_PERMISSIONS),
        ...Object.values(CUSTOMER_MERGE_PERMISSIONS),
        ...ownProfilePermissions
    ]],
    [USER_ROLES.CUSTOMER, [PERMISSIONS.PAYMENT_VIEW_OWN, ...ownProfilePermissions]],
    [USER_ROLES.TECHNICIAN, [...ownProfilePermissions]]
]);

async function seed(knex, { createId = createUuid } = {}) {
    await knex.transaction(async (trx) => {
        const permissionIds = new Map();
        for (const permissionCode of knownPermissions) {
            const existing = await trx("permissions")
                .select("permission_id", "permission_name")
                .where({ permission_code: permissionCode })
                .first();
            if (existing) {
                if (existing.permission_name !== permissionCode) {
                    throw new Error(
                        `Permission code "${permissionCode}" has a conflicting name`
                    );
                }
                permissionIds.set(permissionCode, existing.permission_id);
                continue;
            }

            const permissionId = createId();
            await trx("permissions").insert({
                permission_id: permissionId,
                permission_code: permissionCode,
                permission_name: permissionCode,
                description: null
            });
            permissionIds.set(permissionCode, permissionId);
        }

        const roleIds = new Map();
        for (const roleCode of Object.values(USER_ROLES)) {
            const role = await trx("roles")
                .select("role_id")
                .where({ role_code: roleCode })
                .first();
            if (!role) {
                throw new Error(`Role "${roleCode}" must be seeded before permissions`);
            }
            roleIds.set(roleCode, role.role_id);
        }

        for (const [roleCode, permissionCodes] of approvedRolePermissions) {
            for (const permissionCode of permissionCodes) {
                if (!knownPermissions.has(permissionCode)) {
                    throw new Error(`Unknown permission "${permissionCode}" in role policy`);
                }
                const roleId = roleIds.get(roleCode);
                const permissionId = permissionIds.get(permissionCode);
                const existing = await trx("role_permissions")
                    .select("role_id")
                    .where({ role_id: roleId, permission_id: permissionId })
                    .first();
                if (existing) {
                    continue;
                }

                await trx("role_permissions").insert({
                    role_id: roleId,
                    permission_id: permissionId
                });
            }
        }
    });
}

module.exports = {
    seed
};
