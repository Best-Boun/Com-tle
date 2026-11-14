/**
 * Real payments implementation through the API Gateway (/api/payments/*).
 * Same function names and return shapes as ../mock payments so pages don't change.
 *
 * Work orders and quotations still live in the demo backend (../mock) until
 * Repair-Service exists, so this adapter bridges the two:
 * - Before a payment it registers the work order's bill with Payment-Service
 *   (total = approved quotations), and a new bill version when the total changes.
 * - After any change it mirrors Payment-Service records into the demo db, so
 *   work order pages, lists and the dashboard show the real balance.
 */
import { ApiError, getDb, saveDb } from "../mock/db.js";
import { getSessionUser } from "../session.js";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace(/\/$/, "");
const TOKEN_KEY = "smartfix-session";

const THAI = {
    "Payment exceeds the outstanding balance": "ยอดเกินยอดค้างชำระ",
    "No issued bill for this work order": "ยังไม่มีบิลสำหรับใบงานนี้",
    "Payments for this work order are locked": "ใบงานนี้ถูกล็อกการรับชำระไว้",
    "Refund exceeds the refundable amount of the payment": "ยอดคืนเกินยอดที่คืนได้",
    "A refund must be approved by someone other than the requester": "ผู้อนุมัติต้องไม่ใช่ผู้ขอคืนเงิน",
    "A refund must be executed by someone other than the requester": "ผู้ดำเนินการคืนเงินต้องไม่ใช่ผู้ขอคืนเงิน",
    "Only a requested refund can be approved": "อนุมัติได้เฉพาะคำขอที่รออนุมัติ",
    "Only an approved refund can be executed": "ดำเนินการได้เฉพาะคำขอที่อนุมัติแล้ว",
    "Not authorized for this payment operation": "คุณไม่มีสิทธิ์ทำรายการนี้",
    "Authentication required": "กรุณาเข้าสู่ระบบ"
};

function accessToken() {
    try {
        return JSON.parse(localStorage.getItem(TOKEN_KEY))?.accessToken || null;
    } catch {
        return null;
    }
}

function fail(th, en, status = 400) {
    return new ApiError({ th, en }, status);
}

async function request(path, { method = "GET", body, idempotent = false } = {}) {
    const headers = { "content-type": "application/json" };
    const token = accessToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (idempotent) headers["idempotency-key"] = crypto.randomUUID();
    let response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        throw fail("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "Cannot reach the server", 503);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
        const en = payload?.message || `Request failed (${response.status})`;
        throw fail(THAI[en] || en, en, response.status);
    }
    return payload?.data;
}

const query = (params) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    return search.toString() ? `?${search}` : "";
};

function isAdmin() {
    return getSessionUser()?.roles?.includes("ADMIN") === true;
}

// ---- demo-db bridge -----------------------------------------------------------

function workOrder(woId) {
    return getDb().workOrders.find((w) => w.work_order_id === woId) || null;
}

function approvedTotal(woId) {
    return getDb().quotations
        .filter((q) => q.work_order_id === woId && q.status === "APPROVED")
        .reduce((sum, q) => sum + q.items.reduce((s, i) => s + Number(i.qty) * Number(i.unit_price || 0), 0), 0);
}

function payStatus(due, paid, refunded) {
    const net = paid - refunded;
    if (refunded > 0) return net <= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (net <= 0) return "UNPAID";
    return net < due ? "PARTIAL" : "PAID";
}

function summaryOf(balance) {
    const due = balance.bill_total;
    const paid = balance.paid_total;
    const refunded = balance.refunded_total;
    return {
        due,
        paid,
        refunded,
        net_paid: paid - refunded,
        balance: Math.max(0, balance.outstanding_balance),
        status: payStatus(due, paid, refunded)
    };
}

const nameCache = new Map();
async function displayName(userId) {
    if (!userId) return null;
    const local = getDb().users.find((u) => u.user_id === userId)?.full_name;
    if (local) return local;
    const me = getSessionUser();
    if (me?.user_id === userId) return me.full_name;
    if (!nameCache.has(userId)) {
        nameCache.set(userId, request(`/users/admin/users/${userId}`)
            .then((user) => user?.customer?.full_name || user?.email || null)
            .catch(() => null));
    }
    return nameCache.get(userId);
}

// The bill must name the real User-Service customer_id. Work orders made from a
// booking carry the customer's user_id; an admin can resolve it to customer_id.
async function customerIdFor(wo) {
    try {
        const user = await request(`/users/admin/users/${wo.customer_id}`);
        if (user?.customer?.customer_id) return user.customer.customer_id;
    } catch {
        // walk-in or demo customer: no User-Service account
    }
    return wo.customer_id || wo.work_order_id;
}

async function ensureBill(woId) {
    const wo = workOrder(woId);
    if (!wo) throw fail("ไม่พบใบงาน", "Work order not found", 404);
    const total = approvedTotal(woId);
    if (total <= 0) throw fail("ยังไม่มีใบเสนอราคาที่อนุมัติ", "There is no approved quotation yet", 409);

    let current = null;
    try {
        current = await request(`/payments/balances/${woId}`);
    } catch (error) {
        if (error.status !== 404) throw error;
    }
    if (current && current.bill_total === total) return current;
    return request("/payments/bills", {
        method: "POST",
        body: {
            work_order_id: woId,
            bill_id: woId,
            bill_version: (current?.bill_version || 0) + 1,
            customer_id: await customerIdFor(wo),
            total_amount: total
        }
    });
}

async function fetchAll(path, params) {
    const items = [];
    for (let page = 1; page <= 20; page += 1) {
        const data = await request(`${path}${query({ ...params, page, page_size: 100 })}`);
        items.push(...data.items);
        if (data.items.length < 100) break;
    }
    return items;
}

function toTransactions(payments, refunds) {
    return [
        ...payments.filter((p) => p.status === "SUCCEEDED").map((p) => ({
            payment_id: p.payment_id,
            work_order_id: p.work_order_id,
            type: "PAYMENT",
            amount: p.amount,
            method: p.payment_method,
            recorded_by: p.recorded_by,
            note: p.reference_number || null,
            created_at: p.paid_at || p.created_at
        })),
        ...refunds.filter((r) => r.status === "COMPLETED").map((r) => ({
            payment_id: r.refund_id,
            work_order_id: r.work_order_id,
            type: "REFUND",
            amount: r.amount,
            method: "TRANSFER",
            recorded_by: r.requested_by,
            note: r.reason,
            created_at: r.completed_at || r.requested_at
        }))
    ];
}

/** Replace the demo db's records for a work order with Payment-Service data (admin only). */
async function mirror(woId) {
    if (!isAdmin()) return;
    const [payments, refunds] = await Promise.all([
        fetchAll("/payments", { work_order_id: woId }),
        fetchAll("/payments/refunds", { work_order_id: woId })
    ]);
    const db = getDb();
    db.payments = db.payments.filter((p) => p.work_order_id !== woId)
        .concat(toTransactions(payments, refunds));
    saveDb();
}

async function mirrorSafely(woId) {
    try {
        await mirror(woId);
    } catch {
        // the page still loads from the demo db
    }
}

// ---- public API (same names as the mock) ---------------------------------------

export const payments = {
    async listMine() {
        const data = await request("/payments/my");
        return data.items.map((item) => {
            const wo = workOrder(item.work_order_id);
            return {
                work_order_id: item.work_order_id,
                work_order_number: wo?.work_order_number || `…${item.bill_id.slice(-8)}`,
                service_name: wo?.service_name || null,
                device: wo ? [wo.brand, wo.model].filter(Boolean).join(" ") || wo.device_type : null,
                summary: summaryOf(item),
                transactions: toTransactions(item.payments, [])
            };
        });
    },

    async listAll() {
        const [payments, refunds] = await Promise.all([
            fetchAll("/payments", {}),
            fetchAll("/payments/refunds", { status: "COMPLETED" })
        ]);
        const rows = toTransactions(payments, refunds)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return Promise.all(rows.map(async (p) => {
            const wo = workOrder(p.work_order_id);
            return {
                ...p,
                work_order_number: wo?.work_order_number,
                customer_name: wo?.customer_name,
                recorded_by_name: await displayName(p.recorded_by)
            };
        }));
    },

    async balances() {
        const data = await request("/payments/balances");
        return data.items.map((balance) => {
            const wo = workOrder(balance.work_order_id);
            return {
                work_order_id: balance.work_order_id,
                work_order_number: wo?.work_order_number || `…${balance.bill_id.slice(-8)}`,
                customer_name: wo?.customer_name || null,
                handed_over_at: wo?.handed_over_at || null,
                // Like the mock: the payment status replaces the work order status.
                ...summaryOf(balance),
                is_locked: balance.is_locked
            };
        }).filter((row) => row.due > 0 || row.net_paid > 0);
    },

    /** Returns the refreshed work order, like the mock. */
    async record(woId, { amount, method, note }) {
        const wo = workOrder(woId);
        if (wo?.status === "CANCELLED") throw fail("ใบงานถูกยกเลิกแล้ว", "Work order is cancelled", 409);
        const n = Number(amount);
        if (!Number.isInteger(n) || n < 1) throw fail("จำนวนเงินต้องเป็นจำนวนเต็มบาท", "Amount must be a whole number of baht");
        await ensureBill(woId);
        await request("/payments", {
            method: "POST",
            idempotent: true,
            body: {
                work_order_id: woId,
                amount: n,
                payment_method: method,
                ...(note?.trim() ? { reference_number: note.trim().slice(0, 100) } : {})
            }
        });
        await mirror(woId);
        return refreshedWorkOrder(woId);
    },

    /**
     * Old one-step refund button: files refund REQUESTS against the work
     * order's payments (newest first). Another admin must approve and execute
     * them before the balance changes.
     */
    async refund(woId, { amount, note }) {
        const n = Number(amount);
        if (!Number.isInteger(n) || n < 1) throw fail("จำนวนเงินต้องเป็นจำนวนเต็มบาท", "Amount must be a whole number of baht");
        if (!note?.trim()) throw fail("กรุณาระบุเหตุผลการคืนเงิน", "A refund reason is required");
        const [paid, refunds] = await Promise.all([
            fetchAll("/payments", { work_order_id: woId, status: "SUCCEEDED" }),
            fetchAll("/payments/refunds", { work_order_id: woId })
        ]);
        const reserved = (paymentId) => refunds
            .filter((r) => r.payment_id === paymentId && !["REJECTED", "FAILED"].includes(r.status))
            .reduce((s, r) => s + r.amount, 0);
        const plan = [];
        let remaining = n;
        for (const p of paid.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
            const take = Math.min(remaining, p.amount - reserved(p.payment_id));
            if (take > 0) {
                plan.push([p.payment_id, take]);
                remaining -= take;
            }
            if (remaining === 0) break;
        }
        if (remaining > 0) throw fail("ยอดคืนเกินยอดที่คืนได้", "Refund exceeds the refundable amount", 409);
        for (const [paymentId, take] of plan) {
            await payments.requestRefund(paymentId, { amount: take, reason: note });
        }
        await mirror(woId);
        return refreshedWorkOrder(woId);
    },

    // ---- two-person refunds (for the refund approval UI) ----------------------

    requestRefund(paymentId, { amount, reason }) {
        return request("/payments/refunds", {
            method: "POST",
            idempotent: true,
            body: { payment_id: paymentId, amount: Number(amount), reason }
        });
    },

    async listRefunds({ status, work_order_id, payment_id } = {}) {
        const items = await fetchAll("/payments/refunds", { status, work_order_id, payment_id });
        return Promise.all(items.map(async (r) => {
            const wo = workOrder(r.work_order_id);
            return {
                ...r,
                work_order_number: wo?.work_order_number,
                customer_name: wo?.customer_name,
                requested_by_name: await displayName(r.requested_by),
                approved_by_name: await displayName(r.approved_by)
            };
        }));
    },

    approveRefund: (refundId) => refundAction(refundId, "approve"),
    rejectRefund: (refundId, { reason }) => refundAction(refundId, "reject", { reason }),
    executeRefund: (refundId) => refundAction(refundId, "execute"),

    // ---- void and lock ----------------------------------------------------------

    async voidPayment(paymentId, { reason }) {
        const result = await request(`/payments/${paymentId}/void`, { method: "POST", body: { reason } });
        await mirrorSafely(result.work_order_id);
        return result;
    },

    lock: (woId, { reason }) => request(`/payments/work-orders/${woId}/lock`, { method: "POST", body: { reason } }),
    unlock: (woId, { reason }) => request(`/payments/work-orders/${woId}/unlock`, { method: "POST", body: { reason } }),

    /** Pull Payment-Service records into the demo db before a work order page renders. */
    sync: mirrorSafely
};

async function refundAction(refundId, action, body) {
    const result = await request(`/payments/refunds/${refundId}/${action}`, { method: "POST", body });
    await mirrorSafely(result.work_order_id);
    return result;
}

let refreshWorkOrder = null;
/** Set by ../index.js: loads a work order the same way the page does. */
export function setWorkOrderLoader(loader) {
    refreshWorkOrder = loader;
}

async function refreshedWorkOrder(woId) {
    return refreshWorkOrder ? refreshWorkOrder(woId) : null;
}
