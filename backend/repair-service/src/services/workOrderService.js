const { randomUUID } = require("node:crypto");
const AppError = require("../../../shared/errors/AppError");
const { PERMISSIONS } = require("../../../shared/constants");
const { hasPermission } = require("../../../shared/middleware/serviceAuth");
const {
    createBookingWorkOrderSchema,
    listWorkOrdersSchema,
    assignTechnicianSchema,
    createWalkInSchema,
    diagnosisSchema,
    proposeItemsSchema,
    priceAndSendSchema,
    decisionSchema,
    testResultSchema,
    handoverSchema,
    cancelSchema,
    createPartSchema,
    receivePartSchema,
    issuePartSchema,
    partMovementQuerySchema
} = require("../validators/workOrderSchemas");

const API_STATUSES = {
    RECEIVED: "PENDING",
    DIAGNOSING: "DIAGNOSING",
    WAITING_APPROVAL: "WAITING_APPROVAL",
    APPROVED: "APPROVED",
    WAITING_PARTS: "APPROVED",
    IN_REPAIR: "REPAIRING",
    TESTING: "TESTING",
    RETURN_PENDING: "COMPLETED",
    HANDED_OVER: "COMPLETED",
    ABANDONED: "CANCELLED"
};

function mapStatus(status) {
    if (status === null || status === undefined) {
        return null;
    }
    if (!Object.hasOwn(API_STATUSES, status)) {
        throw new Error(`Unsupported work-order status: ${status}`);
    }
    return API_STATUSES[status];
}

function createWorkOrderService({
    workOrderRepository,
    getPaymentBalance,
    createId = randomUUID,
    now = () => new Date()
} = {}) {
    if (!workOrderRepository) {
        throw new Error("Work order repository is required");
    }

    function present(workOrder, fallbackHistory = []) {
        return {
            payment: {
                due: 0,
                paid: 0,
                refunded: 0,
                net_paid: 0,
                balance: 0,
                status: "UNPAID"
            },
            ...workOrder,
            status: mapStatus(workOrder.status),
            work_order_number: workOrder.work_order_number
                || `WO-${workOrder.work_order_id.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
            created_at: workOrder.received_at || workOrder.created_at,
            technician_name: workOrder.technician_name || null,
            has_pending_quotation: workOrder.has_pending_quotation || false,
            quotations: workOrder.quotations || [],
            payments: workOrder.payments || [],
            parts: workOrder.parts || [],
            stock_movements: workOrder.stock_movements || [],
            cancellation: workOrder.cancellation || null,
            handover_exception: workOrder.handover_exception || null,
            test_result: workOrder.test_result || null,
            history: (workOrder.history || fallbackHistory).map((entry) => ({
                id: entry.history_id,
                work_order_id: entry.work_order_id,
                old_status: mapStatus(entry.old_status),
                new_status: mapStatus(entry.new_status),
                changed_by: entry.changed_by_user_id || entry.changed_by || null,
                changed_by_name: null,
                note: entry.reason || entry.note || null,
                created_at: entry.created_at
            }))
        };
    }

    function canView(workOrder, user) {
        return hasPermission(user, PERMISSIONS.REPAIR_HISTORY_VIEW_ALL)
            || (
                workOrder.technician_id === user.userId
                && hasPermission(user, PERMISSIONS.REPAIR_HISTORY_VIEW_ASSIGNED)
            )
            || (
                workOrder.customer_id === user.userId
                && hasPermission(user, PERMISSIONS.REPAIR_HISTORY_VIEW_OWN)
            );
    }

    async function createFromBooking(input, user) {
        const parsed = createBookingWorkOrderSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid work order details", 400);
        }

        const booking = parsed.data;
        const existing = await workOrderRepository.findByBookingId(booking.booking_id);
        if (existing) {
            return present(existing);
        }

        const createdAt = now();
        const workOrderId = createId();
        const workOrderNumber = `WO-${createdAt.toISOString().slice(0, 10).replace(/-/g, "")}-${workOrderId.slice(0, 6).toUpperCase()}`;
        const workOrder = {
            work_order_id: workOrderId,
            work_order_number: workOrderNumber,
            source: "BOOKING",
            booking_id: booking.booking_id,
            booking_number: booking.booking_number,
            customer_id: booking.customer_id,
            customer_name: null,
            customer_phone: null,
            service_id: booking.service_id,
            service_code: booking.service_code,
            service_name: booking.service_name,
            device_type: booking.device_type,
            brand: booking.brand || null,
            model: booking.model || null,
            serial_number: booking.serial_number || null,
            accessories: booking.accessories || null,
            reported_symptom: booking.reported_symptom,
            status: "RECEIVED",
            technician_id: null,
            intake_terms_acknowledged_at: booking.intake_terms_acknowledged ? createdAt : null,
            received_at: createdAt,
            created_at: createdAt,
            updated_at: createdAt
        };
        workOrder.device_id = createId();
        const initialHistory = {
            history_id: createId(),
            work_order_id: workOrderId,
            old_status: null,
            new_status: "RECEIVED",
            changed_by_user_id: user.userId,
            reason: "Device received",
            created_at: createdAt
        };

        try {
            await workOrderRepository.create(workOrder, initialHistory);
        } catch (error) {
            if (error.code !== "ER_DUP_ENTRY") {
                throw error;
            }
            const duplicate = await workOrderRepository.findByBookingId(booking.booking_id);
            if (!duplicate) {
                throw error;
            }
            return present(duplicate);
        }

        // A technician took this booking in the queue: the job goes straight to
        // them. If that fails the work order still stands; the shop assigns it.
        if (booking.technician_user_id) {
            try {
                const result = await workOrderRepository.assignTechnician(
                    workOrderId,
                    booking.technician_user_id
                );
                if (result?.workOrder) {
                    return present(result.workOrder);
                }
            } catch {
                // keep the unassigned work order
            }
        }

        return present(workOrder, [initialHistory]);
    }

    async function listMine(user) {
        const items = await workOrderRepository.listMine(user.userId);
        return items.map((item) => present(item));
    }

    async function listAssigned(user) {
        const items = await workOrderRepository.listAssigned(user.userId);
        return items.map((item) => present(item));
    }

    async function assignTechnician(workOrderId, input, user) {
        const parsed = assignTechnicianSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid technician assignment", 400);
        }
        requirePermission(user, PERMISSIONS.WORK_ORDER_ASSIGN_TECHNICIAN);

        const result = await workOrderRepository.assignTechnician(
            workOrderId,
            parsed.data.technician_user_id
        );
        if (result.notFound) {
            throw new AppError("Work order not found", 404);
        }
        if (result.closed) {
            throw new AppError("Cannot assign a technician to a closed work order", 409);
        }
        return present(result.workOrder);
    }

    async function listAll(query) {
        const parsed = listWorkOrdersSchema.safeParse(query);
        if (!parsed.success) {
            throw new AppError("Invalid work order query", 400);
        }
        const items = await workOrderRepository.listAll(parsed.data);
        return items.map((item) => present(item));
    }

    async function get(workOrderId, user) {
        const workOrder = await workOrderRepository.findById(workOrderId);
        if (!workOrder || !canView(workOrder, user)) {
            throw new AppError("Work order not found", 404);
        }
        const history = await workOrderRepository.findHistory(workOrderId);
        return present(workOrder, history);
    }

    function parseInput(schema, input, message) {
        const parsed = schema.safeParse(input);
        if (!parsed.success) {
            throw new AppError(message, 400);
        }
        return parsed.data;
    }

    function requirePermission(user, permission) {
        if (!hasPermission(user, permission)) {
            throw new AppError("You do not have permission", 403);
        }
    }

    function unwrapResult(result) {
        if (result.notFound || result.partNotFound) {
            throw new AppError("Work order or part not found", 404);
        }
        if (result.notAssigned || result.forbidden) {
            throw new AppError("You do not have permission for this work order", 403);
        }
        if (result.missingDiagnosis) {
            throw new AppError("Record the diagnosis before proposing repair items", 409);
        }
        if (result.missingTest) {
            throw new AppError("A passing test is required before handover", 409);
        }
        if (result.pendingQuotation) {
            throw new AppError("A quotation is still awaiting a customer decision", 409);
        }
        if (result.insufficientStock) {
            throw new AppError(`Insufficient stock (${result.stock} available)`, 409);
        }
        if (result.overAllowance) {
            throw new AppError(`Issue quantity exceeds approved allowance (${result.remaining} remaining)`, 409);
        }
        if (result.conflict || result.closed) {
            throw new AppError(
                result.status
                    ? `Work order cannot be changed while status is ${result.status}`
                    : "This workflow step is no longer available",
                409
            );
        }
        return result.workOrder || result.part;
    }

    async function createWalkIn(input, user) {
        requirePermission(user, PERMISSIONS.WORK_ORDER_RECEIVE_CREATE);
        const data = parseInput(createWalkInSchema, input, "Invalid walk-in details");
        const createdAt = now();
        const workOrderId = createId();
        const workOrder = {
            work_order_id: workOrderId,
            work_order_number: `WO-${createdAt.toISOString().slice(0, 10).replace(/-/g, "")}-${workOrderId.slice(0, 6).toUpperCase()}`,
            customer_id: createId(),
            customer_name: data.customer_name,
            customer_phone: data.customer_phone,
            service_id: data.service_id || null,
            service_code: data.service_code || null,
            service_name: data.service_name || null,
            device_type: data.device_type,
            brand: data.brand || null,
            model: data.model || null,
            serial_number: data.serial_number || null,
            reported_symptom: data.reported_symptom,
            accessories: data.accessories || null,
            intake_terms_acknowledged_at: data.intake_terms_acknowledged ? createdAt : null,
            device_id: createId(),
            received_at: createdAt,
            created_at: createdAt,
            updated_at: createdAt
        };
        const initialHistory = {
            history_id: createId(),
            work_order_id: workOrderId,
            old_status: null,
            new_status: "RECEIVED",
            changed_by_user_id: user.userId,
            reason: "Walk-in device received",
            created_at: createdAt
        };
        return present(await workOrderRepository.createWalkIn(workOrder, initialHistory));
    }

    async function runTechnicianStep(method, workOrderId, user, ...args) {
        const result = await workOrderRepository[method](workOrderId, user.userId, ...args);
        return present(unwrapResult(result));
    }

    async function startDiagnosis(workOrderId, user) {
        requirePermission(user, PERMISSIONS.DIAGNOSIS_RECORD);
        return runTechnicianStep("startDiagnosis", workOrderId, user);
    }

    async function saveDiagnosis(workOrderId, diagnosis, user) {
        requirePermission(user, PERMISSIONS.DIAGNOSIS_RECORD);
        const parsed = parseInput(diagnosisSchema, diagnosis, "Invalid diagnosis");
        return runTechnicianStep("saveDiagnosis", workOrderId, user, parsed);
    }

    async function proposeItems(workOrderId, input, user) {
        requirePermission(user, PERMISSIONS.REPAIR_ITEM_PROPOSE);
        const data = parseInput(proposeItemsSchema, input, "Invalid proposed repair items");
        return runTechnicianStep("proposeItems", workOrderId, user, data, data.items);
    }

    async function priceAndSend(quotationId, input, user) {
        requirePermission(user, PERMISSIONS.QUOTATION_SET_PRICE);
        const data = parseInput(priceAndSendSchema, input, "Invalid quotation prices");
        if (!data.items.some((item) => item.unit_price > 0)) {
            throw new AppError("Quotation total must be greater than zero", 400);
        }
        const result = unwrapResult(await workOrderRepository.priceAndSend(
            quotationId,
            user.userId,
            data.items,
            data.note
        ));
        return present(result);
    }

    async function reviseQuotation(quotationId, user) {
        requirePermission(user, PERMISSIONS.QUOTATION_SET_PRICE);
        return present(unwrapResult(
            await workOrderRepository.reviseQuotation(quotationId, user.userId)
        ));
    }

    async function decideQuotation(quotationId, input, user) {
        const data = parseInput(decisionSchema, input, "Invalid quotation decision");
        requirePermission(
            user,
            user.roles.includes("ADMIN")
                ? PERMISSIONS.QUOTATION_APPROVE_WALK_IN
                : data.approve
                    ? PERMISSIONS.QUOTATION_APPROVE_OWN
                    : PERMISSIONS.QUOTATION_REJECT_OWN
        );
        const result = unwrapResult(await workOrderRepository.decideQuotation(
            quotationId,
            user,
            data.approve,
            data.note
        ));
        return present(result);
    }

    async function startRepair(workOrderId, user) {
        requirePermission(user, PERMISSIONS.REPAIR_START);
        return runTechnicianStep("startRepair", workOrderId, user);
    }

    async function recordResult(workOrderId, repairResult, user) {
        requirePermission(user, PERMISSIONS.REPAIR_RESULT_RECORD);
        const parsed = parseInput(diagnosisSchema, repairResult, "Invalid repair result");
        return runTechnicianStep("recordRepairResult", workOrderId, user, parsed);
    }

    async function recordTest(workOrderId, input, user) {
        requirePermission(user, PERMISSIONS.TEST_RESULT_RECORD);
        const data = parseInput(testResultSchema, input, "Invalid test result");
        return runTechnicianStep(
            "recordTestResult",
            workOrderId,
            user,
            data.passed,
            data.notes
        );
    }

    async function handover(workOrderId, input, user, authorization) {
        requirePermission(user, PERMISSIONS.HANDOVER_COMPLETE);
        if (typeof getPaymentBalance !== "function") {
            throw new AppError("Payment Service is unavailable", 503);
        }
        const data = parseInput(handoverSchema, input, "Invalid handover details");
        if (!data.terms_acknowledged) {
            throw new AppError("Customer terms acknowledgement is required", 400);
        }
        if (!await workOrderRepository.findById(workOrderId)) {
            throw new AppError("Work order not found", 404);
        }
        const balance = await getPaymentBalance(workOrderId, authorization);
        const outstanding = Number(balance?.outstanding_balance);
        if (!Number.isSafeInteger(outstanding) || outstanding < 0) {
            throw new AppError("Payment balance is invalid", 502);
        }
        if (outstanding > 0 && !data.exceptionReason?.trim()) {
            throw new AppError(
                `Outstanding balance ${outstanding} THB requires an admin exception reason`,
                409
            );
        }
        return present(unwrapResult(await workOrderRepository.handover(
            workOrderId,
            user.userId,
            data.exceptionReason?.trim() || null,
            outstanding
        )));
    }

    async function cancel(workOrderId, input, user) {
        requirePermission(user, PERMISSIONS.WORK_ORDER_ASSIGN_TECHNICIAN);
        const data = parseInput(cancelSchema, input, "Invalid cancellation details");
        return present(unwrapResult(await workOrderRepository.cancel(
            workOrderId,
            user.userId,
            data.reason,
            data.returnParts !== false
        )));
    }

    async function listParts(user) {
        if (!hasPermission(user, PERMISSIONS.INVENTORY_ISSUE)
            && !hasPermission(user, PERMISSIONS.INVENTORY_PART_PROPOSE)) {
            throw new AppError("You do not have permission", 403);
        }
        return workOrderRepository.listParts();
    }

    async function createPart(input, user) {
        requirePermission(user, PERMISSIONS.INVENTORY_ISSUE);
        const data = parseInput(createPartSchema, input, "Invalid part details");
        const createdAt = now();
        try {
            return await workOrderRepository.createPart({
                part_id: createId(),
                sku: data.sku.toUpperCase(),
                name: data.name,
                description: data.description || null,
                unit_price: data.unit_price,
                stock: 0,
                reorder_level: data.reorder_level || 0,
                is_active: true,
                created_at: createdAt,
                updated_at: createdAt
            });
        } catch (error) {
            if (error.code === "ER_DUP_ENTRY") {
                throw new AppError("SKU already exists", 409);
            }
            throw error;
        }
    }

    async function receivePart(partId, input, user) {
        requirePermission(user, PERMISSIONS.INVENTORY_ISSUE);
        const data = parseInput(receivePartSchema, input, "Invalid stock receipt");
        return unwrapResult(await workOrderRepository.receivePart(
            partId,
            data.qty,
            user.userId,
            data.note
        ));
    }

    async function listStockMovements(query, user) {
        requirePermission(user, PERMISSIONS.INVENTORY_ISSUE);
        const data = parseInput(partMovementQuerySchema, query, "Invalid stock movement query");
        return workOrderRepository.listStockMovements(data.partId);
    }

    async function issueParts(workOrderId, input, user) {
        requirePermission(user, PERMISSIONS.INVENTORY_ISSUE);
        const data = parseInput(issuePartSchema, input, "Invalid stock issue");
        return present(unwrapResult(await workOrderRepository.issueParts(
            workOrderId,
            user.userId,
            data.partId,
            data.qty
        )));
    }

    return {
        createFromBooking,
        createWalkIn,
        listMine,
        listAssigned,
        assignTechnician,
        listAll,
        get,
        startDiagnosis,
        saveDiagnosis,
        proposeItems,
        priceAndSend,
        reviseQuotation,
        decideQuotation,
        startRepair,
        recordResult,
        recordTest,
        handover,
        cancel,
        listParts,
        createPart,
        receivePart,
        listStockMovements,
        issueParts
    };
}

module.exports = {
    createWorkOrderService
};
