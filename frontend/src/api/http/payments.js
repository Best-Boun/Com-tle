/**
 * Real payments implementation through the API Gateway (/api/payments/*).
 * Same function names and return shapes as ../mock payments so pages don't change.
 *
 * Repair-Service is the source of work-order and quotation data. Payment
 * records and balances are loaded directly from Payment-Service.
 */
import { ApiError } from "../mock/db.js";
import { getSessionUser } from "../session.js";
import { API_URL, authFetch } from "./tokens.js";

const THAI = {
    "Payment exceeds the outstanding balance": "ยอดเกินยอดค้างชำระ",
    "No issued bill for this work order": "ยังไม่มีบิลสำหรับใบงานนี้",
    "Payments for this work order are locked": "ใบงานนี้ถูกล็อกการรับชำระไว้",
    "This work order is already paid": "ใบงานนี้ชำระครบแล้ว",
    "There is no approved quotation yet": "ยังไม่มีใบเสนอราคาที่อนุมัติ",
    "Work order is cancelled": "ใบงานถูกยกเลิกแล้ว",
    "Repair Service is unavailable": "ระบบใบงานซ่อมไม่พร้อมใช้งาน",
    "Refund exceeds the refundable amount of the payment": "ยอดคืนเกินยอดที่คืนได้",
    "A refund must be approved by someone other than the requester": "ผู้อนุมัติต้องไม่ใช่ผู้ขอคืนเงิน",
    "A refund must be executed by someone other than the requester": "ผู้ดำเนินการคืนเงินต้องไม่ใช่ผู้ขอคืนเงิน",
    "Only a requested refund can be approved": "อนุมัติได้เฉพาะคำขอที่รออนุมัติ",
    "Only an approved refund can be executed": "ดำเนินการได้เฉพาะคำขอที่อนุมัติแล้ว",
    "Not authorized for this payment operation": "คุณไม่มีสิทธิ์ทำรายการนี้",
    "Authentication required": "กรุณาเข้าสู่ระบบ"
};

function fail(th, en, status = 400) {
    return new ApiError({ th, en }, status);
}

async function request(path, { method = "GET", body, idempotent = false } = {}) {
    const headers = { "content-type": "application/json" };
    // A retry after a token refresh reuses the same key, so it is never applied twice.
    if (idempotent) headers["idempotency-key"] = crypto.randomUUID();
    let response;
    try {
        response = await authFetch(`${API_URL}${path}`, {
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

// ---- Repair-Service integration ----------------------------------------------

let refreshWorkOrder = null;

async function workOrder(woId) {
    if (!refreshWorkOrder) {
        throw fail("ระบบใบงานซ่อมยังไม่พร้อม", "Repair Service is not ready", 503);
    }
    return refreshWorkOrder(woId);
}

function approvedTotal(wo) {
    return (wo.quotations || [])
        .filter((quotation) => quotation.status === "APPROVED")
        .reduce((sum, quotation) => sum + Number(quotation.total || 0), 0);
}

function payStatus(due, paid, refunded) {
    const net = paid - refunded;
    if (refunded > 0) return net <= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (net <= 0) return "UNPAID";
    return net < due ? "PARTIAL" : "PAID";
}

function summaryForWorkOrder(workOrder, balance) {
    const due = approvedTotal(workOrder);
    const paid = Number(balance?.paid_total || 0);
    const refunded = Number(balance?.refunded_total || 0);
    return {
        due,
        paid,
        refunded,
        net_paid: paid - refunded,
        balance: Math.max(0, due - paid + refunded),
        status: payStatus(due, paid, refunded)
    };
}

const nameCache = new Map();
async function displayName(userId) {
    if (!userId) return null;
    const me = getSessionUser();
    if (me?.userId === userId || me?.user_id === userId) return me.full_name;
    if (!nameCache.has(userId)) {
        nameCache.set(userId, request(`/users/admin/users/${userId}`)
            .then((user) => user?.customer?.full_name || user?.email || userId));
    }
    return nameCache.get(userId);
}

// The bill must name the real User-Service customer_id. Work orders made from a
// booking carry the customer's user_id; an admin can resolve it to customer_id.
async function customerIdFor(wo) {
    if (wo.source === "WALK_IN") {
        return wo.customer_id;
    }
    const user = await request(`/users/admin/users/${wo.customer_id}`);
    if (!user?.customer?.customer_id) {
        throw fail(
            "ไม่สามารถยืนยันบัญชีลูกค้าสำหรับออกบิลได้",
            "Unable to resolve the registered customer for billing",
            502
        );
    }
    return user.customer.customer_id;
}

async function ensureBill(woId) {
    const wo = await workOrder(woId);
    if (!wo) throw fail("ไม่พบใบงาน", "Work order not found", 404);
    const total = approvedTotal(wo);
    if (total <= 0) throw fail("ยังไม่มีใบเสนอราคาที่อนุมัติ", "There is no approved quotation yet", 409);

    let current = null;
    try {
        current = await request(`/payments/balances/${woId}`);
    } catch (error) {
        if (error.status !== 404) throw error;
    }
    if (current && Number(current.bill_total) === total) return current;
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

// ---- public API (same names as the mock) ---------------------------------------

export const payments = {
    ensureBill,

    async listMine() {
        const data = await request("/payments/my");
        return Promise.all(data.items.map(async (item) => {
            const wo = await workOrder(item.work_order_id);
            return {
                work_order_id: item.work_order_id,
                work_order_number: wo?.work_order_number || `…${item.bill_id.slice(-8)}`,
                service_name: wo?.service_name || null,
                device: wo ? [wo.brand, wo.model].filter(Boolean).join(" ") || wo.device_type : null,
                summary: summaryForWorkOrder(wo, item),
                transactions: toTransactions(item.payments, [])
            };
        }));
    },

    async listAll() {
        const [payments, refunds] = await Promise.all([
            fetchAll("/payments", {}),
            fetchAll("/payments/refunds", { status: "COMPLETED" })
        ]);
        const rows = toTransactions(payments, refunds)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return Promise.all(rows.map(async (p) => {
            const wo = await workOrder(p.work_order_id);
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
        return Promise.all(data.items.map(async (balance) => {
            const wo = await workOrder(balance.work_order_id);
            return {
                work_order_id: balance.work_order_id,
                work_order_number: wo?.work_order_number || `…${balance.bill_id.slice(-8)}`,
                customer_name: wo?.customer_name || null,
                handed_over_at: wo?.handed_over_at || null,
                // Like the mock: the payment status replaces the work order status.
                ...summaryForWorkOrder(wo, balance),
                is_locked: balance.is_locked
            };
        })).then((rows) => rows.filter((row) => row.due > 0 || row.net_paid > 0));
    },

    /** Returns the refreshed work order, like the mock. */
    async record(woId, { amount, method, note }) {
        const wo = await workOrder(woId);
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
        return refreshedWorkOrder(woId);
    },

    /**
     * Customer online checkout (mock provider): pays the whole outstanding
     * balance of the approved quotations. Payment-Service works out the amount
     * itself. Returns the refreshed work order.
     */
    async checkout(woId, { method }) {
        await request("/payments/checkout", {
            method: "POST",
            idempotent: true,
            body: { work_order_id: woId, payment_method: method }
        });
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
            const wo = await workOrder(r.work_order_id);
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
        return request(`/payments/${paymentId}/void`, { method: "POST", body: { reason } });
    },

    lock: (woId, { reason }) => request(`/payments/work-orders/${woId}/lock`, { method: "POST", body: { reason } }),
    unlock: (woId, { reason }) => request(`/payments/work-orders/${woId}/unlock`, { method: "POST", body: { reason } }),

    async balanceFor(woId) {
        return request(`/payments/balances/${encodeURIComponent(woId)}`);
    },

    async outstandingTotal() {
        const data = await request("/payments/balances");
        return data.items.reduce(
            (total, balance) => total + Math.max(0, Number(balance.outstanding_balance)),
            0
        );
    },

    async transactionsFor(woId) {
        const roles = getSessionUser()?.roles || [];
        if (roles.includes("CUSTOMER")) {
            const data = await request("/payments/my");
            const item = data.items.find((entry) => entry.work_order_id === woId);
            return toTransactions(item?.payments || [], []);
        }
        if (!roles.includes("ADMIN")) return [];
        const [paid, refunds] = await Promise.all([
            fetchAll("/payments", { work_order_id: woId }),
            fetchAll("/payments/refunds", { work_order_id: woId, status: "COMPLETED" })
        ]);
        return toTransactions(paid, refunds);
    },

    async detailsFor(wo) {
        const roles = getSessionUser()?.roles || [];
        let balance = null;
        if (roles.includes("ADMIN")) {
            try {
                balance = await payments.balanceFor(wo.work_order_id);
            } catch (error) {
                if (error.status !== 404) throw error;
            }
        } else if (roles.includes("CUSTOMER")) {
            const data = await request("/payments/my");
            balance = data.items.find((entry) => entry.work_order_id === wo.work_order_id) || null;
        }
        const payment = summaryForWorkOrder(wo, balance);
        return {
            payment,
            payments: await payments.transactionsFor(wo.work_order_id)
        };
    },

    sync: (woId) => refreshedWorkOrder(woId)
};

async function refundAction(refundId, action, body) {
    return request(`/payments/refunds/${refundId}/${action}`, { method: "POST", body });
}

/** Set by ../index.js to load work orders from Repair-Service. */
export function setWorkOrderLoader(loader) {
    refreshWorkOrder = loader;
}

async function refreshedWorkOrder(woId) {
    return refreshWorkOrder ? refreshWorkOrder(woId) : null;
}
