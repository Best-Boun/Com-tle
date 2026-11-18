function present(row) {
    return {
        notification_id: row.notification_id,
        work_order_id: row.work_order_id,
        type: row.type,
        title: row.title,
        message: row.message,
        email_status: row.email_status,
        read_at: row.read_at,
        created_at: row.created_at
    };
}

function createNotificationRepository(db) {
    return {
        async insert(notification) {
            await db("customer_notifications").insert(notification);
        },

        async setEmailStatus(notificationId, emailStatus) {
            await db("customer_notifications")
                .where({ notification_id: notificationId })
                .update({ email_status: emailStatus });
        },

        async listForCustomer(customerId, limit = 50) {
            const [rows, [{ unread }]] = await Promise.all([
                db("customer_notifications")
                    .where({ customer_id: customerId })
                    .orderBy([{ column: "created_at", order: "desc" }, { column: "notification_id", order: "asc" }])
                    .limit(limit),
                db("customer_notifications")
                    .where({ customer_id: customerId })
                    .whereNull("read_at")
                    .count({ unread: "*" })
            ]);
            return { items: rows.map(present), unread: Number(unread) };
        },

        /** Marks the given ids (or everything when ids is empty) as read. */
        async markRead(customerId, ids, readAt) {
            const query = db("customer_notifications")
                .where({ customer_id: customerId })
                .whereNull("read_at");
            if (ids.length > 0) {
                query.whereIn("notification_id", ids);
            }
            return query.update({ read_at: readAt });
        }
    };
}

module.exports = {
    createNotificationRepository
};
