/**
 * Single entry point for all data access.
 *
 * Every module uses the in-browser demo backend (./mock) unless
 * VITE_USE_MOCK=false, in which case modules that have a real implementation
 * (./http/*) call the API Gateway instead. Pages don't need to change.
 * Real implementations today: auth, payments, bookings and catalog.
 */
import * as mock from "./mock/index.js";
import { auth as httpAuth } from "./http/auth.js";
import { payments as httpPayments, setWorkOrderLoader } from "./http/payments.js";
import { bookings as httpBookings } from "./http/bookings.js";
import { catalog as httpCatalog } from "./http/catalog.js";

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

// The dashboard still reads work orders and parts from demo data; its booking
// figures come from Booking-Service.
const dashboard = USING_MOCK ? mock.dashboard : {
    async summary() {
        const [demo, real] = await Promise.all([mock.dashboard.summary(), httpBookings.dashboardFigures()]);
        return { ...demo, ...real };
    }
};

export const api = {
    auth: USING_MOCK ? mock.auth : httpAuth,
    catalog: USING_MOCK ? mock.catalog : httpCatalog,
    bookings: USING_MOCK ? mock.bookings : httpBookings,
    repairs,
    inventory: mock.inventory,
    payments: USING_MOCK ? mock.payments : httpPayments,
    dashboard,
    demo: mock.demo
};
