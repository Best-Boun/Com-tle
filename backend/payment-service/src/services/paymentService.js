const { createHash, randomUUID } = require("node:crypto");
const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");

// Payment-Service business rules on the Railway payment_db schema.
// - Bills arrive as inbox_events (repair.bill.issued). Until Repair-Service
//   publishes them, an admin registers them manually (source_service "manual").
// - Amounts are whole baht (BIGINT). Balance = latest bill total
//   - SUCCEEDED payments + COMPLETED refunds.
// - Each work order has one payment_locks row: is_locked blocks recording, and
//   SELECT ... FOR UPDATE on it serializes money changes for that work order.
// - Every money write records payment_audit_logs and outbox_events in the same
//   transaction; POST payment/refund require an Idempotency-Key.

const PERMISSIONS = Object.freeze({
    RECORD: "payment.record",
    REFUND: "payment.refund",
    VIEW_ALL: "payment.view_all",
    VIEW_OWN: "payment.view_own"
});
const PAYMENT_METHODS = ["CASH", "TRANSFER", "CARD"];
const CURRENCY = "THB";
const BILL_EVENT = "repair.bill.issued";
const ACTIVE_REFUND_STATUSES = ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"];
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_AMOUNT = 10_000_000_000;

const id = z.string().trim().min(1).max(36);
const amount = z.union([
    z.number().int(),
    z.string().regex(/^[1-9]\d{0,10}$/).transform(Number)
]).pipe(z.number().int().min(1).max(MAX_AMOUNT));
const reason = z.string().trim().min(1).max(500);

const billSchema = z.object({
    work_order_id: id,
    bill_id: id,
    bill_version: z.number().int().min(1).max(1_000_000),
    customer_id: id,
    total_amount: amount,
    currency: z.literal(CURRENCY).default(CURRENCY)
}).strict();
const paymentSchema = z.object({
    work_order_id: id,
    amount,
    payment_method: z.enum(PAYMENT_METHODS),
    reference_number: z.string().trim().min(1).max(100).optional()
}).strict();
const voidSchema = z.object({ reason }).strict();
const refundSchema = z.object({ payment_id: id, amount, reason }).strict();
const rejectSchema = z.object({ reason }).strict();
const idempotencyKeySchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{8,100}$/);
const pageFields = {
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25)
};
const paymentListSchema = z.object({
    ...pageFields,
    work_order_id: id.optional(),
    status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "VOIDED"]).optional(),
    payment_method: z.enum(PAYMENT_METHODS).optional()
}).strict();
const refundListSchema = z.object({
    ...pageFields,
    work_order_id: id.optional(),
    payment_id: id.optional(),
    status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "PROCESSING", "COMPLETED", "FAILED"])
        .optional()
}).strict();

const PAYMENT_FIELDS = [
    "payment_id", "work_order_id", "bill_id", "bill_version", "amount", "currency",
    "payment_method", "status", "reference_number", "recorded_by", "voided_by",
    "void_reason", "voided_at", "paid_at", "created_at"
];
const OWN_PAYMENT_FIELDS = [
    "payment_id", "work_order_id", "bill_id", "bill_version", "amount", "currency",
    "payment_method", "status", "paid_at", "voided_at"
];
const REFUND_FIELDS = [
    "refund_id", "payment_id", "work_order_id", "amount", "currency", "status",
    "requested_by", "approved_by", "reason", "rejection_reason", "requested_at",
    "approved_at", "processed_at", "completed_at", "rejected_at"
];

function parse(schema, input, message) {
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) {
        throw new AppError(message, 400);
    }
    return parsed.data;
}

function toAmount(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
        throw new AppError("Stored payment amount is invalid", 500);
    }
    return number;
}

function parsePayload(value) {
    if (value && typeof value === "object") {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function stableJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function isDeadlock(error) {
    return error?.code === "ER_LOCK_DEADLOCK" || error?.errno === 1213;
}

function isDuplicateKey(error) {
    return error?.code === "ER_DUP_ENTRY" || error?.errno === 1062;
}

function createPaymentService({
    db,
    requestPermission,
    requestCustomerId,
    createId = randomUUID,
    now = Date.now
} = {}) {
    if (!db
        || typeof requestPermission !== "function"
        || typeof requestCustomerId !== "function") {
        throw new Error("Database, permission checker and customer resolver are required");
    }

    function actorOf(authContext) {
        const userId = authContext?.userId;
        if (typeof userId !== "string" || !userId || userId.length > 36) {
            throw new AppError("Authentication required", 401);
        }
        return userId;
    }

    async function hasPermission(authContext, permission, resource) {
        try {
            return (await requestPermission(authContext, permission, resource)) === true;
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Payment authorization unavailable", 503);
        }
    }

    async function requirePermission(authContext, permission, resource) {
        const actor = actorOf(authContext);
        if (!await hasPermission(authContext, permission, resource)) {
            throw new AppError("Not authorized for this payment operation", 403);
        }
        return actor;
    }

    // Unexpected failures (DB down, constraint we did not anticipate) never leak.
    // A transaction InnoDB picked as a deadlock victim was rolled back in full,
    // so it is safe to run it again.
    async function run(work, message) {
        for (let attempt = 1; ; attempt += 1) {
            try {
                return await work();
            } catch (error) {
                if (isDeadlock(error) && attempt < 3) {
                    continue;
                }
                throw toServiceError(error, message);
            }
        }
    }

    function toServiceError(error, message) {
        if (error instanceof AppError) {
            return error;
        }
        const unavailable = new AppError(message, 503);
        unavailable.cause = error;
        return unavailable;
    }

    // ---- per-work-order state -------------------------------------------------

    // Lock first; create only when missing. INSERT IGNORE on an existing row
    // takes a shared lock, and upgrading it under concurrency deadlocks.
    async function lockWorkOrder(trx, workOrderId) {
        const select = () => trx("payment_locks")
            .select("work_order_id", "is_locked", "lock_reason")
            .where({ work_order_id: workOrderId })
            .forUpdate()
            .first();
        const existing = await select();
        if (existing) {
            return existing;
        }
        await trx.raw(
            "INSERT IGNORE INTO payment_locks (lock_id, work_order_id, is_locked) VALUES (?, ?, false)",
            [createId(), workOrderId]
        );
        return select();
    }

    async function billsFor(trx, workOrderIds) {
        if (workOrderIds !== null && workOrderIds.length === 0) {
            return new Map();
        }
        const query = trx("inbox_events")
            .select("work_order_id", "payload", "received_at")
            .where({ event_type: BILL_EVENT, status: "PROCESSED" });
        if (workOrderIds !== null) {
            query.whereIn("work_order_id", workOrderIds);
        }
        const latest = new Map();
        for (const row of await query) {
            const payload = parsePayload(row.payload);
            if (!payload || payload.work_order_id !== row.work_order_id) {
                continue;
            }
            const current = latest.get(row.work_order_id);
            if (!current || payload.bill_version > current.bill_version) {
                latest.set(row.work_order_id, {
                    work_order_id: row.work_order_id,
                    bill_id: payload.bill_id,
                    bill_version: payload.bill_version,
                    customer_id: payload.customer_id,
                    total_amount: toAmount(payload.total_amount),
                    currency: payload.currency
                });
            }
        }
        return latest;
    }

    async function latestBill(trx, workOrderId) {
        return (await billsFor(trx, [workOrderId])).get(workOrderId) || null;
    }

    async function totalsFor(trx, workOrderId) {
        const [paid] = await trx("payments")
            .sum({ total: "amount" })
            .where({ work_order_id: workOrderId, status: "SUCCEEDED" });
        const [refunded] = await trx("refunds")
            .sum({ total: "amount" })
            .where({ work_order_id: workOrderId, status: "COMPLETED" });
        return {
            paid_total: toAmount(paid?.total || 0),
            refunded_total: toAmount(refunded?.total || 0)
        };
    }

    function balanceView(bill, totals, lock) {
        return {
            work_order_id: bill.work_order_id,
            bill_id: bill.bill_id,
            bill_version: bill.bill_version,
            currency: bill.currency,
            bill_total: bill.total_amount,
            paid_total: totals.paid_total,
            refunded_total: totals.refunded_total,
            outstanding_balance: bill.total_amount - totals.paid_total + totals.refunded_total,
            is_locked: Boolean(lock?.is_locked)
        };
    }

    // ---- audit, outbox, idempotency ---------------------------------------

    async function audit(trx, { paymentId = null, refundId = null, actor, action, reason: why = null, metadata = null }) {
        await trx("payment_audit_logs").insert({
            audit_id: createId(),
            payment_id: paymentId,
            refund_id: refundId,
            actor_user_id: actor,
            action,
            reason: why,
            metadata: metadata ? JSON.stringify(metadata) : null,
            created_at: new Date(now())
        });
    }

    async function outbox(trx, { paymentId = null, refundId = null, type, payload }) {
        await trx("outbox_events").insert({
            event_id: createId(),
            payment_id: paymentId,
            refund_id: refundId,
            event_type: type,
            payload: JSON.stringify({ ...payload, occurred_at: new Date(now()).toISOString() }),
            status: "PENDING",
            created_at: new Date(now())
        });
    }

    // Runs `work` once per (actor, operation, key). The record is written in the
    // same transaction, so a failed attempt leaves nothing behind and can retry.
    async function idempotent(actor, operation, rawKey, request, work) {
        const keyParsed = idempotencyKeySchema.safeParse(rawKey);
        if (!keyParsed.success) {
            throw new AppError("A valid Idempotency-Key header is required", 400);
        }
        const key = keyParsed.data;
        const scopeKey = `user:${actor}`;
        const requestHash = createHash("sha256").update(stableJson(request)).digest("hex");

        return db.transaction(async (trx) => {
            const where = { scope_key: scopeKey, operation, idempotency_key: key };
            const createdAt = new Date(now());
            try {
                await trx("idempotency_records").insert({
                    idempotency_id: createId(),
                    ...where,
                    request_hash: requestHash,
                    status: "PROCESSING",
                    created_at: createdAt,
                    expires_at: new Date(createdAt.getTime() + IDEMPOTENCY_TTL_MS)
                });
            } catch (error) {
                if (!isDuplicateKey(error)) {
                    throw error;
                }
                const existing = await trx("idempotency_records")
                    .select("request_hash", "status", "response_snapshot", "expires_at")
                    .where(where)
                    .first();
                if (existing.request_hash !== requestHash) {
                    throw new AppError("Idempotency-Key was already used for a different request", 422);
                }
                if (existing.status === "COMPLETED") {
                    return { ...parsePayload(existing.response_snapshot), replayed: true };
                }
                throw new AppError("A request with this Idempotency-Key is still in progress", 409);
            }

            const result = await work(trx);
            await trx("idempotency_records").where(where).update({
                status: "COMPLETED",
                resource_type: result.resource_type,
                resource_id: result.resource_id,
                response_snapshot: JSON.stringify(result.body)
            });
            return result.body;
        });
    }

    // ---- bills ----------------------------------------------------------------

    async function registerBill(authContext, input) {
        const actor = await requirePermission(authContext, PERMISSIONS.RECORD);
        const bill = parse(billSchema, input, "Invalid bill details");
        return run(() => db.transaction(async (trx) => {
            await lockWorkOrder(trx, bill.work_order_id);
            const current = await latestBill(trx, bill.work_order_id);
            if (current && bill.bill_version <= current.bill_version) {
                throw new AppError("A newer or equal bill version is already registered", 409);
            }
            if (current && current.customer_id !== bill.customer_id) {
                throw new AppError("Bill customer does not match the work order", 409);
            }
            const receivedAt = new Date(now());
            await trx("inbox_events").insert({
                inbox_id: createId(),
                source_service: "manual",
                source_event_id: createId(),
                event_type: BILL_EVENT,
                work_order_id: bill.work_order_id,
                payload: JSON.stringify({ ...bill, registered_by: actor }),
                status: "PROCESSED",
                received_at: receivedAt,
                processed_at: receivedAt
            });
            const totals = await totalsFor(trx, bill.work_order_id);
            return balanceView({ ...bill, total_amount: bill.total_amount }, totals, null);
        }), "Bill registration unavailable");
    }

    // ---- payments -------------------------------------------------------------

    async function recordPayment(authContext, input, idempotencyKey) {
        const actor = await requirePermission(authContext, PERMISSIONS.RECORD);
        const request = parse(paymentSchema, input, "Invalid payment details");
        return run(() => idempotent(actor, "payment.record", idempotencyKey, request, async (trx) => {
            const lock = await lockWorkOrder(trx, request.work_order_id);
            if (lock.is_locked) {
                throw new AppError("Payments for this work order are locked", 423);
            }
            const bill = await latestBill(trx, request.work_order_id);
            if (!bill) {
                throw new AppError("No issued bill for this work order", 404);
            }
            const balance = balanceView(bill, await totalsFor(trx, bill.work_order_id), lock);
            if (request.amount > balance.outstanding_balance) {
                throw new AppError("Payment exceeds the outstanding balance", 409);
            }

            const paymentId = createId();
            const paidAt = new Date(now());
            const row = {
                payment_id: paymentId,
                work_order_id: bill.work_order_id,
                bill_id: bill.bill_id,
                bill_version: bill.bill_version,
                amount: request.amount,
                currency: CURRENCY,
                payment_method: request.payment_method,
                status: "SUCCEEDED",
                reference_number: request.reference_number || null,
                recorded_by: actor,
                paid_at: paidAt,
                created_at: paidAt,
                updated_at: paidAt
            };
            await trx("payments").insert(row);
            await audit(trx, {
                paymentId, actor, action: "payment.recorded",
                metadata: { amount: request.amount, payment_method: request.payment_method }
            });
            await outbox(trx, {
                paymentId,
                type: "payment.succeeded",
                payload: {
                    payment_id: paymentId,
                    work_order_id: bill.work_order_id,
                    bill_id: bill.bill_id,
                    bill_version: bill.bill_version,
                    amount: request.amount,
                    currency: CURRENCY,
                    outstanding_balance: balance.outstanding_balance - request.amount
                }
            });
            return {
                resource_type: "payment",
                resource_id: paymentId,
                body: {
                    ...row,
                    paid_at: paidAt.toISOString(),
                    created_at: paidAt.toISOString(),
                    updated_at: undefined,
                    outstanding_balance: balance.outstanding_balance - request.amount
                }
            };
        }), "Payment recording unavailable");
    }

    async function voidPayment(authContext, paymentId, input) {
        const actor = await requirePermission(authContext, PERMISSIONS.RECORD);
        const targetId = parse(id, paymentId, "Invalid payment ID");
        const { reason: voidReason } = parse(voidSchema, input, "A void reason is required");
        return run(() => db.transaction(async (trx) => {
            const found = await trx("payments").select("work_order_id")
                .where({ payment_id: targetId }).first();
            if (!found) {
                throw new AppError("Payment not found", 404);
            }
            await lockWorkOrder(trx, found.work_order_id);
            const payment = await trx("payments").select(PAYMENT_FIELDS)
                .where({ payment_id: targetId }).forUpdate().first();
            if (payment.status !== "SUCCEEDED") {
                throw new AppError("Only a succeeded payment can be voided", 409);
            }
            const activeRefund = await trx("refunds").select("refund_id")
                .where({ payment_id: targetId })
                .whereIn("status", ACTIVE_REFUND_STATUSES)
                .first();
            if (activeRefund) {
                throw new AppError("Payment has refunds; it cannot be voided", 409);
            }
            const voidedAt = new Date(now());
            await trx("payments").where({ payment_id: targetId }).update({
                status: "VOIDED", voided_by: actor, void_reason: voidReason, voided_at: voidedAt
            });
            await audit(trx, {
                paymentId: targetId, actor, action: "payment.voided", reason: voidReason,
                metadata: { amount: toAmount(payment.amount) }
            });
            await outbox(trx, {
                paymentId: targetId,
                type: "payment.voided",
                payload: {
                    payment_id: targetId,
                    work_order_id: payment.work_order_id,
                    amount: toAmount(payment.amount),
                    currency: payment.currency
                }
            });
            return {
                ...payment,
                amount: toAmount(payment.amount),
                status: "VOIDED",
                voided_by: actor,
                void_reason: voidReason,
                voided_at: voidedAt
            };
        }), "Payment void unavailable");
    }

    // ---- work order payment lock ---------------------------------------------
    // A locked work order refuses new payments (e.g. a dispute or a bill under
    // review). payment_audit_logs needs a payment or refund target, so a lock
    // has no audit row; the lock row itself keeps the reason and time.

    async function setWorkOrderLock(authContext, workOrderId, input, locked) {
        await requirePermission(authContext, PERMISSIONS.RECORD);
        const targetId = parse(id, workOrderId, "Invalid Work Order ID");
        const { reason: lockReason } = parse(voidSchema, input,
            locked ? "A lock reason is required" : "An unlock reason is required");
        return run(() => db.transaction(async (trx) => {
            if (!await latestBill(trx, targetId)) {
                throw new AppError("No issued bill for this work order", 404);
            }
            const lock = await lockWorkOrder(trx, targetId);
            if (Boolean(lock.is_locked) === locked) {
                throw new AppError(locked ? "Work order is already locked" : "Work order is not locked", 409);
            }
            const lockedAt = locked ? new Date(now()) : null;
            await trx("payment_locks").where({ work_order_id: targetId }).update({
                is_locked: locked,
                lock_reason: locked ? lockReason : null,
                locked_at: lockedAt,
                source_event_id: null
            });
            return {
                work_order_id: targetId,
                is_locked: locked,
                lock_reason: locked ? lockReason : null,
                locked_at: lockedAt
            };
        }), "Payment lock unavailable");
    }

    const lockWorkOrderPayments = (authContext, workOrderId, input) =>
        setWorkOrderLock(authContext, workOrderId, input, true);
    const unlockWorkOrderPayments = (authContext, workOrderId, input) =>
        setWorkOrderLock(authContext, workOrderId, input, false);

    // ---- balances and lists ---------------------------------------------------

    async function getBalance(authContext, workOrderId) {
        const targetId = parse(id, workOrderId, "Invalid Work Order ID");
        actorOf(authContext);
        const canViewAll = await hasPermission(authContext, PERMISSIONS.VIEW_ALL);
        return run(async () => {
            const bill = await latestBill(db, targetId);
            if (!canViewAll) {
                await requireOwnership(authContext, bill, { work_order_id: targetId });
            }
            if (!bill) {
                throw new AppError("No issued bill for this work order", 404);
            }
            const lock = await db("payment_locks").select("is_locked", "lock_reason", "locked_at")
                .where({ work_order_id: targetId }).first();
            const view = balanceView(bill, await totalsFor(db, targetId), lock);
            // The reason is internal (e.g. a dispute note): admins only.
            return canViewAll && view.is_locked
                ? { ...view, lock_reason: lock.lock_reason, locked_at: lock.locked_at }
                : view;
        }, "Payment balance unavailable");
    }

    async function requireOwnership(authContext, bill, resource) {
        if (!await hasPermission(authContext, PERMISSIONS.VIEW_OWN, resource)) {
            throw new AppError("Not authorized for this payment operation", 403);
        }
        const customerId = await resolveCustomerId(authContext);
        // Same answer for "no bill" and "someone else's bill": no existence oracle.
        if (!bill || !customerId || bill.customer_id !== customerId) {
            throw new AppError("Not authorized for this payment operation", 403);
        }
    }

    async function resolveCustomerId(authContext) {
        try {
            return await requestCustomerId(authContext);
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Customer ownership verification unavailable", 503);
        }
    }

    function page(query, parsed) {
        return query
            .limit(parsed.page_size)
            .offset((parsed.page - 1) * parsed.page_size);
    }

    function withAmounts(rows) {
        return rows.map((row) => ({ ...row, amount: toAmount(row.amount) }));
    }

    async function listPayments(authContext, query) {
        await requirePermission(authContext, PERMISSIONS.VIEW_ALL);
        const parsed = parse(paymentListSchema, query, "Invalid payment query");
        return run(async () => {
            const filters = {};
            for (const key of ["work_order_id", "status", "payment_method"]) {
                if (parsed[key]) {
                    filters[key] = parsed[key];
                }
            }
            const rows = await page(
                db("payments").select(PAYMENT_FIELDS).where(filters)
                    .orderBy([{ column: "created_at", order: "desc" }, "payment_id"]),
                parsed
            );
            return { page: parsed.page, page_size: parsed.page_size, items: withAmounts(rows) };
        }, "Payment history unavailable");
    }

    async function listBalances(authContext) {
        await requirePermission(authContext, PERMISSIONS.VIEW_ALL);
        return run(async () => {
            const bills = await billsFor(db, null);
            const locks = new Map((await db("payment_locks").select("work_order_id", "is_locked"))
                .map((row) => [row.work_order_id, row]));
            const items = [];
            for (const bill of bills.values()) {
                items.push(balanceView(bill, await totalsFor(db, bill.work_order_id),
                    locks.get(bill.work_order_id)));
            }
            items.sort((left, right) => right.outstanding_balance - left.outstanding_balance
                || left.work_order_id.localeCompare(right.work_order_id));
            return { items };
        }, "Payment balances unavailable");
    }

    async function listMyPayments(authContext) {
        actorOf(authContext);
        return run(async () => {
            const customerId = await resolveCustomerId(authContext);
            if (!customerId) {
                throw new AppError("Not authorized for this payment operation", 403);
            }
            const owned = [...(await billsFor(db, null)).values()]
                .filter((bill) => bill.customer_id === customerId);
            if (owned.length === 0) {
                return { items: [] };
            }
            if (!await hasPermission(authContext, PERMISSIONS.VIEW_OWN,
                { work_order_id: owned[0].work_order_id })) {
                throw new AppError("Not authorized for this payment operation", 403);
            }
            const workOrderIds = owned.map((bill) => bill.work_order_id);
            const payments = withAmounts(await db("payments").select(OWN_PAYMENT_FIELDS)
                .whereIn("work_order_id", workOrderIds)
                .orderBy([{ column: "created_at", order: "desc" }, "payment_id"]));
            const items = [];
            for (const bill of owned) {
                items.push({
                    ...balanceView(bill, await totalsFor(db, bill.work_order_id), null),
                    is_locked: undefined,
                    payments: payments.filter((payment) => payment.work_order_id === bill.work_order_id)
                });
            }
            return { items };
        }, "Payment history unavailable");
    }

    // ---- refunds (manual provider, two people) --------------------------------

    async function requestRefund(authContext, input, idempotencyKey) {
        const actor = await requirePermission(authContext, PERMISSIONS.REFUND);
        const request = parse(refundSchema, input, "Invalid refund details");
        return run(() => idempotent(actor, "refund.request", idempotencyKey, request, async (trx) => {
            const found = await trx("payments").select("work_order_id")
                .where({ payment_id: request.payment_id }).first();
            if (!found) {
                throw new AppError("Payment not found", 404);
            }
            await lockWorkOrder(trx, found.work_order_id);
            const payment = await trx("payments").select("payment_id", "work_order_id", "amount", "status")
                .where({ payment_id: request.payment_id }).forUpdate().first();
            if (payment.status !== "SUCCEEDED") {
                throw new AppError("Only a succeeded payment can be refunded", 409);
            }
            const [reserved] = await trx("refunds").sum({ total: "amount" })
                .where({ payment_id: payment.payment_id })
                .whereIn("status", ACTIVE_REFUND_STATUSES);
            const refundable = toAmount(payment.amount) - toAmount(reserved?.total || 0);
            if (request.amount > refundable) {
                throw new AppError("Refund exceeds the refundable amount of the payment", 409);
            }
            const refundId = createId();
            const requestedAt = new Date(now());
            const row = {
                refund_id: refundId,
                payment_id: payment.payment_id,
                work_order_id: payment.work_order_id,
                amount: request.amount,
                currency: CURRENCY,
                status: "REQUESTED",
                requested_by: actor,
                reason: request.reason,
                requested_at: requestedAt,
                created_at: requestedAt,
                updated_at: requestedAt
            };
            await trx("refunds").insert(row);
            await audit(trx, {
                refundId, actor, action: "refund.requested", reason: request.reason,
                metadata: { amount: request.amount, payment_id: payment.payment_id }
            });
            return {
                resource_type: "refund",
                resource_id: refundId,
                body: {
                    ...row,
                    requested_at: requestedAt.toISOString(),
                    created_at: undefined,
                    updated_at: undefined
                }
            };
        }), "Refund request unavailable");
    }

    async function loadRefundForUpdate(trx, refundId) {
        const found = await trx("refunds").select("work_order_id")
            .where({ refund_id: refundId }).first();
        if (!found) {
            throw new AppError("Refund not found", 404);
        }
        await lockWorkOrder(trx, found.work_order_id);
        const refund = await trx("refunds").select(REFUND_FIELDS)
            .where({ refund_id: refundId }).forUpdate().first();
        return { ...refund, amount: toAmount(refund.amount) };
    }

    async function approveRefund(authContext, refundId) {
        const actor = await requirePermission(authContext, PERMISSIONS.REFUND);
        const targetId = parse(id, refundId, "Invalid refund ID");
        return run(() => db.transaction(async (trx) => {
            const refund = await loadRefundForUpdate(trx, targetId);
            if (refund.status !== "REQUESTED") {
                throw new AppError("Only a requested refund can be approved", 409);
            }
            if (refund.requested_by === actor) {
                throw new AppError("A refund must be approved by someone other than the requester", 403);
            }
            const approvedAt = new Date(now());
            await trx("refunds").where({ refund_id: targetId }).update({
                status: "APPROVED", approved_by: actor, approved_at: approvedAt
            });
            await audit(trx, { refundId: targetId, actor, action: "refund.approved" });
            return { ...refund, status: "APPROVED", approved_by: actor, approved_at: approvedAt };
        }), "Refund approval unavailable");
    }

    async function rejectRefund(authContext, refundId, input) {
        const actor = await requirePermission(authContext, PERMISSIONS.REFUND);
        const targetId = parse(id, refundId, "Invalid refund ID");
        const { reason: rejectionReason } = parse(rejectSchema, input, "A rejection reason is required");
        return run(() => db.transaction(async (trx) => {
            const refund = await loadRefundForUpdate(trx, targetId);
            if (!["REQUESTED", "APPROVED"].includes(refund.status)) {
                throw new AppError("Only a requested or approved refund can be rejected", 409);
            }
            const rejectedAt = new Date(now());
            await trx("refunds").where({ refund_id: targetId }).update({
                status: "REJECTED", rejection_reason: rejectionReason, rejected_at: rejectedAt
            });
            await audit(trx, {
                refundId: targetId, actor, action: "refund.rejected", reason: rejectionReason,
                metadata: { from_status: refund.status }
            });
            return {
                ...refund, status: "REJECTED", rejection_reason: rejectionReason, rejected_at: rejectedAt
            };
        }), "Refund rejection unavailable");
    }

    // Manual provider: the executor confirms the money was returned outside the
    // system. The executor must not be the requester.
    async function executeRefund(authContext, refundId) {
        const actor = await requirePermission(authContext, PERMISSIONS.REFUND);
        const targetId = parse(id, refundId, "Invalid refund ID");
        return run(() => db.transaction(async (trx) => {
            const refund = await loadRefundForUpdate(trx, targetId);
            if (refund.status !== "APPROVED") {
                throw new AppError("Only an approved refund can be executed", 409);
            }
            if (refund.requested_by === actor) {
                throw new AppError("A refund must be executed by someone other than the requester", 403);
            }
            const completedAt = new Date(now());
            await trx("refunds").where({ refund_id: targetId }).update({
                status: "COMPLETED", processed_at: completedAt, completed_at: completedAt
            });
            await audit(trx, {
                refundId: targetId, actor, action: "refund.completed",
                metadata: { amount: refund.amount, provider: "manual" }
            });
            await outbox(trx, {
                refundId: targetId,
                type: "refund.completed",
                payload: {
                    refund_id: targetId,
                    payment_id: refund.payment_id,
                    work_order_id: refund.work_order_id,
                    amount: refund.amount,
                    currency: refund.currency
                }
            });
            return {
                ...refund, status: "COMPLETED", processed_at: completedAt, completed_at: completedAt
            };
        }), "Refund execution unavailable");
    }

    async function listRefunds(authContext, query) {
        await requirePermission(authContext, PERMISSIONS.VIEW_ALL);
        const parsed = parse(refundListSchema, query, "Invalid refund query");
        return run(async () => {
            const filters = {};
            for (const key of ["work_order_id", "payment_id", "status"]) {
                if (parsed[key]) {
                    filters[key] = parsed[key];
                }
            }
            const rows = await page(
                db("refunds").select(REFUND_FIELDS).where(filters)
                    .orderBy([{ column: "requested_at", order: "desc" }, "refund_id"]),
                parsed
            );
            return { page: parsed.page, page_size: parsed.page_size, items: withAmounts(rows) };
        }, "Refund history unavailable");
    }

    return {
        registerBill,
        recordPayment,
        voidPayment,
        lockWorkOrderPayments,
        unlockWorkOrderPayments,
        getBalance,
        listPayments,
        listBalances,
        listMyPayments,
        requestRefund,
        approveRefund,
        rejectRefund,
        executeRefund,
        listRefunds
    };
}

module.exports = {
    PAYMENT_METHODS,
    createPaymentService
};
