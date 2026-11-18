const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Catalog seed "HW-DIAG" (Hardware Diagnosis): what a request is for when the
// customer does not pick a known service.
const DEFAULT_DIAGNOSIS_SERVICE_ID = "6f1c2a10-0000-4000-8000-000000000003";

function positiveInteger(env, name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
        return fallback;
    }
    if (!/^[1-9]\d*$/.test(raw.trim())) {
        throw new Error(`${name} must be a positive integer`);
    }
    return Number(raw.trim());
}

function serviceUrl(env, name) {
    const value = env[name]?.trim();
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new Error();
        }
    } catch {
        throw new Error(`${name} must be an HTTP(S) URL`);
    }
    return value.replace(/\/+$/, "");
}

function loadBookingConfig(env = process.env) {
    const timezone = env.BOOKING_TIMEZONE?.trim() || "Asia/Bangkok";
    try {
        new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    } catch {
        throw new Error("BOOKING_TIMEZONE must be a valid IANA time zone");
    }

    const diagnosisServiceId = env.REQUEST_DIAGNOSIS_SERVICE_ID?.trim() || DEFAULT_DIAGNOSIS_SERVICE_ID;
    if (!UUID_PATTERN.test(diagnosisServiceId)) {
        throw new Error("REQUEST_DIAGNOSIS_SERVICE_ID must be a UUID");
    }

    return {
        timezone,
        diagnosisServiceId,
        // How many open requests one customer may have at a time.
        maxOpenRequestsPerCustomer: positiveInteger(env, "REQUEST_MAX_OPEN_PER_CUSTOMER", 5),
        // Requests nobody brought in are closed after this many days (job: task 2).
        requestExpiryDays: positiveInteger(env, "REQUEST_EXPIRY_DAYS", 30),
        catalogServiceUrl: serviceUrl(env, "CATALOG_SERVICE_URL"),
        repairServiceUrl: serviceUrl(env, "REPAIR_SERVICE_URL"),
        serviceCallTimeoutMs: positiveInteger(env, "SERVICE_CALL_TIMEOUT_MS", 5000)
    };
}

module.exports = {
    loadBookingConfig
};
