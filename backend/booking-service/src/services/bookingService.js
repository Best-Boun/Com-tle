const { randomUUID, randomInt } = require("node:crypto");
const AppError = require("../../../shared/errors/AppError");
const { PERMISSIONS } = require("../../../shared/constants");
const { hasPermission } = require("../../../shared/middleware/serviceAuth");
const { getPagination, getPaginationMeta } = require("../../../shared/utils/pagination");
const { parseOrThrow } = require("../../../shared/utils/validation");
const {
    BOOKING_STATUS,
    OPEN_STATUSES,
    ALLOWED_TRANSITIONS,
    DEVICE_TYPES,
    SYMPTOM_GROUPS,
    DEVICE_TYPE_FOR_REPAIR,
    SYMPTOM_GROUP_LABELS
} = require("../constants");

/** Symptom text for the work order: "[group] details", within Repair's 5000 characters. */
function symptomForRepair(booking) {
    const group = SYMPTOM_GROUP_LABELS[booking.symptom_group];
    const text = group ? `[${group}] ${booking.reported_symptom}` : booking.reported_symptom;
    return text.slice(0, 5000);
}
const { nowInTimezone, utcToZoned, dayRangeUtc } = require("../utils/time");
const {
    createRequestSchema,
    reasonSchema,
    requiredReasonSchema,
    listQuerySchema,
    checkInSchema,
    uuidSchema
} = require("../validators/bookingSchemas");

const NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. RQ-20261119-FAK643 (date = the day the request was made, shop-local). */
function defaultRequestNumber(date) {
    let suffix = "";
    for (let i = 0; i < 6; i += 1) {
        suffix += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
    }
    return `RQ-${date.replaceAll("-", "")}-${suffix}`;
}

function isDuplicateError(error) {
    return error?.code === "ER_DUP_ENTRY" || error?.errno === 1062;
}

/**
 * Repair requests ("แจ้งซ่อมล่วงหน้า"). The customer says which device and what
 * kind of fault; there is no time slot. When they bring the device in, the
 * counter finds the request by number or phone and checks it in, which
 * creates the Work Order in Repair Service.
 */
function createBookingService({
    bookingRepository,
    catalogClient,
    repairClient,
    config,
    createId = randomUUID,
    createRequestNumber = defaultRequestNumber,
    now = () => new Date()
}) {
    if (!bookingRepository || !catalogClient || !repairClient || !config) {
        throw new Error("Booking repository, service clients and config are required");
    }

    const repo = bookingRepository;
    const tz = config.timezone;
    const canManage = (user) => hasPermission(user, PERMISSIONS.BOOKING_MANAGE);
    const isOwner = (user, booking) => booking.customer_id === user.userId;

    /** API shape. Old appointment bookings also get their shop-local date and time. */
    function present(booking) {
        if (!booking) return null;
        const shown = { ...booking, timezone: tz };
        if (booking.scheduled_at) {
            const scheduledAt = new Date(booking.scheduled_at);
            const local = utcToZoned(scheduledAt, tz);
            Object.assign(shown, {
                scheduled_at: scheduledAt.toISOString(),
                appointment_date: local.date,
                appointment_time: local.time
            });
        }
        return shown;
    }

    async function loadBooking(bookingId) {
        if (!uuidSchema.safeParse(bookingId).success) {
            throw new AppError("Repair request not found", 404);
        }
        const booking = await repo.findById(bookingId);
        if (!booking) {
            throw new AppError("Repair request not found", 404);
        }
        return booking;
    }

    /** Owners and the shop may see a request; others get 404 (no existence leak). */
    async function loadVisibleBooking(bookingId, user) {
        const booking = await loadBooking(bookingId);
        const ownerCanView = isOwner(user, booking) && hasPermission(user, PERMISSIONS.BOOKING_VIEW_OWN);
        if (!ownerCanView && !canManage(user)) {
            throw new AppError("Repair request not found", 404);
        }
        return booking;
    }

    function assertTransition(booking, toStatus) {
        if (!(ALLOWED_TRANSITIONS[booking.status] || []).includes(toStatus)) {
            throw new AppError(`Repair request cannot change from ${booking.status} to ${toStatus}`, 409);
        }
    }

    async function changeStatus(booking, toStatus, user, { reason = null, changes = {} } = {}) {
        assertTransition(booking, toStatus);

        await repo.transaction(async (trx) => {
            const updated = await repo.updateStatus(trx, booking.booking_id, booking.status, {
                status: toStatus,
                ...changes
            });
            if (!updated) {
                throw new AppError("Repair request was changed by someone else, please reload", 409);
            }
            await repo.insertHistory(trx, {
                history_id: createId(),
                booking_id: booking.booking_id,
                old_status: booking.status,
                new_status: toStatus,
                changed_by: user.userId,
                reason
            });
        });

        return present(await repo.findById(booking.booking_id));
    }

    async function listWith(filters, query) {
        const { page, limit, offset } = getPagination(query.page, query.limit);
        const range = query.date ? dayRangeUtc(query.date, tz) : {};
        const { items, total } = await repo.list(
            { ...filters, status: query.status, from: range.start, to: range.end, search: query.search },
            { limit, offset }
        );
        return { items: items.map(present), meta: getPaginationMeta(total, page, limit) };
    }

    return {
        /**
         * Task 2: requests nobody brought in within `requestExpiryDays` are closed
         * (EXPIRED), so the counter list only shows devices that may still come.
         * Run by a timer in server.js; returns how many were closed.
         */
        async expireStaleRequests() {
            const at = now();
            const cutoff = new Date(at.getTime() - config.requestExpiryDays * 24 * 60 * 60 * 1000);
            return repo.expireOpenBefore(cutoff, {
                reason: `No device brought in within ${config.requestExpiryDays} days`,
                createId,
                at
            });
        },

        /** The choices the request form offers. */
        getOptions() {
            return { device_types: [...DEVICE_TYPES], symptom_groups: [...SYMPTOM_GROUPS] };
        },

        async createBooking(input, user, { authorization }) {
            const data = parseOrThrow(createRequestSchema, input, "Invalid repair request");

            const open = await repo.countOpenByCustomer(user.userId);
            if (open >= config.maxOpenRequestsPerCustomer) {
                throw new AppError(
                    `You already have ${open} open repair requests. Please bring those devices in or cancel one first.`,
                    409
                );
            }

            // Booking -> Catalog: a known service the customer picked, otherwise
            // the diagnosis service. Its name/code/price are snapshotted.
            const service = await catalogClient.getActiveService(
                data.service_id || config.diagnosisServiceId,
                { authorization }
            );

            const bookingId = createId();
            const today = nowInTimezone(tz, now()).date;

            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    await repo.transaction(async (trx) => {
                        await repo.insertBooking(trx, {
                            booking_id: bookingId,
                            booking_number: createRequestNumber(today),
                            customer_id: user.userId,
                            contact_name: data.contact_name,
                            contact_phone: data.contact_phone,
                            service_id: service.service_id,
                            service_code: service.service_code,
                            service_name: service.service_name,
                            service_starting_price: service.starting_price,
                            service_currency: service.currency || "THB",
                            device_type: data.device_type,
                            brand: data.brand || null,
                            model: data.model || null,
                            serial_number: data.serial_number || null,
                            symptom_group: data.symptom_group,
                            reported_symptom: data.reported_symptom,
                            scheduled_at: null,
                            status: BOOKING_STATUS.PENDING
                        });
                        await repo.insertHistory(trx, {
                            history_id: createId(),
                            booking_id: bookingId,
                            old_status: null,
                            new_status: BOOKING_STATUS.PENDING,
                            changed_by: user.userId,
                            reason: null
                        });
                    });
                    return present(await repo.findById(bookingId));
                } catch (error) {
                    // A request-number collision: nothing was committed, try another number.
                    if (isDuplicateError(error) && attempt < 2) {
                        continue;
                    }
                    throw error;
                }
            }
            throw new AppError("Could not create the repair request, please try again", 503);
        },

        async listMyBookings(query, user) {
            const filters = parseOrThrow(listQuerySchema, query, "Invalid query");
            return listWith({ customerId: user.userId }, { ...filters, search: undefined });
        },

        /** The shop: all requests, or search by request number / phone at the counter. */
        async listBookings(query) {
            const filters = parseOrThrow(listQuerySchema, query, "Invalid query");
            return listWith({ customerId: filters.customer_id }, filters);
        },

        async getBooking(bookingId, user) {
            const booking = await loadVisibleBooking(bookingId, user);
            const history = await repo.findHistory(booking.booking_id);
            return { ...present(booking), status_history: history };
        },

        /**
         * Customers may cancel their own open request at any time.
         * The shop (booking.manage) may cancel any open request, with a reason.
         */
        async cancelBooking(bookingId, input, user) {
            const booking = await loadVisibleBooking(bookingId, user);
            const managing = canManage(user);

            if (!managing && (!isOwner(user, booking) || !hasPermission(user, PERMISSIONS.BOOKING_CREATE))) {
                throw new AppError("Repair request not found", 404);
            }

            const { reason } = parseOrThrow(
                managing ? requiredReasonSchema : reasonSchema,
                input || {},
                "Invalid cancellation"
            );

            return changeStatus(booking, BOOKING_STATUS.CANCELLED, user, {
                reason: reason || null,
                changes: {
                    cancelled_at: now(),
                    cancelled_by: user.userId,
                    cancellation_reason: reason || null
                }
            });
        },

        /**
         * The customer brought the device in: Booking -> Repair creates the Work
         * Order, then the request becomes COMPLETED. If Repair fails, the request
         * stays open and the call can be retried safely (same Idempotency-Key).
         *
         * Repair's contract still uses the booking_* names and scheduled_at;
         * a request has no appointment, so scheduled_at is when it was made.
         */
        async checkIn(bookingId, user, { authorization }, input = {}) {
            const { accessories, intake_terms_acknowledged } = parseOrThrow(
                checkInSchema,
                input || {},
                "Invalid check-in details"
            );
            const booking = await loadBooking(bookingId);
            if (!OPEN_STATUSES.includes(booking.status)) {
                throw new AppError("This repair request is no longer open", 409);
            }
            assertTransition(booking, BOOKING_STATUS.COMPLETED);

            const { workOrderId } = await repairClient.createWorkOrderFromBooking(
                {
                    source: "BOOKING",
                    booking_id: booking.booking_id,
                    booking_number: booking.booking_number,
                    customer_id: booking.customer_id,
                    service_id: booking.service_id,
                    service_code: booking.service_code,
                    service_name: booking.service_name,
                    device_type: DEVICE_TYPE_FOR_REPAIR[booking.device_type] || booking.device_type,
                    brand: booking.brand,
                    model: booking.model,
                    serial_number: booking.serial_number,
                    accessories: accessories || null,
                    reported_symptom: symptomForRepair(booking),
                    scheduled_at: new Date(booking.scheduled_at || booking.created_at).toISOString(),
                    intake_terms_acknowledged: intake_terms_acknowledged === true,
                    // Old appointment bookings a technician took before this change.
                    ...(booking.technician_id ? { technician_user_id: booking.technician_id } : {})
                },
                { authorization, idempotencyKey: `booking-${booking.booking_id}` }
            );

            return changeStatus(booking, BOOKING_STATUS.COMPLETED, user, {
                changes: { work_order_id: workOrderId }
            });
        }
    };
}

module.exports = {
    createBookingService
};
