/**
 * Mock implementation of every SmartFix API the frontend needs.
 * Each function checks permissions like the real backend would, then
 * applies the team's business rules (see project review doc).
 *
 * Booking + Catalog functions mirror the real booking-service / catalog-service.
 * Repair / Inventory / Payment functions are the proposed contract for the
 * services that are not built yet.
 */
import {
    getDb,
    respond,
    fail,
    newId,
    shortCode,
    bangkokToIso,
    bangkokDate,
    SHOP,
    DEMO_PASSWORD,
    resetDb
} from "./db.js";
import { getSessionUser, setSessionUser } from "../session.js";

const ACTIVE_BOOKING = ["PENDING", "CONFIRMED", "COMPLETED"];
const OPEN_WO = ["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "REPAIRING", "TESTING"];

// ---------------------------------------------------------------- helpers
const now = () => new Date().toISOString();
const has = (user, role) => Boolean(user?.roles?.includes(role));

function requireUser() {
    const user = getSessionUser();
    if (!user) throw { message: { th: "กรุณาเข้าสู่ระบบ", en: "Please sign in" }, status: 401 };
    return user;
}

function requireRole(...roles) {
    const user = requireUser();
    if (!roles.some((role) => has(user, role))) {
        throw { message: { th: "คุณไม่มีสิทธิ์ทำรายการนี้", en: "You do not have permission" }, status: 403 };
    }
    return user;
}

/** Wrap a handler so thrown {message,status} objects become rejected ApiErrors. */
function handler(fn) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            if (error && error.message && error.status && !(error instanceof Error)) {
                return fail(error.message, error.status);
            }
            throw error;
        }
    };
}

function bad(th, en, status = 400) {
    return { message: { th, en }, status };
}

function userName(id) {
    return getDb().users.find((u) => u.user_id === id)?.full_name || null;
}

// ---------------------------------------------------------------- auth
export const auth = {
    login: handler(async ({ email, password }) => {
        const user = getDb().users.find((u) => u.email.toLowerCase() === String(email || "").trim().toLowerCase());
        if (!user || password !== (user.password || DEMO_PASSWORD)) {
            throw bad("อีเมลหรือรหัสผ่านไม่ถูกต้อง", "Invalid email or password", 401);
        }
        const { password: _pw, ...safe } = user;
        setSessionUser(safe);
        return respond({ user: safe, accessToken: "demo-token" });
    }),

    register: handler(async ({ full_name, email, password, phone }) => {
        const db = getDb();
        if (!full_name?.trim() || !email?.trim() || !password) {
            throw bad("กรอกชื่อ อีเมล และรหัสผ่านให้ครบ", "Name, email and password are required");
        }
        if (password.length < 8) throw bad("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร", "Password must be at least 8 characters");
        if (db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
            throw bad("อีเมลนี้มีบัญชีอยู่แล้ว", "An account with this email already exists", 409);
        }
        const user = {
            user_id: newId(),
            full_name: full_name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone?.trim() || null,
            roles: ["CUSTOMER"],
            password
        };
        db.users.push(user);
        const { password: _pw, ...safe } = user;
        return respond({ user: safe });
    }),

    logout: async () => {
        setSessionUser(null);
        return respond(null, 50);
    },

    updateProfile: handler(async ({ full_name, phone }) => {
        const me = requireUser();
        const user = getDb().users.find((u) => u.user_id === me.user_id);
        if (!full_name?.trim()) throw bad("กรุณากรอกชื่อ", "Name is required");
        user.full_name = full_name.trim();
        user.phone = phone?.trim() || null;
        const { password: _pw, ...safe } = user;
        setSessionUser(safe);
        return respond(safe);
    }),

    listTechnicians: handler(async () => {
        requireRole("ADMIN");
        return respond(getDb().users.filter((u) => has(u, "TECHNICIAN")).map(({ password: _p, ...u }) => u));
    })
};

// ---------------------------------------------------------------- catalog (mirrors catalog-service)
function withCategory(service) {
    const c = getDb().categories.find((x) => x.category_id === service.category_id);
    return {
        ...service,
        category_code: c?.category_code,
        category_name: c?.category_name,
        category_is_active: Boolean(c?.is_active)
    };
}

function validateService(input, { partial = false } = {}) {
    const out = {};
    const need = (key) => !partial || input[key] !== undefined;
    if (need("service_name")) {
        if (!String(input.service_name || "").trim()) throw bad("กรุณากรอกชื่อบริการ", "Service name is required");
        out.service_name = input.service_name.trim();
    }
    if (need("starting_price")) {
        const v = Number(input.starting_price);
        if (!Number.isInteger(v) || v < 0) throw bad("ราคาต้องเป็นจำนวนเต็มบาท ไม่ติดลบ", "Price must be a whole number of baht");
        out.starting_price = v;
    }
    if (need("estimated_duration_minutes")) {
        const v = Number(input.estimated_duration_minutes);
        if (!Number.isInteger(v) || v < 1) throw bad("ระยะเวลาต้องเป็นนาทีอย่างน้อย 1", "Duration must be at least 1 minute");
        out.estimated_duration_minutes = v;
    }
    if (input.description !== undefined) out.description = input.description?.trim() || null;
    if (input.category_id !== undefined) {
        const c = getDb().categories.find((x) => x.category_id === input.category_id);
        if (!c || !c.is_active) throw bad("หมวดหมู่ไม่มีอยู่หรือถูกปิด", "Category does not exist or is inactive");
        out.category_id = input.category_id;
    }
    return out;
}

export const catalog = {
    listCategories: handler(async ({ includeInactive = false } = {}) => {
        const user = getSessionUser();
        const all = includeInactive && has(user, "ADMIN");
        return respond(getDb().categories.filter((c) => all || c.is_active));
    }),

    listServices: handler(async ({ categoryId, search, includeInactive = false } = {}) => {
        const user = getSessionUser();
        const all = includeInactive && has(user, "ADMIN");
        let items = getDb().services.map(withCategory);
        if (!all) items = items.filter((s) => s.is_active && s.category_is_active);
        if (categoryId) items = items.filter((s) => s.category_id === categoryId);
        if (search) {
            const q = search.toLowerCase();
            items = items.filter((s) => s.service_name.toLowerCase().includes(q) || s.service_code.toLowerCase().includes(q));
        }
        return respond(items);
    }),

    getService: handler(async (serviceId) => {
        const s = getDb().services.find((x) => x.service_id === serviceId);
        if (!s) throw bad("ไม่พบบริการ", "Service not found", 404);
        const out = withCategory(s);
        if ((!out.is_active || !out.category_is_active) && !has(getSessionUser(), "ADMIN")) {
            throw bad("ไม่พบบริการ", "Service not found", 404);
        }
        return respond(out);
    }),

    createService: handler(async (input) => {
        requireRole("ADMIN");
        const db = getDb();
        const code = String(input.service_code || "").trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(code)) throw bad("รหัสบริการใช้ได้แค่ A-Z 0-9 - _", "Code may only contain A-Z, 0-9, - and _");
        if (db.services.some((s) => s.service_code === code)) throw bad("รหัสบริการนี้มีอยู่แล้ว", "Service code already exists", 409);
        if (!input.category_id) throw bad("กรุณาเลือกหมวดหมู่", "Category is required");
        const data = validateService(input);
        const service = { service_id: newId(), service_code: code, currency: "THB", is_active: true, description: null, ...data };
        db.services.push(service);
        return respond(withCategory(service));
    }),

    updateService: handler(async (serviceId, input) => {
        requireRole("ADMIN");
        const s = getDb().services.find((x) => x.service_id === serviceId);
        if (!s) throw bad("ไม่พบบริการ", "Service not found", 404);
        Object.assign(s, validateService(input, { partial: true }));
        return respond(withCategory(s));
    }),

    setServiceStatus: handler(async (serviceId, isActive) => {
        requireRole("ADMIN");
        const s = getDb().services.find((x) => x.service_id === serviceId);
        if (!s) throw bad("ไม่พบบริการ", "Service not found", 404);
        s.is_active = Boolean(isActive);
        return respond(withCategory(s));
    }),

    createCategory: handler(async ({ category_code, category_name, description }) => {
        requireRole("ADMIN");
        const db = getDb();
        const code = String(category_code || "").trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(code)) throw bad("รหัสหมวดใช้ได้แค่ A-Z 0-9 - _", "Code may only contain A-Z, 0-9, - and _");
        if (!category_name?.trim()) throw bad("กรุณากรอกชื่อหมวด", "Category name is required");
        if (db.categories.some((c) => c.category_code === code || c.category_name === category_name.trim())) {
            throw bad("รหัสหรือชื่อหมวดนี้มีอยู่แล้ว", "Category code or name already exists", 409);
        }
        const category = { category_id: newId(), category_code: code, category_name: category_name.trim(), description: description?.trim() || null, is_active: true };
        db.categories.push(category);
        return respond(category);
    }),

    updateCategory: handler(async (categoryId, { category_name, description }) => {
        requireRole("ADMIN");
        const c = getDb().categories.find((x) => x.category_id === categoryId);
        if (!c) throw bad("ไม่พบหมวดหมู่", "Category not found", 404);
        if (category_name !== undefined) {
            if (!category_name.trim()) throw bad("กรุณากรอกชื่อหมวด", "Category name is required");
            c.category_name = category_name.trim();
        }
        if (description !== undefined) c.description = description?.trim() || null;
        return respond(c);
    }),

    setCategoryStatus: handler(async (categoryId, isActive) => {
        requireRole("ADMIN");
        const c = getDb().categories.find((x) => x.category_id === categoryId);
        if (!c) throw bad("ไม่พบหมวดหมู่", "Category not found", 404);
        c.is_active = Boolean(isActive);
        return respond(c);
    })
};

// ---------------------------------------------------------------- bookings (mirrors booking-service)
function slotStarted(iso) {
    return new Date(iso).getTime() <= Date.now();
}

function presentBooking(b) {
    const local = new Date(new Date(b.scheduled_at).getTime() + 7 * 3600 * 1000).toISOString();
    return {
        ...b,
        appointment_date: local.slice(0, 10),
        appointment_time: local.slice(11, 16),
        timezone: SHOP.timezone,
        customer_name: userName(b.customer_id)
    };
}

function bookingHistory(bookingId) {
    return getDb().bookingHistory
        .filter((h) => h.booking_id === bookingId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((h) => ({ ...h, changed_by_name: userName(h.changed_by) }));
}

function changeBooking(b, to, user, { reason = null, changes = {} } = {}) {
    const allowed = { PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [] };
    if (!allowed[b.status].includes(to)) {
        throw bad(`เปลี่ยนสถานะจาก ${b.status} เป็น ${to} ไม่ได้`, `Booking cannot change from ${b.status} to ${to}`, 409);
    }
    getDb().bookingHistory.push({ history_id: newId(), booking_id: b.booking_id, old_status: b.status, new_status: to, changed_by: user.user_id, reason, created_at: now() });
    Object.assign(b, changes, { status: to, updated_at: now() });
}

function loadBooking(bookingId, user) {
    const b = getDb().bookings.find((x) => x.booking_id === bookingId);
    if (!b || (!has(user, "ADMIN") && b.customer_id !== user.user_id)) throw bad("ไม่พบการจอง", "Booking not found", 404);
    return b;
}

export const bookings = {
    config: SHOP,

    availability: handler(async (date) => {
        requireRole("CUSTOMER", "ADMIN");
        const counts = {};
        for (const b of getDb().bookings) {
            if (!ACTIVE_BOOKING.includes(b.status)) continue;
            const p = presentBooking(b);
            if (p.appointment_date === date) counts[p.appointment_time] = (counts[p.appointment_time] || 0) + 1;
        }
        const slots = SHOP.slotTimes.map((time) => {
            const booked = counts[time] || 0;
            const open = !slotStarted(bangkokToIso(date, time));
            const remaining = open ? Math.max(0, SHOP.slotCapacity - booked) : 0;
            return { time, capacity: SHOP.slotCapacity, booked, remaining, available: remaining > 0 };
        });
        return respond({ date, timezone: SHOP.timezone, slots }, 120);
    }),

    create: handler(async (input) => {
        const user = requireRole("CUSTOMER");
        const db = getDb();
        const service = db.services.find((s) => s.service_id === input.service_id);
        const cat = service && db.categories.find((c) => c.category_id === service.category_id);
        if (!service || !service.is_active || !cat?.is_active) throw bad("บริการนี้ไม่เปิดให้จองแล้ว", "Selected service is not available");
        if (!SHOP.slotTimes.includes(input.appointment_time)) throw bad("เวลานี้ไม่ใช่ช่วงที่รับจอง", "Selected time is not an available booking slot");
        if (input.appointment_date > bangkokDate(SHOP.maxDaysAhead)) throw bad(`จองล่วงหน้าได้ไม่เกิน ${SHOP.maxDaysAhead} วัน`, `Bookings can be made at most ${SHOP.maxDaysAhead} days ahead`);
        const scheduledAt = bangkokToIso(input.appointment_date, input.appointment_time);
        if (slotStarted(scheduledAt)) throw bad("เวลานี้ผ่านไปแล้ว", "Selected time has already passed");
        if (!input.device_type?.trim() || !input.reported_symptom?.trim()) throw bad("กรอกประเภทเครื่องและอาการให้ครบ", "Device type and symptom are required");
        const taken = db.bookings.filter((b) => b.scheduled_at === scheduledAt && ACTIVE_BOOKING.includes(b.status)).length;
        if (taken >= SHOP.slotCapacity) throw bad("ช่วงเวลานี้เต็มแล้ว กรุณาเลือกเวลาอื่น", "Selected time slot is fully booked", 409);

        const booking = {
            booking_id: newId(),
            booking_number: `BK-${input.appointment_date.replaceAll("-", "")}-${shortCode()}`,
            customer_id: user.user_id,
            service_id: service.service_id,
            service_code: service.service_code,
            service_name: service.service_name,
            service_starting_price: service.starting_price,
            service_currency: service.currency,
            device_type: input.device_type.trim(),
            brand: input.brand?.trim() || null,
            model: input.model?.trim() || null,
            serial_number: input.serial_number?.trim() || null,
            reported_symptom: input.reported_symptom.trim(),
            scheduled_at: scheduledAt,
            status: "PENDING",
            work_order_id: null,
            cancelled_at: null,
            cancelled_by: null,
            cancellation_reason: null,
            created_at: now(),
            updated_at: now()
        };
        db.bookings.push(booking);
        db.bookingHistory.push({ history_id: newId(), booking_id: booking.booking_id, old_status: null, new_status: "PENDING", changed_by: user.user_id, reason: null, created_at: now() });
        return respond(presentBooking(booking), 350);
    }),

    listMine: handler(async ({ status } = {}) => {
        const user = requireRole("CUSTOMER");
        let items = getDb().bookings.filter((b) => b.customer_id === user.user_id);
        if (status) items = items.filter((b) => b.status === status);
        items.sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
        return respond(items.map(presentBooking));
    }),

    listAll: handler(async ({ status, date } = {}) => {
        requireRole("ADMIN");
        let items = getDb().bookings.map(presentBooking);
        if (status) items = items.filter((b) => b.status === status);
        if (date) items = items.filter((b) => b.appointment_date === date);
        items.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
        return respond(items);
    }),

    get: handler(async (bookingId) => {
        const user = requireRole("CUSTOMER", "ADMIN");
        const b = loadBooking(bookingId, user);
        return respond({ ...presentBooking(b), status_history: bookingHistory(bookingId) });
    }),

    confirm: handler(async (bookingId) => {
        const user = requireRole("ADMIN");
        const b = loadBooking(bookingId, user);
        changeBooking(b, "CONFIRMED", user);
        return respond(presentBooking(b));
    }),

    cancel: handler(async (bookingId, reason) => {
        const user = requireRole("CUSTOMER", "ADMIN");
        const b = loadBooking(bookingId, user);
        const admin = has(user, "ADMIN");
        if (!admin && slotStarted(b.scheduled_at)) throw bad("เลยเวลานัดแล้ว กรุณาติดต่อร้าน", "Appointment time has passed, please contact the shop", 409);
        if (admin && !reason?.trim()) throw bad("กรุณาระบุเหตุผลการยกเลิก", "A cancellation reason is required");
        changeBooking(b, "CANCELLED", user, {
            reason: reason?.trim() || null,
            changes: { cancelled_at: now(), cancelled_by: user.user_id, cancellation_reason: reason?.trim() || null }
        });
        return respond(presentBooking(b));
    }),

    /** Customer arrived: create the Work Order (1 booking = 1 work order) and complete the booking. */
    checkIn: handler(async (bookingId, { accessories } = {}) => {
        const user = requireRole("ADMIN");
        const b = loadBooking(bookingId, user);
        if (b.status !== "CONFIRMED") throw bad("ต้องยืนยันการจองก่อนรับเครื่อง", "Confirm the booking before check-in", 409);
        if (b.work_order_id) throw bad("การจองนี้มีใบงานแล้ว", "This booking already has a work order", 409);
        const wo = createWorkOrder({
            source: "BOOKING",
            booking_id: b.booking_id,
            customer_id: b.customer_id,
            customer_name: userName(b.customer_id),
            customer_phone: getDb().users.find((u) => u.user_id === b.customer_id)?.phone || null,
            service_id: b.service_id,
            service_name: b.service_name,
            device_type: b.device_type,
            brand: b.brand,
            model: b.model,
            serial_number: b.serial_number,
            reported_symptom: b.reported_symptom,
            accessories: accessories?.trim() || null
        }, user, "รับเครื่องจากการจอง " + b.booking_number);
        changeBooking(b, "COMPLETED", user, { changes: { work_order_id: wo.work_order_id } });
        return respond({ booking: presentBooking(b), work_order: wo }, 400);
    })
};

// ---------------------------------------------------------------- repair (proposed contract)
function createWorkOrder(data, user, note) {
    const db = getDb();
    db.workOrderSeq += 1;
    const wo = {
        work_order_id: newId(),
        work_order_number: `WO-${String(db.workOrderSeq).padStart(4, "0")}`,
        status: "PENDING",
        technician_id: null,
        diagnosis: null,
        repair_result: null,
        test_result: null,
        handed_over_at: null,
        handover_exception: null,
        cancellation: null,
        created_at: now(),
        updated_at: now(),
        ...data
    };
    db.workOrders.push(wo);
    db.workOrderHistory.push({ id: newId(), work_order_id: wo.work_order_id, old_status: null, new_status: "PENDING", changed_by: user.user_id, note, created_at: now() });
    return wo;
}

function setWoStatus(wo, to, user, note = null) {
    getDb().workOrderHistory.push({ id: newId(), work_order_id: wo.work_order_id, old_status: wo.status, new_status: to, changed_by: user.user_id, note, created_at: now() });
    wo.status = to;
    wo.updated_at = now();
}

function quotationTotal(q) {
    return q.items.reduce((sum, i) => sum + Number(i.qty) * Number(i.unit_price || 0), 0);
}

function paymentSummary(woId) {
    const db = getDb();
    const due = db.quotations.filter((q) => q.work_order_id === woId && q.status === "APPROVED").reduce((s, q) => s + quotationTotal(q), 0);
    const tx = db.payments.filter((p) => p.work_order_id === woId);
    const paid = tx.filter((p) => p.type === "PAYMENT").reduce((s, p) => s + p.amount, 0);
    const refunded = tx.filter((p) => p.type === "REFUND").reduce((s, p) => s + p.amount, 0);
    const net = paid - refunded;
    let status;
    if (refunded > 0) status = net <= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    else if (net <= 0) status = "UNPAID";
    else if (net < due) status = "PARTIAL";
    else status = "PAID";
    return { due, paid, refunded, net_paid: net, balance: Math.max(0, due - net), status };
}

function issuedQty(woId, partId) {
    return getDb().stockMovements
        .filter((m) => m.work_order_id === woId && m.part_id === partId)
        .reduce((s, m) => s + (m.type === "ISSUE" ? m.qty : m.type === "RETURN" ? -m.qty : 0), 0);
}

/** Parts the approved scope allows, minus what was already issued. */
function partsAllowance(woId) {
    const db = getDb();
    const approved = {};
    for (const q of db.quotations.filter((x) => x.work_order_id === woId && x.status === "APPROVED")) {
        for (const i of q.items) {
            if (i.type === "PART" && i.part_id) approved[i.part_id] = (approved[i.part_id] || 0) + Number(i.qty);
        }
    }
    return Object.entries(approved).map(([partId, qty]) => {
        const part = db.parts.find((p) => p.part_id === partId);
        const issued = issuedQty(woId, partId);
        return { part_id: partId, sku: part?.sku, name: part?.name, stock: part?.stock ?? 0, approved_qty: qty, issued_qty: issued, remaining_qty: Math.max(0, qty - issued) };
    });
}

function presentWo(wo, { detail = false } = {}) {
    const db = getDb();
    const out = {
        ...wo,
        technician_name: userName(wo.technician_id),
        payment: paymentSummary(wo.work_order_id),
        has_pending_quotation: db.quotations.some((q) => q.work_order_id === wo.work_order_id && ["DRAFT", "SENT"].includes(q.status))
    };
    if (detail) {
        out.history = db.workOrderHistory
            .filter((h) => h.work_order_id === wo.work_order_id)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((h) => ({ ...h, changed_by_name: userName(h.changed_by) }));
        out.quotations = db.quotations
            .filter((q) => q.work_order_id === wo.work_order_id)
            .sort((a, b) => (a.kind === b.kind ? a.revision - b.revision : a.kind === "INITIAL" ? -1 : 1))
            .map((q) => ({ ...q, total: quotationTotal(q), decided_by_name: userName(q.decided_by) }));
        out.payments = db.payments
            .filter((p) => p.work_order_id === wo.work_order_id)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((p) => ({ ...p, recorded_by_name: userName(p.recorded_by) }));
        out.parts = partsAllowance(wo.work_order_id);
        out.stock_movements = db.stockMovements
            .filter((m) => m.work_order_id === wo.work_order_id)
            .map((m) => ({ ...m, part_name: db.parts.find((p) => p.part_id === m.part_id)?.name }));
        out.booking_number = wo.booking_id ? db.bookings.find((b) => b.booking_id === wo.booking_id)?.booking_number : null;
    }
    return out;
}

function loadWo(woId, user) {
    const wo = getDb().workOrders.find((w) => w.work_order_id === woId);
    const visible = wo && (
        has(user, "ADMIN")
        || (has(user, "TECHNICIAN") && wo.technician_id === user.user_id)
        || (has(user, "CUSTOMER") && wo.customer_id === user.user_id)
    );
    if (!visible) throw bad("ไม่พบใบงาน", "Work order not found", 404);
    return wo;
}

function loadQuotation(quotationId) {
    const q = getDb().quotations.find((x) => x.quotation_id === quotationId);
    if (!q) throw bad("ไม่พบใบเสนอราคา", "Quotation not found", 404);
    return q;
}

function normalizeItems(items, { requirePrice }) {
    if (!Array.isArray(items) || items.length === 0) throw bad("ต้องมีอย่างน้อย 1 รายการ", "At least one item is required");
    return items.map((i) => {
        const qty = Number(i.qty);
        const price = Number(i.unit_price ?? 0);
        if (!String(i.description || "").trim()) throw bad("กรอกรายละเอียดทุกรายการ", "Every item needs a description");
        if (!Number.isInteger(qty) || qty < 1) throw bad("จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1", "Quantity must be a whole number ≥ 1");
        if (requirePrice && (!Number.isInteger(price) || price < 0)) {
            throw bad("ใส่ราคาเป็นจำนวนเต็มบาททุกรายการ", "Every item needs a whole-baht price");
        }
        return { item_id: i.item_id || newId(), type: i.type === "PART" ? "PART" : "LABOR", description: i.description.trim(), part_id: i.type === "PART" ? i.part_id || null : null, qty, unit_price: price };
    });
}

export const repairs = {
    listMine: handler(async () => {
        const user = requireRole("CUSTOMER");
        const items = getDb().workOrders.filter((w) => w.customer_id === user.user_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
        return respond(items.map((w) => presentWo(w)));
    }),

    listAssigned: handler(async () => {
        const user = requireRole("TECHNICIAN");
        const items = getDb().workOrders.filter((w) => w.technician_id === user.user_id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return respond(items.map((w) => presentWo(w)));
    }),

    listAll: handler(async ({ status, search } = {}) => {
        requireRole("ADMIN");
        let items = getDb().workOrders.map((w) => presentWo(w));
        if (status === "OPEN") items = items.filter((w) => OPEN_WO.includes(w.status));
        else if (status === "READY") items = items.filter((w) => w.status === "COMPLETED" && !w.handed_over_at);
        else if (status) items = items.filter((w) => w.status === status);
        if (search) {
            const q = search.toLowerCase();
            items = items.filter((w) => [w.work_order_number, w.customer_name, w.brand, w.model, w.customer_phone].some((v) => v?.toLowerCase().includes(q)));
        }
        items.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return respond(items);
    }),

    get: handler(async (woId) => {
        const user = requireRole("CUSTOMER", "TECHNICIAN", "ADMIN");
        return respond(presentWo(loadWo(woId, user), { detail: true }));
    }),

    createWalkIn: handler(async (input) => {
        const user = requireRole("ADMIN");
        if (!input.customer_name?.trim() || !input.customer_phone?.trim()) throw bad("กรอกชื่อและเบอร์โทรลูกค้า", "Customer name and phone are required");
        if (!input.device_type?.trim() || !input.reported_symptom?.trim()) throw bad("กรอกประเภทเครื่องและอาการ", "Device type and symptom are required");
        const service = getDb().services.find((s) => s.service_id === input.service_id);
        const wo = createWorkOrder({
            source: "WALK_IN",
            booking_id: null,
            customer_id: null,
            customer_name: input.customer_name.trim(),
            customer_phone: input.customer_phone.trim(),
            service_id: service?.service_id || null,
            service_name: service?.service_name || null,
            device_type: input.device_type.trim(),
            brand: input.brand?.trim() || null,
            model: input.model?.trim() || null,
            serial_number: input.serial_number?.trim() || null,
            reported_symptom: input.reported_symptom.trim(),
            accessories: input.accessories?.trim() || null
        }, user, "Walk-in");
        return respond(presentWo(wo), 350);
    }),

    assignTechnician: handler(async (woId, technicianId) => {
        const user = requireRole("ADMIN");
        const wo = loadWo(woId, user);
        if (!OPEN_WO.includes(wo.status)) throw bad("ใบงานนี้ปิดแล้ว", "This work order is closed", 409);
        const tech = getDb().users.find((u) => u.user_id === technicianId && has(u, "TECHNICIAN"));
        if (!tech) throw bad("ไม่พบช่าง", "Technician not found");
        wo.technician_id = tech.user_id;
        wo.updated_at = now();
        getDb().workOrderHistory.push({ id: newId(), work_order_id: wo.work_order_id, old_status: wo.status, new_status: wo.status, changed_by: user.user_id, note: `มอบหมายให้ ${tech.full_name}`, created_at: now() });
        return respond(presentWo(wo, { detail: true }));
    }),

    startDiagnosis: handler(async (woId) => {
        const user = requireRole("TECHNICIAN");
        const wo = loadWo(woId, user);
        if (wo.status !== "PENDING") throw bad("เริ่มตรวจได้เฉพาะใบงานที่รอดำเนินการ", "Only pending work orders can start diagnosis", 409);
        setWoStatus(wo, "DIAGNOSING", user);
        return respond(presentWo(wo, { detail: true }));
    }),

    saveDiagnosis: handler(async (woId, diagnosis) => {
        const user = requireRole("TECHNICIAN");
        const wo = loadWo(woId, user);
        if (!["DIAGNOSING", "WAITING_APPROVAL"].includes(wo.status)) throw bad("บันทึกผลตรวจได้ระหว่างตรวจเช็กเท่านั้น", "Diagnosis can only be recorded while diagnosing", 409);
        if (!diagnosis?.trim()) throw bad("กรุณากรอกผลการตรวจ", "Diagnosis is required");
        wo.diagnosis = diagnosis.trim();
        wo.updated_at = now();
        return respond(presentWo(wo, { detail: true }));
    }),

    /** Technician proposes repair items/parts (no prices). Admin prices it afterwards. */
    proposeItems: handler(async (woId, { items, note }) => {
        const user = requireRole("TECHNICIAN");
        const wo = loadWo(woId, user);
        const db = getDb();
        let kind;
        if (wo.status === "DIAGNOSING") kind = "INITIAL";
        else if (["APPROVED", "REPAIRING"].includes(wo.status)) kind = "ADDITIONAL";
        else throw bad("เสนอรายการซ่อมได้ระหว่างตรวจเช็กหรือระหว่างซ่อมเท่านั้น", "Items can only be proposed while diagnosing or repairing", 409);
        if (!wo.diagnosis) throw bad("บันทึกผลตรวจก่อนเสนอรายการ", "Record the diagnosis first", 409);
        const same = db.quotations.filter((q) => q.work_order_id === woId && q.kind === kind);
        if (same.some((q) => ["DRAFT", "SENT"].includes(q.status))) throw bad("มีใบเสนอราคาที่รอดำเนินการอยู่แล้ว", "There is already a pending quotation", 409);
        const q = {
            quotation_id: newId(),
            work_order_id: woId,
            revision: same.length + 1,
            kind,
            status: "DRAFT",
            items: normalizeItems(items, { requirePrice: false }).map((i) => ({ ...i, unit_price: 0 })),
            note: note?.trim() || null,
            created_by: user.user_id,
            created_at: now(),
            sent_at: null,
            decided_by: null,
            decided_at: null,
            decision_note: null
        };
        db.quotations.push(q);
        return respond(presentWo(wo, { detail: true }));
    }),

    /** Admin sets prices on a DRAFT and sends it to the customer. */
    priceAndSend: handler(async (quotationId, { items, note }) => {
        const user = requireRole("ADMIN");
        const q = loadQuotation(quotationId);
        const wo = loadWo(q.work_order_id, user);
        if (q.status !== "DRAFT") throw bad("ส่งได้เฉพาะใบเสนอราคาฉบับร่าง", "Only draft quotations can be sent", 409);
        q.items = normalizeItems(items, { requirePrice: true });
        if (quotationTotal(q) <= 0) throw bad("ยอดรวมต้องมากกว่า 0", "Total must be greater than 0");
        q.note = note?.trim() || q.note;
        q.status = "SENT";
        q.sent_at = now();
        if (q.kind === "INITIAL") setWoStatus(wo, "WAITING_APPROVAL", user, `ส่งใบเสนอราคา Rev.${q.revision}`);
        return respond(presentWo(wo, { detail: true }));
    }),

    /** Rejected quotation -> new revision (never overwrite the old one). */
    reviseQuotation: handler(async (quotationId) => {
        const user = requireRole("ADMIN");
        const q = loadQuotation(quotationId);
        const wo = loadWo(q.work_order_id, user);
        if (q.status !== "REJECTED") throw bad("แก้ไขได้เฉพาะใบที่ถูกปฏิเสธ (สร้างฉบับใหม่)", "Only rejected quotations can be revised", 409);
        const db = getDb();
        const same = db.quotations.filter((x) => x.work_order_id === q.work_order_id && x.kind === q.kind);
        if (same.some((x) => ["DRAFT", "SENT"].includes(x.status))) throw bad("มีฉบับใหม่อยู่แล้ว", "A newer revision already exists", 409);
        db.quotations.push({
            ...q,
            quotation_id: newId(),
            revision: same.length + 1,
            status: "DRAFT",
            items: q.items.map((i) => ({ ...i, item_id: newId() })),
            created_by: user.user_id,
            created_at: now(),
            sent_at: null,
            decided_by: null,
            decided_at: null,
            decision_note: null
        });
        return respond(presentWo(wo, { detail: true }));
    }),

    /** Customer approves/rejects their own quotation; admin may do it for walk-in customers. */
    decideQuotation: handler(async (quotationId, { approve, note }) => {
        const user = requireRole("CUSTOMER", "ADMIN");
        const q = loadQuotation(quotationId);
        const wo = loadWo(q.work_order_id, user);
        if (has(user, "ADMIN") && !has(user, "CUSTOMER") && wo.source !== "WALK_IN") {
            throw bad("ลูกค้าที่จองผ่านระบบต้องอนุมัติเอง", "Booked customers must approve their own quotation", 403);
        }
        if (q.status !== "SENT") throw bad("ใบเสนอราคานี้ไม่ได้รอการอนุมัติ", "This quotation is not awaiting a decision", 409);
        q.status = approve ? "APPROVED" : "REJECTED";
        q.decided_by = user.user_id;
        q.decided_at = now();
        q.decision_note = note?.trim() || null;
        if (q.kind === "INITIAL") {
            if (approve) setWoStatus(wo, "APPROVED", user, `อนุมัติใบเสนอราคา Rev.${q.revision}`);
            else setWoStatus(wo, "DIAGNOSING", user, `ปฏิเสธใบเสนอราคา Rev.${q.revision}`);
        } else {
            getDb().workOrderHistory.push({ id: newId(), work_order_id: wo.work_order_id, old_status: wo.status, new_status: wo.status, changed_by: user.user_id, note: `${approve ? "อนุมัติ" : "ปฏิเสธ"}งานเพิ่มเติม Rev.${q.revision}`, created_at: now() });
        }
        return respond(presentWo(wo, { detail: true }));
    }),

    startRepair: handler(async (woId) => {
        const user = requireRole("TECHNICIAN");
        const wo = loadWo(woId, user);
        if (wo.status !== "APPROVED") throw bad("เริ่มซ่อมได้หลังลูกค้าอนุมัติแล้ว", "Repair can start only after approval", 409);
        setWoStatus(wo, "REPAIRING", user);
        return respond(presentWo(wo, { detail: true }));
    }),

    recordResult: handler(async (woId, result) => {
        const user = requireRole("TECHNICIAN");
        const wo = loadWo(woId, user);
        if (wo.status !== "REPAIRING") throw bad("บันทึกผลซ่อมได้ระหว่างซ่อมเท่านั้น", "Results can only be recorded while repairing", 409);
        if (!result?.trim()) throw bad("กรุณากรอกผลการซ่อม", "Repair result is required");
        wo.repair_result = result.trim();
        setWoStatus(wo, "TESTING", user);
        return respond(presentWo(wo, { detail: true }));
    }),

    recordTest: handler(async (woId, { passed, notes }) => {
        const user = requireRole("TECHNICIAN");
        const wo = loadWo(woId, user);
        if (wo.status !== "TESTING") throw bad("บันทึกผลทดสอบได้ในขั้นทดสอบเท่านั้น", "Tests can only be recorded while testing", 409);
        if (!notes?.trim()) throw bad("กรุณาบันทึกรายละเอียดการทดสอบ", "Test notes are required");
        wo.test_result = { passed: Boolean(passed), notes: notes.trim(), tested_by: user.user_id, tested_at: now() };
        setWoStatus(wo, passed ? "COMPLETED" : "REPAIRING", user, passed ? "ทดสอบผ่าน" : "ทดสอบไม่ผ่าน กลับไปซ่อม");
        return respond(presentWo(wo, { detail: true }));
    }),

    /** Normal: completed + tested + fully paid. Otherwise admin must approve an exception with a reason. */
    handover: handler(async (woId, { exceptionReason } = {}) => {
        const user = requireRole("ADMIN");
        const wo = loadWo(woId, user);
        if (wo.handed_over_at) throw bad("ส่งมอบเครื่องไปแล้ว", "Already handed over", 409);
        if (wo.status !== "COMPLETED" || !wo.test_result?.passed) throw bad("ต้องซ่อมเสร็จและทดสอบผ่านก่อนส่งมอบ", "The repair must be completed and tested first", 409);
        const pay = paymentSummary(woId);
        if (pay.balance > 0) {
            if (!exceptionReason?.trim()) throw bad(`ยังค้างชำระ ${pay.balance} บาท ต้องให้ Admin อนุมัติข้อยกเว้นพร้อมเหตุผล`, `Outstanding ${pay.balance} THB — an admin exception with a reason is required`, 409);
            wo.handover_exception = { approved_by: user.user_id, approved_by_name: user.full_name, reason: exceptionReason.trim(), outstanding: pay.balance, at: now() };
        }
        wo.handed_over_at = now();
        wo.updated_at = now();
        getDb().workOrderHistory.push({ id: newId(), work_order_id: wo.work_order_id, old_status: wo.status, new_status: wo.status, changed_by: user.user_id, note: pay.balance > 0 ? `ส่งมอบเครื่อง (ข้อยกเว้น ค้าง ${pay.balance} บาท)` : "ส่งมอบเครื่องแล้ว", created_at: now() });
        return respond(presentWo(wo, { detail: true }));
    }),

    /** Cancel after work started: return unused parts, keep all history. */
    cancel: handler(async (woId, { reason, returnParts = true }) => {
        const user = requireRole("ADMIN");
        const wo = loadWo(woId, user);
        if (!OPEN_WO.includes(wo.status)) throw bad("ยกเลิกได้เฉพาะใบงานที่ยังไม่ปิด", "Only open work orders can be cancelled", 409);
        if (!reason?.trim()) throw bad("กรุณาระบุเหตุผล", "A reason is required");
        const db = getDb();
        const returned = [];
        if (returnParts) {
            for (const p of partsAllowance(woId)) {
                if (p.issued_qty > 0) {
                    const part = db.parts.find((x) => x.part_id === p.part_id);
                    part.stock += p.issued_qty;
                    db.stockMovements.push({ movement_id: newId(), part_id: p.part_id, type: "RETURN", qty: p.issued_qty, work_order_id: woId, by: user.user_id, note: "คืนจากการยกเลิกงาน", created_at: now() });
                    returned.push({ part_id: p.part_id, name: p.name, qty: p.issued_qty });
                }
            }
        }
        wo.cancellation = { by: user.user_id, by_name: user.full_name, reason: reason.trim(), returned_parts: returned, at: now() };
        setWoStatus(wo, "CANCELLED", user, reason.trim());
        return respond(presentWo(wo, { detail: true }));
    })
};

// ---------------------------------------------------------------- inventory (proposed contract)
export const inventory = {
    listParts: handler(async () => {
        requireRole("ADMIN", "TECHNICIAN");
        return respond([...getDb().parts].sort((a, b) => a.name.localeCompare(b.name)));
    }),

    listMovements: handler(async ({ partId } = {}) => {
        requireRole("ADMIN");
        const db = getDb();
        let items = db.stockMovements;
        if (partId) items = items.filter((m) => m.part_id === partId);
        return respond(
            [...items]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((m) => ({
                    ...m,
                    part_name: db.parts.find((p) => p.part_id === m.part_id)?.name,
                    by_name: userName(m.by),
                    work_order_number: db.workOrders.find((w) => w.work_order_id === m.work_order_id)?.work_order_number || null
                }))
        );
    }),

    createPart: handler(async ({ sku, name, unit_price, reorder_level }) => {
        requireRole("ADMIN");
        const db = getDb();
        const code = String(sku || "").trim().toUpperCase();
        if (!code || !name?.trim()) throw bad("กรอก SKU และชื่ออะไหล่", "SKU and name are required");
        if (db.parts.some((p) => p.sku === code)) throw bad("SKU นี้มีอยู่แล้ว", "SKU already exists", 409);
        const price = Number(unit_price);
        if (!Number.isInteger(price) || price < 0) throw bad("ราคาต้องเป็นจำนวนเต็มบาท", "Price must be a whole number of baht");
        const part = { part_id: newId(), sku: code, name: name.trim(), unit_price: price, stock: 0, reorder_level: Math.max(0, Number(reorder_level) || 0) };
        db.parts.push(part);
        return respond(part);
    }),

    receive: handler(async (partId, { qty, note }) => {
        const user = requireRole("ADMIN");
        const db = getDb();
        const part = db.parts.find((p) => p.part_id === partId);
        if (!part) throw bad("ไม่พบอะไหล่", "Part not found", 404);
        const n = Number(qty);
        if (!Number.isInteger(n) || n < 1) throw bad("จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1", "Quantity must be a whole number ≥ 1");
        part.stock += n;
        db.stockMovements.push({ movement_id: newId(), part_id: partId, type: "RECEIVE", qty: n, work_order_id: null, by: user.user_id, note: note?.trim() || null, created_at: now() });
        return respond(part);
    }),

    /** Repair -> Inventory: issue parts only within the approved scope; Inventory owns the stock. */
    issueForWorkOrder: handler(async (woId, { partId, qty }) => {
        const user = requireRole("ADMIN");
        const wo = loadWo(woId, user);
        if (!["APPROVED", "REPAIRING", "TESTING"].includes(wo.status)) throw bad("เบิกอะไหล่ได้หลังอนุมัติและก่อนปิดงาน", "Parts can be issued only after approval and before closing", 409);
        const allowance = partsAllowance(woId).find((p) => p.part_id === partId);
        if (!allowance) throw bad("อะไหล่นี้ไม่อยู่ในขอบเขตงานที่อนุมัติ", "This part is not in the approved scope", 409);
        const n = Number(qty);
        if (!Number.isInteger(n) || n < 1) throw bad("จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1", "Quantity must be a whole number ≥ 1");
        if (n > allowance.remaining_qty) throw bad(`เบิกได้อีกไม่เกิน ${allowance.remaining_qty} ชิ้นตามที่อนุมัติ`, `Only ${allowance.remaining_qty} more allowed by the approved scope`, 409);
        const db = getDb();
        const part = db.parts.find((p) => p.part_id === partId);
        if (part.stock < n) throw bad(`สต็อกไม่พอ (เหลือ ${part.stock})`, `Not enough stock (${part.stock} left)`, 409);
        part.stock -= n;
        db.stockMovements.push({ movement_id: newId(), part_id: partId, type: "ISSUE", qty: n, work_order_id: woId, by: user.user_id, note: null, created_at: now() });
        return respond(presentWo(wo, { detail: true }));
    })
};

// ---------------------------------------------------------------- payments (proposed contract)
export const payments = {
    listMine: handler(async () => {
        const user = requireRole("CUSTOMER");
        const db = getDb();
        const mine = db.workOrders.filter((w) => w.customer_id === user.user_id);
        return respond(mine.map((w) => ({
            work_order_id: w.work_order_id,
            work_order_number: w.work_order_number,
            service_name: w.service_name,
            device: [w.brand, w.model].filter(Boolean).join(" ") || w.device_type,
            summary: paymentSummary(w.work_order_id),
            transactions: db.payments.filter((p) => p.work_order_id === w.work_order_id)
        })));
    }),

    listAll: handler(async () => {
        requireRole("ADMIN");
        const db = getDb();
        return respond(
            [...db.payments]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((p) => {
                    const wo = db.workOrders.find((w) => w.work_order_id === p.work_order_id);
                    return { ...p, work_order_number: wo?.work_order_number, customer_name: wo?.customer_name, recorded_by_name: userName(p.recorded_by) };
                })
        );
    }),

    balances: handler(async () => {
        requireRole("ADMIN");
        return respond(
            getDb().workOrders
                .filter((w) => w.status !== "CANCELLED" || paymentSummary(w.work_order_id).net_paid > 0)
                .map((w) => ({ work_order_id: w.work_order_id, work_order_number: w.work_order_number, customer_name: w.customer_name, status: w.status, handed_over_at: w.handed_over_at, ...paymentSummary(w.work_order_id) }))
                .filter((r) => r.due > 0 || r.net_paid > 0)
        );
    }),

    /** Balance is always computed from recorded transactions, never taken from the client. */
    record: handler(async (woId, { amount, method, note }) => {
        const user = requireRole("ADMIN");
        const wo = loadWo(woId, user);
        if (wo.status === "CANCELLED") throw bad("ใบงานถูกยกเลิกแล้ว", "Work order is cancelled", 409);
        const n = Number(amount);
        if (!Number.isInteger(n) || n < 1) throw bad("จำนวนเงินต้องเป็นจำนวนเต็มบาท", "Amount must be a whole number of baht");
        const sum = paymentSummary(woId);
        if (sum.due === 0) throw bad("ยังไม่มีใบเสนอราคาที่อนุมัติ", "There is no approved quotation yet", 409);
        if (n > sum.balance) throw bad(`ยอดเกินยอดค้างชำระ (${sum.balance} บาท)`, `Amount exceeds the outstanding balance (${sum.balance} THB)`, 409);
        if (!["CASH", "TRANSFER", "CARD"].includes(method)) throw bad("เลือกวิธีชำระเงิน", "Choose a payment method");
        getDb().payments.push({ payment_id: newId(), work_order_id: woId, type: "PAYMENT", amount: n, method, recorded_by: user.user_id, note: note?.trim() || null, created_at: now() });
        return respond(presentWo(wo, { detail: true }));
    }),

    refund: handler(async (woId, { amount, note }) => {
        const user = requireRole("ADMIN");
        const wo = loadWo(woId, user);
        const n = Number(amount);
        if (!Number.isInteger(n) || n < 1) throw bad("จำนวนเงินต้องเป็นจำนวนเต็มบาท", "Amount must be a whole number of baht");
        const sum = paymentSummary(woId);
        if (n > sum.net_paid) throw bad(`คืนได้ไม่เกินยอดที่ชำระแล้ว (${sum.net_paid} บาท)`, `Refund cannot exceed the amount paid (${sum.net_paid} THB)`, 409);
        if (!note?.trim()) throw bad("กรุณาระบุเหตุผลการคืนเงิน", "A refund reason is required");
        getDb().payments.push({ payment_id: newId(), work_order_id: woId, type: "REFUND", amount: n, method: "TRANSFER", recorded_by: user.user_id, note: note.trim(), created_at: now() });
        return respond(presentWo(wo, { detail: true }));
    })
};

// ---------------------------------------------------------------- dashboard
export const dashboard = {
    summary: handler(async () => {
        requireRole("ADMIN");
        const db = getDb();
        const today = bangkokDate(0);
        const bookingsToday = db.bookings.map(presentBooking).filter((b) => b.appointment_date === today && ACTIVE_BOOKING.includes(b.status));
        const wos = db.workOrders.map((w) => presentWo(w));
        return respond({
            today,
            bookings_today: bookingsToday.length,
            bookings_to_confirm: db.bookings.filter((b) => b.status === "PENDING").length,
            open_work_orders: wos.filter((w) => OPEN_WO.includes(w.status)).length,
            waiting_approval: wos.filter((w) => w.status === "WAITING_APPROVAL").length,
            drafts_to_price: db.quotations.filter((q) => q.status === "DRAFT").length,
            ready_for_handover: wos.filter((w) => w.status === "COMPLETED" && !w.handed_over_at).length,
            unassigned: wos.filter((w) => OPEN_WO.includes(w.status) && !w.technician_id).length,
            low_stock: db.parts.filter((p) => p.stock <= p.reorder_level).map((p) => ({ part_id: p.part_id, name: p.name, stock: p.stock, reorder_level: p.reorder_level })),
            outstanding_total: wos.filter((w) => w.status !== "CANCELLED").reduce((s, w) => s + w.payment.balance, 0),
            upcoming: db.bookings.map(presentBooking).filter((b) => ["PENDING", "CONFIRMED"].includes(b.status) && !slotStarted(b.scheduled_at)).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 6),
            work_by_status: OPEN_WO.map((s) => ({ status: s, count: wos.filter((w) => w.status === s).length }))
        });
    })
};

export const demo = {
    reset: async () => {
        resetDb();
        setSessionUser(null);
        return respond(null, 50);
    },
    accounts: [
        { role: "CUSTOMER", email: "customer@smartfix.test" },
        { role: "TECHNICIAN", email: "technician@smartfix.test" },
        { role: "ADMIN", email: "admin@smartfix.test" }
    ],
    password: DEMO_PASSWORD
};

