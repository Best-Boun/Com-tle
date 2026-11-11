/**
 * Data access for catalog_db (team schema):
 *   service_categories, services, catalog_audit_logs
 * Every method takes an optional `trx` so writes and their audit log
 * can share one transaction.
 */
const CATEGORY_COLUMNS = [
    "category_id",
    "category_code",
    "category_name",
    "description",
    "is_active",
    "created_at",
    "updated_at"
];

const SERVICE_COLUMNS = [
    "s.service_id",
    "s.category_id",
    "c.category_code",
    "c.category_name",
    "s.service_code",
    "s.service_name",
    "s.description",
    "s.starting_price",
    "s.currency",
    "s.estimated_duration_minutes",
    "s.is_active",
    "c.is_active as category_is_active",
    "s.created_at",
    "s.updated_at"
];

function toCategory(row) {
    return row ? { ...row, is_active: Boolean(row.is_active) } : null;
}

function toService(row) {
    if (!row) {
        return null;
    }
    return {
        ...row,
        starting_price: Number(row.starting_price),
        is_active: Boolean(row.is_active),
        category_is_active: Boolean(row.category_is_active)
    };
}

function escapeLike(value) {
    return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function createServiceRepository(db) {
    if (!db) {
        throw new Error("Database is required");
    }

    const q = (trx) => trx || db;

    function serviceQuery(trx) {
        return q(trx)("services as s")
            .join("service_categories as c", "c.category_id", "s.category_id");
    }

    function applyServiceFilters(query, { categoryId, categoryCode, search, includeInactive }) {
        if (!includeInactive) {
            query.where("s.is_active", true).where("c.is_active", true);
        }
        if (categoryId) query.where("s.category_id", categoryId);
        if (categoryCode) query.where("c.category_code", categoryCode);
        if (search) {
            const pattern = escapeLike(search);
            query.where((b) => b.where("s.service_name", "like", pattern).orWhere("s.service_code", "like", pattern));
        }
        return query;
    }

    return {
        transaction(work) {
            return db.transaction(work);
        },

        // ---------- categories ----------
        async listCategories({ includeInactive }) {
            const query = q()("service_categories").select(CATEGORY_COLUMNS).orderBy("category_name");
            if (!includeInactive) query.where("is_active", true);
            return (await query).map(toCategory);
        },

        async findCategoryById(categoryId, trx) {
            return toCategory(
                await q(trx)("service_categories").select(CATEGORY_COLUMNS).where({ category_id: categoryId }).first()
            );
        },

        async findCategoryByCodeOrName(code, name, trx) {
            return toCategory(
                await q(trx)("service_categories")
                    .select(CATEGORY_COLUMNS)
                    .where({ category_code: code })
                    .orWhere({ category_name: name })
                    .first()
            );
        },

        async insertCategory(category, trx) {
            await q(trx)("service_categories").insert(category);
        },

        async updateCategory(categoryId, changes, trx) {
            await q(trx)("service_categories")
                .where({ category_id: categoryId })
                .update({ ...changes, updated_at: new Date() });
        },

        // ---------- services ----------
        async listServices(filters, { limit, offset }) {
            const rows = await applyServiceFilters(serviceQuery().select(SERVICE_COLUMNS), filters)
                .orderBy([{ column: "c.category_name" }, { column: "s.service_name" }])
                .limit(limit)
                .offset(offset);
            const [{ total }] = await applyServiceFilters(serviceQuery(), filters).count({ total: "*" });
            return { items: rows.map(toService), total: Number(total) };
        },

        async findServiceById(serviceId, trx) {
            return toService(
                await serviceQuery(trx).select(SERVICE_COLUMNS).where("s.service_id", serviceId).first()
            );
        },

        async findServiceByCode(serviceCode, trx) {
            return toService(
                await serviceQuery(trx).select(SERVICE_COLUMNS).where("s.service_code", serviceCode).first()
            );
        },

        async insertService(service, trx) {
            await q(trx)("services").insert(service);
        },

        async updateService(serviceId, changes, trx) {
            await q(trx)("services")
                .where({ service_id: serviceId })
                .update({ ...changes, updated_at: new Date() });
        },

        // ---------- audit ----------
        async insertAuditLog(entry, trx) {
            await q(trx)("catalog_audit_logs").insert({
                ...entry,
                old_values: entry.old_values ? JSON.stringify(entry.old_values) : null,
                new_values: entry.new_values ? JSON.stringify(entry.new_values) : null
            });
        },

        async listAuditLogs({ resourceType, resourceId }, { limit, offset }) {
            const base = () => {
                const query = q()("catalog_audit_logs");
                if (resourceType) query.where("resource_type", resourceType);
                if (resourceId) query.where("resource_id", resourceId);
                return query;
            };
            const rows = await base()
                .select("audit_id", "actor_user_id", "action", "resource_type", "resource_id", "old_values", "new_values", "created_at")
                .orderBy("created_at", "desc")
                .limit(limit)
                .offset(offset);
            const [{ total }] = await base().count({ total: "*" });
            const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
            return {
                items: rows.map((r) => ({ ...r, old_values: parse(r.old_values), new_values: parse(r.new_values) })),
                total: Number(total)
            };
        }
    };
}

module.exports = {
    createServiceRepository
};
