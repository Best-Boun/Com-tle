const { z } = require("zod");
const { BOOKING_STATUS, DEVICE_TYPES, SYMPTOM_GROUPS } = require("../constants");
const { isValidDate } = require("../utils/time");

const dateString = z.string().trim().refine(isValidDate, "must be a valid YYYY-MM-DD date");
const optionalText = (max) => z.union([z.string().trim().max(max), z.null()]).optional();

/** Thai phone numbers: keep digits only (e.g. "081-234-5678" -> "0812345678"). */
function phoneDigits(value) {
    return String(value).replace(/[\s\-().]/g, "").replace(/^\+66/, "0");
}

const phoneSchema = z.string().trim().transform(phoneDigits).pipe(
    z.string().regex(/^0\d{8,9}$/, "must be a Thai phone number, e.g. 0812345678")
);

/**
 * A repair request: the device and what the customer sees, no time slot.
 * service_id is optional, for a known job such as cleaning or an OS install;
 * otherwise the request is for a diagnosis.
 */
const createRequestSchema = z.object({
    device_type: z.enum(DEVICE_TYPES),
    brand: optionalText(100),
    model: optionalText(150),
    serial_number: optionalText(150),
    symptom_group: z.enum(SYMPTOM_GROUPS),
    reported_symptom: z.string().trim().min(1).max(5000),
    contact_name: z.string().trim().min(1).max(150),
    contact_phone: phoneSchema,
    service_id: z.union([z.string().uuid(), z.null()]).optional()
}).strict();

const reasonSchema = z.object({
    reason: optionalText(500)
}).strict();

const requiredReasonSchema = z.object({
    reason: z.string().trim().min(1).max(500)
}).strict();

/**
 * search: a request number (RQ-... / BK-...) or part of a phone number,
 * which is what the counter has when the customer walks in.
 */
const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(Object.values(BOOKING_STATUS)).optional(),
    date: dateString.optional(),
    customer_id: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(40).optional()
});

const checkInSchema = z.object({
    accessories: optionalText(1000),
    intake_terms_acknowledged: z.boolean().optional()
}).strict();

const uuidSchema = z.string().uuid();

module.exports = {
    phoneDigits,
    createRequestSchema,
    reasonSchema,
    requiredReasonSchema,
    listQuerySchema,
    checkInSchema,
    uuidSchema
};
