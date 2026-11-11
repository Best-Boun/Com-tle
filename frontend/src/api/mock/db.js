/**
 * In-browser demo database. Persists to localStorage so the demo keeps
 * its state across reloads. Field names follow the real backend
 * (booking_db / catalog_db) and the team's business rules.
 */
const STORAGE_KEY = "smartfix-demo-db-v1";

const DAY = 24 * 60 * 60 * 1000;

export const SHOP = {
    timezone: "Asia/Bangkok",
    slotTimes: ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"],
    slotCapacity: 2,
    maxDaysAhead: 30
};

export const DEMO_PASSWORD = "demo1234";

let idCounter = 0;
export function newId() {
    if (globalThis.crypto?.randomUUID) {
        return crypto.randomUUID();
    }
    idCounter += 1;
    return `id-${Date.now()}-${idCounter}`;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function shortCode(length = 6) {
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
}

/** Bangkok wall-clock "YYYY-MM-DD" + "HH:MM" -> ISO UTC (Bangkok is UTC+7, no DST). */
export function bangkokToIso(date, time) {
    return new Date(`${date}T${time}:00+07:00`).toISOString();
}

export function bangkokDate(offsetDays = 0) {
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000 + offsetDays * DAY);
    return d.toISOString().slice(0, 10);
}

function ago(days, hours = 0) {
    return new Date(Date.now() - days * DAY - hours * 60 * 60 * 1000).toISOString();
}

function seed() {
    const users = [
        { user_id: "u-cust-1", full_name: "สมชาย ใจดี", email: "customer@smartfix.test", phone: "081-234-5678", roles: ["CUSTOMER"] },
        { user_id: "u-cust-2", full_name: "นิดา รักษ์ดี", email: "nida@smartfix.test", phone: "089-765-4321", roles: ["CUSTOMER"] },
        { user_id: "u-tech-1", full_name: "อาทิตย์ ช่างไฟ", email: "technician@smartfix.test", phone: "082-111-2222", roles: ["TECHNICIAN"] },
        { user_id: "u-tech-2", full_name: "มาลี บอร์ดดี", email: "malee@smartfix.test", phone: "082-333-4444", roles: ["TECHNICIAN"] },
        { user_id: "u-admin-1", full_name: "พิมพ์ ผู้ดูแล", email: "admin@smartfix.test", phone: "02-123-4567", roles: ["ADMIN"] }
    ];

    const categories = [
        { category_id: "cat-maint", category_code: "MAINTENANCE", category_name: "ดูแลรักษาเครื่อง", description: "ทำความสะอาด เปลี่ยนซิลิโคน ตรวจเช็กประจำปี", is_active: true },
        { category_id: "cat-soft", category_code: "SOFTWARE", category_name: "ซอฟต์แวร์", description: "ติดตั้งระบบ กำจัดไวรัส กู้ข้อมูล", is_active: true },
        { category_id: "cat-repair", category_code: "REPAIR", category_name: "ซ่อมฮาร์ดแวร์", description: "ตรวจอาการ เปลี่ยนอะไหล่ ซ่อมบอร์ด", is_active: true },
        { category_id: "cat-upgrade", category_code: "UPGRADE", category_name: "อัปเกรด", description: "เพิ่ม RAM เปลี่ยน SSD", is_active: true }
    ];

    const services = [
        { service_id: "svc-clean", category_id: "cat-maint", service_code: "PC-CLEAN", service_name: "ทำความสะอาดเครื่อง PC / โน้ตบุ๊ก", description: "เป่าฝุ่น ล้างพัดลม เปลี่ยนซิลิโคน CPU/GPU ลดความร้อนและเสียงดัง", starting_price: 500, currency: "THB", estimated_duration_minutes: 60, is_active: true },
        { service_id: "svc-os", category_id: "cat-soft", service_code: "OS-INSTALL", service_name: "ติดตั้ง Windows และไดรเวอร์", description: "ติดตั้งระบบใหม่ สำรองข้อมูลก่อนติดตั้ง ลงโปรแกรมพื้นฐาน", starting_price: 400, currency: "THB", estimated_duration_minutes: 90, is_active: true },
        { service_id: "svc-virus", category_id: "cat-soft", service_code: "VIRUS-CLEAN", service_name: "กำจัดไวรัสและมัลแวร์", description: "สแกน ลบมัลแวร์ ปรับแต่งให้เครื่องกลับมาเร็ว", starting_price: 350, currency: "THB", estimated_duration_minutes: 60, is_active: true },
        { service_id: "svc-diag", category_id: "cat-repair", service_code: "HW-DIAG", service_name: "ตรวจเช็กอาการเสีย", description: "หาสาเหตุเครื่องเปิดไม่ติด ดับเอง จอฟ้า ก่อนเสนอราคาซ่อม", starting_price: 300, currency: "THB", estimated_duration_minutes: 60, is_active: true },
        { service_id: "svc-screen", category_id: "cat-repair", service_code: "NB-SCREEN", service_name: "เปลี่ยนจอโน้ตบุ๊ก", description: "ราคาเริ่มต้นเป็นค่าแรง ไม่รวมค่าจอ", starting_price: 800, currency: "THB", estimated_duration_minutes: 120, is_active: true },
        { service_id: "svc-ssd", category_id: "cat-upgrade", service_code: "SSD-UP", service_name: "เปลี่ยนเป็น SSD พร้อมย้ายข้อมูล", description: "โคลนข้อมูลจากดิสก์เดิมไป SSD ใหม่ เครื่องบูตเร็วขึ้นหลายเท่า", starting_price: 600, currency: "THB", estimated_duration_minutes: 90, is_active: true },
        { service_id: "svc-ram", category_id: "cat-upgrade", service_code: "RAM-UP", service_name: "เพิ่ม RAM", description: "ตรวจรุ่นที่รองรับและติดตั้งให้", starting_price: 200, currency: "THB", estimated_duration_minutes: 30, is_active: true },
        { service_id: "svc-board", category_id: "cat-repair", service_code: "BOARD-FIX", service_name: "ซ่อมเมนบอร์ด", description: "ซ่อมระดับชิ้นส่วน (หยุดรับชั่วคราว)", starting_price: 1500, currency: "THB", estimated_duration_minutes: 240, is_active: false }
    ];

    const parts = [
        { part_id: "p-ssd512", sku: "SSD-512-NVME", name: "SSD NVMe 512GB", unit_price: 1290, stock: 8, reorder_level: 3 },
        { part_id: "p-ssd1t", sku: "SSD-1T-NVME", name: "SSD NVMe 1TB", unit_price: 2190, stock: 4, reorder_level: 2 },
        { part_id: "p-ram8", sku: "RAM-DDR4-8G", name: "RAM DDR4 8GB 3200", unit_price: 690, stock: 12, reorder_level: 4 },
        { part_id: "p-ram16", sku: "RAM-DDR4-16G", name: "RAM DDR4 16GB 3200", unit_price: 1290, stock: 2, reorder_level: 3 },
        { part_id: "p-paste", sku: "TP-MX4", name: "ซิลิโคน MX-4", unit_price: 150, stock: 30, reorder_level: 10 },
        { part_id: "p-fan", sku: "FAN-NB-UNI", name: "พัดลมโน้ตบุ๊ก (ทั่วไป)", unit_price: 450, stock: 5, reorder_level: 2 },
        { part_id: "p-screen156", sku: "LCD-156-FHD", name: "จอ 15.6\" FHD IPS", unit_price: 2490, stock: 3, reorder_level: 2 },
        { part_id: "p-psu", sku: "PSU-550W", name: "Power Supply 550W", unit_price: 1590, stock: 0, reorder_level: 2 }
    ];

    // Bookings — shape matches booking-service responses
    const svc = (id) => services.find((s) => s.service_id === id);
    const mkBooking = (id, number, customerId, serviceId, dayOffset, time, status, extra = {}) => ({
        booking_id: id,
        booking_number: number,
        customer_id: customerId,
        service_id: serviceId,
        service_code: svc(serviceId).service_code,
        service_name: svc(serviceId).service_name,
        service_starting_price: svc(serviceId).starting_price,
        service_currency: "THB",
        device_type: "โน้ตบุ๊ก",
        brand: "Asus",
        model: "TUF Gaming F15",
        serial_number: null,
        reported_symptom: "เครื่องร้อนมาก พัดลมดัง เล่นเกมแล้วดับเอง",
        scheduled_at: bangkokToIso(bangkokDate(dayOffset), time),
        status,
        work_order_id: null,
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
        created_at: ago(Math.max(1, -dayOffset + 2)),
        updated_at: ago(1),
        ...extra
    });

    const bookings = [
        mkBooking("bk-1", `BK-${bangkokDate(2).replaceAll("-", "")}-K7QM2P`, "u-cust-1", "svc-clean", 2, "10:00", "PENDING"),
        mkBooking("bk-2", `BK-${bangkokDate(1).replaceAll("-", "")}-H3TX9A`, "u-cust-2", "svc-ssd", 1, "13:00", "CONFIRMED", { device_type: "PC", brand: "ประกอบเอง", model: null, reported_symptom: "อยากเปลี่ยนเป็น SSD เปิดเครื่องช้ามาก" }),
        mkBooking("bk-3", `BK-${bangkokDate(-3).replaceAll("-", "")}-P9WD4R`, "u-cust-1", "svc-diag", -3, "11:00", "COMPLETED", { device_type: "โน้ตบุ๊ก", brand: "Lenovo", model: "IdeaPad 5", serial_number: "PF3XK2LM", reported_symptom: "เปิดไม่ติด ไฟชาร์จติดแต่จอดำ", work_order_id: "wo-1" }),
        mkBooking("bk-4", `BK-${bangkokDate(-6).replaceAll("-", "")}-Z2LN8C`, "u-cust-2", "svc-os", -6, "09:00", "CANCELLED", { cancelled_at: ago(7), cancelled_by: "u-cust-2", cancellation_reason: "ติดธุระ จะจองใหม่ภายหลัง" }),
        mkBooking("bk-5", `BK-${bangkokDate(-8).replaceAll("-", "")}-R5VJ7E`, "u-cust-2", "svc-ssd", -8, "14:00", "COMPLETED", { device_type: "โน้ตบุ๊ก", brand: "Acer", model: "Swift 3", reported_symptom: "เปลี่ยน SSD 1TB", work_order_id: "wo-3" })
    ];

    const bookingHistory = [
        { history_id: newId(), booking_id: "bk-1", old_status: null, new_status: "PENDING", changed_by: "u-cust-1", reason: null, created_at: ago(1) },
        { history_id: newId(), booking_id: "bk-2", old_status: null, new_status: "PENDING", changed_by: "u-cust-2", reason: null, created_at: ago(3) },
        { history_id: newId(), booking_id: "bk-2", old_status: "PENDING", new_status: "CONFIRMED", changed_by: "u-admin-1", reason: null, created_at: ago(2) },
        { history_id: newId(), booking_id: "bk-3", old_status: null, new_status: "PENDING", changed_by: "u-cust-1", reason: null, created_at: ago(6) },
        { history_id: newId(), booking_id: "bk-3", old_status: "PENDING", new_status: "CONFIRMED", changed_by: "u-admin-1", reason: null, created_at: ago(5) },
        { history_id: newId(), booking_id: "bk-3", old_status: "CONFIRMED", new_status: "COMPLETED", changed_by: "u-admin-1", reason: null, created_at: ago(3) },
        { history_id: newId(), booking_id: "bk-4", old_status: null, new_status: "PENDING", changed_by: "u-cust-2", reason: null, created_at: ago(9) },
        { history_id: newId(), booking_id: "bk-4", old_status: "PENDING", new_status: "CANCELLED", changed_by: "u-cust-2", reason: "ติดธุระ จะจองใหม่ภายหลัง", created_at: ago(7) }
    ];

    // Work orders (Repair Service — not built yet, shape proposed here)
    const workOrders = [
        {
            work_order_id: "wo-1", work_order_number: "WO-0001", source: "BOOKING", booking_id: "bk-3",
            customer_id: "u-cust-1", customer_name: "สมชาย ใจดี", customer_phone: "081-234-5678",
            service_id: "svc-diag", service_name: "ตรวจเช็กอาการเสีย",
            device_type: "โน้ตบุ๊ก", brand: "Lenovo", model: "IdeaPad 5", serial_number: "PF3XK2LM",
            reported_symptom: "เปิดไม่ติด ไฟชาร์จติดแต่จอดำ", accessories: "อะแดปเตอร์ชาร์จ",
            status: "WAITING_APPROVAL", technician_id: "u-tech-1",
            diagnosis: "SSD เสีย อ่านไม่ได้ ทำให้บูตไม่ขึ้น บอร์ดและจอปกติ",
            repair_result: null, test_result: null,
            handed_over_at: null, handover_exception: null, cancellation: null,
            created_at: ago(3), updated_at: ago(1)
        },
        {
            work_order_id: "wo-2", work_order_number: "WO-0002", source: "WALK_IN", booking_id: null,
            customer_id: null, customer_name: "ประเสริฐ วอล์กอิน", customer_phone: "086-555-0101",
            service_id: "svc-clean", service_name: "ทำความสะอาดเครื่อง PC / โน้ตบุ๊ก",
            device_type: "PC", brand: "ประกอบเอง", model: null, serial_number: null,
            reported_symptom: "พัดลม CPU เสียงดัง เครื่องร้อน", accessories: null,
            status: "REPAIRING", technician_id: "u-tech-2",
            diagnosis: "ฝุ่นอุดตันฮีตซิงก์ ซิลิโคนแห้ง",
            repair_result: null, test_result: null,
            handed_over_at: null, handover_exception: null, cancellation: null,
            created_at: ago(2), updated_at: ago(0, 5)
        },
        {
            work_order_id: "wo-3", work_order_number: "WO-0003", source: "BOOKING", booking_id: "bk-5",
            customer_id: "u-cust-2", customer_name: "นิดา รักษ์ดี", customer_phone: "089-765-4321",
            service_id: "svc-ssd", service_name: "เปลี่ยนเป็น SSD พร้อมย้ายข้อมูล",
            device_type: "โน้ตบุ๊ก", brand: "Acer", model: "Swift 3", serial_number: "NXH1PSA001",
            reported_symptom: "เปลี่ยน SSD 1TB", accessories: null,
            status: "COMPLETED", technician_id: "u-tech-1",
            diagnosis: "ดิสก์เดิม HDD 500GB ทำงานปกติ ย้ายข้อมูลได้",
            repair_result: "ติดตั้ง SSD 1TB และโคลนข้อมูลครบ",
            test_result: { passed: true, notes: "บูต 9 วินาที ทดสอบอ่านเขียนผ่าน", tested_by: "u-tech-1", tested_at: ago(6) },
            handed_over_at: null, handover_exception: null, cancellation: null,
            created_at: ago(8), updated_at: ago(6)
        },
        {
            work_order_id: "wo-4", work_order_number: "WO-0004", source: "WALK_IN", booking_id: null,
            customer_id: null, customer_name: "วิไล ทดสอบ", customer_phone: "087-000-1111",
            service_id: "svc-diag", service_name: "ตรวจเช็กอาการเสีย",
            device_type: "โน้ตบุ๊ก", brand: "HP", model: "Pavilion 14", serial_number: null,
            reported_symptom: "จอกะพริบ", accessories: null,
            status: "PENDING", technician_id: null,
            diagnosis: null, repair_result: null, test_result: null,
            handed_over_at: null, handover_exception: null, cancellation: null,
            created_at: ago(0, 3), updated_at: ago(0, 3)
        }
    ];

    const workOrderHistory = [
        { id: newId(), work_order_id: "wo-1", old_status: null, new_status: "PENDING", changed_by: "u-admin-1", note: "รับเครื่องจากการจอง", created_at: ago(3) },
        { id: newId(), work_order_id: "wo-1", old_status: "PENDING", new_status: "DIAGNOSING", changed_by: "u-tech-1", note: null, created_at: ago(2, 20) },
        { id: newId(), work_order_id: "wo-1", old_status: "DIAGNOSING", new_status: "WAITING_APPROVAL", changed_by: "u-admin-1", note: "ส่งใบเสนอราคา Rev.2", created_at: ago(1) },
        { id: newId(), work_order_id: "wo-2", old_status: null, new_status: "PENDING", changed_by: "u-admin-1", note: "Walk-in", created_at: ago(2) },
        { id: newId(), work_order_id: "wo-2", old_status: "PENDING", new_status: "DIAGNOSING", changed_by: "u-tech-2", note: null, created_at: ago(1, 20) },
        { id: newId(), work_order_id: "wo-2", old_status: "DIAGNOSING", new_status: "WAITING_APPROVAL", changed_by: "u-admin-1", note: null, created_at: ago(1, 10) },
        { id: newId(), work_order_id: "wo-2", old_status: "WAITING_APPROVAL", new_status: "APPROVED", changed_by: "u-admin-1", note: "ลูกค้า walk-in อนุมัติที่หน้าร้าน", created_at: ago(1, 8) },
        { id: newId(), work_order_id: "wo-2", old_status: "APPROVED", new_status: "REPAIRING", changed_by: "u-tech-2", note: null, created_at: ago(0, 5) },
        { id: newId(), work_order_id: "wo-3", old_status: null, new_status: "PENDING", changed_by: "u-admin-1", note: null, created_at: ago(8) },
        { id: newId(), work_order_id: "wo-3", old_status: "TESTING", new_status: "COMPLETED", changed_by: "u-tech-1", note: "ทดสอบผ่าน", created_at: ago(6) },
        { id: newId(), work_order_id: "wo-4", old_status: null, new_status: "PENDING", changed_by: "u-admin-1", note: "Walk-in", created_at: ago(0, 3) }
    ];

    const quotations = [
        {
            quotation_id: "q-1", work_order_id: "wo-1", revision: 1, kind: "INITIAL", status: "REJECTED",
            items: [
                { item_id: newId(), type: "LABOR", description: "ค่าตรวจเช็กและเปลี่ยน SSD", part_id: null, qty: 1, unit_price: 500 },
                { item_id: newId(), type: "PART", description: "SSD NVMe 1TB", part_id: "p-ssd1t", qty: 1, unit_price: 2190 }
            ],
            note: null, created_by: "u-admin-1", created_at: ago(2), sent_at: ago(2),
            decided_by: "u-cust-1", decided_at: ago(1, 12), decision_note: "ขอเป็น 512GB ได้ไหม"
        },
        {
            quotation_id: "q-2", work_order_id: "wo-1", revision: 2, kind: "INITIAL", status: "SENT",
            items: [
                { item_id: newId(), type: "LABOR", description: "ค่าตรวจเช็กและเปลี่ยน SSD", part_id: null, qty: 1, unit_price: 500 },
                { item_id: newId(), type: "PART", description: "SSD NVMe 512GB", part_id: "p-ssd512", qty: 1, unit_price: 1290 }
            ],
            note: "ปรับเป็น 512GB ตามที่ลูกค้าขอ", created_by: "u-admin-1", created_at: ago(1), sent_at: ago(1),
            decided_by: null, decided_at: null, decision_note: null
        },
        {
            quotation_id: "q-3", work_order_id: "wo-2", revision: 1, kind: "INITIAL", status: "APPROVED",
            items: [
                { item_id: newId(), type: "LABOR", description: "ล้างทำความสะอาด", part_id: null, qty: 1, unit_price: 500 },
                { item_id: newId(), type: "PART", description: "ซิลิโคน MX-4", part_id: "p-paste", qty: 1, unit_price: 150 }
            ],
            note: null, created_by: "u-admin-1", created_at: ago(1, 10), sent_at: ago(1, 10),
            decided_by: "u-admin-1", decided_at: ago(1, 8), decision_note: "Walk-in อนุมัติที่หน้าร้าน"
        },
        {
            quotation_id: "q-4", work_order_id: "wo-2", revision: 1, kind: "ADDITIONAL", status: "DRAFT",
            items: [
                { item_id: newId(), type: "PART", description: "พัดลมโน้ตบุ๊ก (ทั่วไป)", part_id: "p-fan", qty: 1, unit_price: 0 }
            ],
            note: "พบพัดลมลูกปืนแตก ควรเปลี่ยน", created_by: "u-tech-2", created_at: ago(0, 4), sent_at: null,
            decided_by: null, decided_at: null, decision_note: null
        },
        {
            quotation_id: "q-5", work_order_id: "wo-3", revision: 1, kind: "INITIAL", status: "APPROVED",
            items: [
                { item_id: newId(), type: "LABOR", description: "ติดตั้งและโคลนข้อมูล", part_id: null, qty: 1, unit_price: 600 },
                { item_id: newId(), type: "PART", description: "SSD NVMe 1TB", part_id: "p-ssd1t", qty: 1, unit_price: 2190 }
            ],
            note: null, created_by: "u-admin-1", created_at: ago(8), sent_at: ago(8),
            decided_by: "u-cust-2", decided_at: ago(7, 20), decision_note: null
        }
    ];

    const stockMovements = [
        { movement_id: newId(), part_id: "p-paste", type: "ISSUE", qty: 1, work_order_id: "wo-2", by: "u-admin-1", note: null, created_at: ago(0, 5) },
        { movement_id: newId(), part_id: "p-ssd1t", type: "ISSUE", qty: 1, work_order_id: "wo-3", by: "u-admin-1", note: null, created_at: ago(7) },
        { movement_id: newId(), part_id: "p-ssd512", type: "RECEIVE", qty: 10, work_order_id: null, by: "u-admin-1", note: "รับของจากซัพพลายเออร์", created_at: ago(10) }
    ];

    const payments = [
        { payment_id: newId(), work_order_id: "wo-3", type: "PAYMENT", amount: 1500, method: "TRANSFER", recorded_by: "u-admin-1", note: "มัดจำ", created_at: ago(7) },
        { payment_id: newId(), work_order_id: "wo-2", type: "PAYMENT", amount: 650, method: "CASH", recorded_by: "u-admin-1", note: null, created_at: ago(1, 8) }
    ];

    return {
        version: 1,
        seededAt: new Date().toISOString(),
        users,
        categories,
        services,
        bookings,
        bookingHistory,
        workOrders,
        workOrderHistory,
        workOrderSeq: 4,
        quotations,
        parts,
        stockMovements,
        payments
    };
}

let db = null;

export function getDb() {
    if (db) return db;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        db = raw ? JSON.parse(raw) : seed();
    } catch {
        db = seed();
    }
    return db;
}

export function saveDb() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
        // storage unavailable — keep in memory only
    }
}

export function resetDb() {
    db = seed();
    saveDb();
}

/**
 * API error. `message` may be a string or { th, en } so the UI can show
 * it in the current language (see utils/errors.js).
 */
export class ApiError extends Error {
    constructor(message, status = 400) {
        super(typeof message === "string" ? message : message.en);
        this.name = "ApiError";
        this.status = status;
        this.localized = typeof message === "string" ? null : message;
    }
}

/** Simulate network latency and return a deep copy (like JSON from a server). */
export function respond(value, ms = 180) {
    saveDb();
    const copy = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    return new Promise((resolve) => setTimeout(() => resolve(copy), ms));
}

export function fail(message, status = 400, ms = 180) {
    return new Promise((_, reject) => setTimeout(() => reject(new ApiError(message, status)), ms));
}
