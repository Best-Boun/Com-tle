/**
 * Real bookings implementation through the API Gateway (/api/bookings/*).
 * Same function names and return shapes as ../mock bookings so pages don't change.
 *
 * Booking-Service stores only customer ids, so names shown to the admin are
 * looked up from User-Service (/api/users/admin/users/:id).
 */
import { SHOP } from "../mock/db.js";
import { getSessionUser } from "../session.js";
import { query, request } from "./client.js";

const isAdmin = () => getSessionUser()?.roles?.includes("ADMIN") === true;

const nameCache = new Map();
async function displayName(userId) {
    if (!userId) return null;
    const me = getSessionUser();
    if (me?.user_id === userId) return me.full_name;
    if (!isAdmin()) return "SmartFix";
    if (!nameCache.has(userId)) {
        nameCache.set(userId, request(`/users/admin/users/${encodeURIComponent(userId)}`)
            .then((user) => user?.customer?.full_name || user?.full_name || user?.email || null)
            .catch(() => null));
    }
    return (await nameCache.get(userId)) || `${userId.slice(0, 8)}…`;
}

async function withCustomerName(booking) {
    return { ...booking, customer_name: await displayName(booking.customer_id) };
}

async function withNames(bookings) {
    return Promise.all(bookings.map(withCustomerName));
}

export const bookings = {
    config: SHOP,

    async availability(date) {
        return request(`/bookings/availability${query({ date })}`);
    },

    async create(input) {
        const booking = await request("/bookings", {
            method: "POST",
            body: {
                service_id: input.service_id,
                appointment_date: input.appointment_date,
                appointment_time: input.appointment_time,
                device_type: input.device_type,
                brand: input.brand || null,
                model: input.model || null,
                serial_number: input.serial_number || null,
                reported_symptom: input.reported_symptom
            }
        });
        return withCustomerName(booking);
    },

    async listMine({ status } = {}) {
        const items = await request(`/bookings/me${query({ status, limit: 100 })}`);
        return withNames(items);
    },

    async listAll({ status, date } = {}) {
        const items = await request(`/bookings${query({ status, date, limit: 100 })}`);
        items.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
        return withNames(items);
    },

    async get(bookingId) {
        const booking = await request(`/bookings/${encodeURIComponent(bookingId)}`);
        const history = await Promise.all((booking.status_history || []).map(async (h) => ({
            ...h,
            changed_by_name: await displayName(h.changed_by)
        })));
        return { ...(await withCustomerName(booking)), status_history: history };
    },

    async confirm(bookingId) {
        return withCustomerName(await request(`/bookings/${encodeURIComponent(bookingId)}/confirm`, { method: "PATCH" }));
    },

    async cancel(bookingId, reason) {
        const trimmed = reason?.trim();
        return withCustomerName(await request(`/bookings/${encodeURIComponent(bookingId)}/cancel`, {
            method: "PATCH",
            body: { reason: trimmed || null }
        }));
    },

    /**
     * Customer arrived: Booking-Service asks Repair-Service to open the work order.
     * Until Repair-Service exists this fails with 503 and the booking stays CONFIRMED.
     */
    async checkIn(bookingId) {
        const booking = await request(`/bookings/${encodeURIComponent(bookingId)}/check-in`, { method: "POST" });
        return { booking: await withCustomerName(booking), work_order: { work_order_id: booking.work_order_id } };
    },

    /** Booking numbers for the admin dashboard (replaces the demo figures). */
    async dashboardFigures() {
        const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        const [todays, pending, all] = await Promise.all([
            request(`/bookings${query({ date: today, limit: 100 })}`),
            request(`/bookings${query({ status: "PENDING", limit: 100 })}`),
            request(`/bookings${query({ limit: 100 })}`)
        ]);
        const now = Date.now();
        const upcoming = all
            .filter((b) => ["PENDING", "CONFIRMED"].includes(b.status) && new Date(b.scheduled_at).getTime() > now)
            .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
            .slice(0, 6);
        return {
            bookings_today: todays.filter((b) => b.status !== "CANCELLED").length,
            bookings_to_confirm: pending.length,
            upcoming: await withNames(upcoming)
        };
    }
};
