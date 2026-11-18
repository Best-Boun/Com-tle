/**
 * Shared vocabulary used across many pages (statuses, roles, navigation).
 * Page-specific copy is written inline with L("ไทย", "English").
 */
export const DICT = {
    th: {
        "role.CUSTOMER": "ลูกค้า",
        "role.TECHNICIAN": "ช่างซ่อม",
        "role.ADMIN": "ผู้ดูแลร้าน",

        "status.booking.PENDING": "รอนำเครื่องมา",
        "status.booking.CONFIRMED": "นัดแล้ว (ระบบเดิม)",
        "status.booking.COMPLETED": "รับเครื่องแล้ว",
        "status.booking.CANCELLED": "ยกเลิก",
        "status.booking.EXPIRED": "หมดอายุ",
        "status.booking.NO_SHOW": "ไม่มาตามนัด",

        "device.NOTEBOOK": "โน้ตบุ๊ก",
        "device.DESKTOP": "คอมพิวเตอร์ตั้งโต๊ะ (PC)",
        "device.ALL_IN_ONE": "All-in-One",
        "device.OTHER": "อื่น ๆ",

        "symptom.WONT_POWER_ON": "เปิดไม่ติด / ดับเอง",
        "symptom.DISPLAY": "จอไม่แสดงผล / จอมีปัญหา",
        "symptom.SLOW_OR_FREEZING": "ช้า ค้าง รีสตาร์ทเอง",
        "symptom.BATTERY_OR_CHARGING": "แบตเตอรี่ / ชาร์จไม่เข้า",
        "symptom.KEYBOARD_TOUCHPAD_PORTS": "คีย์บอร์ด ทัชแพด พอร์ต",
        "symptom.OVERHEATING_OR_NOISE": "ร้อนผิดปกติ / พัดลมดัง",
        "symptom.LIQUID_OR_DROP_DAMAGE": "โดนน้ำ / ตกหล่น",
        "symptom.SOFTWARE_OR_VIRUS": "ระบบ โปรแกรม ไวรัส",
        "symptom.DATA_RECOVERY": "กู้ข้อมูล",
        "symptom.OTHER": "อื่น ๆ / ไม่แน่ใจ",

        "status.wo.RECEIVED": "รับเครื่อง",
        "status.wo.PENDING": "รอตรวจเช็ก",
        "status.wo.DIAGNOSING": "กำลังตรวจเช็ก",
        "status.wo.WAITING_APPROVAL": "รออนุมัติราคา",
        "status.wo.APPROVED": "อนุมัติแล้ว",
        "status.wo.REPAIRING": "กำลังซ่อม",
        "status.wo.TESTING": "กำลังทดสอบ",
        "status.wo.COMPLETED": "รอรับเครื่อง",
        "status.wo.CANCELLED": "ยกเลิก",
        "status.wo.HANDED_OVER": "ส่งคืนแล้ว",

        "status.quote.DRAFT": "ร่าง",
        "status.quote.SENT": "รอลูกค้าตอบ",
        "status.quote.APPROVED": "อนุมัติ",
        "status.quote.REJECTED": "ไม่อนุมัติ",

        "quote.kind.INITIAL": "ใบเสนอราคา",
        "quote.kind.ADDITIONAL": "งานเพิ่มเติม",

        "status.pay.UNPAID": "ยังไม่ชำระ",
        "status.pay.PARTIAL": "ชำระบางส่วน",
        "status.pay.PAID": "ชำระครบ",
        "status.pay.PARTIALLY_REFUNDED": "คืนเงินบางส่วน",
        "status.pay.REFUNDED": "คืนเงินครบ",
        "status.refund.REQUESTED": "รออนุมัติ",
        "status.refund.APPROVED": "อนุมัติแล้ว รอโอนคืน",
        "status.refund.COMPLETED": "คืนเงินแล้ว",
        "status.refund.REJECTED": "ปฏิเสธ/ยกเลิก",

        "pay.method.CASH": "เงินสด",
        "pay.method.TRANSFER": "โอนเงิน",
        "pay.method.CARD": "บัตร",
        "pay.method.PROMPTPAY": "พร้อมเพย์",
        "pay.type.PAYMENT": "รับชำระ",
        "pay.type.REFUND": "คืนเงิน",

        "move.RECEIVE": "รับเข้า",
        "move.ISSUE": "เบิกใช้",
        "move.RETURN": "คืนสต็อก",

        "item.LABOR": "ค่าแรง",
        "item.PART": "อะไหล่",

        "source.BOOKING": "จากการแจ้งซ่อม",
        "source.WALK_IN": "Walk-in",

        "common.save": "บันทึก",
        "common.cancel": "ยกเลิก",
        "common.close": "ปิด",
        "common.back": "ย้อนกลับ",
        "common.loading": "กำลังโหลด…",
        "common.retry": "ลองอีกครั้ง",
        "common.search": "ค้นหา",
        "common.all": "ทั้งหมด",
        "common.signout": "ออกจากระบบ",
        "common.notes": "หมายเหตุ"
    },
    en: {
        "role.CUSTOMER": "Customer",
        "role.TECHNICIAN": "Technician",
        "role.ADMIN": "Shop admin",

        "status.booking.PENDING": "Waiting for the device",
        "status.booking.CONFIRMED": "Appointment (old system)",
        "status.booking.COMPLETED": "Device received",
        "status.booking.CANCELLED": "Cancelled",
        "status.booking.EXPIRED": "Expired",
        "status.booking.NO_SHOW": "No-show",

        "device.NOTEBOOK": "Notebook",
        "device.DESKTOP": "Desktop PC",
        "device.ALL_IN_ONE": "All-in-One",
        "device.OTHER": "Other",

        "symptom.WONT_POWER_ON": "Won't turn on / shuts down",
        "symptom.DISPLAY": "No picture / screen problem",
        "symptom.SLOW_OR_FREEZING": "Slow, freezing, restarting",
        "symptom.BATTERY_OR_CHARGING": "Battery / not charging",
        "symptom.KEYBOARD_TOUCHPAD_PORTS": "Keyboard, touchpad, ports",
        "symptom.OVERHEATING_OR_NOISE": "Overheating / noisy fan",
        "symptom.LIQUID_OR_DROP_DAMAGE": "Liquid spill / dropped",
        "symptom.SOFTWARE_OR_VIRUS": "System, software, virus",
        "symptom.DATA_RECOVERY": "Data recovery",
        "symptom.OTHER": "Other / not sure",

        "status.wo.RECEIVED": "Device received",
        "status.wo.PENDING": "Waiting for inspection",
        "status.wo.DIAGNOSING": "Diagnosing",
        "status.wo.WAITING_APPROVAL": "Awaiting approval",
        "status.wo.APPROVED": "Approved",
        "status.wo.REPAIRING": "Repairing",
        "status.wo.TESTING": "Testing",
        "status.wo.COMPLETED": "Ready for pickup",
        "status.wo.CANCELLED": "Cancelled",
        "status.wo.HANDED_OVER": "Returned to customer",

        "status.quote.DRAFT": "Draft",
        "status.quote.SENT": "Awaiting customer",
        "status.quote.APPROVED": "Approved",
        "status.quote.REJECTED": "Rejected",

        "quote.kind.INITIAL": "Quotation",
        "quote.kind.ADDITIONAL": "Additional work",

        "status.pay.UNPAID": "Unpaid",
        "status.pay.PARTIAL": "Partly paid",
        "status.pay.PAID": "Paid",
        "status.pay.PARTIALLY_REFUNDED": "Partly refunded",
        "status.pay.REFUNDED": "Refunded",
        "status.refund.REQUESTED": "Awaiting approval",
        "status.refund.APPROVED": "Approved, to pay out",
        "status.refund.COMPLETED": "Refunded",
        "status.refund.REJECTED": "Rejected/withdrawn",

        "pay.method.CASH": "Cash",
        "pay.method.TRANSFER": "Bank transfer",
        "pay.method.CARD": "Card",
        "pay.method.PROMPTPAY": "PromptPay",
        "pay.type.PAYMENT": "Payment",
        "pay.type.REFUND": "Refund",

        "move.RECEIVE": "Received",
        "move.ISSUE": "Issued",
        "move.RETURN": "Returned",

        "item.LABOR": "Labour",
        "item.PART": "Part",

        "source.BOOKING": "From a repair request",
        "source.WALK_IN": "Walk-in",

        "common.save": "Save",
        "common.cancel": "Cancel",
        "common.close": "Close",
        "common.back": "Back",
        "common.loading": "Loading…",
        "common.retry": "Try again",
        "common.search": "Search",
        "common.all": "All",
        "common.signout": "Sign out",
        "common.notes": "Notes"
    }
};

/** Badge colour per status: amber = waiting on someone, blue = in progress, green = done. */
export const TONES = {
    booking: { PENDING: "amber", CONFIRMED: "blue", COMPLETED: "green", CANCELLED: "grey", EXPIRED: "grey", NO_SHOW: "red" },
    wo: { PENDING: "grey", DIAGNOSING: "blue", WAITING_APPROVAL: "amber", APPROVED: "blue", REPAIRING: "blue", TESTING: "blue", COMPLETED: "green", CANCELLED: "grey", HANDED_OVER: "green" },
    quote: { DRAFT: "grey", SENT: "amber", APPROVED: "green", REJECTED: "red" },
    pay: { UNPAID: "red", PARTIAL: "amber", PAID: "green", PARTIALLY_REFUNDED: "blue", REFUNDED: "grey" },
    refund: { REQUESTED: "amber", APPROVED: "blue", COMPLETED: "green", REJECTED: "grey" }
};

/** Repair stages shown to customers, in order. */
export const WO_STAGES = ["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "REPAIRING", "TESTING", "COMPLETED"];
