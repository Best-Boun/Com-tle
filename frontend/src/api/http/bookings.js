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

    /** The choices the request form offers (device types and symptom groups). */
    async options() {
        return request("/bookings/options");
    },

    /** "แจ้งซ่อมล่วงหน้า": device + symptom group + contact, no time slot. */
    async create(input) {
        const booking = await request("/bookings", {
            method: "POST",
            body: {
                device_type: input.device_type,
                brand: input.brand?.trim() || null,
                model: input.model?.trim() || null,
                serial_number: input.serial_number?.trim() || null,
                symptom_group: input.symptom_group,
                reported_symptom: input.reported_symptom,
                contact_name: input.contact_name,
                contact_phone: input.contact_phone,
                service_id: input.service_id || null
            }
        });
        return withCustomerName(booking);
    },

    async listMine({ status } = {}) {
        const items = await request(`/bookings/me${query({ status, limit: 100 })}`);
        return withNames(items);
    },

    /** The shop: newest first; search = request number (RQ-...) or phone. */
    async listAll({ status, date, search } = {}) {
        const items = await request(`/bookings${query({ status, date, search: search?.trim() || undefined, limit: 100 })}`);
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

    async cancel(bookingId, reason) {
        const trimmed = reason?.trim();
        return withCustomerName(await request(`/bookings/${encodeURIComponent(bookingId)}/cancel`, {
            method: "PATCH",
            body: { reason: trimmed || null }
        }));
    },

    /**
     * The customer brought the device in: Booking-Service asks Repair-Service to
     * open the work order. The request stays open if Repair-Service cannot.
     */
    async checkIn(bookingId, { accessories, intake_terms_acknowledged } = {}) {
        const booking = await request(`/bookings/${encodeURIComponent(bookingId)}/check-in`, {
            method: "POST",
            body: { accessories: accessories?.trim() || null, intake_terms_acknowledged: intake_terms_acknowledged === true }
        });
        return { booking: await withCustomerName(booking), work_order: { work_order_id: booking.work_order_id } };
    },

    /**
     * Request numbers for the admin dashboard. The old key names are kept for
     * Dashboard.jsx until task 17 renames them: bookings_today = requests made
     * today, bookings_overdue = requests waiting longer than 7 days for the
     * device, upcoming = requests still waiting (newest first).
     */
    async dashboardFigures() {
        const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        const [todays, waiting] = await Promise.all([
            request(`/bookings${query({ date: today, limit: 100 })}`),
            request(`/bookings${query({ status: "PENDING", limit: 100 })}`)
        ]);
        const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
        return {
            bookings_today: todays.length,
            bookings_overdue: waiting.filter((r) => new Date(r.created_at).getTime() < weekAgo).length,
            upcoming: await withNames(waiting.slice(0, 6))
        };
    }
};
