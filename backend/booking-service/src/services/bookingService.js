const { randomUUID, randomInt } = require("node:crypto");
const AppError = require("../../../shared/errors/AppError");
const { PERMISSIONS } = require("../../../shared/constants");
const { hasPermission } = require("../../../shared/middleware/serviceAuth");
const { getPagination, getPaginationMeta } = require("../../../shared/utils/pagination");
const { parseOrThrow } = require("../../../shared/utils/validation");
const { BOOKING_STATUS, ALLOWED_TRANSITIONS } = require("../constants");
const {
    nowInTimezone,
    zonedToUtc,
    utcToZoned,
    addDays,
    dayRangeUtc
} = require("../utils/time");
const {
    createBookingSchema,
    reasonSchema,
    requiredReasonSchema,
    availabilityQuerySchema,
    listQuerySchema,
    uuidSchema
} = require("../validators/bookingSchemas");

const NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. BK-20261120-FAK643 (date = appointment date, shop-local). */
function defaultBookingNumber(date) {
    let suffix = "";
    for (let i = 0; i < 6; i += 1) {
        suffix += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
    }
    return `BK-${date.replaceAll("-", "")}-${suffix}`;
}

function isDuplicateError(error) {
    return error?.code === "ER_DUP_ENTRY" || error?.errno === 1062;
}

function isDeadlockOrLockTimeout(error) {
    return ["ER_LOCK_DEADLOCK", "SLOT_LOCK_TIMEOUT"].includes(error?.code) || error?.errno === 1213;
}

function createBookingService({
    bookingRepository,
    catalogClient,
    repairClient,
    config,
    createId = randomUUID,
    createBookingNumber = defaultBookingNumber,
    now = () => new Date()
}) {
    if (!bookingRepository || !catalogClient || !repairClient || !config) {
        throw new Error("Booking repository, service clients and config are required");
    }

    const repo = bookingRepository;
    const tz = config.timezone;
    const canManage = (user) => hasPermission(user, PERMISSIONS.BOOKING_MANAGE);
    const isOwner = (user, booking) => booking.customer_id === user.userId;

    /** API shape: DB row + shop-local appointment_date/appointment_time. */
    function present(booking) {
        if (!booking) return null;
        const scheduledAt = new Date(booking.scheduled_at);
        const local = utcToZoned(scheduledAt, tz);
        return {
            ...booking,
            scheduled_at: scheduledAt.toISOString(),
            appointment_date: local.date,
            appointment_time: local.time,
            timezone: tz
        };
    }

    async function loadBooking(bookingId) {
        if (!uuidSchema.safeParse(bookingId).success) {
            throw new AppError("Booking not found", 404);
        }
        const booking = await repo.findById(bookingId);
        if (!booking) {
            throw new AppError("Booking not found", 404);
        }
        return booking;
    }

    /** Owners and booking managers may see a booking; others get 404 (no existence leak). */
    async function loadVisibleBooking(bookingId, user) {
        const booking = await loadBooking(bookingId);
        const ownerCanView = isOwner(user, booking) && hasPermission(user, PERMISSIONS.BOOKING_VIEW_OWN);
        if (!ownerCanView && !canManage(user)) {
            throw new AppError("Booking not found", 404);
        }
        return booking;
    }

    function assertTransition(booking, toStatus) {
        if (!ALLOWED_TRANSITIONS[booking.status].includes(toStatus)) {
            throw new AppError(`Booking cannot change from ${booking.status} to ${toStatus}`, 409);
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
                throw new AppError("Booking was changed by someone else, please reload", 409);
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

    function hasStarted(scheduledAt) {
        return new Date(scheduledAt).getTime() <= now().getTime();
    }

    function assertBookableSlot(date, time) {
        if (!config.slotTimes.includes(time)) {
            throw new AppError("Selected time is not an available booking slot", 400);
        }
        const today = nowInTimezone(tz, now()).date;
        if (date > addDays(today, config.maxDaysAhead)) {
            throw new AppError(`Bookings can be made at most ${config.maxDaysAhead} days ahead`, 400);
        }
        const scheduledAt = zonedToUtc(date, time, tz);
        if (hasStarted(scheduledAt)) {
            throw new AppError("Selected time has already passed", 400);
        }
        return scheduledAt;
    }

    async function listWith(filters, query) {
        const { page, limit, offset } = getPagination(query.page, query.limit);
        const range = query.date ? dayRangeUtc(query.date, tz) : {};
        const { items, total } = await repo.list(
            { ...filters, status: query.status, from: range.start, to: range.end },
            { limit, offset }
        );
        return { items: items.map(present), meta: getPaginationMeta(total, page, limit) };
    }

    return {
        async getAvailability(query) {
            const { date } = parseOrThrow(availabilityQuerySchema, query, "Invalid query");
            const { start, end } = dayRangeUtc(date, tz);
            const taken = await repo.listActiveTimes(start, end);
            const counts = {};
            for (const instant of taken) {
                const { time } = utcToZoned(instant, tz);
                counts[time] = (counts[time] || 0) + 1;
            }

            const slots = config.slotTimes.map((time) => {
                const booked = counts[time] || 0;
                const open = !hasStarted(zonedToUtc(date, time, tz));
                const remaining = open ? Math.max(0, config.slotCapacity - booked) : 0;
                return { time, capacity: config.slotCapacity, booked, remaining, available: remaining > 0 };
            });

            return { date, timezone: tz, slots };
        },

        async createBooking(input, user, { authorization }) {
            const data = parseOrThrow(createBookingSchema, input, "Invalid booking details");
            const scheduledAt = assertBookableSlot(data.appointment_date, data.appointment_time);

            // Booking -> Catalog: the service must exist and be bookable;
            // its name/code/price are snapshotted into the booking.
            const service = await catalogClient.getActiveService(data.service_id, { authorization });

            const bookingId = createId();
            const slotKey = scheduledAt.toISOString();

            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    await repo.withSlotLock(slotKey, async (trx) => {
                        const taken = await repo.countActiveAt(trx, scheduledAt);
                        if (taken >= config.slotCapacity) {
                            throw new AppError("Selected time slot is fully booked", 409);
                        }
                        await repo.insertBooking(trx, {
                            booking_id: bookingId,
                            booking_number: createBookingNumber(data.appointment_date),
                            customer_id: user.userId,
                            service_id: data.service_id,
                            service_code: service.service_code,
                            service_name: service.service_name,
                            service_starting_price: service.starting_price,
                            service_currency: service.currency || "THB",
                            device_type: data.device_type,
                            brand: data.brand || null,
                            model: data.model || null,
                            serial_number: data.serial_number || null,
                            reported_symptom: data.reported_symptom,
                            scheduled_at: scheduledAt,
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
                    // Retry on lock contention or a booking-number collision (nothing was committed).
                    if ((isDeadlockOrLockTimeout(error) || isDuplicateError(error)) && attempt < 2) {
                        continue;
                    }
                    if (isDeadlockOrLockTimeout(error)) {
                        throw new AppError("Booking system is busy, please try again", 503);
                    }
                    throw error;
                }
            }
            throw new AppError("Could not create booking, please try again", 503);
        },

        async listMyBookings(query, user) {
            const filters = parseOrThrow(listQuerySchema, query, "Invalid query");
            return listWith({ customerId: user.userId }, filters);
        },

        async listBookings(query) {
            const filters = parseOrThrow(listQuerySchema, query, "Invalid query");
            return listWith({ customerId: filters.customer_id }, filters);
        },

        async getBooking(bookingId, user) {
            const booking = await loadVisibleBooking(bookingId, user);
            const history = await repo.findHistory(booking.booking_id);
            return { ...present(booking), status_history: history };
        },

        async confirmBooking(bookingId, user) {
            const booking = await loadBooking(bookingId);
            return changeStatus(booking, BOOKING_STATUS.CONFIRMED, user);
        },

        /**
         * Customers may cancel their own booking before the appointment.
         * The shop (booking.manage) may cancel any time with a reason —
         * this is also how a no-show is recorded.
         */
        async cancelBooking(bookingId, input, user) {
            const booking = await loadVisibleBooking(bookingId, user);
            const managing = canManage(user);

            if (!managing) {
                if (!isOwner(user, booking) || !hasPermission(user, PERMISSIONS.BOOKING_CREATE)) {
                    throw new AppError("Booking not found", 404);
                }
                if (hasStarted(booking.scheduled_at)) {
                    throw new AppError("Appointment time has passed, please contact the shop", 409);
                }
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
         * Customer arrived with the device: Booking -> Repair creates the Work Order,
         * then the booking becomes COMPLETED. If Repair fails, the booking stays
         * CONFIRMED and the call can be retried safely (same Idempotency-Key).
         */
        async checkIn(bookingId, user, { authorization }) {
            const booking = await loadBooking(bookingId);
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
                    device_type: booking.device_type,
                    brand: booking.brand,
                    model: booking.model,
                    serial_number: booking.serial_number,
                    reported_symptom: booking.reported_symptom,
                    scheduled_at: new Date(booking.scheduled_at).toISOString()
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
