/**
 * Single entry point for all data access.
 *
 * Every module uses the in-browser demo backend (./mock) unless
 * VITE_USE_MOCK=false, in which case modules that have a real implementation
 * (./http/*) call the API Gateway instead. Pages don't need to change.
 * Real implementations today: auth, staff accounts, payments, bookings, catalog,
 * the repair workflow and repair parts inventory.
 */
import * as mock from "./mock/index.js";
import { auth as httpAuth } from "./http/auth.js";
import { payments as httpPayments, serviceDown, setWorkOrderLoader } from "./http/payments.js";
import { bookings as httpBookings } from "./http/bookings.js";
import { catalog as httpCatalog } from "./http/catalog.js";
import { staff as httpStaff } from "./http/staff.js";
import { inventory as httpInventory, repairs as httpRepairs } from "./http/repairs.js";

export const USING_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

async function loadLiveWorkOrder(workOrderId) {
    const workOrder = await httpRepairs.get(workOrderId);
    return { ...workOrder, ...await httpPayments.detailsFor(workOrder) };
}

async function refreshLiveResult(promise) {
    const workOrder = await promise;
    return loadLiveWorkOrder(workOrder.work_order_id);
}

const repairs = USING_MOCK ? mock.repairs : {
    ...httpRepairs,
    get: loadLiveWorkOrder,
    assignTechnician: (id, technicianId) => refreshLiveResult(
        httpRepairs.assignTechnician(id, technicianId)
    ),
    startDiagnosis: (id) => refreshLiveResult(httpRepairs.startDiagnosis(id)),
    saveDiagnosis: (id, diagnosis) => refreshLiveResult(httpRepairs.saveDiagnosis(id, diagnosis)),
    proposeQuotation: (id, input) => refreshLiveResult(httpRepairs.proposeQuotation(id, input)),
    decideQuotation: (id, input) => refreshLiveResult(httpRepairs.decideQuotation(id, input)),
    waitForParts: (id, note) => refreshLiveResult(httpRepairs.waitForParts(id, note)),
    startRepair: (id) => refreshLiveResult(httpRepairs.startRepair(id)),
    recordResult: (id, result) => refreshLiveResult(httpRepairs.recordResult(id, result)),
    recordTest: (id, input) => refreshLiveResult(httpRepairs.recordTest(id, input)),
    // Repair-Service brings the bill up to date itself before checking the balance.
    handover: (id, input) => refreshLiveResult(httpRepairs.handover(id, input)),
    cancel: (id, input) => refreshLiveResult(httpRepairs.cancel(id, input))
};

const inventory = USING_MOCK ? mock.inventory : {
    ...httpInventory,
    issueForWorkOrder: (id, input) => refreshLiveResult(
        httpInventory.issueForWorkOrder(id, input)
    )
};

if (!USING_MOCK) setWorkOrderLoader(loadLiveWorkOrder);

const OPEN_WORK_ORDER_STATUSES = [
    "PENDING",
    "DIAGNOSING",
    "WAITING_APPROVAL",
    "APPROVED",
    "WAITING_PARTS",
    "REPAIRING",
    "TESTING"
];

const dashboard = USING_MOCK ? mock.dashboard : {
    async summary() {
        const [bookings, workOrders, parts, outstandingTotal] = await Promise.all([
            httpBookings.dashboardFigures(),
            httpRepairs.listAll(),
            httpInventory.listParts(),
            // Payment-Service down: the rest of the dashboard still shows.
            httpPayments.outstandingTotal().catch((error) => {
                if (serviceDown(error)) return null;
                throw error;
            })
        ]);
        const count = (status) => workOrders.filter((workOrder) => workOrder.status === status).length;
        const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        return {
            today,
            bookings_today: bookings.bookings_today,
            bookings_overdue: bookings.bookings_overdue,
            open_work_orders: workOrders.filter((workOrder) => OPEN_WORK_ORDER_STATUSES.includes(workOrder.status)).length,
            waiting_approval: count("WAITING_APPROVAL"),
            waiting_parts: count("WAITING_PARTS"),
            ready_for_handover: workOrders.filter(
                (workOrder) => workOrder.status === "COMPLETED" && !workOrder.handed_over_at
            ).length,
            // Free storage is over: the shop should call these customers.
            overdue_pickups: workOrders
                .filter((workOrder) => workOrder.pickup?.overdue && !workOrder.handed_over_at)
                .sort((a, b) => b.pickup.days_overdue - a.pickup.days_overdue),
            unassigned: workOrders.filter(
                (workOrder) => OPEN_WORK_ORDER_STATUSES.includes(workOrder.status) && !workOrder.technician_id
            ).length,
            low_stock: parts.filter((part) => part.stock <= part.reorder_level),
            outstanding_total: outstandingTotal,
            upcoming: bookings.upcoming,
            work_by_status: OPEN_WORK_ORDER_STATUSES.map((status) => ({
                status,
                count: count(status)
            }))
        };
    }
};

export const api = {
    auth: USING_MOCK ? mock.auth : httpAuth,
    staff: USING_MOCK ? mock.staff : httpStaff,
    catalog: USING_MOCK ? mock.catalog : httpCatalog,
    bookings: USING_MOCK ? mock.bookings : httpBookings,
    repairs,
    inventory,
    payments: USING_MOCK ? mock.payments : httpPayments,
    dashboard,
    demo: mock.demo
};
