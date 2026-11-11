const { randomUUID } = require("node:crypto");
const AppError = require("../../../shared/errors/AppError");
const { PERMISSIONS } = require("../../../shared/constants");
const { hasPermission } = require("../../../shared/middleware/serviceAuth");
const { getPagination, getPaginationMeta } = require("../../../shared/utils/pagination");
const { parseOrThrow } = require("../../../shared/utils/validation");
const {
    createCategorySchema,
    updateCategorySchema,
    createServiceSchema,
    updateServiceSchema,
    statusSchema,
    listServicesQuerySchema,
    listCategoriesQuerySchema,
    auditQuerySchema,
    uuidSchema
} = require("../validators/catalogSchemas");

const RESOURCE = Object.freeze({ SERVICE: "SERVICE", CATEGORY: "CATEGORY" });

function isDuplicateError(error) {
    return error?.code === "ER_DUP_ENTRY" || error?.errno === 1062;
}

// Only real table columns go into the audit log (not joined fields).
function serviceSnapshot(service) {
    if (!service) return null;
    const {
        service_id, category_id, service_code, service_name, description,
        starting_price, currency, estimated_duration_minutes, is_active
    } = service;
    return {
        service_id, category_id, service_code, service_name, description,
        starting_price, currency, estimated_duration_minutes, is_active
    };
}

function categorySnapshot(category) {
    if (!category) return null;
    const { category_id, category_code, category_name, description, is_active } = category;
    return { category_id, category_code, category_name, description, is_active };
}

function createCatalogService({ serviceRepository, createId = randomUUID }) {
    if (!serviceRepository) {
        throw new Error("Service repository is required");
    }

    const repo = serviceRepository;
    const canManage = (user) => hasPermission(user, PERMISSIONS.CATALOG_MANAGE);

    function assertUuid(id, label) {
        if (!uuidSchema.safeParse(id).success) {
            throw new AppError(`${label} not found`, 404);
        }
    }

    async function getExistingService(serviceId, trx) {
        assertUuid(serviceId, "Service");
        const service = await repo.findServiceById(serviceId, trx);
        if (!service) throw new AppError("Service not found", 404);
        return service;
    }

    async function getExistingCategory(categoryId, trx) {
        assertUuid(categoryId, "Category");
        const category = await repo.findCategoryById(categoryId, trx);
        if (!category) throw new AppError("Category not found", 404);
        return category;
    }

    async function requireActiveCategory(categoryId, trx) {
        const category = await repo.findCategoryById(categoryId, trx);
        if (!category || !category.is_active) {
            throw new AppError("Category does not exist or is inactive", 400);
        }
        return category;
    }

    function audit(trx, user, action, resourceType, resourceId, oldValues, newValues) {
        return repo.insertAuditLog({
            audit_id: createId(),
            actor_user_id: user.userId,
            action,
            resource_type: resourceType,
            resource_id: resourceId,
            old_values: oldValues,
            new_values: newValues
        }, trx);
    }

    async function withDuplicateCheck(work, message) {
        try {
            return await work();
        } catch (error) {
            if (isDuplicateError(error)) throw new AppError(message, 409);
            throw error;
        }
    }

    return {
        // ---------------- categories ----------------
        async listCategories(query, user) {
            const filters = parseOrThrow(listCategoriesQuerySchema, query, "Invalid query");
            return repo.listCategories({
                includeInactive: filters.include_inactive === "true" && canManage(user)
            });
        },

        async createCategory(input, user) {
            const data = parseOrThrow(createCategorySchema, input, "Invalid category details");
            if (await repo.findCategoryByCodeOrName(data.category_code, data.category_name)) {
                throw new AppError("Category code or name already exists", 409);
            }
            const category = {
                category_id: createId(),
                category_code: data.category_code,
                category_name: data.category_name,
                description: data.description ?? null,
                is_active: true
            };
            return withDuplicateCheck(() => repo.transaction(async (trx) => {
                await repo.insertCategory(category, trx);
                await audit(trx, user, "CATEGORY_CREATED", RESOURCE.CATEGORY, category.category_id, null, category);
                return repo.findCategoryById(category.category_id, trx);
            }), "Category code or name already exists");
        },

        async updateCategory(categoryId, input, user) {
            const before = await getExistingCategory(categoryId);
            const changes = parseOrThrow(updateCategorySchema, input, "Invalid category details");
            return withDuplicateCheck(() => repo.transaction(async (trx) => {
                await repo.updateCategory(categoryId, changes, trx);
                const after = await repo.findCategoryById(categoryId, trx);
                await audit(trx, user, "CATEGORY_UPDATED", RESOURCE.CATEGORY, categoryId, categorySnapshot(before), categorySnapshot(after));
                return after;
            }), "Category name already exists");
        },

        async setCategoryStatus(categoryId, input, user) {
            const before = await getExistingCategory(categoryId);
            const { is_active: isActive } = parseOrThrow(statusSchema, input, "Invalid status");
            return repo.transaction(async (trx) => {
                await repo.updateCategory(categoryId, { is_active: isActive }, trx);
                const after = await repo.findCategoryById(categoryId, trx);
                await audit(trx, user, isActive ? "CATEGORY_ACTIVATED" : "CATEGORY_DEACTIVATED", RESOURCE.CATEGORY, categoryId, categorySnapshot(before), categorySnapshot(after));
                return after;
            });
        },

        // ---------------- services ----------------
        async listServices(query, user) {
            const filters = parseOrThrow(listServicesQuerySchema, query, "Invalid query");
            const { page, limit, offset } = getPagination(filters.page, filters.limit);
            const { items, total } = await repo.listServices({
                categoryId: filters.category_id || null,
                categoryCode: filters.category_code || null,
                search: filters.search || null,
                // Inactive services/categories are only visible to catalog managers.
                includeInactive: filters.include_inactive === "true" && canManage(user)
            }, { limit, offset });
            return { items, meta: getPaginationMeta(total, page, limit) };
        },

        async getService(serviceId, user) {
            const service = await getExistingService(serviceId);
            const bookable = service.is_active && service.category_is_active;
            if (!bookable && !canManage(user)) {
                throw new AppError("Service not found", 404);
            }
            return service;
        },

        async createService(input, user) {
            const data = parseOrThrow(createServiceSchema, input, "Invalid service details");
            await requireActiveCategory(data.category_id);
            if (await repo.findServiceByCode(data.service_code)) {
                throw new AppError("Service code already exists", 409);
            }

            const service = {
                service_id: createId(),
                category_id: data.category_id,
                service_code: data.service_code,
                service_name: data.service_name,
                description: data.description ?? null,
                starting_price: data.starting_price,
                currency: data.currency || "THB",
                estimated_duration_minutes: data.estimated_duration_minutes,
                is_active: true
            };

            return withDuplicateCheck(() => repo.transaction(async (trx) => {
                await repo.insertService(service, trx);
                await audit(trx, user, "SERVICE_CREATED", RESOURCE.SERVICE, service.service_id, null, service);
                return repo.findServiceById(service.service_id, trx);
            }), "Service code already exists");
        },

        async updateService(serviceId, input, user) {
            const before = await getExistingService(serviceId);
            const changes = parseOrThrow(updateServiceSchema, input, "Invalid service details");
            if (changes.category_id && changes.category_id !== before.category_id) {
                await requireActiveCategory(changes.category_id);
            }
            return repo.transaction(async (trx) => {
                await repo.updateService(serviceId, changes, trx);
                const after = await repo.findServiceById(serviceId, trx);
                await audit(trx, user, "SERVICE_UPDATED", RESOURCE.SERVICE, serviceId, serviceSnapshot(before), serviceSnapshot(after));
                return after;
            });
        },

        async setServiceStatus(serviceId, input, user) {
            const before = await getExistingService(serviceId);
            const { is_active: isActive } = parseOrThrow(statusSchema, input, "Invalid status");
            return repo.transaction(async (trx) => {
                await repo.updateService(serviceId, { is_active: isActive }, trx);
                const after = await repo.findServiceById(serviceId, trx);
                await audit(trx, user, isActive ? "SERVICE_ACTIVATED" : "SERVICE_DEACTIVATED", RESOURCE.SERVICE, serviceId, serviceSnapshot(before), serviceSnapshot(after));
                return after;
            });
        },

        // ---------------- audit ----------------
        async listAuditLogs(query) {
            const filters = parseOrThrow(auditQuerySchema, query, "Invalid query");
            const { page, limit, offset } = getPagination(filters.page, filters.limit);
            const { items, total } = await repo.listAuditLogs({
                resourceType: filters.resource_type,
                resourceId: filters.resource_id
            }, { limit, offset });
            return { items, meta: getPaginationMeta(total, page, limit) };
        }
    };
}

module.exports = {
    createCatalogService
};
