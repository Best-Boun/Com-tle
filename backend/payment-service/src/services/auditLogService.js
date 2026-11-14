const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");

const ACTIONS = [
    "payment.recorded",
    "payment.record.rejected",
    "refund.requested",
    "refund.approved",
    "refund.rejected",
    "refund.execution.started",
    "refund.execution.retry_attempted",
    "refund.execution.completed",
    "refund.execution.failed",
    "refund.execution.unknown"
];
const METADATA_KEYS = new Set([
    "amount",
    "currency",
    "execution_attempt",
    "execution_result",
    "from_status",
    "payment_id",
    "payment_method",
    "reason_code",
    "to_status"
]);
const metadataSchema = z.record(
    z.string(),
    z.union([z.string().max(100), z.number().int().nonnegative()])
).superRefine((metadata, context) => {
    for (const key of Object.keys(metadata)) {
        if (!METADATA_KEYS.has(key)) {
            context.addIssue({
                code: "custom",
                message: "Unsupported audit metadata field",
                path: [key]
            });
        }
    }
});
const eventSchema = z.object({
    event_key: z.string().min(1).max(191),
    actor_user_id: z.string().max(36).nullable(),
    action: z.enum(ACTIONS),
    target_entity_type: z.enum(["PAYMENT", "REFUND"]),
    target_entity_id: z.string().max(36).nullable(),
    occurred_at: z.date(),
    outcome: z.enum(["SUCCESS", "FAILURE", "UNKNOWN"]),
    request_id: z.string().max(100).nullable(),
    metadata: metadataSchema.nullable()
}).strict();

function getAuditRequestId(context) {
    const requestId = context?.requestId
        || context?.request_id
        || context?.correlationId
        || context?.correlation_id;
    return typeof requestId === "string"
        && /^[A-Za-z0-9._:-]{1,100}$/.test(requestId)
        ? requestId
        : null;
}

function isDuplicateKeyError(error) {
    return error?.code === "ER_DUP_ENTRY"
        || error?.errno === 1062
        || error?.code === "SQLITE_CONSTRAINT_UNIQUE";
}

function createAuditLogService({ createId, now }) {
    async function record(trx, input) {
        const parsed = eventSchema.safeParse({
            ...input,
            occurred_at: input.occurred_at || new Date(now())
        });
        if (!parsed.success) {
            throw new AppError("Invalid audit event", 500);
        }
        try {
            await trx("audit_logs").insert({
                audit_id: createId(),
                ...parsed.data
            });
            return true;
        } catch (error) {
            let cause = error;
            if (isDuplicateKeyError(error)) {
                try {
                    const existing = await trx("audit_logs")
                        .select("audit_id")
                        .where({ event_key: parsed.data.event_key })
                        .first();
                    if (existing) {
                        return false;
                    }
                } catch (lookupError) {
                    cause = lookupError;
                }
            }
            const persistenceError = new AppError(
                "Audit log persistence failed",
                503
            );
            persistenceError.code = "AUDIT_LOG_PERSISTENCE_FAILED";
            persistenceError.cause = cause;
            throw persistenceError;
        }
    }

    return { record };
}

module.exports = {
    ACTIONS,
    createAuditLogService,
    getAuditRequestId
};
