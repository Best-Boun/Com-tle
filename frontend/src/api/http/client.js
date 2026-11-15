/**
 * Small fetch helper for Booking and Catalog calls through the API Gateway.
 * Errors become ApiError with Thai + English text, like the demo backend.
 */
import { ApiError } from "../mock/db.js";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace(/\/$/, "");
const TOKEN_KEY = "smartfix-session";

/** English messages from booking-service / catalog-service, translated for the UI. */
const THAI = {
    "Access token is required": "กรุณาเข้าสู่ระบบ",
    "Invalid or expired access token": "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    "You do not have permission": "คุณไม่มีสิทธิ์ทำรายการนี้",
    "Booking not found": "ไม่พบการจอง",
    "Service not found": "ไม่พบบริการ",
    "Category not found": "ไม่พบหมวดหมู่",
    "Selected service is not available": "บริการนี้ไม่เปิดให้จองแล้ว",
    "Selected time is not an available booking slot": "เวลานี้ไม่ใช่ช่วงที่รับจอง",
    "Selected time has already passed": "เวลานี้ผ่านไปแล้ว",
    "Selected time slot is fully booked": "ช่วงเวลานี้เต็มแล้ว กรุณาเลือกเวลาอื่น",
    "Booking system is busy, please try again": "ระบบจองคิวกำลังยุ่ง กรุณาลองใหม่",
    "Appointment time has passed, please contact the shop": "เลยเวลานัดแล้ว กรุณาติดต่อร้าน",
    "Booking was changed by someone else, please reload": "มีคนแก้การจองนี้ไปแล้ว กรุณาโหลดหน้าใหม่",
    "Catalog Service is unavailable, please try again": "ระบบบริการไม่ตอบสนอง กรุณาลองใหม่",
    "Repair Service is unavailable, booking was not checked in. Please retry.": "ยังรับเครื่องไม่ได้ เพราะระบบใบงานซ่อม (Repair Service) ยังไม่พร้อม การจองยังเป็น “ยืนยันแล้ว” ลองใหม่ได้ภายหลัง",
    "Repair Service could not create the work order, booking was not checked in. Please retry.": "ระบบใบงานซ่อมสร้างใบงานไม่สำเร็จ การจองยังเป็น “ยืนยันแล้ว” ลองใหม่ได้ภายหลัง",
    "Service code already exists": "รหัสบริการนี้มีอยู่แล้ว",
    "Category code or name already exists": "รหัสหรือชื่อหมวดนี้มีอยู่แล้ว",
    "Category name already exists": "ชื่อหมวดนี้มีอยู่แล้ว",
    "Category does not exist or is inactive": "หมวดหมู่ไม่มีอยู่หรือถูกปิด",
    "API endpoint not found": "ไม่พบ API นี้ที่ Gateway",
    "An account with this email already exists": "อีเมลนี้มีบัญชีอยู่แล้ว",
    "Invalid registration details": "ข้อมูลไม่ถูกต้อง: ชื่อ อีเมล หรือรหัสผ่าน (อย่างน้อย 8 ตัว)",
    "User not found": "ไม่พบบัญชีนี้",
    "User already has this role": "บัญชีนี้เป็นช่างอยู่แล้ว",
    "Administrators cannot change their own status": "ปิดบัญชีของตัวเองไม่ได้",
    "Administrators cannot modify their own roles": "เปลี่ยนสิทธิ์ของตัวเองไม่ได้",
    "Cannot disable the last active administrator": "ปิดผู้ดูแลคนสุดท้ายไม่ได้",
    "Invalid account status transition": "เปลี่ยนสถานะบัญชีนี้ไม่ได้",
    "Too many requests": "ทำรายการบ่อยเกินไป กรุณารอสักครู่"
};

function translate(en) {
    if (THAI[en]) return THAI[en];
    if (en.startsWith("Bookings can be made at most")) return en.replace(/Bookings can be made at most (\d+) days ahead/, "จองล่วงหน้าได้ไม่เกิน $1 วัน");
    if (en.startsWith("Booking cannot change from")) return "เปลี่ยนสถานะการจองนี้ไม่ได้";
    if (en.startsWith("Invalid")) return `ข้อมูลไม่ถูกต้อง: ${en}`;
    return en;
}

export function accessToken() {
    try {
        return JSON.parse(localStorage.getItem(TOKEN_KEY))?.accessToken || null;
    } catch {
        return null;
    }
}

export async function request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = auth ? accessToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;

    let response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
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
