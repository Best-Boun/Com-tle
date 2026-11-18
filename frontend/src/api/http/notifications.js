/** Task 13: the signed-in customer's notifications (Repair-Service, /api/repairs/notifications). */
import { request } from "./client.js";

export const notifications = {
    listMine() {
        return request("/repairs/notifications/me");
    },

    /** No ids = mark everything as read. */
    markRead(ids = []) {
        return request("/repairs/notifications/me/read", {
            method: "POST",
            body: ids.length > 0 ? { ids } : {}
        });
    }
};
