/**
 * Booking Service now holds repair requests ("แจ้งซ่อมล่วงหน้า"): the customer
 * tells the shop about the device and the fault before bringing it in. There is
 * no appointment time, no deposit and no no-show. The table is still called
 * bookings so existing work orders keep their booking_id link.
 *
 * Statuses:
 *   PENDING   – waiting for the customer to bring the device in
 *   COMPLETED – device received at the counter, Work Order created in Repair
 *   CANCELLED – cancelled by the customer, or by the shop with a reason
 *   EXPIRED   – nobody brought the device in; closed automatically
 *
 * Left by the old appointment flow (read-only, never created any more):
 *   CONFIRMED        – an appointment; can still be checked in or cancelled
 *   NO_SHOW          – final
 *   AWAITING_DEPOSIT – final; the migration cancels any that are left
 */
const BOOKING_STATUS = Object.freeze({
    PENDING: "PENDING",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    EXPIRED: "EXPIRED",
    CONFIRMED: "CONFIRMED",
    NO_SHOW: "NO_SHOW",
    AWAITING_DEPOSIT: "AWAITING_DEPOSIT"
});

// Requests the counter can still check in (and the customer can still cancel).
const OPEN_STATUSES = Object.freeze([
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED
]);

const CLOSE_OPEN = [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.EXPIRED];

const ALLOWED_TRANSITIONS = Object.freeze({
    [BOOKING_STATUS.PENDING]: CLOSE_OPEN,
    [BOOKING_STATUS.CONFIRMED]: CLOSE_OPEN,
    [BOOKING_STATUS.COMPLETED]: [],
    [BOOKING_STATUS.CANCELLED]: [],
    [BOOKING_STATUS.EXPIRED]: [],
    [BOOKING_STATUS.NO_SHOW]: [],
    [BOOKING_STATUS.AWAITING_DEPOSIT]: []
});

/** The shop repairs computers and notebooks. */
const DEVICE_TYPES = Object.freeze(["NOTEBOOK", "DESKTOP", "ALL_IN_ONE", "OTHER"]);

/** What the customer picks instead of a service: the kind of fault they see. */
const SYMPTOM_GROUPS = Object.freeze([
    "WONT_POWER_ON",
    "DISPLAY",
    "SLOW_OR_FREEZING",
    "BATTERY_OR_CHARGING",
    "KEYBOARD_TOUCHPAD_PORTS",
    "OVERHEATING_OR_NOISE",
    "LIQUID_OR_DROP_DAMAGE",
    "SOFTWARE_OR_VIRUS",
    "DATA_RECOVERY",
    "OTHER"
]);

/**
 * What Repair Service gets at check-in. Work orders store the device type as
 * the same text the walk-in form uses, and have no symptom-group field, so the
 * group goes in front of the symptom text for the technician.
 */
const DEVICE_TYPE_FOR_REPAIR = Object.freeze({
    NOTEBOOK: "โน้ตบุ๊ก",
    DESKTOP: "PC",
    ALL_IN_ONE: "All-in-One",
    OTHER: "อื่น ๆ"
});

const SYMPTOM_GROUP_LABELS = Object.freeze({
    WONT_POWER_ON: "เปิดไม่ติด / ดับเอง",
    DISPLAY: "จอไม่แสดงผล / จอมีปัญหา",
    SLOW_OR_FREEZING: "ช้า ค้าง รีสตาร์ทเอง",
    BATTERY_OR_CHARGING: "แบตเตอรี่ / ชาร์จไม่เข้า",
    KEYBOARD_TOUCHPAD_PORTS: "คีย์บอร์ด ทัชแพด พอร์ต",
    OVERHEATING_OR_NOISE: "ร้อนผิดปกติ / พัดลมดัง",
    LIQUID_OR_DROP_DAMAGE: "โดนน้ำ / ตกหล่น",
    SOFTWARE_OR_VIRUS: "ระบบ โปรแกรม ไวรัส",
    DATA_RECOVERY: "กู้ข้อมูล",
    OTHER: "อื่น ๆ / ไม่แน่ใจ"
});

module.exports = {
    BOOKING_STATUS,
    OPEN_STATUSES,
    ALLOWED_TRANSITIONS,
    DEVICE_TYPES,
    SYMPTOM_GROUPS,
    DEVICE_TYPE_FOR_REPAIR,
    SYMPTOM_GROUP_LABELS
};
