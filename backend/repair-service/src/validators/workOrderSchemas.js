const { z } = require("zod");

const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const optionalUuid = z.preprocess(
    (value) => value === "" ? null : value,
    z.string().uuid().nullable().optional()
);
const optionalNumber = (schema) => z.preprocess(
    (value) => value === "" || value === null ? undefined : value,
    z.coerce.number().pipe(schema).optional()
);
const requiredNumber = (schema) => z.preprocess(
    (value) => value === "" || value === null ? undefined : value,
    z.coerce.number().pipe(schema)
);

const createBookingWorkOrderSchema = z.object({
    source: z.literal("BOOKING"),
    booking_id: z.string().uuid(),
    booking_number: z.string().trim().min(1).max(30),
    customer_id: z.string().uuid(),
    service_id: z.string().uuid(),
    service_code: z.string().trim().min(1).max(50),
    service_name: z.string().trim().min(1).max(150),
    device_type: z.string().trim().min(1).max(100),
    brand: nullableText(100),
    model: nullableText(150),
    serial_number: nullableText(150),
    accessories: nullableText(1000),
    reported_symptom: z.string().trim().min(1).max(5000),
    scheduled_at: z.string().datetime({ offset: true })
}).strict();

const listWorkOrdersSchema = z.object({
    status: z.enum([
        "OPEN",
        "READY",
        "PENDING",
        "DIAGNOSING",
        "WAITING_APPROVAL",
        "APPROVED",
        "REPAIRING",
        "TESTING",
        "COMPLETED",
        "CANCELLED"
    ]).optional(),
    search: z.string().trim().max(100).optional()
}).strict();

const assignTechnicianSchema = z.object({
    technician_user_id: z.string().uuid()
}).strict();

const createWalkInSchema = z.object({
    customer_name: z.string().trim().min(1).max(150),
    customer_phone: z.string().trim().min(1).max(40),
    service_id: optionalUuid,
    service_code: z.string().trim().min(1).max(50).nullable().optional(),
    service_name: z.string().trim().min(1).max(150).nullable().optional(),
    device_type: z.string().trim().min(1).max(100),
    brand: nullableText(100),
    model: nullableText(150),
    serial_number: nullableText(150),
    reported_symptom: z.string().trim().min(1).max(5000),
    accessories: nullableText(1000)
}).strict();

const diagnosisSchema = z.string().trim().min(1).max(5000);
const quotationItemSchema = z.object({
    item_id: z.string().uuid().optional(),
    type: z.enum(["PART", "LABOR"]),
    description: z.string().trim().min(1).max(1000),
    part_id: z.string().uuid().nullable().optional(),
    qty: z.coerce.number().int().min(1).max(10000),
    unit_price: optionalNumber(z.number().int().min(0).max(1000000000))
}).strict();
function validatePartReferences(items, context) {
    items.forEach((item, index) => {
        if (item.type === "PART" && !item.part_id) {
            context.addIssue({
                code: "custom",
                path: [index, "part_id"],
                message: "A part must be selected"
            });
        }
    });
}
const proposeItemsSchema = z.object({
    items: z.array(quotationItemSchema).min(1).max(100),
    note: nullableText(1000)
}).strict().superRefine((data, context) => {
    validatePartReferences(data.items, context);
});
const priceAndSendSchema = z.object({
    items: z.array(quotationItemSchema.extend({
        unit_price: z.coerce.number().int().min(0).max(1000000000)
    })).min(1).max(100),
    note: nullableText(1000)
}).strict().superRefine((data, context) => {
    validatePartReferences(data.items, context);
});
const decisionSchema = z.object({
    approve: z.boolean(),
    note: nullableText(1000)
}).strict();
const testResultSchema = z.object({
    passed: z.boolean(),
    notes: z.string().trim().min(1).max(5000)
}).strict();
const handoverSchema = z.object({
    exceptionReason: nullableText(1000)
}).strict();
const cancelSchema = z.object({
    reason: z.string().trim().min(1).max(1000),
    returnParts: z.boolean().optional()
}).strict();
const createPartSchema = z.object({
    sku: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(150),
    description: nullableText(2000),
    unit_price: requiredNumber(z.number().int().min(0).max(1000000000)),
    reorder_level: optionalNumber(z.number().min(0).max(1000000))
}).strict();
const receivePartSchema = z.object({
    qty: z.coerce.number().int().min(1).max(1000000),
    note: nullableText(1000)
}).strict();
const issuePartSchema = z.object({
    partId: z.string().uuid(),
    qty: z.coerce.number().int().min(1).max(1000000)
}).strict();
const partMovementQuerySchema = z.object({
    partId: z.string().uuid().optional()
}).strict();

module.exports = {
    createBookingWorkOrderSchema,
    listWorkOrdersSchema,
    assignTechnicianSchema,
    createWalkInSchema,
    diagnosisSchema,
    proposeItemsSchema,
    priceAndSendSchema,
    decisionSchema,
    testResultSchema,
    handoverSchema,
    cancelSchema,
    createPartSchema,
    receivePartSchema,
    issuePartSchema,
    partMovementQuerySchema
};