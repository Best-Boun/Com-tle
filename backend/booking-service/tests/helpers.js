const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const AppError = require("../../shared/errors/AppError");
const { OPEN_STATUSES, SLOT_OCCUPYING_STATUSES } = require("../src/constants");

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
    depositHoldMinutes: 10,
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

    // Like the repository: active bookings, plus holds whose time to pay has not run out.
    const active = (b, now = new Date(0)) => SLOT_OCCUPYING_STATUSES.includes(b.status)
        || (b.status === "AWAITING_DEPOSIT" && b.deposit_due_at > now);

    return {
        bookings,
        history,
        transaction: inTransaction,
        withSlotLock: (key, work) => inTransaction(work),
        async countActiveAt(trx, scheduledAt, now = new Date(0), exceptBookingId = null) {
            return [...bookings.values()].filter((b) => b.booking_id !== exceptBookingId
                && active(b, now) && b.scheduled_at.getTime() === scheduledAt.getTime()).length;
        },
        async listActiveTimes(from, to, now = new Date(0)) {
            return [...bookings.values()]
                .filter((b) => active(b, now) && b.scheduled_at >= from && b.scheduled_at < to)
                .map((b) => b.scheduled_at);
        },
        async listExpiredHolds(now, { customerId, bookingId } = {}) {
            return [...bookings.values()]
                .filter((b) => b.status === "AWAITING_DEPOSIT" && b.deposit_due_at <= now)
                .filter((b) => (!customerId || b.customer_id === customerId) && (!bookingId || b.booking_id === bookingId))
                .map((b) => ({ ...b }));
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
                deposit_due_at: booking.deposit_due_at ? new Date(booking.deposit_due_at) : null,
                work_order_id: null,
                technician_id: null,
                technician_claimed_at: null,
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
        },
        async listOpenBetween(from, to) {
            return [...bookings.values()]
                .filter((b) => OPEN_STATUSES.includes(b.status) && b.scheduled_at >= from && b.scheduled_at < to)
                .sort((a, b) => a.scheduled_at - b.scheduled_at)
                .map((b) => ({ ...b }));
        },
        async claim(id, technicianId, claimedAt) {
            const current = bookings.get(id);
            if (!current || current.technician_id || !OPEN_STATUSES.includes(current.status)) return false;
            bookings.set(id, { ...current, technician_id: technicianId, technician_claimed_at: claimedAt });
            return true;
        },
        async release(id, technicianId = null) {
            const current = bookings.get(id);
            if (!current || !OPEN_STATUSES.includes(current.status)) return false;
            if (technicianId && current.technician_id !== technicianId) return false;
            bookings.set(id, { ...current, technician_id: null, technician_claimed_at: null });
            return true;
        },
        async countNoShows(customerIds) {
            const counts = new Map();
            for (const b of bookings.values()) {
                if (b.status === "NO_SHOW" && customerIds.includes(b.customer_id)) {
                    counts.set(b.customer_id, (counts.get(b.customer_id) || 0) + 1);
                }
            }
            return counts;
        }
    };
}

function createFakeClients() {
    const calls = { catalog: [], repair: [] };
    const state = { repairFails: false, workOrders: new Map(), deposits: new Map() };

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
        // Payment-Service: deposits recorded per booking id.
        paymentClient: {
            async getDeposit(bookingId, ctx) {
                calls.payment = calls.payment || [];
                calls.payment.push({ bookingId, ctx });
                return state.deposits.get(bookingId) || null;
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
