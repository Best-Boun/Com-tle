const USER_COLUMNS = ["user_id", "status"];
const CUSTOMER_COLUMNS = [
    "customer_id", "user_id", "customer_type", "merged_into_customer_id"
];
const MAX_DEADLOCK_ATTEMPTS = 3;

async function lockRows(trx, table, idColumn, ids, defaultColumns, additionalColumns = []) {
    const rows = new Map();
    const columns = [...new Set([...defaultColumns, ...additionalColumns])];
    const sortedIds = [...new Set(ids)].sort((a, b) => {
        const normalizedA = a.toLowerCase();
        const normalizedB = b.toLowerCase();
        if (normalizedA < normalizedB) return -1;
        if (normalizedA > normalizedB) return 1;
        return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const id of sortedIds) {
        const row = await trx(table)
            .select(...columns)
            .where({ [idColumn]: id })
            .forUpdate()
            .first();
        if (row) {
            rows.set(id, row);
        }
    }
    return rows;
}

async function lockUsers(trx, userIds, additionalColumns) {
    return lockRows(trx, "users", "user_id", userIds, USER_COLUMNS, additionalColumns);
}

async function lockCustomers(trx, customerIds, additionalColumns) {
    return lockRows(trx, "customers", "customer_id", customerIds, CUSTOMER_COLUMNS, additionalColumns);
}

function isDeadlockError(error) {
    const seen = new Set();
    while (error && typeof error === "object" && !seen.has(error)) {
        seen.add(error);
        if (error.code === "ER_LOCK_DEADLOCK" || Number(error.errno) === 1213) {
            return true;
        }
        error = error.cause;
    }
    return false;
}

async function withDeadlockRetry(operation) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === MAX_DEADLOCK_ATTEMPTS || !isDeadlockError(error)) {
                throw error;
            }
        }
    }
}

module.exports = { lockUsers, lockCustomers, withDeadlockRetry, isDeadlockError };
