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
    proposeItems: (id, input) => refreshLiveResult(httpRepairs.proposeItems(id, input)),
    priceAndSend: (id, input) => refreshLiveResult(httpRepairs.priceAndSend(id, input)),
    reviseQuotation: (id) => refreshLiveResult(httpRepairs.reviseQuotation(id)),
    decideQuotation: (id, input) => refreshLiveResult(httpRepairs.decideQuotation(id, input)),
    startRepair: (id) => refreshLiveResult(httpRepairs.startRepair(id)),
    recordResult: (id, result) => refreshLiveResult(httpRepairs.recordResult(id, result)),
    recordTest: (id, input) => refreshLiveResult(httpRepairs.recordTest(id, input)),
    handover: async (id, input) => {
        await httpPayments.ensureBill(id);
        return refreshLiveResult(httpRepairs.handover(id, input));
    },
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
            bookings_to_confirm: bookings.bookings_to_confirm,
            open_work_orders: workOrders.filter((workOrder) => OPEN_WORK_ORDER_STATUSES.includes(workOrder.status)).length,
            waiting_approval: count("WAITING_APPROVAL"),
            drafts_to_price: workOrders.reduce(
                (total, workOrder) => total + (workOrder.has_draft_quotation ? 1 : 0),
                0
            ),
            ready_for_handover: workOrders.filter(
                (workOrder) => workOrder.status === "COMPLETED" && !workOrder.handed_over_at
            ).length,
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
