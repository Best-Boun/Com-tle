const { randomUUID } = require("node:crypto");

function workOrderQuery(db) {
    return db("work_orders as wo")
        .leftJoin("work_order_devices as wd", "wd.work_order_id", "wo.work_order_id")
        .leftJoin("work_order_assignments as wa", function joinActiveAssignment() {
            this.on("wa.work_order_id", "=", "wo.work_order_id")
                .andOnNull("wa.unassigned_at");
        })
        .select(
            "wo.work_order_id",
            "wo.work_order_number",
            "wo.source",
            "wo.booking_id",
            "wo.booking_number",
            "wo.parent_work_order_id",
            "wo.customer_id",
            "wo.customer_name",
            "wo.customer_phone",
            "wo.customer_email",
            "wo.service_id",
            "wo.service_code",
            "wo.service_name",
            "wo.status",
            "wo.close_reason",
            "wo.reported_symptom",
            "wo.repair_result",
            "wo.handed_over_at",
            "wo.intake_terms_acknowledged_at",
            "wo.handover_terms_acknowledged_at",
            "wo.repair_declined",
            "wo.ready_at",
            "wo.received_at",
            "wo.created_at",
            "wo.updated_at",
            "wa.technician_user_id as technician_id",
            "wd.device_type",
            "wd.brand",
            "wd.model",
            "wd.serial_number",
            "wd.accessories_received"
        );
}

function accessoriesText(value) {
    let items = value;
    if (typeof items === "string") {
        items = JSON.parse(items);
    }
    if (items === null || items === undefined) {
        return null;
    }
    if (!Array.isArray(items)) {
        throw new Error("Stored device accessories must be a JSON array");
    }

    const labels = items.map((item) => {
        if (typeof item === "string") {
            return item.trim();
        }
        if (item && typeof item === "object") {
            const label = item.name || item.description;
            return typeof label === "string" ? label.trim() : JSON.stringify(item);
        }
        return String(item);
    }).filter(Boolean);

    return labels.length > 0 ? labels.join(", ") : null;
}

function presentRow(row) {
    if (!row) {
        return row;
    }
    const { accessories_received: accessoriesReceived, ...workOrder } = row;
    return {
        ...workOrder,
        accessories: accessoriesText(accessoriesReceived),
        repair_declined: Boolean(workOrder.repair_declined),
        ready_at: workOrder.ready_at || null,
        created_at: workOrder.received_at || workOrder.created_at,
        technician_id: workOrder.technician_id || null,
        work_order_number: workOrder.work_order_number
            || `WO-${workOrder.work_order_id.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
        source: workOrder.source || (workOrder.booking_id ? "BOOKING" : "WALK_IN")
    };
}

function presentOptionItem(item) {
    return {
        item_id: item.option_item_id,
        type: item.item_type,
        description: item.description,
        part_id: item.part_id || null,
        qty: Number(item.quantity),
        unit_price: Number(item.unit_price),
        subtotal: Number(item.subtotal)
    };
}

function presentPart(part) {
    if (!part) {
        return part;
    }
    return {
        ...part,
        unit_price: Number(part.unit_price),
        stock: Number(part.stock),
        reorder_level: Number(part.reorder_level),
        is_active: Boolean(part.is_active)
    };
}

/**
 * Task 12: a warranty claim is a work order whose parent_work_order_id is the
 * original repair. Each side shows the other.
 */
async function loadWarrantyLinks(db, workOrder) {
    const [parent, claims] = await Promise.all([
        workOrder.parent_work_order_id
            ? db("work_orders")
                .select("work_order_id", "work_order_number", "handed_over_at")
                .where({ work_order_id: workOrder.parent_work_order_id })
                .first()
            : null,
        db("work_orders")
            .select("work_order_id", "work_order_number", "status", "created_at")
            .where({ parent_work_order_id: workOrder.work_order_id })
            .orderBy("created_at", "asc")
    ]);
    return {
        warranty_parent: parent || null,
        warranty_claims: claims
    };
}

async function loadWorkOrderDetails(db, workOrderId) {
    const workOrder = await workOrderQuery(db)
        .where("wo.work_order_id", workOrderId)
        .first();
    if (!workOrder) {
        return null;
    }
    const warrantyLinks = await loadWarrantyLinks(db, workOrder);

    const [
        history,
        diagnosis,
        quotations,
        testResult,
        handover,
        abandonment,
        movements
    ] = await Promise.all([
        db("work_order_status_history")
            .where({ work_order_id: workOrderId })
            .orderBy("created_at", "asc"),
        db("diagnoses")
            .where({ work_order_id: workOrderId })
            .orderBy("diagnosed_at", "desc")
            .first(),
        db("quotations")
            .where({ work_order_id: workOrderId })
            .orderBy("revision_number", "asc"),
        db("test_results")
            .where({ work_order_id: workOrderId })
            .orderBy("tested_at", "desc")
            .first(),
        db("handover_records")
            .where({ work_order_id: workOrderId })
            .orderBy("handed_over_at", "desc")
            .first(),
        db("work_order_abandonment_records")
            .where({ work_order_id: workOrderId })
            .orderBy("abandoned_at", "desc")
            .first(),
        db("repair_stock_movements as m")
            .leftJoin("repair_parts_inventory as p", "p.part_id", "m.part_id")
            .select("m.*", "p.name as part_name")
            .where("m.work_order_id", workOrderId)
            .orderBy("m.created_at", "asc")
    ]);

    const quotationIds = quotations.map((quotation) => quotation.quotation_id);
    const [items, approvals, options] = quotationIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            db("quotation_items")
                .whereIn("quotation_id", quotationIds)
                .orderBy("quotation_item_id", "asc"),
            db("quotation_approval_records").whereIn("quotation_id", quotationIds),
            db("quotation_options")
                .whereIn("quotation_id", quotationIds)
                .orderBy("sort_order", "asc")
        ]);
    const optionIds = options.map((option) => option.option_id);
    const optionItems = optionIds.length === 0
        ? []
        : await db("quotation_option_items")
            .whereIn("option_id", optionIds)
            .orderBy("sort_order", "asc");
    const itemsByOption = new Map(optionIds.map((id) => [id, []]));
    for (const item of optionItems) {
        itemsByOption.get(item.option_id).push(presentOptionItem(item));
    }
    const optionsByQuotation = new Map(quotationIds.map((id) => [id, []]));
    for (const option of options) {
        optionsByQuotation.get(option.quotation_id).push({
            option_id: option.option_id,
            kind: option.option_kind,
            title: option.title,
            description: option.description,
            total: Number(option.total_amount),
            items: itemsByOption.get(option.option_id)
        });
    }
    const itemsByQuotation = new Map(quotationIds.map((id) => [id, []]));
    for (const item of items) {
        itemsByQuotation.get(item.quotation_id).push({
            item_id: item.quotation_item_id,
            type: item.item_type,
            description: item.description,
            part_id: item.part_id || null,
            qty: Number(item.quantity),
            unit_price: Number(item.unit_price),
            subtotal: Number(item.subtotal)
        });
    }
    const approvalsByQuotation = new Map(
        approvals.map((approval) => [approval.quotation_id, approval])
    );
    const presentedQuotations = quotations.map((quotation) => {
        const approval = approvalsByQuotation.get(quotation.quotation_id);
        return {
            quotation_id: quotation.quotation_id,
            work_order_id: quotation.work_order_id,
            revision: quotation.revision_number,
            kind: quotation.quotation_kind,
            status: quotation.status,
            options: optionsByQuotation.get(quotation.quotation_id),
            selected_option_id: quotation.selected_option_id || null,
            items: itemsByQuotation.get(quotation.quotation_id),
            total: Number(quotation.total_amount),
            note: quotation.note,
            created_by: quotation.created_by_user_id,
            created_at: quotation.created_at,
            sent_at: quotation.sent_at,
            decided_by: approval?.approved_by_customer_id || null,
            decided_by_name: null,
            decided_at: approval?.decided_at || null,
            decision_note: approval?.rejection_reason || null
        };
    });

    const approvedParts = new Map();
    for (const quotation of presentedQuotations) {
        if (quotation.status !== "APPROVED") {
            continue;
        }
        for (const item of quotation.items) {
            if (item.type !== "PART" || !item.part_id) {
                continue;
            }
            const current = approvedParts.get(item.part_id) || {
                approved_qty: 0,
                name: item.description,
                sku: null
            };
            current.approved_qty += item.qty;
            approvedParts.set(item.part_id, current);
        }
    }
    const partIds = [...approvedParts.keys()];
    const stockParts = partIds.length === 0
        ? []
        : await db("repair_parts_inventory")
            .whereIn("part_id", partIds)
            .select("part_id", "sku", "name", "stock");
    const stockByPartId = new Map(stockParts.map((part) => [part.part_id, part]));
    const issuedByPartId = new Map();
    for (const movement of movements) {
        const quantity = Number(movement.quantity);
        const change = movement.movement_type === "ISSUE" ? quantity
            : movement.movement_type === "RETURN" ? -quantity : 0;
        issuedByPartId.set(
            movement.part_id,
            (issuedByPartId.get(movement.part_id) || 0) + change
        );
    }

    const presentedMovements = movements.map((movement) => ({
        movement_id: movement.movement_id,
        part_id: movement.part_id,
        part_name: movement.part_name,
        type: movement.movement_type,
        qty: Number(movement.quantity),
        work_order_id: movement.work_order_id,
        by: movement.actor_user_id,
        note: movement.note,
        created_at: movement.created_at
    }));

    return {
        ...presentRow(workOrder),
        diagnosis: diagnosis?.diagnosis_result || null,
        repair_result: workOrder.repair_result || null,
        test_result: testResult ? {
            passed: testResult.result === "PASS",
            notes: testResult.remarks || testResult.test_description,
            tested_by: testResult.tested_by_user_id,
            tested_at: testResult.tested_at
        } : null,
        handed_over_at: handover?.handed_over_at || null,
        handover_exception: handover?.status === "EXCEPTION_APPROVED" ? {
            approved_by: handover.exception_approved_by_user_id,
            approved_by_name: handover.exception_approved_by_user_id,
            reason: handover.exception_reason,
            outstanding: Number(handover.outstanding_amount || 0),
            at: handover.handed_over_at
        } : null,
        cancellation: abandonment ? {
            by: abandonment.abandoned_by_user_id,
            by_name: abandonment.abandoned_by_user_id,
            reason: abandonment.reason,
            at: abandonment.abandoned_at,
            returned_parts: presentedMovements
                .filter((movement) => movement.type === "RETURN")
                .map((movement) => ({
                    part_id: movement.part_id,
                    name: movement.part_name,
                    qty: movement.qty
                }))
        } : null,
        has_pending_quotation: presentedQuotations.some(
            (quotation) => ["DRAFT", "SENT"].includes(quotation.status)
        ),
        history,
        quotations: presentedQuotations,
        payments: [],
        parts: [...approvedParts.entries()].map(([partId, allowance]) => {
            const stockPart = stockByPartId.get(partId);
            const issued = issuedByPartId.get(partId) || 0;
            return {
                part_id: partId,
                sku: stockPart?.sku || allowance.sku,
                name: stockPart?.name || allowance.name,
                stock: Number(stockPart?.stock || 0),
                approved_qty: allowance.approved_qty,
                issued_qty: issued,
                remaining_qty: Math.max(0, allowance.approved_qty - issued)
            };
        }),
        stock_movements: presentedMovements,
        ...warrantyLinks
    };
}

function statusConflict(workOrder, allowedStatuses) {
    return workOrder && !allowedStatuses.includes(workOrder.status);
}

function createWorkOrderRepository(db) {
    async function lockQuotationAndWorkOrder(trx, quotationId) {
        const reference = await trx("quotations")
            .select("work_order_id")
            .where({ quotation_id: quotationId })
            .first();
        if (!reference) {
            return { notFound: true };
        }
        const workOrder = await trx("work_orders")
            .where({ work_order_id: reference.work_order_id })
            .forUpdate()
            .first();
        const quotation = await trx("quotations")
            .where({ quotation_id: quotationId })
            .forUpdate()
            .first();
        if (!workOrder || !quotation) {
            return { notFound: true };
        }
        return { quotation, workOrder };
    }

    async function assignedOrder(trx, workOrderId, technicianId, allowedStatuses) {
        const workOrder = await trx("work_orders")
            .where({ work_order_id: workOrderId })
            .forUpdate()
            .first();
        if (!workOrder) {
            return { notFound: true };
        }
        const assignment = await trx("work_order_assignments")
            .where({ work_order_id: workOrderId, technician_user_id: technicianId })
            .whereNull("unassigned_at")
            .forUpdate()
            .first();
        if (!assignment) {
            return { notAssigned: true };
        }
        if (statusConflict(workOrder, allowedStatuses)) {
            return { conflict: true, status: workOrder.status };
        }
        return { workOrder };
    }

    async function recordStatusChange(trx, workOrder, actorId, nextStatus, reason, changes = {}) {
        const changedAt = new Date();
        const readyAt = nextStatus === "RETURN_PENDING" ? { ready_at: changedAt } : {};
        await trx("work_orders")
            .where({ work_order_id: workOrder.work_order_id })
            .update({ ...changes, ...readyAt, status: nextStatus, updated_at: changedAt });
        await trx("work_order_status_history").insert({
            history_id: randomUUID(),
            work_order_id: workOrder.work_order_id,
            old_status: workOrder.status,
            new_status: nextStatus,
            changed_by_user_id: actorId,
            reason: reason || null,
            created_at: changedAt
        });
        return loadWorkOrderDetails(trx, workOrder.work_order_id);
    }

    return {
        async findByBookingId(bookingId) {
            const row = await workOrderQuery(db)
                .where("wo.booking_id", bookingId)
                .orderBy("wo.created_at", "asc")
                .first();
            return presentRow(row);
        },

        async create(workOrder, initialHistory) {
            await db.transaction(async (trx) => {
                await trx("work_orders").insert({
                    work_order_id: workOrder.work_order_id,
                    work_order_number: workOrder.work_order_number,
                    source: workOrder.source,
                    booking_id: workOrder.booking_id,
                    booking_number: workOrder.booking_number,
                    customer_id: workOrder.customer_id,
                    customer_name: workOrder.customer_name,
                    customer_phone: workOrder.customer_phone,
                    customer_email: workOrder.customer_email || null,
                    service_id: workOrder.service_id,
                    service_code: workOrder.service_code,
                    service_name: workOrder.service_name,
                    reported_symptom: workOrder.reported_symptom,
                    intake_terms_acknowledged_at: workOrder.intake_terms_acknowledged_at || null,
                    status: workOrder.status,
                    received_at: workOrder.received_at,
                    created_at: workOrder.created_at,
                    updated_at: workOrder.updated_at
                });
                await trx("work_order_devices").insert({
                    device_id: workOrder.device_id,
                    work_order_id: workOrder.work_order_id,
                    device_type: workOrder.device_type,
                    brand: workOrder.brand,
                    model: workOrder.model,
                    serial_number: workOrder.serial_number,
                    accessories_received: workOrder.accessories
                        ? JSON.stringify([workOrder.accessories])
                        : JSON.stringify([]),
                    created_at: workOrder.created_at
                });
                await trx("work_order_status_history").insert(initialHistory);
                await trx("repair_booking_work_order_keys").insert({
                    booking_id: workOrder.booking_id,
                    work_order_id: workOrder.work_order_id,
                    created_at: workOrder.created_at
                });
            });
        },

/**
         * Task 12: open a warranty claim for a repaired device. The original row
         * is locked so two claims cannot be opened for it at the same time.
         * Returns { notFound }, { notEligible }, { openClaim } or the new work order.
         */
        async createWarrantyClaim(parentId, isEligible, buildClaim) {
            return db.transaction(async (trx) => {
                const parentRow = await trx("work_orders").where({ work_order_id: parentId }).forUpdate().first();
                if (!parentRow) {
                    return { notFound: true };
                }
                const parent = presentRow(await workOrderQuery(trx).where("wo.work_order_id", parentId).first());
                if (!isEligible(parent)) {
                    return { notEligible: true };
                }
                const open = await trx("work_orders")
                    .where({ parent_work_order_id: parentId })
                    .whereNotIn("status", ["HANDED_OVER", "ABANDONED"])
                    .first();
                if (open) {
                    return { openClaim: open.work_order_number };
                }
                const { workOrder, initialHistory } = buildClaim(parent);
                await trx("work_orders").insert({
                    work_order_id: workOrder.work_order_id,
                    work_order_number: workOrder.work_order_number,
                    source: parent.source,
                    booking_id: null,
                    parent_work_order_id: parentId,
                    customer_id: parent.customer_id,
                    customer_name: parent.customer_name,
                    customer_phone: parent.customer_phone,
                    customer_email: parent.customer_email || null,
                    service_id: parent.service_id,
                    service_code: parent.service_code,
                    service_name: parent.service_name,
                    reported_symptom: workOrder.reported_symptom,
                    intake_terms_acknowledged_at: workOrder.intake_terms_acknowledged_at,
                    status: "RECEIVED",
                    received_at: workOrder.received_at,
                    created_at: workOrder.created_at,
                    updated_at: workOrder.updated_at
                });
                await trx("work_order_devices").insert({
                    device_id: workOrder.device_id,
                    work_order_id: workOrder.work_order_id,
                    device_type: parent.device_type,
                    brand: parent.brand,
                    model: parent.model,
                    serial_number: parent.serial_number,
                    accessories_received: workOrder.accessories
                        ? JSON.stringify([workOrder.accessories])
                        : JSON.stringify([]),
                    created_at: workOrder.created_at
                });
                await trx("work_order_status_history").insert(initialHistory);
                return { workOrder: await loadWorkOrderDetails(trx, workOrder.work_order_id) };
            });
        },

        async createWalkIn(workOrder, initialHistory) {
            await db.transaction(async (trx) => {
                await trx("work_orders").insert({
                    work_order_id: workOrder.work_order_id,
                    work_order_number: workOrder.work_order_number,
                    source: "WALK_IN",
                    booking_id: null,
                    customer_id: workOrder.customer_id,
                    customer_name: workOrder.customer_name,
                    customer_phone: workOrder.customer_phone,
                    customer_email: workOrder.customer_email || null,
                    service_id: workOrder.service_id,
                    service_code: workOrder.service_code,
                    service_name: workOrder.service_name,
                    reported_symptom: workOrder.reported_symptom,
                    intake_terms_acknowledged_at: workOrder.intake_terms_acknowledged_at || null,
                    status: "RECEIVED",
                    received_at: workOrder.received_at,
                    created_at: workOrder.created_at,
                    updated_at: workOrder.updated_at
                });
                await trx("work_order_devices").insert({
                    device_id: workOrder.device_id,
                    work_order_id: workOrder.work_order_id,
                    device_type: workOrder.device_type,
                    brand: workOrder.brand,
                    model: workOrder.model,
                    serial_number: workOrder.serial_number,
                    accessories_received: workOrder.accessories
                        ? JSON.stringify([workOrder.accessories])
                        : JSON.stringify([]),
                    created_at: workOrder.created_at
                });
                await trx("work_order_status_history").insert(initialHistory);
            });
            return loadWorkOrderDetails(db, workOrder.work_order_id);
        },

        async findById(workOrderId) {
            return loadWorkOrderDetails(db, workOrderId);
        },

        async findHistory(workOrderId) {
            return db("work_order_status_history")
                .where({ work_order_id: workOrderId })
                .orderBy("created_at", "asc");
        },

        async listMine(customerId) {
            const rows = await workOrderQuery(db)
                .where("wo.customer_id", customerId)
                .orderBy("wo.created_at", "desc");
            return rows.map(presentRow);
        },

        async listAssigned(technicianId) {
            const rows = await workOrderQuery(db)
                .where("wa.technician_user_id", technicianId)
                .orderBy("wo.updated_at", "desc");
            return rows.map(presentRow);
        },

        /** The technicians' queue: received devices nobody has taken yet, oldest first. */
        async listUnassigned() {
            const rows = await workOrderQuery(db)
                .whereNull("wa.technician_user_id")
                .where("wo.status", "RECEIVED")
                .orderBy([{ column: "wo.received_at", order: "asc" }, { column: "wo.created_at", order: "asc" }]);
            return rows.map(presentRow);
        },

        /**
         * onlyIfFree: a technician taking a job from the queue. It succeeds only
         * while nobody holds the job and it is still RECEIVED, so two technicians
         * cannot both get it (the row lock serialises them).
         */
        async assignTechnician(workOrderId, technicianUserId, { onlyIfFree = false } = {}) {
            return db.transaction(async (trx) => {
                const workOrder = await trx("work_orders")
                    .where({ work_order_id: workOrderId })
                    .forUpdate()
                    .first();
                if (!workOrder) {
                    return { notFound: true };
                }
                if (["RETURN_PENDING", "HANDED_OVER", "ABANDONED"].includes(workOrder.status)) {
                    return { closed: true };
                }

                const activeAssignments = await trx("work_order_assignments")
                    .where({ work_order_id: workOrderId })
                    .whereNull("unassigned_at")
                    .forUpdate();
                if (activeAssignments.length === 1
                    && activeAssignments[0].technician_user_id === technicianUserId) {
                    return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
                }
                if (onlyIfFree && activeAssignments.length > 0) {
                    return { taken: true };
                }
                if (onlyIfFree && workOrder.status !== "RECEIVED") {
                    return { notInQueue: true };
                }

                const assignedAt = new Date();
                if (activeAssignments.length > 0) {
                    await trx("work_order_assignments")
                        .where({ work_order_id: workOrderId })
                        .whereNull("unassigned_at")
                        .update({ unassigned_at: assignedAt });
                }
                await trx("work_order_assignments").insert({
                    assignment_id: randomUUID(),
                    work_order_id: workOrderId,
                    technician_user_id: technicianUserId,
                    assigned_at: assignedAt,
                    unassigned_at: null
                });
                await trx("work_orders")
                    .where({ work_order_id: workOrderId })
                    .update({ updated_at: assignedAt });
                return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
            });
        },

        async startDiagnosis(workOrderId, technicianId) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(
                    trx,
                    workOrderId,
                    technicianId,
                    ["RECEIVED"]
                );
                if (!result.workOrder) {
                    return result;
                }
                return {
                    workOrder: await recordStatusChange(
                        trx,
                        result.workOrder,
                        technicianId,
                        "DIAGNOSING",
                        "Diagnosis started"
                    )
                };
            });
        },

        async saveDiagnosis(workOrderId, technicianId, diagnosis) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(
                    trx,
                    workOrderId,
                    technicianId,
                    ["DIAGNOSING"]
                );
                if (!result.workOrder) {
                    return result;
                }
                const diagnosedAt = new Date();
                await trx("diagnoses").insert({
                    diagnosis_id: randomUUID(),
                    work_order_id: workOrderId,
                    diagnosed_by_user_id: technicianId,
                    problem_description: result.workOrder.reported_symptom || "Customer-reported symptoms",
                    diagnosis_result: diagnosis,
                    recommended_action: diagnosis,
                    diagnosed_at: diagnosedAt
                });
                await trx("work_orders").where({ work_order_id: workOrderId }).update({
                    updated_at: diagnosedAt
                });
                return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
            });
        },

        // The technician sends priced options straight to the customer. The
        // system adds one more option itself, so a customer can always say no:
        //   INITIAL     "no repair" = the inspection fee, device goes back
        //   ADDITIONAL  "skip the extra work" = 0 THB, the approved repair goes on
        async proposeQuotation(workOrderId, technicianId, quotation, rules) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(
                    trx,
                    workOrderId,
                    technicianId,
                    ["DIAGNOSING", "APPROVED", "WAITING_PARTS", "IN_REPAIR"]
                );
                if (!result.workOrder) {
                    return result;
                }
                if (result.workOrder.status === "DIAGNOSING"
                    && !await trx("diagnoses").where({ work_order_id: workOrderId }).first()) {
                    return { missingDiagnosis: true };
                }
                const kind = result.workOrder.status === "DIAGNOSING" ? "INITIAL" : "ADDITIONAL";
                const pending = await trx("quotations")
                    .where({ work_order_id: workOrderId, quotation_kind: kind })
                    .whereIn("status", ["DRAFT", "SENT"])
                    .first();
                if (pending) {
                    return { conflict: true, status: result.workOrder.status };
                }
                const latest = await trx("quotations")
                    .where({ work_order_id: workOrderId })
                    .max({ revision_number: "revision_number" })
                    .first();
                const sentAt = new Date();
                const quotationId = randomUUID();
                const revision = Number(latest.revision_number || 0) + 1;
                await trx("quotations").insert({
                    quotation_id: quotationId,
                    work_order_id: workOrderId,
                    revision_number: revision,
                    quotation_kind: kind,
                    status: "SENT",
                    total_amount: 0,
                    currency: "THB",
                    created_by_user_id: technicianId,
                    note: quotation.note || null,
                    sent_at: sentAt,
                    created_at: sentAt,
                    updated_at: sentAt
                });

                // Task 12: a warranty claim is free, so every price is 0
                // (also "no repair"); everything else works the same.
                const claim = Boolean(result.workOrder.parent_work_order_id);
                const fee = claim ? 0 : rules.noRepairFee;
                const free = (items) => (claim ? items.map((item) => ({ ...item, unit_price: 0 })) : items);
                const options = [
                    ...quotation.options.map((option) => ({ ...option, items: free(option.items), kind: "REPAIR" })),
                    kind === "INITIAL"
                        ? {
                            kind: "NO_REPAIR",
                            title: "ไม่ซ่อม รับเครื่องคืน",
                            description: claim
                                ? "งานเคลมประกัน ไม่มีค่าใช้จ่าย"
                                : `ตรวจเช็กฟรีเมื่อซ่อม หากไม่ซ่อมคิดค่าตรวจเช็ก ${fee} บาท`,
                            items: [{
                                type: "LABOR",
                                description: "ค่าตรวจเช็ก (ไม่ซ่อม)",
                                part_id: null,
                                qty: 1,
                                unit_price: fee
                            }]
                        }
                        : {
                            kind: "SKIP_EXTRA",
                            title: "ไม่ทำงานเพิ่ม",
                            description: "ซ่อมต่อตามที่อนุมัติไว้เดิม ไม่มีค่าใช้จ่ายเพิ่ม",
                            items: []
                        }
                ];
                for (const [index, option] of options.entries()) {
                    const optionId = randomUUID();
                    const total = option.items.reduce(
                        (sum, item) => sum + item.qty * item.unit_price,
                        0
                    );
                    await trx("quotation_options").insert({
                        option_id: optionId,
                        quotation_id: quotationId,
                        work_order_id: workOrderId,
                        sort_order: index + 1,
                        option_kind: option.kind,
                        title: option.title,
                        description: option.description || null,
                        total_amount: total,
                        created_at: sentAt
                    });
                    if (option.items.length > 0) {
                        await trx("quotation_option_items").insert(option.items.map((item, itemIndex) => ({
                            option_item_id: randomUUID(),
                            option_id: optionId,
                            sort_order: itemIndex + 1,
                            item_type: item.type,
                            description: item.description,
                            part_id: item.type === "PART" ? item.part_id || null : null,
                            quantity: item.qty,
                            unit_price: item.unit_price,
                            subtotal: item.qty * item.unit_price
                        })));
                    }
                }

                if (kind === "INITIAL") {
                    await recordStatusChange(
                        trx,
                        result.workOrder,
                        technicianId,
                        "WAITING_APPROVAL",
                        `Quotation Rev.${revision} sent with ${options.length} options`
                    );
                } else {
                    await trx("work_orders").where({ work_order_id: workOrderId }).update({
                        updated_at: sentAt
                    });
                }
                return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
            });
        },

        // The customer (or the shop, for a walk-in) chooses one option. The
        // chosen option's items become the quotation's items, so parts
        // allowance and billing keep reading APPROVED quotations as before.
        async decideQuotation(quotationId, user, optionId, note) {
            return db.transaction(async (trx) => {
                const locked = await lockQuotationAndWorkOrder(trx, quotationId);
                if (locked.notFound) return locked;
                const { quotation, workOrder } = locked;
                const isAdmin = user.roles.includes("ADMIN");
                const isCustomer = user.roles.includes("CUSTOMER")
                    && workOrder.customer_id === user.userId;
                if (!isCustomer && !(isAdmin && workOrder.source === "WALK_IN")) {
                    return { forbidden: true };
                }
                if (quotation.status !== "SENT") {
                    return { conflict: true, status: workOrder.status };
                }
                if ((quotation.quotation_kind === "INITIAL" && workOrder.status !== "WAITING_APPROVAL")
                    || (quotation.quotation_kind === "ADDITIONAL"
                        && !["APPROVED", "WAITING_PARTS", "IN_REPAIR", "TESTING"].includes(workOrder.status))) {
                    return { conflict: true, status: workOrder.status };
                }
                const option = await trx("quotation_options")
                    .where({ option_id: optionId, quotation_id: quotationId })
                    .first();
                if (!option) {
                    return { optionNotFound: true };
                }

                const skipped = option.option_kind === "SKIP_EXTRA";
                const decision = skipped ? "REJECTED" : "APPROVED";
                const decidedAt = new Date();
                await trx("quotation_approval_records").insert({
                    approval_id: randomUUID(),
                    quotation_id: quotationId,
                    decision,
                    approved_by_customer_id: user.userId,
                    approval_method: isCustomer ? "ONLINE" : "IN_PERSON",
                    evidence_reference: null,
                    rejection_reason: skipped ? (note || "Customer skipped the additional work") : null,
                    decided_at: decidedAt
                });
                if (!skipped) {
                    const chosenItems = await trx("quotation_option_items")
                        .where({ option_id: optionId })
                        .orderBy("sort_order", "asc");
                    if (chosenItems.length > 0) {
                        await trx("quotation_items").insert(chosenItems.map((item) => ({
                            quotation_item_id: randomUUID(),
                            quotation_id: quotationId,
                            work_order_id: workOrder.work_order_id,
                            item_type: item.item_type,
                            description: item.description,
                            part_id: item.part_id,
                            quantity: item.quantity,
                            unit_price: item.unit_price,
                            subtotal: item.subtotal
                        })));
                    }
                }
                await trx("quotations").where({ quotation_id: quotationId }).update({
                    status: decision,
                    selected_option_id: optionId,
                    total_amount: skipped ? 0 : option.total_amount,
                    updated_at: decidedAt
                });

                const chose = `Option ${option.sort_order} "${option.title}" chosen on Rev.${quotation.revision_number}`;
                const reason = note ? `${chose}: ${note}` : chose;
                if (quotation.quotation_kind === "INITIAL") {
                    const declined = option.option_kind === "NO_REPAIR";
                    await recordStatusChange(
                        trx,
                        workOrder,
                        user.userId,
                        declined ? "RETURN_PENDING" : "APPROVED",
                        reason,
                        declined ? { repair_declined: true } : {}
                    );
                } else {
                    await trx("work_orders").where({ work_order_id: workOrder.work_order_id }).update({
                        updated_at: decidedAt
                    });
                    await trx("work_order_status_history").insert({
                        history_id: randomUUID(),
                        work_order_id: workOrder.work_order_id,
                        old_status: workOrder.status,
                        new_status: workOrder.status,
                        changed_by_user_id: user.userId,
                        reason,
                        created_at: decidedAt
                    });
                }
                return { workOrder: await loadWorkOrderDetails(trx, workOrder.work_order_id) };
            });
        },

        async startRepair(workOrderId, technicianId) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(
                    trx,
                    workOrderId,
                    technicianId,
                    ["APPROVED", "WAITING_PARTS"]
                );
                if (!result.workOrder) {
                    return result;
                }
                return {
                    workOrder: await recordStatusChange(
                        trx,
                        result.workOrder,
                        technicianId,
                        "IN_REPAIR",
                        result.workOrder.status === "WAITING_PARTS"
                            ? "Parts arrived; repair started"
                            : "Repair started"
                    )
                };
            });
        },

        async markWaitingParts(workOrderId, technicianId, note) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(
                    trx,
                    workOrderId,
                    technicianId,
                    ["APPROVED", "IN_REPAIR"]
                );
                if (!result.workOrder) {
                    return result;
                }
                return {
                    workOrder: await recordStatusChange(
                        trx,
                        result.workOrder,
                        technicianId,
                        "WAITING_PARTS",
                        note
                    )
                };
            });
        },

        async recordRepairResult(workOrderId, technicianId, repairResult) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(trx, workOrderId, technicianId, ["IN_REPAIR"]);
                if (!result.workOrder) {
                    return result;
                }
                return {
                    workOrder: await recordStatusChange(
                        trx,
                        result.workOrder,
                        technicianId,
                        "TESTING",
                        "Repair completed; testing started",
                        { repair_result: repairResult }
                    )
                };
            });
        },

        async recordTestResult(workOrderId, technicianId, passed, notes) {
            return db.transaction(async (trx) => {
                const result = await assignedOrder(trx, workOrderId, technicianId, ["TESTING"]);
                if (!result.workOrder) {
                    return result;
                }
                if (await trx("quotations")
                    .where({ work_order_id: workOrderId, status: "SENT" })
                    .first()) {
                    return { pendingQuotation: true };
                }
                const testedAt = new Date();
                await trx("test_results").insert({
                    test_result_id: randomUUID(),
                    work_order_id: workOrderId,
                    tested_by_user_id: technicianId,
                    test_description: "Repair verification",
                    result: passed ? "PASS" : "FAIL",
                    remarks: notes,
                    tested_at: testedAt
                });
                return {
                    workOrder: await recordStatusChange(
                        trx,
                        result.workOrder,
                        technicianId,
                        passed ? "RETURN_PENDING" : "IN_REPAIR",
                        passed ? "Test passed" : "Test failed; repair resumed"
                    )
                };
            });
        },

        async handover(workOrderId, actorId, exceptionReason, outstandingAmount) {
            return db.transaction(async (trx) => {
                const workOrder = await trx("work_orders")
                    .where({ work_order_id: workOrderId })
                    .forUpdate()
                    .first();
                if (!workOrder) {
                    return { notFound: true };
                }
                if (workOrder.status === "HANDED_OVER") {
                    return { conflict: true, status: workOrder.status };
                }
                if (workOrder.status !== "RETURN_PENDING") {
                    return { conflict: true, status: workOrder.status };
                }
                if (await trx("quotations")
                    .where({ work_order_id: workOrderId })
                    .whereIn("status", ["DRAFT", "SENT"])
                    .first()) {
                    return { pendingQuotation: true };
                }
                // A device the customer chose not to repair was never repaired,
                // so there is nothing to test before it goes back.
                const declined = Boolean(workOrder.repair_declined);
                const testResult = declined ? null : await trx("test_results")
                    .where({ work_order_id: workOrderId, result: "PASS" })
                    .orderBy("tested_at", "desc")
                    .first();
                if (!declined && !testResult) {
                    return { missingTest: true };
                }
                const handedOverAt = new Date();
                const hasException = outstandingAmount > 0;
                await trx("handover_records").insert({
                    handover_id: randomUUID(),
                    work_order_id: workOrderId,
                    handed_over_by_user_id: actorId,
                    received_by_customer_id: workOrder.customer_id,
                    status: hasException ? "EXCEPTION_APPROVED" : "COMPLETED",
                    exception_approved_by_user_id: hasException ? actorId : null,
                    exception_reason: hasException ? exceptionReason : null,
                    outstanding_amount: hasException ? outstandingAmount : null,
                    evidence_reference: null,
                    handed_over_at: handedOverAt
                });
                await trx("work_orders").where({ work_order_id: workOrderId }).update({
                    status: "HANDED_OVER",
                    close_reason: declined ? "REJECTED" : "REPAIRED",
                    handed_over_at: handedOverAt,
                    handover_terms_acknowledged_at: handedOverAt,
                    updated_at: handedOverAt
                });
                await trx("work_order_status_history").insert({
                    history_id: randomUUID(),
                    work_order_id: workOrderId,
                    old_status: workOrder.status,
                    new_status: "HANDED_OVER",
                    changed_by_user_id: actorId,
                    reason: hasException
                        ? `Handed over with payment exception: ${exceptionReason}`
                        : "Device handed over",
                    created_at: handedOverAt
                });
                return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
            });
        },

        async cancel(workOrderId, actorId, reason, returnParts = true) {
            return db.transaction(async (trx) => {
                const workOrder = await trx("work_orders")
                    .where({ work_order_id: workOrderId })
                    .forUpdate()
                    .first();
                if (!workOrder) {
                    return { notFound: true };
                }
                if (["RETURN_PENDING", "HANDED_OVER", "ABANDONED"].includes(workOrder.status)) {
                    return { conflict: true, status: workOrder.status };
                }
                const issued = returnParts ? await trx("repair_stock_movements")
                    .select("part_id")
                    .sum({ quantity: "quantity" })
                    .where({ work_order_id: workOrderId, movement_type: "ISSUE" })
                    .groupBy("part_id") : [];
                const returned = returnParts ? await trx("repair_stock_movements")
                    .select("part_id")
                    .sum({ quantity: "quantity" })
                    .where({ work_order_id: workOrderId, movement_type: "RETURN" })
                    .groupBy("part_id") : [];
                const returnedByPart = new Map(returned.map((row) => [row.part_id, Number(row.quantity)]));
                const canceledAt = new Date();
                for (const row of issued) {
                    const quantity = Number(row.quantity) - (returnedByPart.get(row.part_id) || 0);
                    if (quantity <= 0) {
                        continue;
                    }
                    await trx("repair_parts_inventory").where({ part_id: row.part_id }).update({
                        stock: trx.raw("stock + ?", [quantity]),
                        updated_at: canceledAt
                    });
                    await trx("repair_stock_movements").insert({
                        movement_id: randomUUID(),
                        part_id: row.part_id,
                        movement_type: "RETURN",
                        quantity,
                        work_order_id: workOrderId,
                        actor_user_id: actorId,
                        note: "Returned after work-order cancellation",
                        created_at: canceledAt
                    });
                }
                await trx("work_order_abandonment_records").insert({
                    abandonment_id: randomUUID(),
                    work_order_id: workOrderId,
                    abandoned_by_user_id: actorId,
                    reason,
                    customer_follow_up_evidence: JSON.stringify({
                        method: "STAFF_RECORDED",
                        outcome: reason
                    }),
                    abandoned_at: canceledAt
                });
                await trx("work_orders").where({ work_order_id: workOrderId }).update({
                    status: "ABANDONED",
                    close_reason: "CANCELLED",
                    updated_at: canceledAt
                });
                await trx("work_order_status_history").insert({
                    history_id: randomUUID(),
                    work_order_id: workOrderId,
                    old_status: workOrder.status,
                    new_status: "ABANDONED",
                    changed_by_user_id: actorId,
                    reason,
                    created_at: canceledAt
                });
                return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
            });
        },

        async listParts() {
            const parts = await db("repair_parts_inventory")
                .select("part_id", "sku", "name", "description", "unit_price", "stock", "reorder_level", "is_active")
                .where({ is_active: true })
                .orderBy("name");
            return parts.map(presentPart);
        },

        async createPart(part) {
            await db("repair_parts_inventory").insert(part);
            const created = await db("repair_parts_inventory")
                .where({ part_id: part.part_id })
                .first();
            return presentPart(created);
        },

        async receivePart(partId, quantity, actorId, note) {
            return db.transaction(async (trx) => {
                const part = await trx("repair_parts_inventory")
                    .where({ part_id: partId })
                    .forUpdate()
                    .first();
                if (!part || !part.is_active) {
                    return { notFound: true };
                }
                const receivedAt = new Date();
                await trx("repair_parts_inventory").where({ part_id: partId }).update({
                    stock: trx.raw("stock + ?", [quantity]),
                    updated_at: receivedAt
                });
                await trx("repair_stock_movements").insert({
                    movement_id: randomUUID(),
                    part_id: partId,
                    movement_type: "RECEIVE",
                    quantity,
                    work_order_id: null,
                    actor_user_id: actorId,
                    note: note || null,
                    created_at: receivedAt
                });
                const updated = await trx("repair_parts_inventory")
                    .where({ part_id: partId })
                    .first();
                return { part: presentPart(updated) };
            });
        },

        async listStockMovements(partId) {
            const query = db("repair_stock_movements as m")
                .join("repair_parts_inventory as p", "p.part_id", "m.part_id")
                .select(
                    "m.movement_id",
                    "m.part_id",
                    "p.name as part_name",
                    "m.movement_type as type",
                    "m.quantity as qty",
                    "m.work_order_id",
                    "wo.work_order_number",
                    "m.actor_user_id as by",
                    "m.actor_user_id as by_name",
                    "m.note",
                    "m.created_at"
                )
                .leftJoin("work_orders as wo", "wo.work_order_id", "m.work_order_id")
                .orderBy("m.created_at", "desc");
            if (partId) {
                query.where("m.part_id", partId);
            }
            return query.then((movements) => movements.map((movement) => ({
                ...movement,
                qty: Number(movement.qty)
            })));
        },

        async issueParts(workOrderId, actorId, partId, quantity) {
            return db.transaction(async (trx) => {
                const workOrder = await trx("work_orders")
                    .where({ work_order_id: workOrderId })
                    .forUpdate()
                    .first();
                if (!workOrder) {
                    return { notFound: true };
                }
                if (!["APPROVED", "WAITING_PARTS", "IN_REPAIR", "TESTING"].includes(workOrder.status)) {
                    return { conflict: true, status: workOrder.status };
                }
                const part = await trx("repair_parts_inventory")
                    .where({ part_id: partId })
                    .forUpdate()
                    .first();
                if (!part || !part.is_active) {
                    return { partNotFound: true };
                }
                const approvedItems = await trx("quotation_items as qi")
                    .join("quotations as q", "q.quotation_id", "qi.quotation_id")
                    .sum({ quantity: "qi.quantity" })
                    .where({
                        "q.work_order_id": workOrderId,
                        "q.status": "APPROVED",
                        "qi.item_type": "PART",
                        "qi.part_id": partId
                    })
                    .first();
                const allowance = Number(approvedItems.quantity || 0);
                const movements = await trx("repair_stock_movements")
                    .select("movement_type")
                    .sum({ quantity: "quantity" })
                    .where({ work_order_id: workOrderId, part_id: partId })
                    .whereIn("movement_type", ["ISSUE", "RETURN"])
                    .groupBy("movement_type");
                const totals = new Map(movements.map((item) => [
                    item.movement_type,
                    Number(item.quantity)
                ]));
                const issued = (totals.get("ISSUE") || 0) - (totals.get("RETURN") || 0);
                if (quantity > allowance - issued) {
                    return { overAllowance: true, remaining: Math.max(0, allowance - issued) };
                }
                if (Number(part.stock) < quantity) {
                    return { insufficientStock: true, stock: Number(part.stock) };
                }
                const issuedAt = new Date();
                await trx("repair_parts_inventory").where({ part_id: partId }).update({
                    stock: trx.raw("stock - ?", [quantity]),
                    updated_at: issuedAt
                });
                await trx("repair_stock_movements").insert({
                    movement_id: randomUUID(),
                    part_id: partId,
                    movement_type: "ISSUE",
                    quantity,
                    work_order_id: workOrderId,
                    actor_user_id: actorId,
                    note: null,
                    created_at: issuedAt
                });
                await trx("work_orders").where({ work_order_id: workOrderId }).update({
                    updated_at: issuedAt
                });
                return { workOrder: await loadWorkOrderDetails(trx, workOrderId) };
            });
        },

        async listAll(filters) {
            const query = workOrderQuery(db);
            if (filters.status === "OPEN") {
                query.whereNotIn("wo.status", ["RETURN_PENDING", "HANDED_OVER", "ABANDONED"]);
            } else if (filters.status === "READY") {
                query.where("wo.status", "RETURN_PENDING");
            } else if (filters.status) {
                const status = {
                    PENDING: "RECEIVED",
                    REPAIRING: "IN_REPAIR",
                    COMPLETED: "RETURN_PENDING",
                    CANCELLED: "ABANDONED"
                }[filters.status] || filters.status;
                query.where("wo.status", status);
            }

            if (filters.search) {
                const search = `%${filters.search}%`;
                query.where((builder) => {
                    builder
                        .where("wo.work_order_number", "like", search)
                        .orWhere("wo.booking_number", "like", search)
                        .orWhere("wo.customer_name", "like", search)
                        .orWhere("wo.customer_phone", "like", search)
                        .orWhere("wd.brand", "like", search)
                        .orWhere("wd.model", "like", search)
                        .orWhere("wd.serial_number", "like", search);
                });
            }

            const rows = await query.orderBy("wo.created_at", "desc");
            const workOrderIds = rows.map((row) => row.work_order_id);
            const drafts = workOrderIds.length === 0
                ? []
                : await db("quotations")
                    .select("work_order_id")
                    .whereIn("work_order_id", workOrderIds)
                    .where({ status: "DRAFT" });
            const draftWorkOrderIds = new Set(drafts.map((draft) => draft.work_order_id));
            return rows.map((row) => ({
                ...presentRow(row),
                has_draft_quotation: draftWorkOrderIds.has(row.work_order_id)
            }));
        }
    };
}

module.exports = {
    createWorkOrderRepository
};
