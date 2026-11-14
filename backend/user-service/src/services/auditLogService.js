const { z } = require("zod");
const { createUuid } = require("../utils/uuid");

const allowedMetadataKeys = new Set([
    "changed_fields",
    "calling_service",
    "from_status",
    "linked_user_id",
    "merge_request_id",
    "reason",
    "revoked",
    "role_code",
    "role_codes",
    "to_status"
]);
const metadataSchema = z.record(
    z.string(),
    z.union([
        z.string().max(500),
        z.boolean(),
        z.array(z.string().max(50)).max(10)
    ])
).superRefine((metadata, context) => {
    for (const [key, value] of Object.entries(metadata)) {
        if (key === "outcome" || key === "request_id") {
            context.addIssue({
                code: "custom",
                message: "Reserved audit metadata field",
                path: [key]
            });
            continue;
        }
        if (!allowedMetadataKeys.has(key)) {
            context.addIssue({
                code: "custom",
                message: "Unsupported audit metadata field",
                path: [key]
            });
            continue;
        }
        if (key === "reason") {
            if (typeof value !== "string") {
                context.addIssue({
                    code: "custom",
                    message: "Audit reason must be a string",
                    path: [key]
                });
            }
        } else if (typeof value === "string" && value.length > 150) {
            context.addIssue({
                code: "custom",
                message: "Audit metadata value is too long",
                path: [key]
            });
        }
    }
});
const eventSchema = z.object({
    actor_user_id: z.string().max(36).nullable(),
    action: z.string().min(1).max(100),
    target_entity_type: z.enum(["user", "refresh_session", "customer"]),
    target_entity_id: z.string().max(36).nullable(),
    outcome: z.enum(["SUCCESS", "FAILURE"]),
    request_id: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).nullable().optional(),
    metadata: metadataSchema.nullable().optional()
}).strict();

function getAuditRequestId(req) {
    const requestId = req?.get?.("x-request-id");
    return typeof requestId === "string"
        && /^[A-Za-z0-9._:-]{1,100}$/.test(requestId)
        ? requestId
        : null;
}

function createAuditLogService({ createId = createUuid, logger = console } = {}) {
    if (!logger || typeof logger.error !== "function") {
        throw new Error("Audit log error logger is required");
    }

    async function record(trx, input) {
        const parsed = eventSchema.safeParse(input);
        if (!parsed.success) {
            throw new Error("Invalid audit event");
        }

        const producerMetadata = parsed.data.metadata || {};
        const { reason = null, ...ordinaryMetadata } = producerMetadata;
        const metadata = {
            ...ordinaryMetadata,
            outcome: parsed.data.outcome,
            request_id: parsed.data.request_id ?? null
        };

        try {
            const auditId = createId();
            await trx("user_audit_logs").insert({
                audit_id: auditId,
                actor_user_id: parsed.data.actor_user_id,
                action: parsed.data.action,
                resource_type: parsed.data.target_entity_type,
                resource_id: parsed.data.target_entity_id,
                reason,
                metadata: Object.keys(metadata).length > 0 ? metadata : null
            });
            return auditId;
        } catch (error) {
            logger.error("Audit log persistence failed", {
                code: "AUDIT_LOG_PERSISTENCE_FAILED",
                action: parsed.data.action,
                resource_type: parsed.data.target_entity_type
            });
            throw Object.assign(new Error("Audit log persistence failed", { cause: error }), {
                code: "AUDIT_LOG_PERSISTENCE_FAILED"
            });
        }
    }

    return { record };
}

module.exports = {
    createAuditLogService,
    getAuditRequestId
};
