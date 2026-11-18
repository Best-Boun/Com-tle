const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const AppError = require("../../shared/errors/AppError");
const { OPEN_STATUSES } = require("../src/constants");

const ISSUER = "test-issuer";
const AUDIENCE = "test-audience";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

function signToken(userId, roles) {
    return jwt.sign({ roles }, privateKey, {
        algorithm: "RS256",
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 300
    });
}

// 2026-11-11 10:00 in Asia/Bangkok
const FIXED_NOW = new Date("2026-11-11T03:00:00Z");

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const DIAGNOSIS_SERVICE_ID = "22222222-2222-4222-8222-222222222222";

const TEST_CONFIG = {
    timezone: "Asia/Bangkok",
    diagnosisServiceId: DIAGNOSIS_SERVICE_ID,
    maxOpenRequestsPerCustomer: 3,
    requestExpiryDays: 30,
    catalogServiceUrl: "http://catalog.test",
    repairServiceUrl: "http://repair.test",
    serviceCallTimeoutMs: 1000
};

/** In-memory stand-in for bookingRepository (same method names). */
function createFakeBookingRepository({ now = () => FIXED_NOW } = {}) {
    const bookings = new Map();
    const history = [];

    async function inTransaction(work) {
        const snapshot = new Map([...bookings].map(([k, v]) => [k, { ...v }]));
        const historyLength = history.length;
        try {
            return await work({});
        } catch (error) {
            bookings.clear();
            snapshot.forEach((v, k) => bookings.set(k, v));
            history.length = historyLength;
            throw error;
        }
    }

    function matchesSearch(b, search) {
        const text = search.trim().toUpperCase();
        if (/^(RQ|BK)-/.test(text)) return b.booking_number.startsWith(text);
        const digits = text.replace(/\D/g, "");
        return Boolean(digits) && String(b.contact_phone || "").includes(digits);
    }

    return {
        bookings,
        history,
        transaction: inTransaction,
        async insertBooking(trx, booking) {
            if ([...bookings.values()].some((b) => b.booking_number === booking.booking_number)) {
                const error = new Error("Duplicate entry");
                error.code = "ER_DUP_ENTRY";
                throw error;
            }
            bookings.set(booking.booking_id, {
                ...booking,
                work_order_id: null,
                technician_id: null,
                cancelled_at: null,
                cancelled_by: null,
                cancellation_reason: null,
                created_at: now(),
                updated_at: now()
            });
        },
        async insertHistory(trx, entry) {
            history.push({ ...entry });
        },
        async findById(id) {
            return bookings.has(id) ? { ...bookings.get(id) } : null;
        },
        async findHistory(id) {
            return history.filter((h) => h.booking_id === id);
        },
        async list({ customerId, status, from, to, search }, { limit, offset }) {
            let items = [...bookings.values()];
            if (customerId) items = items.filter((b) => b.customer_id === customerId);
            if (status) items = items.filter((b) => b.status === status);
            if (from) items = items.filter((b) => b.created_at >= from);
            if (to) items = items.filter((b) => b.created_at < to);
            if (search) items = items.filter((b) => matchesSearch(b, search));
            return { items: items.slice(offset, offset + limit).map((b) => ({ ...b })), total: items.length };
        },
        async countOpenByCustomer(customerId) {
            return [...bookings.values()]
                .filter((b) => b.customer_id === customerId && OPEN_STATUSES.includes(b.status)).length;
        },
        async expireOpenBefore(cutoff, { reason, createId, at }) {
            const stale = [...bookings.values()].filter((b) => OPEN_STATUSES.includes(b.status) && b.created_at < cutoff);
            for (const b of stale) {
                history.push({ history_id: createId(), booking_id: b.booking_id, old_status: b.status, new_status: "EXPIRED", changed_by: null, reason });
                bookings.set(b.booking_id, { ...b, status: "EXPIRED", updated_at: at });
            }
            return stale.length;
        },
        async updateStatus(trx, id, fromStatus, changes) {
            const current = bookings.get(id);
            if (!current || current.status !== fromStatus) return false;
            bookings.set(id, { ...current, ...changes });
            return true;
        }
    };
}

function createFakeClients() {
    const calls = { catalog: [], repair: [] };
    const state = { repairFails: false, workOrders: new Map() };

    return {
        calls,
        state,
        catalogClient: {
            async getActiveService(serviceId, ctx) {
                calls.catalog.push({ serviceId, ctx });
                const services = {
                    [SERVICE_ID]: { service_code: "PC-CLEAN", service_name: "PC Cleaning", starting_price: 500 },
                    [DIAGNOSIS_SERVICE_ID]: { service_code: "HW-DIAG", service_name: "Hardware Diagnosis", starting_price: 300 }
                };
                if (!services[serviceId]) {
                    throw new AppError("Selected service is not available", 400);
                }
                return {
                    service_id: serviceId,
                    ...services[serviceId],
                    currency: "THB",
                    is_active: true,
                    category_is_active: true
                };
            }
        },
        repairClient: {
            async createWorkOrderFromBooking(payload, ctx) {
                calls.repair.push({ payload, ctx });
                if (state.repairFails) {
                    throw new AppError("Repair Service is unavailable", 503);
                }
                // Idempotent: same key returns the same work order.
                if (!state.workOrders.has(ctx.idempotencyKey)) {
                    state.workOrders.set(
                        ctx.idempotencyKey,
                        `cccccccc-0000-4000-8000-${String(state.workOrders.size + 1).padStart(12, "0")}`
                    );
                }
                return { workOrderId: state.workOrders.get(ctx.idempotencyKey) };
            }
        }
    };
}

module.exports = {
    ISSUER,
    AUDIENCE,
    publicKey,
    signToken,
    FIXED_NOW,
    TEST_CONFIG,
    SERVICE_ID,
    DIAGNOSIS_SERVICE_ID,
    createFakeBookingRepository,
    createFakeClients
};
