const { USER_ROLES } = require("../../shared/constants");
const { createUuid } = require("../src/utils/uuid");

const roles = [
    { roleCode: USER_ROLES.CUSTOMER, roleName: "Customer" },
    { roleCode: USER_ROLES.TECHNICIAN, roleName: "Technician" },
    { roleCode: USER_ROLES.ADMIN, roleName: "Admin" }
];

async function seed(knex, { createUuid: generateUuid = createUuid } = {}) {
    await knex.transaction(async (trx) => {
        for (const role of roles) {
            const existingRole = await trx("roles")
                .select("role_id", "role_name")
                .where({ role_code: role.roleCode })
                .first();

            if (existingRole) {
                if (existingRole.role_name !== role.roleName) {
                    throw new Error(
                        `Role code "${role.roleCode}" is assigned to role name "${existingRole.role_name}" instead of "${role.roleName}"`
                    );
                }
                continue;
            }

            const conflictingName = await trx("roles")
                .select("role_code")
                .where({ role_name: role.roleName })
                .first();

            if (conflictingName) {
                throw new Error(
                    `Role name "${role.roleName}" is already assigned to another role code`
                );
            }

            await trx("roles").insert({
                role_id: generateUuid(),
                role_code: role.roleCode,
                role_name: role.roleName,
                description: null
            });
        }
    });
}

module.exports = {
    seed
};
