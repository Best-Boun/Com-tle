const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");
const {
    createAuditLogService,
    getAuditRequestId
} = require("./auditLogService");

const requestSchema = z.object({
    work_order_id: z.string().trim().min(1).max(36),
    amount: z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    payment_method: z.string().trim().min(1).max(50)
}).strict();
const refundRequestSchema = z.object({
    payment_id: z.string().trim().min(1).max(36),
    amount: z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/),
    reason: z.string().trim().min(1).max(500)
}).strict();
const refundDecisionSchema = z.object({
    refund_id: z.string().trim().min(1).max(36),
    decision: z.enum(["APPROVED", "REJECTED"])
}).strict();
const refundExecutionSchema = z.object({
    refund_id: z.string().trim().min(1).max(36)
}).strict();
const paginationFields = {
    page: z.string().regex(/^[1-9]\d{0,6}$/).default("1"),
    page_size: z.string().regex(/^[1-9]\d{0,2}$/).default("25"),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional()
};
const paymentHistoryQuerySchema = z.object({
    ...paginationFields,
    status: z.enum(["PENDING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
    payment_method: z.string().trim().min(1).max(50).optional()
}).strict();
const refundHistoryQuerySchema = z.object({
    ...paginationFields,
    payment_id: z.string().trim().min(1).max(36).optional(),
    work_order_id: z.string().trim().min(1).max(36).optional(),
    status: z.enum([
        "REQUESTED",
        "APPROVED",
        "REJECTED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "CANCELLED"
    ]).optional()
}).strict();
const PAYMENT_HISTORY_FIELDS = [
    "payment_id",
    "work_order_id",
    "amount",
    "currency",
    "payment_method",
    "status",
    "created_at"
];
const REFUND_HISTORY_FIELDS = [
    "refunds.refund_id",
    "refunds.payment_id",
    "refunds.amount",
    "refunds.currency",
    "refunds.reason",
    "refunds.status",
    "refunds.initiated_by",
    "refunds.reviewer_user_id",
    "refunds.review_decision",
    "refunds.reviewed_at",
    "refunds.execution_result",
    "refunds.created_at",
    "refunds.updated_at"
];
const REFUND_RESERVED_STATUSES = [
    "REQUESTED",
    "APPROVED",
    "PROCESSING",
    "COMPLETED"
];

function toMinorUnits(value, fieldName) {
    if (typeof value !== "string"
        || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) {
        throw new AppError(`Invalid ${fieldName}`, 400);
    }

    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function fromMinorUnits(value) {
    return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function storedAmountToMinorUnits(value) {
    try {
        const amount = toMinorUnits(value, "stored amount");
        if (amount <= 0n) {
            throw new Error("Stored amount must be positive");
        }
        return amount;
    } catch {
        throw new AppError("Payment account balance is inconsistent", 409);
    }
}

function assertCurrencyMatches(value, expectedCurrency) {
    if (!/^[A-Z]{3}$/.test(value) || value !== expectedCurrency) {
        throw new AppError("Payment account balance has inconsistent currencies", 409);
    }
}

function assertHistoryCurrency(value, expectedCurrency, entity) {
    if (!/^[A-Z]{3}$/.test(value) || value !== expectedCurrency) {
        throw new AppError(`${entity} contains inconsistent currencies`, 409);
    }
}

async function calculateBalance(trx, account) {
    if (!/^[A-Z]{3}$/.test(account.currency)) {
        throw new AppError("Payment account balance has an invalid currency", 409);
    }

    const amountDue = storedAmountToMinorUnits(account.amount_due);
    const completedPayments = await trx("payments")
        .select("payment_id", "amount", "currency")
        .where({
            work_order_id: account.work_order_id,
            status: "COMPLETED"
        });
    let completedPaymentsTotal = 0n;
    for (const payment of completedPayments) {
        assertCurrencyMatches(payment.currency, account.currency);
        completedPaymentsTotal += storedAmountToMinorUnits(payment.amount);
    }

    let completedRefundsTotal = 0n;
    if (completedPayments.length > 0) {
        const completedRefunds = await trx("refunds")
            .select("amount", "currency")
            .whereIn(
                "payment_id",
                completedPayments.map((payment) => payment.payment_id)
            )
            .where({ status: "COMPLETED" });
        for (const refund of completedRefunds) {
            assertCurrencyMatches(refund.currency, account.currency);
            completedRefundsTotal += storedAmountToMinorUnits(refund.amount);
        }
    }
    if (completedRefundsTotal > completedPaymentsTotal) {
        throw new AppError("Payment account balance is inconsistent", 409);
    }

    const outstandingBalance = amountDue - completedPaymentsTotal + completedRefundsTotal;
    if (outstandingBalance < 0n) {
        throw new AppError("Payment account balance is inconsistent", 409);
    }

    return {
        work_order_id: account.work_order_id,
        currency: account.currency,
        amount_due: fromMinorUnits(amountDue),
        completed_payments_total: fromMinorUnits(completedPaymentsTotal),
        completed_refunds_total: fromMinorUnits(completedRefundsTotal),
        outstanding_balance: fromMinorUnits(outstandingBalance),
        amountDue,
        completedPaymentsTotal,
        completedRefundsTotal,
        outstandingBalance
    };
}

function trustedDependencyError(error, message) {
    if (error instanceof AppError) {
        return error;
    }
    return new AppError(message, 503);
}

function createPaymentService({
    db,
    authorizePaymentRecorder,
    authorizePaymentQuery,
    authorizeRefundQuery,
    authorizeRefundActor,
    refundProvider,
    allowTestRefundProvider = false,
    verifyApprovedPaymentAccount,
    isApprovedPaymentMethod,
    createId = randomUUID,
    createAuditId = randomUUID,
    now = Date.now
} = {}) {
    if (!db
        || typeof authorizePaymentRecorder !== "function"
        || typeof verifyApprovedPaymentAccount !== "function"
        || typeof isApprovedPaymentMethod !== "function") {
        throw new Error(
            "Database, trusted payment authorization, approved-account verifier, "
            + "and payment-method validator are required"
        );
    }
    const auditLog = createAuditLogService({ createId: createAuditId, now });
    const refundProviderConfigured = typeof refundProvider?.executeRefund === "function"
        && (refundProvider.trusted === true
            || (refundProvider.testOnly === true
                && allowTestRefundProvider === true
                && process.env.NODE_ENV !== "production"));

    async function recordAudit(trx, authContext, event) {
        return auditLog.record(trx, {
            ...event,
            actor_user_id: event.actor_user_id || null,
            request_id: getAuditRequestId(authContext),
            occurred_at: new Date(now()),
            metadata: event.metadata || null
        });
    }

    async function recordRejectedPayment(actorUserId, authContext, reasonCode) {
        await db.transaction(async (trx) => {
            await recordAudit(trx, authContext, {
                event_key: `payment.record.rejected:${getAuditRequestId(authContext) || createId()}`,
                actor_user_id: actorUserId,
                action: "payment.record.rejected",
                target_entity_type: "PAYMENT",
                target_entity_id: null,
                outcome: "FAILURE",
                metadata: { reason_code: reasonCode }
            });
        });
    }

    async function recordPayment(authContext, input) {
        let actorUserId;
        try {
            actorUserId = await authorizePaymentRecorder(authContext);
        } catch (error) {
            throw trustedDependencyError(error, "Payment authorization unavailable");
        }
        if (typeof actorUserId !== "string"
            || actorUserId.trim().length === 0
            || actorUserId.trim().length > 36) {
            throw new AppError("Payment recording is not authorized", 403);
        }
        actorUserId = actorUserId.trim();

        const parsed = requestSchema.safeParse(input);
        if (!parsed.success) {
            await recordRejectedPayment(actorUserId, authContext, "invalid_request");
            throw new AppError("Invalid payment details", 400);
        }
        let paymentAmount;
        try {
            paymentAmount = toMinorUnits(parsed.data.amount, "payment amount");
        } catch (error) {
            await recordRejectedPayment(actorUserId, authContext, "invalid_amount");
            throw error;
        }
        if (paymentAmount <= 0n) {
            await recordRejectedPayment(actorUserId, authContext, "invalid_amount");
            throw new AppError("Payment amount must be greater than zero", 400);
        }

        let methodAllowed;
        try {
            methodAllowed = await isApprovedPaymentMethod(parsed.data.payment_method);
        } catch {
            throw new AppError("Payment method validation unavailable", 503);
        }
        if (methodAllowed !== true) {
            await recordRejectedPayment(actorUserId, authContext, "unsupported_method");
            throw new AppError("Unsupported payment method", 400);
        }

        try {
            return await db.transaction(async (trx) => {
                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "amount_due", "currency")
                    .where({ work_order_id: parsed.data.work_order_id })
                    .forUpdate()
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 404);
                }

                let approvedAccount;
                try {
                    approvedAccount = await verifyApprovedPaymentAccount(trx, account);
                } catch (error) {
                    throw trustedDependencyError(
                        error,
                        "Approved quotation verification unavailable"
                    );
                }
                if (approvedAccount !== true) {
                    throw new AppError(
                        "Payment account has no verified approved quotation",
                        409
                    );
                }

                if (account.currency !== parsed.data.currency) {
                    throw new AppError("Payment currency does not match the account", 400);
                }

                const balance = await calculateBalance(trx, account);
                if (balance.outstandingBalance <= 0n
                    || paymentAmount > balance.outstandingBalance) {
                    throw new AppError("Payment exceeds the outstanding balance", 409);
                }

                const paymentId = createId();
                const occurredAt = new Date(now());
                await trx("payments").insert({
                    payment_id: paymentId,
                    work_order_id: account.work_order_id,
                    amount: fromMinorUnits(paymentAmount),
                    currency: account.currency,
                    payment_method: parsed.data.payment_method,
                    recorded_by: actorUserId,
                    status: "COMPLETED",
                    created_at: occurredAt,
                    updated_at: occurredAt
                });
                await recordAudit(trx, authContext, {
                    event_key: `payment.recorded:${paymentId}`,
                    actor_user_id: actorUserId,
                    action: "payment.recorded",
                    target_entity_type: "PAYMENT",
                    target_entity_id: paymentId,
                    outcome: "SUCCESS",
                    metadata: {
                        amount: fromMinorUnits(paymentAmount),
                        currency: account.currency,
                        payment_method: parsed.data.payment_method
                    }
                });

                return {
                    payment_id: paymentId,
                    work_order_id: account.work_order_id,
                    amount: fromMinorUnits(paymentAmount),
                    currency: account.currency,
                    payment_method: parsed.data.payment_method,
                    status: "COMPLETED",
                    recorded_by: actorUserId,
                    paid_total: fromMinorUnits(
                        balance.completedPaymentsTotal + paymentAmount
                    ),
                    outstanding_balance: fromMinorUnits(
                        balance.outstandingBalance - paymentAmount
                    ),
                    created_at: occurredAt
                };
            });
        } catch (error) {
            if (error instanceof AppError) {
                const rejectedReasons = new Map([
                    ["Payment currency does not match the account", "currency_mismatch"],
                    ["Payment exceeds the outstanding balance", "overpayment"],
                    ["Payment account balance is inconsistent", "balance_inconsistent"],
                    [
                        "Payment account balance has inconsistent currencies",
                        "currency_inconsistent"
                    ],
                    [
                        "Payment account balance has an invalid currency",
                        "currency_inconsistent"
                    ]
                ]);
                const reasonCode = rejectedReasons.get(error.message);
                if (reasonCode) {
                    await recordRejectedPayment(actorUserId, authContext, reasonCode);
                }
                throw error;
            }
            throw new AppError("Payment recording unavailable", 503);
        }
    }

    async function getBalance(workOrderId) {
        if (typeof workOrderId !== "string"
            || workOrderId.trim().length === 0
            || workOrderId.trim().length > 36) {
            throw new AppError("Invalid Work Order ID", 400);
        }

        try {
            return await db.transaction(async (trx) => {
                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "amount_due", "currency")
                    .where({ work_order_id: workOrderId.trim() })
                    .forUpdate()
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 404);
                }

                let approvedAccount;
                try {
                    approvedAccount = await verifyApprovedPaymentAccount(trx, account);
                } catch (error) {
                    throw trustedDependencyError(
                        error,
                        "Approved quotation verification unavailable"
                    );
                }
                if (approvedAccount !== true) {
                    throw new AppError(
                        "Payment account has no verified approved quotation",
                        409
                    );
                }

                const balance = await calculateBalance(trx, account);
                return {
                    work_order_id: balance.work_order_id,
                    currency: balance.currency,
                    amount_due: balance.amount_due,
                    completed_payments_total: balance.completed_payments_total,
                    completed_refunds_total: balance.completed_refunds_total,
                    outstanding_balance: balance.outstanding_balance
                };
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Payment balance retrieval unavailable", 503);
        }
    }

    function parseHistoryQuery(schema, query) {
        const parsed = schema.safeParse(query);
        if (!parsed.success) {
            throw new AppError("Invalid history query", 400);
        }
        const page = Number(parsed.data.page);
        const pageSize = Number(parsed.data.page_size);
        if (pageSize > 100 || page > 1_000_000) {
            throw new AppError("Invalid pagination values", 400);
        }
        const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
        const to = parsed.data.to ? new Date(parsed.data.to) : undefined;
        if (from && to && from > to) {
            throw new AppError("Invalid date range", 400);
        }
        return {
            ...parsed.data,
            page,
            page_size: pageSize,
            from,
            to,
            offset: (page - 1) * pageSize
        };
    }

    async function authorizeQuery(provider, authContext, resource, message) {
        if (typeof provider !== "function") {
            throw new AppError(message, 503);
        }
        let allowed;
        try {
            allowed = await provider(authContext, resource);
        } catch (error) {
            throw trustedDependencyError(error, message);
        }
        if (allowed !== true && allowed?.allowed !== true) {
            throw new AppError("Payment history access is not authorized", 403);
        }
        return allowed === true ? {} : allowed;
    }

    function safePaymentRow(row, includeRecordedBy = false) {
        const result = {
            payment_id: row.payment_id,
            work_order_id: row.work_order_id,
            amount: row.amount,
            currency: row.currency,
            payment_method: row.payment_method,
            status: row.status,
            created_at: row.created_at
        };
        if (includeRecordedBy === true) {
            result.recorded_by = row.recorded_by;
        }
        return result;
    }

    async function verifyHistoryPaymentMethod(method) {
        if (method === undefined) {
            return;
        }
        let methodAllowed;
        try {
            methodAllowed = await isApprovedPaymentMethod(method);
        } catch {
            throw new AppError("Payment method validation unavailable", 503);
        }
        if (methodAllowed !== true) {
            throw new AppError("Unsupported payment method", 400);
        }
    }

    function applyDateRange(query, parsed) {
        if (parsed.from) {
            query.where("created_at", ">=", parsed.from);
        }
        if (parsed.to) {
            query.where("created_at", "<=", parsed.to);
        }
        return query;
    }

    async function getPaymentHistory(authContext, workOrderId, query = {}) {
        if (typeof workOrderId !== "string"
            || workOrderId.trim().length === 0
            || workOrderId.trim().length > 36) {
            throw new AppError("Invalid Work Order ID", 400);
        }
        const parsed = parseHistoryQuery(paymentHistoryQuerySchema, query);
        await verifyHistoryPaymentMethod(parsed.payment_method);
        const normalizedWorkOrderId = workOrderId.trim();
        const authorization = await authorizeQuery(
            authorizePaymentQuery,
            authContext,
            { work_order_id: normalizedWorkOrderId },
            "Payment history authorization unavailable"
        );

        try {
            return await db.transaction(async (trx) => {
                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "currency")
                    .where({ work_order_id: normalizedWorkOrderId })
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 404);
                }

                const base = () => {
                    let builder = trx("payments")
                        .where({ work_order_id: normalizedWorkOrderId });
                    if (parsed.status) {
                        builder = builder.where({ status: parsed.status });
                    }
                    if (parsed.payment_method) {
                        builder = builder.where({
                            payment_method: parsed.payment_method
                        });
                    }
                    return applyDateRange(builder, parsed);
                };
                const countRow = await base().count({ total: "payment_id" }).first();
                const rows = await base()
                    .select(
                        ...(authorization.include_recorded_by === true
                            ? [...PAYMENT_HISTORY_FIELDS, "recorded_by"]
                            : PAYMENT_HISTORY_FIELDS)
                    )
                    .orderBy("created_at", "desc")
                    .orderBy("payment_id", "desc")
                    .limit(parsed.page_size)
                    .offset(parsed.offset);
                for (const row of rows) {
                    assertHistoryCurrency(
                        row.currency,
                        account.currency,
                        "Payment history"
                    );
                }
                const total = Number(countRow?.total || 0);

                return {
                    items: rows.map((row) =>
                        safePaymentRow(row, authorization.include_recorded_by === true)
                    ),
                    pagination: {
                        page: parsed.page,
                        page_size: parsed.page_size,
                        total,
                        total_pages: Math.ceil(total / parsed.page_size)
                    }
                };
            }, { isolationLevel: "repeatable read" });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Payment history unavailable", 503);
        }
    }

    async function getPaymentDetails(authContext, paymentId) {
        if (typeof paymentId !== "string"
            || paymentId.trim().length === 0
            || paymentId.trim().length > 36) {
            throw new AppError("Invalid Payment ID", 400);
        }
        try {
            return await db.transaction(async (trx) => {
                const payment = await trx("payments")
                    .select(
                        "payment_id",
                        "work_order_id",
                        "amount",
                        "currency",
                        "payment_method",
                        "status",
                        "recorded_by",
                        "created_at"
                    )
                    .where({ payment_id: paymentId.trim() })
                    .first();
                if (!payment) {
                    throw new AppError("Payment not found", 404);
                }
                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "currency")
                    .where({ work_order_id: payment.work_order_id })
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 404);
                }
                assertHistoryCurrency(
                    payment.currency,
                    account.currency,
                    "Payment details"
                );
                const authorization = await authorizeQuery(
                    authorizePaymentQuery,
                    authContext,
                    {
                        work_order_id: payment.work_order_id,
                        payment_id: payment.payment_id
                    },
                    "Payment history authorization unavailable"
                );
                return safePaymentRow(
                    payment,
                    authorization.include_recorded_by === true
                );
            }, { isolationLevel: "repeatable read" });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Payment details unavailable", 503);
        }
    }

    async function getRefundHistory(authContext, query = {}) {
        const parsed = parseHistoryQuery(refundHistoryQuerySchema, query);
        if (!parsed.payment_id && !parsed.work_order_id) {
            throw new AppError("Payment ID or Work Order ID is required", 400);
        }
        const authorization = await authorizeQuery(
            authorizeRefundQuery,
            authContext,
            {
                payment_id: parsed.payment_id,
                work_order_id: parsed.work_order_id
            },
            "Refund history authorization unavailable"
        );

        try {
            return await db.transaction(async (trx) => {
                let base = trx("refunds")
                    .join("payments", "refunds.payment_id", "payments.payment_id");
                let paymentScope;
                let accountCurrency;
                if (parsed.payment_id) {
                    paymentScope = await trx("payments")
                        .select("payment_id", "work_order_id", "currency")
                        .where({ payment_id: parsed.payment_id })
                        .first();
                    if (!paymentScope) {
                        throw new AppError("Payment not found", 404);
                    }
                    const account = await trx("work_order_payment_accounts")
                        .select("work_order_id", "currency")
                        .where({ work_order_id: paymentScope.work_order_id })
                        .first();
                    if (!account) {
                        throw new AppError("Payment account not found", 404);
                    }
                    accountCurrency = account.currency;
                    assertHistoryCurrency(
                        paymentScope.currency,
                        accountCurrency,
                        "Payment"
                    );
                    base = base.where({ "refunds.payment_id": parsed.payment_id });
                }
                if (parsed.work_order_id) {
                    const account = await trx("work_order_payment_accounts")
                        .select("work_order_id", "currency")
                        .where({ work_order_id: parsed.work_order_id })
                        .first();
                    if (!account) {
                        throw new AppError("Payment account not found", 404);
                    }
                    if (paymentScope
                        && paymentScope.work_order_id !== parsed.work_order_id) {
                        throw new AppError("Payment not found", 404);
                    }
                    accountCurrency = account.currency;
                    base = base.where({ "payments.work_order_id": parsed.work_order_id });
                }
                if (parsed.status) {
                    base = base.where({ "refunds.status": parsed.status });
                }
                if (parsed.from) {
                    base = base.where("refunds.created_at", ">=", parsed.from);
                }
                if (parsed.to) {
                    base = base.where("refunds.created_at", "<=", parsed.to);
                }

                const countRow = await base.clone()
                    .count({ total: "refunds.refund_id" })
                    .first();
                const rows = await base.clone()
                    .select(
                        ...REFUND_HISTORY_FIELDS,
                        "payments.currency as payment_currency"
                    )
                    .orderBy("refunds.created_at", "desc")
                    .orderBy("refunds.refund_id", "desc")
                    .limit(parsed.page_size)
                    .offset(parsed.offset);
                for (const row of rows) {
                    assertHistoryCurrency(
                        row.currency,
                        row.payment_currency,
                        "Refund history"
                    );
                    assertHistoryCurrency(
                        row.payment_currency,
                        accountCurrency,
                        "Refund history"
                    );
                }
                const items = rows.map((row) => ({
                    refund_id: row.refund_id,
                    payment_id: row.payment_id,
                    amount: row.amount,
                    currency: row.currency,
                    reason: row.reason,
                    status: row.status,
                    initiated_by: row.initiated_by,
                    reviewer_user_id: row.reviewer_user_id,
                    review_decision: row.review_decision,
                    reviewed_at: row.reviewed_at,
                    execution_result: row.execution_result,
                    created_at: row.created_at,
                    updated_at: row.updated_at
                }));
                const total = Number(countRow?.total || 0);
                return {
                    items,
                    pagination: {
                        page: parsed.page,
                        page_size: parsed.page_size,
                        total,
                        total_pages: Math.ceil(total / parsed.page_size)
                    }
                };
            }, { isolationLevel: "repeatable read" });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Refund history unavailable", 503);
        }
    }

    async function getRefundDetails(authContext, refundId) {
        if (typeof refundId !== "string"
            || refundId.trim().length === 0
            || refundId.trim().length > 36) {
            throw new AppError("Invalid Refund ID", 400);
        }
        try {
            return await db.transaction(async (trx) => {
                const refund = await trx("refunds")
                    .join("payments", "refunds.payment_id", "payments.payment_id")
                    .select(
                        ...REFUND_HISTORY_FIELDS,
                        "payments.work_order_id as work_order_id",
                        "payments.currency as payment_currency"
                    )
                    .where({ "refunds.refund_id": refundId.trim() })
                    .first();
                if (!refund) {
                    throw new AppError("Refund not found", 404);
                }
                const account = await trx("work_order_payment_accounts")
                    .select("currency")
                    .where({ work_order_id: refund.work_order_id })
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 404);
                }
                assertHistoryCurrency(
                    refund.payment_currency,
                    account.currency,
                    "Payment"
                );
                assertHistoryCurrency(
                    refund.currency,
                    refund.payment_currency,
                    "Refund details"
                );
                await authorizeQuery(
                    authorizeRefundQuery,
                    authContext,
                    {
                        refund_id: refund.refund_id,
                        payment_id: refund.payment_id,
                        work_order_id: refund.work_order_id
                    },
                    "Refund history authorization unavailable"
                );
                return {
                    refund_id: refund.refund_id,
                    payment_id: refund.payment_id,
                    amount: refund.amount,
                    currency: refund.currency,
                    reason: refund.reason,
                    status: refund.status,
                    initiated_by: refund.initiated_by,
                    reviewer_user_id: refund.reviewer_user_id,
                    review_decision: refund.review_decision,
                    reviewed_at: refund.reviewed_at,
                    execution_result: refund.execution_result,
                    created_at: refund.created_at,
                    updated_at: refund.updated_at
                };
            }, { isolationLevel: "repeatable read" });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Refund details unavailable", 503);
        }
    }

    async function getRefundActor(authContext) {
        if (typeof authorizeRefundActor !== "function") {
            throw new AppError("Refund authorization unavailable", 503);
        }

        let actorUserId;
        try {
            actorUserId = await authorizeRefundActor(authContext, "can_refund");
        } catch (error) {
            throw trustedDependencyError(error, "Refund authorization unavailable");
        }
        if (typeof actorUserId !== "string"
            || actorUserId.trim().length === 0
            || actorUserId.trim().length > 36) {
            throw new AppError("Refund operation is not authorized", 403);
        }
        return actorUserId.trim();
    }

    async function verifyAccount(trx, account) {
        let approvedAccount;
        try {
            approvedAccount = await verifyApprovedPaymentAccount(trx, account);
        } catch (error) {
            throw trustedDependencyError(
                error,
                "Approved quotation verification unavailable"
            );
        }
        if (approvedAccount !== true) {
            throw new AppError(
                "Payment account has no verified approved quotation",
                409
            );
        }
    }

    async function createRefundRequest(authContext, input) {
        const actorUserId = await getRefundActor(authContext);
        const parsed = refundRequestSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid refund request", 400);
        }
        const requestedAmount = toMinorUnits(parsed.data.amount, "refund amount");
        if (requestedAmount <= 0n) {
            throw new AppError("Refund amount must be greater than zero", 400);
        }

        try {
            return await db.transaction(async (trx) => {
                const initialPayment = await trx("payments")
                    .select("payment_id", "work_order_id")
                    .where({ payment_id: parsed.data.payment_id })
                    .first();
                if (!initialPayment) {
                    throw new AppError("Payment not found", 404);
                }

                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "amount_due", "currency")
                    .where({ work_order_id: initialPayment.work_order_id })
                    .forUpdate()
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 409);
                }
                await verifyAccount(trx, account);

                const payment = await trx("payments")
                    .select("payment_id", "work_order_id", "amount", "currency", "status")
                    .where({ payment_id: parsed.data.payment_id })
                    .forUpdate()
                    .first();
                if (!payment || payment.work_order_id !== account.work_order_id) {
                    throw new AppError("Payment not found", 404);
                }
                if (payment.status !== "COMPLETED") {
                    throw new AppError("Payment is not eligible for a refund", 409);
                }
                assertCurrencyMatches(payment.currency, account.currency);

                const paymentAmount = storedAmountToMinorUnits(payment.amount);
                const reservedRefunds = await trx("refunds")
                    .select("amount", "currency")
                    .where({ payment_id: payment.payment_id })
                    .whereIn("status", REFUND_RESERVED_STATUSES);
                let reservedTotal = 0n;
                for (const refund of reservedRefunds) {
                    assertCurrencyMatches(refund.currency, payment.currency);
                    reservedTotal += storedAmountToMinorUnits(refund.amount);
                }
                if (reservedTotal > paymentAmount) {
                    throw new AppError("Refund reservations are inconsistent", 409);
                }
                if (requestedAmount > paymentAmount - reservedTotal) {
                    throw new AppError("Refund exceeds the refundable amount", 409);
                }

                const refundId = createId();
                const occurredAt = new Date(now());
                const refund = {
                    refund_id: refundId,
                    payment_id: payment.payment_id,
                    amount: fromMinorUnits(requestedAmount),
                    currency: payment.currency,
                    status: "REQUESTED",
                    reason: parsed.data.reason,
                    initiated_by: actorUserId,
                    reviewer_user_id: null,
                    review_decision: null,
                    reviewed_at: null,
                    created_at: occurredAt,
                    updated_at: occurredAt
                };
                await trx("refunds").insert(refund);
                await recordAudit(trx, authContext, {
                    event_key: `refund.requested:${refundId}`,
                    actor_user_id: actorUserId,
                    action: "refund.requested",
                    target_entity_type: "REFUND",
                    target_entity_id: refundId,
                    outcome: "SUCCESS",
                    metadata: {
                        amount: refund.amount,
                        currency: refund.currency,
                        payment_id: refund.payment_id,
                        to_status: refund.status
                    }
                });

                return { ...refund };
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Refund request unavailable", 503);
        }
    }

    async function decideRefundRequest(authContext, input) {
        const reviewerUserId = await getRefundActor(authContext);
        const parsed = refundDecisionSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid refund decision", 400);
        }

        try {
            return await db.transaction(async (trx) => {
                const initialRefund = await trx("refunds")
                    .select("refund_id", "payment_id")
                    .where({ refund_id: parsed.data.refund_id })
                    .first();
                if (!initialRefund) {
                    throw new AppError("Refund request not found", 404);
                }
                const initialPayment = await trx("payments")
                    .select("payment_id", "work_order_id")
                    .where({ payment_id: initialRefund.payment_id })
                    .first();
                if (!initialPayment) {
                    throw new AppError("Payment not found", 409);
                }

                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "amount_due", "currency")
                    .where({ work_order_id: initialPayment.work_order_id })
                    .forUpdate()
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 409);
                }
                await verifyAccount(trx, account);

                const payment = await trx("payments")
                    .select("payment_id", "work_order_id")
                    .where({ payment_id: initialRefund.payment_id })
                    .forUpdate()
                    .first();
                const refund = await trx("refunds")
                    .select(
                        "refund_id",
                        "payment_id",
                        "status",
                        "initiated_by"
                    )
                    .where({ refund_id: parsed.data.refund_id })
                    .forUpdate()
                    .first();
                if (!payment
                    || payment.work_order_id !== account.work_order_id
                    || !refund
                    || refund.payment_id !== payment.payment_id) {
                    throw new AppError("Refund request not found", 404);
                }
                if (refund.initiated_by === reviewerUserId) {
                    throw new AppError(
                        "Refund initiator cannot review their own request",
                        403
                    );
                }
                if (refund.status !== "REQUESTED") {
                    throw new AppError("Refund request is not reviewable", 409);
                }

                const reviewedAt = new Date(now());
                const updatedRows = await trx("refunds")
                    .where({
                        refund_id: refund.refund_id,
                        status: "REQUESTED"
                    })
                    .update({
                        status: parsed.data.decision,
                        reviewer_user_id: reviewerUserId,
                        review_decision: parsed.data.decision,
                        reviewed_at: reviewedAt,
                        updated_at: reviewedAt
                    });
                if (updatedRows !== 1) {
                    throw new AppError("Refund request is not reviewable", 409);
                }
                await recordAudit(trx, authContext, {
                    event_key: `refund.${parsed.data.decision.toLowerCase()}:${refund.refund_id}`,
                    actor_user_id: reviewerUserId,
                    action: `refund.${parsed.data.decision.toLowerCase()}`,
                    target_entity_type: "REFUND",
                    target_entity_id: refund.refund_id,
                    outcome: "SUCCESS",
                    metadata: {
                        from_status: "REQUESTED",
                        to_status: parsed.data.decision
                    }
                });

                return {
                    refund_id: refund.refund_id,
                    status: parsed.data.decision,
                    initiated_by: refund.initiated_by,
                    reviewer_user_id: reviewerUserId,
                    review_decision: parsed.data.decision,
                    reviewed_at: reviewedAt
                };
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Refund decision unavailable", 503);
        }
    }

    async function executeRefund(authContext, input) {
        const actorUserId = await getRefundActor(authContext);
        const parsed = refundExecutionSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid refund execution request", 400);
        }
        if (!refundProviderConfigured) {
            throw new AppError("Refund provider is not configured", 503);
        }

        let execution;
        try {
            execution = await db.transaction(async (trx) => {
                const initialRefund = await trx("refunds")
                    .select("refund_id", "payment_id")
                    .where({ refund_id: parsed.data.refund_id })
                    .first();
                if (!initialRefund) {
                    throw new AppError("Refund request not found", 404);
                }
                const initialPayment = await trx("payments")
                    .select("payment_id", "work_order_id")
                    .where({ payment_id: initialRefund.payment_id })
                    .first();
                if (!initialPayment) {
                    throw new AppError("Payment not found", 409);
                }

                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id", "amount_due", "currency")
                    .where({ work_order_id: initialPayment.work_order_id })
                    .forUpdate()
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 409);
                }
                await verifyAccount(trx, account);

                const payment = await trx("payments")
                    .select("payment_id", "work_order_id", "amount", "currency", "status")
                    .where({ payment_id: initialRefund.payment_id })
                    .forUpdate()
                    .first();
                const refund = await trx("refunds")
                    .select(
                        "refund_id",
                        "payment_id",
                        "amount",
                        "currency",
                        "status",
                        "initiated_by",
                        "reviewer_user_id",
                        "review_decision",
                        "execution_started_at",
                        "execution_attempts",
                        "execution_lease_token",
                        "execution_lease_until",
                        "execution_result",
                        "idempotency_key"
                    )
                    .where({ refund_id: parsed.data.refund_id })
                    .forUpdate()
                    .first();
                if (!payment
                    || payment.work_order_id !== account.work_order_id
                    || payment.status !== "COMPLETED"
                    || !refund
                    || refund.payment_id !== payment.payment_id) {
                    throw new AppError("Refund request not found", 404);
                }
                if (!refund.initiated_by
                    || !refund.reviewer_user_id
                    || refund.reviewer_user_id === refund.initiated_by
                    || refund.review_decision !== "APPROVED") {
                    throw new AppError("Refund has no valid approval", 409);
                }
                assertCurrencyMatches(payment.currency, account.currency);
                assertCurrencyMatches(refund.currency, payment.currency);
                const paymentAmount = storedAmountToMinorUnits(payment.amount);
                const refundAmount = storedAmountToMinorUnits(refund.amount);
                if (refundAmount > paymentAmount) {
                    throw new AppError("Refund reservations are inconsistent", 409);
                }

                const currentTime = now();
                const currentTimestamp = new Date(currentTime);
                const allowedRetry = refund.status === "FAILED"
                    && refund.execution_result === "FAILED";
                if (refund.status !== "APPROVED"
                    && refund.status !== "PROCESSING"
                    && !allowedRetry) {
                    throw new AppError("Refund request is not executable", 409);
                }
                if (refund.status === "PROCESSING" && refund.execution_lease_until) {
                    const leaseEnd = new Date(refund.execution_lease_until).getTime();
                    if (!Number.isFinite(leaseEnd)) {
                        throw new AppError("Refund execution state is inconsistent", 409);
                    }
                    if (leaseEnd > currentTimestamp.getTime()) {
                        throw new AppError("Refund execution is already in progress", 409);
                    }
                }

                const reservations = await trx("refunds")
                    .select("refund_id", "amount", "currency", "status")
                    .where({ payment_id: payment.payment_id });
                let reservedOther = 0n;
                for (const reserved of reservations) {
                    if (reserved.refund_id === refund.refund_id
                        || !REFUND_RESERVED_STATUSES.includes(reserved.status)) {
                        continue;
                    }
                    assertCurrencyMatches(reserved.currency, payment.currency);
                    reservedOther += storedAmountToMinorUnits(reserved.amount);
                }
                if (reservedOther + refundAmount > paymentAmount) {
                    throw new AppError("Refund exceeds the refundable amount", 409);
                }

                const leaseToken = createId();
                const idempotencyKey = refund.idempotency_key || `refund:${refund.refund_id}`;
                const leaseUntil = new Date(currentTimestamp.getTime() + 60_000);
                const executionAttempt = (refund.execution_attempts || 0) + 1;
                const isRetry = executionAttempt > 1;
                const updatedRows = await trx("refunds")
                    .where({ refund_id: refund.refund_id })
                    .where({ status: refund.status })
                    .update({
                        status: "PROCESSING",
                        execution_started_at: refund.execution_started_at || currentTimestamp,
                        executing_by: actorUserId,
                        execution_attempts: executionAttempt,
                        execution_lease_token: leaseToken,
                        execution_lease_until: leaseUntil,
                        execution_result: "UNKNOWN",
                        idempotency_key: idempotencyKey,
                        updated_at: currentTimestamp
                    });
                if (updatedRows !== 1) {
                    throw new AppError("Refund execution state changed; retry", 409);
                }
                await recordAudit(trx, authContext, {
                    event_key: `refund.execution.started:${refund.refund_id}:${refund.execution_attempts + 1}`,
                    actor_user_id: actorUserId,
                    action: "refund.execution.started",
                    target_entity_type: "REFUND",
                    target_entity_id: refund.refund_id,
                    outcome: "SUCCESS",
                    metadata: {
                        execution_attempt: executionAttempt,
                        from_status: refund.status,
                        to_status: "PROCESSING"
                    }
                });
                if (isRetry) {
                    await recordAudit(trx, authContext, {
                        event_key: `refund.execution.retry_attempted:${refund.refund_id}:${refund.execution_attempts + 1}`,
                        actor_user_id: actorUserId,
                        action: "refund.execution.retry_attempted",
                        target_entity_type: "REFUND",
                        target_entity_id: refund.refund_id,
                        outcome: "SUCCESS",
                        metadata: {
                            execution_attempt: executionAttempt,
                            from_status: refund.status,
                            to_status: "PROCESSING"
                        }
                    });
                }

                return {
                    refund_id: refund.refund_id,
                    payment_id: payment.payment_id,
                    amount: fromMinorUnits(refundAmount),
                    currency: refund.currency,
                    idempotency_key: idempotencyKey,
                    lease_token: leaseToken,
                    executing_by: actorUserId
                };
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Refund execution could not be started", 503);
        }

        let providerResult;
        try {
            providerResult = await refundProvider.executeRefund({
                refund_id: execution.refund_id,
                payment_id: execution.payment_id,
                amount: execution.amount,
                currency: execution.currency,
                idempotency_key: execution.idempotency_key
            });
        } catch {
            providerResult = { outcome: "unknown" };
        }

        const validExternalReference = providerResult?.external_reference_id === undefined
            || (typeof providerResult.external_reference_id === "string"
                && providerResult.external_reference_id.trim().length > 0
                && providerResult.external_reference_id.length <= 191);
        const outcome = validExternalReference
            && ["succeeded", "failed", "unknown"].includes(providerResult?.outcome)
            ? providerResult.outcome
            : "unknown";
        const externalReferenceId = validExternalReference
            ? providerResult.external_reference_id || null
            : null;

        try {
            return await db.transaction(async (trx) => {
                const currentRefund = await trx("refunds")
                    .select(
                        "refund_id",
                        "payment_id",
                        "status",
                        "execution_lease_token",
                        "executing_by"
                    )
                    .where({ refund_id: execution.refund_id })
                    .first();
                if (!currentRefund) {
                    throw new AppError("Refund request not found", 404);
                }
                const currentPayment = await trx("payments")
                    .select("payment_id", "work_order_id")
                    .where({ payment_id: currentRefund.payment_id })
                    .first();
                if (!currentPayment) {
                    throw new AppError("Payment not found", 409);
                }
                const account = await trx("work_order_payment_accounts")
                    .select("work_order_id")
                    .where({ work_order_id: currentPayment.work_order_id })
                    .forUpdate()
                    .first();
                if (!account) {
                    throw new AppError("Payment account not found", 409);
                }
                await trx("payments")
                    .select("payment_id")
                    .where({ payment_id: currentPayment.payment_id })
                    .forUpdate()
                    .first();
                const lockedRefund = await trx("refunds")
                    .select(
                        "refund_id",
                        "payment_id",
                        "status",
                        "execution_lease_token",
                        "executing_by",
                        "external_reference_id"
                    )
                    .where({ refund_id: execution.refund_id })
                    .forUpdate()
                    .first();
                if (lockedRefund.execution_lease_token !== execution.lease_token) {
                    return {
                        refund_id: execution.refund_id,
                        status: lockedRefund.status,
                        execution_result: lockedRefund.status === "COMPLETED"
                            ? "SUCCEEDED"
                            : "UNKNOWN",
                        external_reference_id: lockedRefund.external_reference_id || null,
                        idempotency_key: execution.idempotency_key
                    };
                }

                const status = outcome === "succeeded"
                    ? "COMPLETED"
                    : outcome === "failed"
                        ? "FAILED"
                        : "PROCESSING";
                const executionResult = outcome.toUpperCase();
                const updateFields = {
                    status,
                    execution_result: executionResult,
                    execution_lease_token: null,
                    execution_lease_until: null,
                    updated_at: new Date(now())
                };
                if (externalReferenceId) {
                    updateFields.external_reference_id = externalReferenceId;
                }
                const updatedRows = await trx("refunds")
                    .where({
                        refund_id: execution.refund_id,
                        status: "PROCESSING",
                        execution_lease_token: execution.lease_token
                    })
                    .update(updateFields);
                if (updatedRows !== 1) {
                    throw new AppError("Refund execution state changed; reconcile", 409);
                }
                const action = outcome === "succeeded"
                    ? "refund.execution.completed"
                    : outcome === "failed"
                        ? "refund.execution.failed"
                        : "refund.execution.unknown";
                await recordAudit(trx, authContext, {
                    event_key: `${action}:${execution.refund_id}:${execution.idempotency_key}`,
                    actor_user_id: execution.executing_by,
                    action,
                    target_entity_type: "REFUND",
                    target_entity_id: execution.refund_id,
                    outcome: outcome === "succeeded"
                        ? "SUCCESS"
                        : outcome === "failed"
                            ? "FAILURE"
                            : "UNKNOWN",
                    metadata: {
                        execution_result: executionResult,
                        to_status: status
                    }
                });

                return {
                    refund_id: execution.refund_id,
                    status,
                    execution_result: executionResult,
                    executing_by: lockedRefund.executing_by,
                    external_reference_id: externalReferenceId
                        || lockedRefund.external_reference_id
                        || null,
                    idempotency_key: execution.idempotency_key
                };
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(
                "Refund provider outcome could not be persisted; reconciliation is required",
                503
            );
        }
    }

    return {
        recordPayment,
        getBalance,
        getPaymentHistory,
        getPaymentDetails,
        createRefundRequest,
        decideRefundRequest,
        executeRefund,
        getRefundHistory,
        getRefundDetails
    };
}

module.exports = {
    createPaymentService,
    fromMinorUnits,
    toMinorUnits
};
