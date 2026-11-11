const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const AppError = require("../../shared/errors/AppError");
const { SLOT_OCCUPYING_STATUSES } = require("../src/constants");

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

const TEST_CONFIG = {
    timezone: "Asia/Bangkok",
    slotTimes: ["09:00", "10:00", "11:00", "13:00"],
    slotCapacity: 2,
    maxDaysAhead: 30,
    catalogServiceUrl: "http://catalog.test",
    repairServiceUrl: "http://repair.test",
    serviceCallTimeoutMs: 1000
};

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";

/** In-memory stand-in for bookingRepository (same method names). */
function createFakeBookingRepository() {
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

    const active = (b) => SLOT_OCCUPYING_STATUSES.includes(b.status);

    return {
        bookings,
        history,
        transaction: inTransaction,
        withSlotLock: (key, work) => inTransaction(work),
        async countActiveAt(trx, scheduledAt) {
            return [...bookings.values()].filter((b) => active(b) && b.scheduled_at.getTime() === scheduledAt.getTime()).length;
        },
        async listActiveTimes(from, to) {
            return [...bookings.values()]
                .filter((b) => active(b) && b.scheduled_at >= from && b.scheduled_at < to)
                .map((b) => b.scheduled_at);
        },
        async insertBooking(trx, booking) {
            if ([...bookings.values()].some((b) => b.booking_number === booking.booking_number)) {
                const error = new Error("Duplicate entry");
                error.code = "ER_DUP_ENTRY";
                throw error;
            }
            bookings.set(booking.booking_id, {
                ...booking,
                scheduled_at: new Date(booking.scheduled_at),
                work_order_id: null,
                cancelled_at: null,
                cancelled_by: null,
                cancellation_reason: null
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
        async list({ customerId, status, from, to }, { limit, offset }) {
            let items = [...bookings.values()];
            if (customerId) items = items.filter((b) => b.customer_id === customerId);
            if (status) items = items.filter((b) => b.status === status);
            if (from) items = items.filter((b) => b.scheduled_at >= from);
            if (to) items = items.filter((b) => b.scheduled_at < to);
            return { items: items.slice(offset, offset + limit).map((b) => ({ ...b })), total: items.length };
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
                if (serviceId !== SERVICE_ID) {
                    throw new AppError("Selected service is not available", 400);
                }
                return {
                    service_id: SERVICE_ID,
                    service_code: "PC-CLEAN",
                    service_name: "PC Cleaning",
                    starting_price: 500,
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
    createFakeBookingRepository,
    createFakeClients
};
