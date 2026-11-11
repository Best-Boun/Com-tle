/**
 * Single entry point for all data access.
 *
 * Today every call goes to the in-browser demo backend (./mock).
 * When the real services are reachable through the API Gateway, add an
 * implementation with the same function names (e.g. ./http/bookings.js)
 * and switch per module here — pages don't need to change.
 */
import * as mock from "./mock/index.js";

export const api = {
    auth: mock.auth,
    catalog: mock.catalog,
    bookings: mock.bookings,
    repairs: mock.repairs,
    inventory: mock.inventory,
    payments: mock.payments,
    dashboard: mock.dashboard,
    demo: mock.demo
};

export const USING_MOCK = true;
