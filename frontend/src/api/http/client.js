/**
 * Small fetch helper for Booking and Catalog calls through the API Gateway.
 * Errors become ApiError with Thai + English text, like the demo backend.
 */
import { ApiError } from "../mock/db.js";
import { API_URL, accessToken, authFetch } from "./tokens.js";

export { API_URL };

/**
 * English messages from the services behind /api/bookings, /api/catalog,
 * /api/repairs and /api/users, translated for the Thai UI. Messages with a
 * number or a reference in them are handled by PATTERNS below.
 */
const THAI = {
    // Gateway / any service
    "Access token is required": "กรุณาเข้าสู่ระบบ",
    "Invalid or expired access token": "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    "Authentication required": "กรุณาเข้าสู่ระบบ",
    "You do not have permission": "คุณไม่มีสิทธิ์ทำรายการนี้",
    "API endpoint not found": "ไม่พบ API นี้ที่ Gateway",
    "Too many requests": "ทำรายการบ่อยเกินไป กรุณารอสักครู่",
    "Authorization service unavailable": "ระบบตรวจสิทธิ์ไม่พร้อม กรุณาลองใหม่",
    "Authentication service unavailable": "ระบบเข้าสู่ระบบไม่พร้อม กรุณาลองใหม่",

    // Repair requests (booking-service)
    "Repair request not found": "ไม่พบคำขอแจ้งซ่อม",
    "Repair request was changed by someone else, please reload": "มีคนเปลี่ยนคำขอนี้ไปแล้ว กรุณาโหลดหน้าใหม่",
    "Could not create the repair request, please try again": "ส่งคำขอแจ้งซ่อมไม่สำเร็จ กรุณาลองใหม่",
    "This repair request is no longer open": "คำขอนี้ปิดไปแล้ว",
    "Selected service is not available": "บริการนี้ไม่เปิดให้บริการแล้ว",
    "Catalog Service is unavailable, please try again": "ระบบบริการไม่ตอบสนอง กรุณาลองใหม่",
    "Repair Service is unavailable, booking was not checked in. Please retry.": "ยังรับเครื่องไม่ได้ เพราะระบบใบงานซ่อมยังไม่พร้อม คำขอยังเปิดอยู่ ลองใหม่ได้ภายหลัง",
    "Repair Service could not create the work order, booking was not checked in. Please retry.": "ระบบใบงานซ่อมสร้างใบงานไม่สำเร็จ คำขอยังเปิดอยู่ ลองใหม่ได้ภายหลัง",
    "Repair Service rejected the work order": "ระบบใบงานซ่อมไม่รับใบงานนี้",

    // Catalog
    "Service code already exists": "รหัสบริการนี้มีอยู่แล้ว",
    "Category code or name already exists": "รหัสหรือชื่อหมวดนี้มีอยู่แล้ว",
    "Category name already exists": "ชื่อหมวดนี้มีอยู่แล้ว",
    "Category does not exist or is inactive": "หมวดหมู่ไม่มีอยู่หรือถูกปิด",
    "Service not found": "ไม่พบบริการ",
    "Category not found": "ไม่พบหมวดหมู่",

    // Work orders (repair-service)
    "Work order not found": "ไม่พบใบงาน",
    "Work order or part not found": "ไม่พบใบงานหรืออะไหล่",
    "You do not have permission for this work order": "คุณไม่มีสิทธิ์ทำรายการกับใบงานนี้",
    "Another technician has already taken this job": "ช่างคนอื่นรับงานนี้ไปแล้ว",
    "This job is no longer in the queue": "งานนี้ไม่อยู่ในคิวแล้ว",
    "Cannot assign a technician to a closed work order": "ใบงานนี้ปิดแล้ว มอบหมายช่างไม่ได้",
    "Option not found on this quotation": "ไม่พบตัวเลือกนี้ในใบเสนอราคา",
    "Record the diagnosis before proposing repair items": "บันทึกผลตรวจก่อนเสนอตัวเลือก",
    "Every option needs a total greater than zero": "ทุกตัวเลือกต้องมีราคามากกว่า 0",
    "A quotation is still awaiting a customer decision": "ยังมีใบเสนอราคาที่รอลูกค้าเลือกอยู่",
    "A passing test is required before handover": "ต้องทดสอบผ่านก่อนส่งมอบเครื่อง",
    "Customer intake terms acknowledgement is required": "ลูกค้าต้องรับทราบเงื่อนไขการรับเครื่องก่อน",
    "Customer terms acknowledgement is required": "ลูกค้าต้องรับทราบเงื่อนไขก่อน",
    "This work order is not under warranty": "ใบงานนี้ไม่อยู่ในระยะประกันแล้ว",
    "Work order is cancelled": "ใบงานถูกยกเลิกแล้ว",
    "There is no approved quotation yet": "ยังไม่มีตัวเลือกที่ลูกค้าเลือก",
    "Payment Service is unavailable": "ระบบการเงินไม่พร้อมใช้งาน กรุณาลองใหม่",
    "User Service is unavailable": "ระบบบัญชีผู้ใช้ไม่พร้อมใช้งาน กรุณาลองใหม่",
    "Payment balance is invalid": "ยอดค้างชำระไม่ถูกต้อง กรุณาติดต่อผู้ดูแล",
    "SKU already exists": "รหัส SKU นี้มีอยู่แล้ว",

    // Accounts (user-service)
    "An account with this email already exists": "อีเมลนี้มีบัญชีอยู่แล้ว",
    "Invalid registration details": "ข้อมูลไม่ถูกต้อง: ชื่อ อีเมล หรือรหัสผ่าน (อย่างน้อย 8 ตัว)",
    "Refresh token is required": "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    "Registration service unavailable": "ระบบสมัครสมาชิกไม่พร้อม กรุณาลองใหม่",
    "User not found": "ไม่พบบัญชีนี้",
    "User profile not found": "ไม่พบโปรไฟล์",
    "User profile service unavailable": "ระบบโปรไฟล์ไม่พร้อม กรุณาลองใหม่",
    "User administration service unavailable": "ระบบจัดการบัญชีไม่พร้อม กรุณาลองใหม่",
    "Active administrator authorization is required": "ต้องใช้บัญชีผู้ดูแลที่ยังเปิดใช้งาน",
    "Active user authorization is required": "บัญชีนี้ถูกปิดใช้งาน",
    "Role not found": "ไม่พบบทบาทนี้",
    "User already has this role": "บัญชีนี้มีบทบาทนี้อยู่แล้ว",
    "Administrator roles cannot be changed": "เปลี่ยนบทบาทของบัญชีผู้ดูแลร้านไม่ได้",
    "Administrators cannot change their own status": "ปิดบัญชีของตัวเองไม่ได้",
    "Administrators cannot modify their own roles": "เปลี่ยนสิทธิ์ของตัวเองไม่ได้",
    "Cannot disable the last active administrator": "ปิดผู้ดูแลคนสุดท้ายไม่ได้",
    "Invalid account status transition": "เปลี่ยนสถานะบัญชีนี้ไม่ได้",
    "Cannot remove the user's final role": "ต้องเหลือบทบาทอย่างน้อย 1 อย่าง",
    "User does not have this role": "บัญชีนี้ไม่มีบทบาทนี้",
    "Invalid role assignment": "ตั้งบทบาทนี้จากหน้าเว็บไม่ได้",
    "Customer not found": "ไม่พบลูกค้า",
    "Merged customer profile cannot be updated": "โปรไฟล์ลูกค้าที่ถูกรวมแล้วแก้ไขไม่ได้"
};

/** Messages that carry a number or a reference. */
const PATTERNS = [
    [/^You already have (\d+) open repair requests\..*$/, "คุณมีคำขอที่ยังไม่ได้นำเครื่องมา $1 รายการแล้ว นำเครื่องมาหรือยกเลิกก่อน"],
    [/^Repair request cannot change from \w+ to \w+$/, "เปลี่ยนสถานะคำขอนี้ไม่ได้"],
    [/^Insufficient stock \((\d+) available\)$/, "อะไหล่ในสต็อกไม่พอ (เหลือ $1)"],
    [/^Issue quantity exceeds approved allowance \((\d+) remaining\)$/, "เบิกเกินจำนวนที่ลูกค้าเลือก (เบิกได้อีก $1)"],
    [/^A warranty claim is already open: (\S+)$/, "มีใบงานเคลมที่ยังเปิดอยู่แล้ว: $1"],
    [/^Outstanding balance (\d+) THB requires an admin exception reason$/, "ยังค้างชำระ $1 บาท ต้องระบุเหตุผลข้อยกเว้น"],
    [/^(Service|Category) not found$/, "ไม่พบข้อมูลนี้"],
    [/^Request failed \((\d+)\)$/, "ทำรายการไม่สำเร็จ ($1)"]
];

function translate(en) {
    if (THAI[en]) return THAI[en];
    for (const [pattern, thai] of PATTERNS) {
        if (pattern.test(en)) return en.replace(pattern, thai);
    }
    if (en.startsWith("Invalid")) return `ข้อมูลไม่ถูกต้อง: ${en}`;
    return en;
}

export { accessToken };

export async function request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };

    let response;
    try {
        response = await (auth ? authFetch : fetch)(`${API_URL}${path}`, init);
    } catch {
        throw new ApiError({ th: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", en: "Cannot reach the server" }, 503);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
        const en = payload?.message || `Request failed (${response.status})`;
        throw new ApiError({ th: translate(en), en }, response.status);
    }
    return payload?.data;
}

export function query(params) {
    const search = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    );
    return search.toString() ? `?${search}` : "";
}
