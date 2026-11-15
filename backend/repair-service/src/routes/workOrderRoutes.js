const express = require("express");
const { PERMISSIONS } = require("../../../shared/constants");
const { requireAnyPermission } = require("../../../shared/middleware/serviceAuth");
const { createWorkOrderController } = require("../controllers/workOrderController");

function createWorkOrderRouter({ workOrderService, authenticate }) {
    if (!workOrderService || typeof authenticate !== "function") {
        throw new Error("Work order service and authenticate middleware are required");
    }

    const router = express.Router();
    const controller = createWorkOrderController(workOrderService);

    router.post(
        "/work-orders",
        authenticate,
        requireAnyPermission(PERMISSIONS.WORK_ORDER_RECEIVE_CREATE),
        controller.createFromBooking
    );
    router.post(
        "/work-orders/walk-in",
        authenticate,
        requireAnyPermission(PERMISSIONS.WORK_ORDER_RECEIVE_CREATE),
        controller.createWalkIn
    );
    router.get(
        "/work-orders/me",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_HISTORY_VIEW_OWN),
        controller.listMine
    );
    router.get(
        "/work-orders/assigned",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_HISTORY_VIEW_ASSIGNED),
        controller.listAssigned
    );
    router.post(
        "/work-orders/:workOrderId/assign",
        authenticate,
        requireAnyPermission(PERMISSIONS.WORK_ORDER_ASSIGN_TECHNICIAN),
        controller.assignTechnician
    );
    router.post(
        "/work-orders/:workOrderId/diagnosis/start",
        authenticate,
        requireAnyPermission(PERMISSIONS.DIAGNOSIS_RECORD),
        controller.startDiagnosis
    );
    router.put(
        "/work-orders/:workOrderId/diagnosis",
        authenticate,
        requireAnyPermission(PERMISSIONS.DIAGNOSIS_RECORD),
        controller.saveDiagnosis
    );
    router.post(
        "/work-orders/:workOrderId/quotations",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_ITEM_PROPOSE),
        controller.proposeItems
    );
    router.put(
        "/quotations/:quotationId/send",
        authenticate,
        requireAnyPermission(PERMISSIONS.QUOTATION_SET_PRICE),
        controller.priceAndSend
    );
    router.post(
        "/quotations/:quotationId/revise",
        authenticate,
        requireAnyPermission(PERMISSIONS.QUOTATION_SET_PRICE),
        controller.reviseQuotation
    );
    router.post(
        "/quotations/:quotationId/decision",
        authenticate,
        requireAnyPermission(
            PERMISSIONS.QUOTATION_APPROVE_OWN,
            PERMISSIONS.QUOTATION_REJECT_OWN,
            PERMISSIONS.QUOTATION_APPROVE_WALK_IN
        ),
        controller.decideQuotation
    );
    router.post(
        "/work-orders/:workOrderId/repair/start",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_START),
        controller.startRepair
    );
    router.put(
        "/work-orders/:workOrderId/repair/result",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_RESULT_RECORD),
        controller.recordResult
    );
    router.post(
        "/work-orders/:workOrderId/tests",
        authenticate,
        requireAnyPermission(PERMISSIONS.TEST_RESULT_RECORD),
        controller.recordTest
    );
    router.post(
        "/work-orders/:workOrderId/handover",
        authenticate,
        requireAnyPermission(PERMISSIONS.HANDOVER_COMPLETE),
        controller.handover
    );
    router.post(
        "/work-orders/:workOrderId/cancel",
        authenticate,
        requireAnyPermission(PERMISSIONS.WORK_ORDER_ASSIGN_TECHNICIAN),
        controller.cancel
    );
    router.get(
        "/parts/movements",
        authenticate,
        requireAnyPermission(PERMISSIONS.INVENTORY_ISSUE),
        controller.listStockMovements
    );
    router.get(
        "/parts",
        authenticate,
        requireAnyPermission(
            PERMISSIONS.INVENTORY_ISSUE,
            PERMISSIONS.INVENTORY_PART_PROPOSE
        ),
        controller.listParts
    );
    router.post(
        "/parts",
        authenticate,
        requireAnyPermission(PERMISSIONS.INVENTORY_ISSUE),
        controller.createPart
    );
    router.post(
        "/parts/:partId/receive",
        authenticate,
        requireAnyPermission(PERMISSIONS.INVENTORY_ISSUE),
        controller.receivePart
    );
    router.post(
        "/work-orders/:workOrderId/parts/issue",
        authenticate,
        requireAnyPermission(PERMISSIONS.INVENTORY_ISSUE),
        controller.issueParts
    );
    router.get(
        "/work-orders",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_HISTORY_VIEW_ALL),
        controller.listAll
    );
    router.get(
        "/work-orders/:workOrderId",
        authenticate,
        requireAnyPermission(
            PERMISSIONS.REPAIR_HISTORY_VIEW_OWN,
            PERMISSIONS.REPAIR_HISTORY_VIEW_ASSIGNED,
            PERMISSIONS.REPAIR_HISTORY_VIEW_ALL
        ),
        controller.get
    );

    return router;
}

module.exports = createWorkOrderRouter;