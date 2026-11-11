const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

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

const CAT_ACTIVE = "aaaaaaaa-0000-4000-8000-000000000001";
const CAT_INACTIVE = "aaaaaaaa-0000-4000-8000-000000000002";
const SVC_ACTIVE = "11111111-1111-4111-8111-111111111111";
const SVC_INACTIVE = "22222222-2222-4222-8222-222222222222";
const SVC_IN_INACTIVE_CAT = "33333333-3333-4333-8333-333333333333";

function initialData() {
    return {
        categories: [
            { category_id: CAT_ACTIVE, category_code: "MAINTENANCE", category_name: "Maintenance", description: null, is_active: true },
            { category_id: CAT_INACTIVE, category_code: "OLD", category_name: "Old", description: null, is_active: false }
        ],
        services: [
            { service_id: SVC_ACTIVE, category_id: CAT_ACTIVE, service_code: "PC-CLEAN", service_name: "PC Cleaning", description: null, starting_price: 500, currency: "THB", estimated_duration_minutes: 60, is_active: true },
            { service_id: SVC_INACTIVE, category_id: CAT_ACTIVE, service_code: "RETIRED", service_name: "Retired", description: null, starting_price: 100, currency: "THB", estimated_duration_minutes: 30, is_active: false },
            { service_id: SVC_IN_INACTIVE_CAT, category_id: CAT_INACTIVE, service_code: "LEGACY", service_name: "Legacy", description: null, starting_price: 100, currency: "THB", estimated_duration_minutes: 30, is_active: true }
        ]
    };
}

/** In-memory stand-in for serviceRepository (same method names). */
function createFakeServiceRepository(data = initialData()) {
    const categories = new Map(data.categories.map((c) => [c.category_id, { ...c }]));
    const services = new Map(data.services.map((s) => [s.service_id, { ...s }]));
    const auditLogs = [];

    function joined(service) {
        if (!service) return null;
        const category = categories.get(service.category_id);
        return {
            ...service,
            category_code: category.category_code,
            category_name: category.category_name,
            category_is_active: category.is_active
        };
    }

    return {
        categories,
        services,
        auditLogs,
        async transaction(work) {
            const snap = {
                c: new Map([...categories].map(([k, v]) => [k, { ...v }])),
                s: new Map([...services].map(([k, v]) => [k, { ...v }])),
                a: auditLogs.length
            };
            try {
                return await work({});
            } catch (error) {
                categories.clear(); snap.c.forEach((v, k) => categories.set(k, v));
                services.clear(); snap.s.forEach((v, k) => services.set(k, v));
                auditLogs.length = snap.a;
                throw error;
            }
        },
        async listCategories({ includeInactive }) {
            return [...categories.values()].filter((c) => includeInactive || c.is_active).map((c) => ({ ...c }));
        },
        async findCategoryById(id) {
            return categories.has(id) ? { ...categories.get(id) } : null;
        },
        async findCategoryByCodeOrName(code, name) {
            return [...categories.values()].find((c) => c.category_code === code || c.category_name === name) || null;
        },
        async insertCategory(category) {
            categories.set(category.category_id, { ...category });
        },
        async updateCategory(id, changes) {
            categories.set(id, { ...categories.get(id), ...changes });
        },
        async listServices({ categoryId, categoryCode, search, includeInactive }, { limit, offset }) {
            let items = [...services.values()].map(joined);
            if (!includeInactive) items = items.filter((s) => s.is_active && s.category_is_active);
            if (categoryId) items = items.filter((s) => s.category_id === categoryId);
            if (categoryCode) items = items.filter((s) => s.category_code === categoryCode);
            if (search) items = items.filter((s) => s.service_name.includes(search) || s.service_code.includes(search));
            return { items: items.slice(offset, offset + limit), total: items.length };
        },
        async findServiceById(id) {
            return joined(services.get(id));
        },
        async findServiceByCode(code) {
            return joined([...services.values()].find((s) => s.service_code === code));
        },
        async insertService(service) {
            services.set(service.service_id, { ...service });
        },
        async updateService(id, changes) {
            services.set(id, { ...services.get(id), ...changes });
        },
        async insertAuditLog(entry) {
            auditLogs.push({ ...entry });
        },
        async listAuditLogs({ resourceType, resourceId }, { limit, offset }) {
            let items = [...auditLogs];
            if (resourceType) items = items.filter((a) => a.resource_type === resourceType);
            if (resourceId) items = items.filter((a) => a.resource_id === resourceId);
            return { items: items.slice(offset, offset + limit), total: items.length };
        }
    };
}

module.exports = {
    ISSUER,
    AUDIENCE,
    publicKey,
    signToken,
    CAT_ACTIVE,
    CAT_INACTIVE,
    SVC_ACTIVE,
    SVC_INACTIVE,
    SVC_IN_INACTIVE_CAT,
    createFakeServiceRepository
};
