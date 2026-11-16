/**
 * Staff (technician) accounts through User Service's existing endpoints.
 *
 * User Service has no "create staff account" endpoint, so an admin creates a
 * technician in two calls:
 *   1. POST /auth/register                      -> new user (role CUSTOMER)
 *   2. PUT  /admin/users/:id/roles/TECHNICIAN    -> REPLACES the role (one role per user)
 * The customers row created by register stays: User Service keeps the
 * display name there. The role change is audit-logged by User Service.
 */
import { ApiError } from "../mock/db.js";
import { query, request } from "./client.js";

const STAFF_ROLE = "TECHNICIAN";

function toStaff(item) {
    return {
        user_id: item.user_id,
        full_name: item.full_name || item.email,
        email: item.email,
        phone: item.phone ?? null,
        status: item.status,
        roles: item.roles || []
    };
}

/** Make an existing user a technician. Their previous role is replaced. */
async function makeTechnician(userId) {
    try {
        await request(`/users/admin/users/${userId}/roles/${STAFF_ROLE}`, { method: "PUT" });
    } catch (error) {
        if (error.status !== 409 || !/already has this role/i.test(error.message)) throw error;
    }
}

export const staff = {
    async list() {
        const data = await request(`/users/admin/users${query({ role: STAFF_ROLE, limit: 100 })}`);
        return (data?.items || []).map(toStaff);
    },

    async createTechnician({ full_name, email, password, phone }) {
        const registered = await request("/users/auth/register", {
            method: "POST",
            auth: false,
            body: { full_name: full_name?.trim(), email: email?.trim(), password, phone: phone?.trim() || null }
        });
        try {
            await makeTechnician(registered.user.user_id);
        } catch (error) {
            throw new ApiError({
                th: `สร้างบัญชี ${registered.user.email} แล้ว แต่ตั้งเป็นช่างไม่สำเร็จ (${error.localized?.th || error.message}) กดปุ่ม "ตั้งบัญชีที่มีอยู่เป็นช่าง" เพื่อลองอีกครั้ง`,
                en: `Account ${registered.user.email} was created but the technician role was not set (${error.message}). Use "Use an existing account" to retry.`
            }, error.status || 503);
        }
        return toStaff({ ...registered.user, status: "ACTIVE", roles: [STAFF_ROLE] });
    },

    /** Turn an account that already exists (e.g. registered as a customer) into a technician. */
    async promoteByEmail(email) {
        const wanted = String(email || "").trim().toLowerCase();
        const data = await request(`/users/admin/users${query({ search: wanted, limit: 100 })}`);
        const user = (data?.items || []).find((u) => u.email?.toLowerCase() === wanted);
        if (!user) {
            throw new ApiError({ th: "ไม่พบบัญชีที่ใช้อีเมลนี้", en: "No account uses this email" }, 404);
        }
        if (user.roles?.includes("ADMIN")) {
            throw new ApiError({ th: "บัญชีนี้เป็นผู้ดูแลระบบ ตั้งเป็นช่างจากหน้านี้ไม่ได้", en: "This is an admin account" }, 409);
        }
        await makeTechnician(user.user_id);
        return toStaff({ ...user, roles: [STAFF_ROLE] });
    },

    async setStatus(userId, active) {
        const status = active ? "ACTIVE" : "DISABLED";
        await request(`/users/admin/users/${userId}/status`, { method: "PATCH", body: { status } });
        return { user_id: userId, status };
    },

    /** All accounts, any role. Returns { items, pagination: { page, page_size, total, total_pages } }. */
    async listUsers({ role, status, search, page = 1, pageSize = 20 } = {}) {
        const data = await request(`/users/admin/users${query({
            role: role || undefined,
            status: status || undefined,
            search: search?.trim() || undefined,
            page,
            limit: pageSize
        })}`);
        return {
            items: (data?.items || []).map(toStaff),
            pagination: data?.pagination || { page, page_size: pageSize, total: 0, total_pages: 0 }
        };
    },

    /**
     * One user, one role: User Service REPLACES the current role with this one.
     * Only CUSTOMER and TECHNICIAN can be set; admin accounts can't be changed.
     */
    async setRole(userId, roleCode) {
        await request(`/users/admin/users/${userId}/roles/${roleCode}`, { method: "PUT" });
    },

    /** Unlock an account that was locked after too many failed sign-ins. */
    async unlock(userId) {
        await request(`/users/admin/users/${userId}/status`, { method: "PATCH", body: { status: "ACTIVE" } });
        return { user_id: userId, status: "ACTIVE" };
    }
};
