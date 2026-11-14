const assert = require("node:assert/strict");
const test = require("node:test");
const { loadBaselineStatements } = require("../scripts/apply-fresh-baseline");

test("fresh baseline uses assigned_at and omits role_permissions.assigned_by", () => {
    const sql = loadBaselineStatements().join("\n");
    const rolePermissions = sql.match(/CREATE TABLE `role_permissions` \([\s\S]*?\) ENGINE=/i);

    assert.ok(rolePermissions);
    assert.match(
        rolePermissions[0],
        /`assigned_at` datetime\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)/i
    );
    assert.match(rolePermissions[0], /PRIMARY KEY \(`role_id`,`permission_id`\)/i);
    assert.match(rolePermissions[0], /`idx_role_permissions_permission_id`/i);
    assert.doesNotMatch(rolePermissions[0], /assigned_by/i);
    assert.match(
        rolePermissions[0],
        /FOREIGN KEY \(`role_id`\) REFERENCES `roles` \(`role_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/i
    );
    assert.match(
        rolePermissions[0],
        /FOREIGN KEY \(`permission_id`\) REFERENCES `permissions` \(`permission_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/i
    );
});
