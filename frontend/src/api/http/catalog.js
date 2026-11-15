/**
 * Real catalog implementation through the API Gateway (/api/catalog/*).
 * Same function names and return shapes as ../mock catalog so pages don't change.
 * Reads are public (no login needed); changes need an admin token.
 */
import { query, request } from "./client.js";

const nullIfBlank = (value) => (typeof value === "string" && value.trim() === "" ? null : value);

export const catalog = {
    async listCategories({ includeInactive = false } = {}) {
        return request(`/catalog/categories${query({ include_inactive: includeInactive ? "true" : "" })}`);
    },

    async listServices({ categoryId, search, includeInactive = false } = {}) {
        return request(`/catalog/services${query({
            category_id: categoryId,
            search,
            include_inactive: includeInactive ? "true" : "",
            limit: 100
        })}`);
    },

    async getService(serviceId) {
        return request(`/catalog/services/${encodeURIComponent(serviceId)}`);
    },

    async createService(input) {
        return request("/catalog/services", {
            method: "POST",
            body: {
                category_id: input.category_id,
                service_code: input.service_code,
                service_name: input.service_name,
                description: nullIfBlank(input.description ?? null),
                starting_price: input.starting_price,
                estimated_duration_minutes: input.estimated_duration_minutes
            }
        });
    },

    async updateService(serviceId, input) {
        const body = {};
        for (const key of ["category_id", "service_name", "description", "starting_price", "estimated_duration_minutes"]) {
            if (input[key] !== undefined) body[key] = key === "description" ? nullIfBlank(input[key]) : input[key];
        }
        return request(`/catalog/services/${encodeURIComponent(serviceId)}`, { method: "PATCH", body });
    },

    async setServiceStatus(serviceId, isActive) {
        return request(`/catalog/services/${encodeURIComponent(serviceId)}/status`, {
            method: "PATCH",
            body: { is_active: Boolean(isActive) }
        });
    },

    async createCategory({ category_code, category_name, description }) {
        return request("/catalog/categories", {
            method: "POST",
            body: { category_code, category_name, description: nullIfBlank(description ?? null) }
        });
    },

    async updateCategory(categoryId, { category_name, description }) {
        const body = {};
        if (category_name !== undefined) body.category_name = category_name;
        if (description !== undefined) body.description = nullIfBlank(description);
        return request(`/catalog/categories/${encodeURIComponent(categoryId)}`, { method: "PATCH", body });
    },

    async setCategoryStatus(categoryId, isActive) {
        return request(`/catalog/categories/${encodeURIComponent(categoryId)}/status`, {
            method: "PATCH",
            body: { is_active: Boolean(isActive) }
        });
    }
};
