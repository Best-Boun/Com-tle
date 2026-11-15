const { successResponse } = require("../../../shared/utils/responseFormatter");

function handle(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res);
        } catch (error) {
            next(error);
        }
    };
}

function createWorkOrderController(workOrderService) {
    return {
        createFromBooking: handle(async (req, res) => {
            const workOrder = await workOrderService.createFromBooking(req.body, req.user);
            res.status(201).json(successResponse("Work order created", workOrder));
        }),

        createWalkIn: handle(async (req, res) => {
            const workOrder = await workOrderService.createWalkIn(req.body, req.user);
            res.status(201).json(successResponse("Walk-in work order created", workOrder));
        }),

        listMine: handle(async (req, res) => {
            const workOrders = await workOrderService.listMine(req.user);
            res.status(200).json(successResponse("Work orders retrieved", workOrders));
        }),

        listAssigned: handle(async (req, res) => {
            const workOrders = await workOrderService.listAssigned(req.user);
            res.status(200).json(successResponse("Assigned work orders retrieved", workOrders));
        }),

        assignTechnician: handle(async (req, res) => {
            const workOrder = await workOrderService.assignTechnician(
                req.params.workOrderId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Technician assigned", workOrder));
        }),

        startDiagnosis: handle(async (req, res) => {
            const workOrder = await workOrderService.startDiagnosis(
                req.params.workOrderId,
                req.user
            );
            res.status(200).json(successResponse("Diagnosis started", workOrder));
        }),

        saveDiagnosis: handle(async (req, res) => {
            const workOrder = await workOrderService.saveDiagnosis(
                req.params.workOrderId,
                req.body.diagnosis,
                req.user
            );
            res.status(200).json(successResponse("Diagnosis saved", workOrder));
        }),

        proposeItems: handle(async (req, res) => {
            const workOrder = await workOrderService.proposeItems(
                req.params.workOrderId,
                req.body,
                req.user
            );
            res.status(201).json(successResponse("Repair items proposed", workOrder));
        }),

        priceAndSend: handle(async (req, res) => {
            const workOrder = await workOrderService.priceAndSend(
                req.params.quotationId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Quotation sent", workOrder));
        }),

        reviseQuotation: handle(async (req, res) => {
            const workOrder = await workOrderService.reviseQuotation(
                req.params.quotationId,
                req.user
            );
            res.status(201).json(successResponse("Quotation revision created", workOrder));
        }),

        decideQuotation: handle(async (req, res) => {
            const workOrder = await workOrderService.decideQuotation(
                req.params.quotationId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Quotation decision saved", workOrder));
        }),

        startRepair: handle(async (req, res) => {
            const workOrder = await workOrderService.startRepair(
                req.params.workOrderId,
                req.user
            );
            res.status(200).json(successResponse("Repair started", workOrder));
        }),

        recordResult: handle(async (req, res) => {
            const workOrder = await workOrderService.recordResult(
                req.params.workOrderId,
                req.body.result,
                req.user
            );
            res.status(200).json(successResponse("Repair result recorded", workOrder));
        }),

        recordTest: handle(async (req, res) => {
            const workOrder = await workOrderService.recordTest(
                req.params.workOrderId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Test result recorded", workOrder));
        }),

        handover: handle(async (req, res) => {
            const workOrder = await workOrderService.handover(
                req.params.workOrderId,
                req.body,
                req.user,
                req.get("authorization")
            );
            res.status(200).json(successResponse("Device handed over", workOrder));
        }),

        cancel: handle(async (req, res) => {
            const workOrder = await workOrderService.cancel(
                req.params.workOrderId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Work order cancelled", workOrder));
        }),

        listParts: handle(async (req, res) => {
            const parts = await workOrderService.listParts(req.user);
            res.status(200).json(successResponse("Parts retrieved", parts));
        }),

        createPart: handle(async (req, res) => {
            const part = await workOrderService.createPart(req.body, req.user);
            res.status(201).json(successResponse("Part created", part));
        }),

        receivePart: handle(async (req, res) => {
            const part = await workOrderService.receivePart(
                req.params.partId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Stock received", part));
        }),

        listStockMovements: handle(async (req, res) => {
            const movements = await workOrderService.listStockMovements(req.query, req.user);
            res.status(200).json(successResponse("Stock movements retrieved", movements));
        }),

        issueParts: handle(async (req, res) => {
            const workOrder = await workOrderService.issueParts(
                req.params.workOrderId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Parts issued", workOrder));
        }),

        listAll: handle(async (req, res) => {
            const workOrders = await workOrderService.listAll(req.query);
            res.status(200).json(successResponse("Work orders retrieved", workOrders));
        }),

        get: handle(async (req, res) => {
            const workOrder = await workOrderService.get(req.params.workOrderId, req.user);
            res.status(200).json(successResponse("Work order retrieved", workOrder));
        })
    };
}

module.exports = {
    createWorkOrderController
};