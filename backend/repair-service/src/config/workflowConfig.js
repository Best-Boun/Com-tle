/**
 * Shop rules that the owner can change without touching code.
 *
 *   NO_REPAIR_FEE       inspection fee (THB) when the customer chooses not to
 *                       repair. Inspection is free when they do repair.
 *   FREE_STORAGE_DAYS   days a ready device is kept for free before the
 *                       dashboard asks the shop to call the customer.
 */
function wholeNumber(env, name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
        return fallback;
    }
    if (!/^\d+$/.test(String(raw).trim())) {
        throw new Error(`${name} must be a whole number`);
    }
    return Number(String(raw).trim());
}

function loadWorkflowConfig(env = process.env) {
    return {
        noRepairFee: wholeNumber(env, "NO_REPAIR_FEE", 300),
        freeStorageDays: wholeNumber(env, "FREE_STORAGE_DAYS", 7)
    };
}

module.exports = {
    loadWorkflowConfig
};
