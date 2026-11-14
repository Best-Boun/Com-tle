/**
 * Single entry point for all data access.
 *
 * Every module uses the in-browser demo backend (./mock) unless
 * VITE_USE_MOCK=false, in which case modules that have a real implementation
 * (./http/*) call the API Gateway instead. Pages don't need to change.
 * Real implementations today: auth only.
 */
import * as mock from "./mock/index.js";
import { auth as httpAuth } from "./http/auth.js";

export const USING_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

export const api = {
    auth: USING_MOCK ? mock.auth : httpAuth,
    catalog: mock.catalog,
    bookings: mock.bookings,
    repairs: mock.repairs,
    inventory: mock.inventory,
    payments: mock.payments,
    dashboard: mock.dashboard,
    demo: mock.demo
};
