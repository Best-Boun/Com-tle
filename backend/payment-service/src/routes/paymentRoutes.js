const express = require("express");
const { successResponse } = require("../../../shared/utils/responseFormatter");

// Public paths (through the Gateway they sit under /api/payments):
//   POST /                         record a payment        (Idempotency-Key)
//   GET  /                         list payments           (payment.view_all)
//   POST /:paymentId/void          void a payment
//   POST /bills                    register an issued bill (manual until Repair-Service)
//   GET  /balances                 all balances            (payment.view_all)
//   GET  /balances/:workOrderId    one balance             (admin or owning customer)
//   POST /refunds                  request a refund        (Idempotency-Key)
//   GET  /refunds                  list refunds            (payment.view_all)
//   POST /refunds/:refundId/approve|reject|execute
//   POST /work-orders/:workOrderId/lock|unlock   stop or allow new payments (reason)
//   GET  /my                       the caller's own bills and payments
function createPaymentRouter({ paymentService, requireUserAuth }) {
    if (!paymentService || typeof requireUserAuth !== "function") {
        throw new Error("Payment service and user authentication are required");
    }
    const router = express.Router();
    router.use(requireUserAuth);

    const handle = (status, message, action) => async (req, res, next) => {
        try {
            res.status(status).json(successResponse(message, await action(req)));
        } catch (error) {
            next(error);
        }
    };
    const key = (req) => req.get("idempotency-key");

    router.post("/", handle(201, "Payment recorded",
        (req) => paymentService.recordPayment(req.auth, req.body, key(req))));
    router.get("/", handle(200, "Payments",
        (req) => paymentService.listPayments(req.auth, { ...req.query })));
    router.post("/bills", handle(201, "Bill registered",
        (req) => paymentService.registerBill(req.auth, req.body)));
    router.get("/balances", handle(200, "Balances",
        (req) => paymentService.listBalances(req.auth)));
    router.get("/balances/:workOrderId", handle(200, "Balance",
        (req) => paymentService.getBalance(req.auth, req.params.workOrderId)));
    router.post("/work-orders/:workOrderId/lock", handle(200, "Payments locked",
        (req) => paymentService.lockWorkOrderPayments(req.auth, req.params.workOrderId, req.body)));
    router.post("/work-orders/:workOrderId/unlock", handle(200, "Payments unlocked",
        (req) => paymentService.unlockWorkOrderPayments(req.auth, req.params.workOrderId, req.body)));
    router.get("/my", handle(200, "My payments",
        (req) => paymentService.listMyPayments(req.auth)));
    router.post("/refunds", handle(201, "Refund requested",
        (req) => paymentService.requestRefund(req.auth, req.body, key(req))));
    router.get("/refunds", handle(200, "Refunds",
        (req) => paymentService.listRefunds(req.auth, { ...req.query })));
    router.post("/refunds/:refundId/approve", handle(200, "Refund approved",
        (req) => paymentService.approveRefund(req.auth, req.params.refundId)));
    router.post("/refunds/:refundId/reject", handle(200, "Refund rejected",
        (req) => paymentService.rejectRefund(req.auth, req.params.refundId, req.body)));
    router.post("/refunds/:refundId/execute", handle(200, "Refund completed",
        (req) => paymentService.executeRefund(req.auth, req.params.refundId)));
    router.post("/:paymentId/void", handle(200, "Payment voided",
        (req) => paymentService.voidPayment(req.auth, req.params.paymentId, req.body)));

    return router;
}

module.exports = {
    createPaymentRouter
};
