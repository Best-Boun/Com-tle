/**
 * Single entry point for all data access.
 *
 * Every module uses the in-browser demo backend (./mock) unless
 * VITE_USE_MOCK=false, in which case modules that have a real implementation
 * (./http/*) call the API Gateway instead. Pages don't need to change.
 * Real implementations today: auth and payments.
 */
import * as mock from "./mock/index.js";
import { auth as httpAuth } from "./http/auth.js";
import { payments as httpPayments, setWorkOrderLoader } from "./http/payments.js";

export const USING_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

// Work orders are still demo data. With real payments, a work order page first
// pulls that work order's Payment-Service records so its balance is current.
const repairs = USING_MOCK ? mock.repairs : {
    ...mock.repairs,
    async get(workOrderId) {
        await httpPayments.sync(workOrderId);
        return mock.repairs.get(workOrderId);
    }
};
if (!USING_MOCK) {
    setWorkOrderLoader((workOrderId) => mock.repairs.get(workOrderId));
}

export const api = {
    auth: USING_MOCK ? mock.auth : httpAuth,
    catalog: mock.catalog,
    bookings: mock.bookings,
    repairs,
    inventory: mock.inventory,
    payments: USING_MOCK ? mock.payments : httpPayments,
    dashboard: mock.dashboard,
    demo: mock.demo
};
