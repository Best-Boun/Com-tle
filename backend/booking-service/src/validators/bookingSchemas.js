const { z } = require("zod");
const { BOOKING_STATUS } = require("../constants");
const { isValidDate } = require("../utils/time");

const dateString = z.string().trim().refine(isValidDate, "must be a valid YYYY-MM-DD date");
const timeString = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const optionalText = (max) => z.union([z.string().trim().max(max), z.null()]).optional();

/** appointment_date + appointment_time are in the shop's time zone (BOOKING_TIMEZONE). */
const createBookingSchema = z.object({
    service_id: z.string().uuid(),
    appointment_date: dateString,
    appointment_time: timeString,
    device_type: z.string().trim().min(1).max(100),
    brand: optionalText(100),
    model: optionalText(150),
    serial_number: optionalText(150),
    reported_symptom: z.string().trim().min(1).max(5000)
}).strict();

const reasonSchema = z.object({
    reason: optionalText(500)
}).strict();

const requiredReasonSchema = z.object({
    reason: z.string().trim().min(1).max(500)
}).strict();

const availabilityQuerySchema = z.object({
    date: dateString
});

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(Object.values(BOOKING_STATUS)).optional(),
    date: dateString.optional(),
    customer_id: z.string().uuid().optional()
});

const uuidSchema = z.string().uuid();

module.exports = {
    createBookingSchema,
    reasonSchema,
    requiredReasonSchema,
    availabilityQuerySchema,
    listQuerySchema,
    uuidSchema
};
