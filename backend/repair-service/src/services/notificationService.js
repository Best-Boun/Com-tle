const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");

/**
 * Customer notifications (task 13). Event contract (point E): every message is
 *   { type, work_order_id, customer_id, title, message, created_at, read_at }
 * and is shown on the website; a copy goes by email when the work order has
 * the customer's email and SMTP is configured.
 *
 * Types: RECEIVED, QUOTATION_SENT, WAITING_PARTS, READY_FOR_PICKUP,
 *        HANDED_OVER, CLAIM_OPENED, CANCELLED
 */
const TEMPLATES = {
    RECEIVED: (wo) => ({
        title: `ร้านรับเครื่องแล้ว ${wo.work_order_number}`,
        message: "ร้านรับเครื่องของคุณแล้ว ช่างจะตรวจเช็กและส่งผลตรวจพร้อมตัวเลือกราคามาให้เลือกในเว็บ"
    }),
    QUOTATION_SENT: (wo) => ({
        title: `ผลตรวจพร้อมแล้ว เลือกตัวเลือก ${wo.work_order_number}`,
        message: "ช่างตรวจเครื่องเสร็จแล้ว เข้าไปอ่านผลตรวจและเลือกตัวเลือกที่ต้องการในหน้าติดตามงานซ่อม ร้านจะเริ่มซ่อมเมื่อคุณเลือก"
    }),
    WAITING_PARTS: (wo) => ({
        title: `กำลังรออะไหล่ ${wo.work_order_number}`,
        message: "ร้านสั่งอะไหล่สำหรับเครื่องของคุณแล้ว จะเริ่มซ่อมทันทีที่อะไหล่มาถึง"
    }),
    READY_FOR_PICKUP: (wo, extra) => ({
        title: `เครื่องพร้อมรับแล้ว ${wo.work_order_number}`,
        message: `มารับเครื่องได้ที่ร้าน เก็บเครื่องให้ฟรี ${extra.freeStorageDays} วัน`
    }),
    HANDED_OVER: (wo, extra) => ({
        title: `รับเครื่องคืนแล้ว ${wo.work_order_number}`,
        message: wo.close_reason === "REPAIRED"
            ? `ขอบคุณที่ใช้บริการ งานซ่อมนี้รับประกัน ${extra.warrantyDays} วัน หากอาการเดิมกลับมา ติดต่อร้านได้โดยไม่เสียค่าใช้จ่าย`
            : "ขอบคุณที่ใช้บริการ"
    }),
    CLAIM_OPENED: (wo) => ({
        title: `เปิดใบงานเคลมแล้ว ${wo.work_order_number}`,
        message: "ร้านรับเครื่องเคลมประกันแล้ว งานเคลมไม่มีค่าใช้จ่าย"
    }),
    CANCELLED: (wo) => ({
        title: `ยกเลิกงานซ่อม ${wo.work_order_number}`,
        message: "งานซ่อมนี้ถูกยกเลิก ติดต่อร้านเพื่อรับเครื่องคืนหรือสอบถามรายละเอียด"
    })
};

const markReadSchema = z.object({
    ids: z.array(z.string().uuid()).max(200).optional()
}).strict();

function createNotificationService({
    notificationRepository,
    mailer = { configured: false, async send() { return "NOT_CONFIGURED"; } },
    rules = {},
    webBaseUrl = null,
    createId = randomUUID,
    now = () => new Date(),
    logger = console
} = {}) {
    const extra = {
        freeStorageDays: rules.freeStorageDays ?? 7,
        warrantyDays: rules.warrantyDays ?? 90
    };

    /**
     * Never throws: a notification problem must not undo or fail the repair
     * step that caused it.
     */
    async function notify(workOrder, type) {
        try {
            const template = TEMPLATES[type];
            if (!template || !workOrder?.customer_id) {
                return null;
            }
            // Walk-in customers have no account to read it; the shop calls them.
            if (workOrder.source === "WALK_IN") {
                return null;
            }
            const { title, message } = template(workOrder, extra);
            const email = workOrder.customer_email || null;
            const notification = {
                notification_id: createId(),
                customer_id: workOrder.customer_id,
                work_order_id: workOrder.work_order_id,
                type,
                title,
                message,
                email_status: !email ? "NO_EMAIL" : mailer.configured ? "PENDING" : "NOT_CONFIGURED",
                read_at: null,
                created_at: now()
            };
            await notificationRepository.insert(notification);
            if (email && mailer.configured) {
                const link = webBaseUrl
                    ? `\n\nดูรายละเอียด: ${webBaseUrl.replace(/\/$/, "")}/my/repairs/${workOrder.work_order_id}`
                    : "";
                const status = await mailer.send({
                    to: email,
                    subject: `[SmartFix] ${title}`,
                    text: `${message}${link}`
                });
                await notificationRepository.setEmailStatus(notification.notification_id, status);
                notification.email_status = status;
            }
            return notification;
        } catch (error) {
            logger.error(`Notification ${type} for ${workOrder?.work_order_id} failed: ${error.message}`);
            return null;
        }
    }

    async function listMine(user) {
        return notificationRepository.listForCustomer(user.userId);
    }

    async function markRead(input, user) {
        const parsed = markReadSchema.safeParse(input || {});
        if (!parsed.success) {
            throw new AppError("Invalid notification ids", 400);
        }
        const updated = await notificationRepository.markRead(user.userId, parsed.data.ids || [], now());
        return { updated: Number(updated) || 0 };
    }

    return {
        notify,
        listMine,
        markRead
    };
}

module.exports = {
    createNotificationService,
    NOTIFICATION_TYPES: Object.keys(TEMPLATES)
};
