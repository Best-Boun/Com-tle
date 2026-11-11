/**
 * Shared vocabulary used across many pages (statuses, roles, navigation).
 * Page-specific copy is written inline with L("ไทย", "English").
 */
export const DICT = {
    th: {
        "role.CUSTOMER": "ลูกค้า",
        "role.TECHNICIAN": "ช่างซ่อม",
        "role.ADMIN": "ผู้ดูแลร้าน",

        "status.booking.PENDING": "รอร้านยืนยัน",
        "status.booking.CONFIRMED": "ยืนยันแล้ว",
        "status.booking.COMPLETED": "รับเครื่องแล้ว",
        "status.booking.CANCELLED": "ยกเลิก",

        "status.wo.PENDING": "รอตรวจ",
        "status.wo.DIAGNOSING": "กำลังตรวจเช็ก",
        "status.wo.WAITING_APPROVAL": "รออนุมัติราคา",
        "status.wo.APPROVED": "อนุมัติแล้ว",
        "status.wo.REPAIRING": "กำลังซ่อม",
        "status.wo.TESTING": "กำลังทดสอบ",
        "status.wo.COMPLETED": "ซ่อมเสร็จ",
        "status.wo.CANCELLED": "ยกเลิก",
        "status.wo.HANDED_OVER": "ส่งมอบแล้ว",

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

        "pay.method.CASH": "เงินสด",
        "pay.method.TRANSFER": "โอนเงิน",
        "pay.method.CARD": "บัตร",
        "pay.type.PAYMENT": "รับชำระ",
        "pay.type.REFUND": "คืนเงิน",

        "move.RECEIVE": "รับเข้า",
        "move.ISSUE": "เบิกใช้",
        "move.RETURN": "คืนสต็อก",

        "item.LABOR": "ค่าแรง",
        "item.PART": "อะไหล่",

        "source.BOOKING": "จากการจอง",
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

        "status.booking.PENDING": "Waiting for shop",
        "status.booking.CONFIRMED": "Confirmed",
        "status.booking.COMPLETED": "Device received",
        "status.booking.CANCELLED": "Cancelled",

        "status.wo.PENDING": "Waiting for check",
        "status.wo.DIAGNOSING": "Diagnosing",
        "status.wo.WAITING_APPROVAL": "Awaiting approval",
        "status.wo.APPROVED": "Approved",
        "status.wo.REPAIRING": "Repairing",
        "status.wo.TESTING": "Testing",
        "status.wo.COMPLETED": "Repair done",
        "status.wo.CANCELLED": "Cancelled",
        "status.wo.HANDED_OVER": "Handed over",

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

        "pay.method.CASH": "Cash",
        "pay.method.TRANSFER": "Bank transfer",
        "pay.method.CARD": "Card",
        "pay.type.PAYMENT": "Payment",
        "pay.type.REFUND": "Refund",

        "move.RECEIVE": "Received",
        "move.ISSUE": "Issued",
        "move.RETURN": "Returned",

        "item.LABOR": "Labour",
        "item.PART": "Part",

        "source.BOOKING": "From booking",
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
    booking: { PENDING: "amber", CONFIRMED: "blue", COMPLETED: "green", CANCELLED: "grey" },
    wo: { PENDING: "grey", DIAGNOSING: "blue", WAITING_APPROVAL: "amber", APPROVED: "blue", REPAIRING: "blue", TESTING: "blue", COMPLETED: "green", CANCELLED: "grey", HANDED_OVER: "green" },
    quote: { DRAFT: "grey", SENT: "amber", APPROVED: "green", REJECTED: "red" },
    pay: { UNPAID: "red", PARTIAL: "amber", PAID: "green", PARTIALLY_REFUNDED: "blue", REFUNDED: "grey" }
};

/** Repair stages shown to customers, in order. */
export const WO_STAGES = ["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "REPAIRING", "TESTING", "COMPLETED"];
