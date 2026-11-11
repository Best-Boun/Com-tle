const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

    const slotTimes = (env.BOOKING_SLOT_TIMES || "09:00,10:00,11:00,13:00,14:00,15:00,16:00")
        .split(",")
        .map((time) => time.trim())
        .filter(Boolean);

    if (slotTimes.length === 0 || !slotTimes.every((time) => TIME_PATTERN.test(time))) {
        throw new Error("BOOKING_SLOT_TIMES must be a comma-separated list of HH:MM times");
    }

    return {
        timezone,
        slotTimes: [...new Set(slotTimes)].sort(),
        slotCapacity: positiveInteger(env, "BOOKING_SLOT_CAPACITY", 2),
        maxDaysAhead: positiveInteger(env, "BOOKING_MAX_DAYS_AHEAD", 30),
        catalogServiceUrl: serviceUrl(env, "CATALOG_SERVICE_URL"),
        repairServiceUrl: serviceUrl(env, "REPAIR_SERVICE_URL"),
        serviceCallTimeoutMs: positiveInteger(env, "SERVICE_CALL_TIMEOUT_MS", 5000)
    };
}

module.exports = {
    loadBookingConfig
};
