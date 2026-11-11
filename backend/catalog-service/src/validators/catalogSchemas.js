const { z } = require("zod");

const code = (max) => z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]*$/, "letters, digits, - and _ only").min(2).max(max);
const optionalText = (max) => z.union([z.string().trim().max(max), z.null()]).optional();

// starting_price is a whole number of baht (team schema: BIGINT UNSIGNED).
const bahtPrice = z.coerce.number().int("must be a whole number of baht").min(0).max(Number.MAX_SAFE_INTEGER);

const createCategorySchema = z.object({
    category_code: code(50),
    category_name: z.string().trim().min(1).max(150),
    description: optionalText(500)
}).strict();

const updateCategorySchema = z.object({
    category_name: z.string().trim().min(1).max(150),
    description: optionalText(500)
})
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, "at least one field is required");

const createServiceSchema = z.object({
    category_id: z.string().uuid(),
    service_code: code(50),
    service_name: z.string().trim().min(1).max(150),
    description: z.union([z.string().trim().max(5000), z.null()]).optional(),
    starting_price: bahtPrice,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    estimated_duration_minutes: z.coerce.number().int().min(1).max(10080)
}).strict();

const updateServiceSchema = z.object({
    category_id: z.string().uuid(),
    service_name: z.string().trim().min(1).max(150),
    description: z.union([z.string().trim().max(5000), z.null()]),
    starting_price: bahtPrice,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    estimated_duration_minutes: z.coerce.number().int().min(1).max(10080)
})
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, "at least one field is required");

const statusSchema = z.object({
    is_active: z.boolean()
}).strict();

const listServicesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    category_id: z.string().uuid().optional(),
    category_code: z.string().trim().toUpperCase().max(50).optional(),
    search: z.string().trim().max(100).optional(),
    include_inactive: z.enum(["true", "false"]).optional()
});

const listCategoriesQuerySchema = z.object({
    include_inactive: z.enum(["true", "false"]).optional()
});

const auditQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    resource_type: z.enum(["SERVICE", "CATEGORY"]).optional(),
    resource_id: z.string().trim().max(100).optional()
});

const uuidSchema = z.string().uuid();

module.exports = {
    createCategorySchema,
    updateCategorySchema,
    createServiceSchema,
    updateServiceSchema,
    statusSchema,
    listServicesQuerySchema,
    listCategoriesQuerySchema,
    auditQuerySchema,
    uuidSchema
};
