const { createHash } = require("node:crypto");
const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");
const { createUuid } = require("../utils/uuid");
const { createAuditLogService } = require("./auditLogService");
const {
    lockUsers,
    lockCustomers,
    withDeadlockRetry
} = require("./customerLocking");
const { USER_ROLES } = require("../../../shared/constants");
const {
    CUSTOMER_MERGE_PERMISSIONS
} = require("../constants/customerMergePermissions");

const digestVersion = 1;
const customerIdSchema = z.string().trim().min(1).max(36)
    .transform((value) => value.toLowerCase());
const actorIdSchema = z.string().trim().min(1).max(36)
    .transform((value) => value.toLowerCase());
const requestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).nullable()
    .optional();
const initiateInputSchema = z.object({
    source_customer_id: customerIdSchema,
    target_customer_id: customerIdSchema,
    merge_reason: z.string().trim().max(500).transform((value) =>
        value.normalize("NFC")).optional(),
    idempotency_key: z.string().min(1).refine(
        (value) => value.trim().length > 0
            && Buffer.byteLength(value, "utf8") <= 128
    )
}).strict();
const verificationInputSchema = z.object({
    verification_reference: z.string().trim().min(1).max(500)
        .transform((value) => value.normalize("NFC"))
}).strict();
const reasonInputSchema = z.object({
    reason: z.string().trim().max(500).transform((value) =>
        value.normalize("NFC")).optional()
}).strict();

function isDuplicateKeyError(error) {
    return error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062;
}

function makeRetryError(message) {
    return Object.assign(new Error(message), { code: "ER_LOCK_DEADLOCK" });
}

function toUtcMilliseconds(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value !== "string") {
        return Number.NaN;
    }
    const utcValue = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
        ? `${value.replace(" ", "T")}Z`
        : value;
    return Date.parse(utcValue);
}

function rawResultRow(result) {
    if (result && Array.isArray(result[0])) {
        return result[0][0] || null;
    }
    if (Array.isArray(result)) {
        return result[0] || null;
    }
    if (result && Array.isArray(result.rows)) {
        return result.rows[0] || null;
    }
    return result || null;
}

function normalizeCustomerId(customerId) {
    return String(customerId).toLowerCase();
}

function digestInitiation(sourceCustomerId, targetCustomerId, mergeReason) {
    const payload = JSON.stringify([
        digestVersion,
        sourceCustomerId,
        targetCustomerId,
        mergeReason === undefined ? null : mergeReason
    ]);
    return createHash("sha256").update(payload, "utf8").digest();
}

function digestMatches(left, right) {
    if (left === null || left === undefined || right === null || right === undefined) {
        return false;
    }
    const leftBytes = Buffer.isBuffer(left) ? left : Buffer.from(left);
    const rightBytes = Buffer.isBuffer(right) ? right : Buffer.from(right);
    return leftBytes.length === rightBytes.length && leftBytes.equals(rightBytes);
}

function isPendingReservationSet(rows, request) {
    if (rows.length !== 2) {
        return false;
    }
    const expected = new Set([
        `${request.source_customer_id}:SOURCE`,
        `${request.target_customer_id}:TARGET`
    ]);
    return rows.every((row) => expected.delete(`${row.customer_id}:${row.participant}`))
        && expected.size === 0;
}

function requestResult(row) {
    return {
        request_id: row.request_id,
        source_customer_id: row.source_customer_id,
        target_customer_id: row.target_customer_id,
        status: row.status,
        merge_reason: row.merge_reason,
        initiated_by_user_id: row.initiated_by_user_id,
        decided_by_user_id: row.decided_by_user_id || null,
        decision_reason: row.decision_reason || null,
        history_id: row.history_id || null,
        created_at: row.created_at,
        expires_at: row.expires_at,
        decided_at: row.decided_at || null
    };
}

function createCustomerMergeService({
    db,
    auditLog = createAuditLogService(),
    createId = createUuid
} = {}) {
    if (!db || typeof db.transaction !== "function") {
        throw new Error("Database is required");
    }
    if (!auditLog || typeof auditLog.record !== "function") {
        throw new Error("Audit log service is required");
    }
    if (typeof createId !== "function") {
        throw new Error("ID generator is required");
    }

    async function readCustomerHints(customerIds) {
        const rows = await db("customers")
            .select("customer_id", "user_id")
            .select(db.raw("CAST(`row_version` AS CHAR) AS row_version_text"))
            .whereIn("customer_id", [...new Set(customerIds)].sort());
        return new Map(rows.map((row) => [
            normalizeCustomerId(row.customer_id),
            { ...row, row_version: row.row_version_text }
        ]));
    }

    async function readRequestHint(mergeRequestId) {
        return db("customer_merge_requests")
            .select(
                "request_id",
                "source_customer_id",
                "target_customer_id",
                "initiated_by_user_id",
                "source_user_id_snapshot",
                "target_user_id_snapshot"
            )
            .where({ request_id: mergeRequestId })
            .first();
    }

    async function readIdempotencyHint(actorId, idempotencyKey) {
        return db("customer_merge_requests")
            .select(
                "request_id",
                "source_customer_id",
                "target_customer_id",
                "initiated_by_user_id",
                "source_user_id_snapshot",
                "target_user_id_snapshot"
            )
            .where({
                initiated_by_user_id: actorId,
                idempotency_key: idempotencyKey
            })
            .first();
    }

    async function lockAdminRole(trx, permissionCode) {
        const role = await trx("roles")
            .select("role_id")
            .where({ role_code: "ADMIN" })
            .forUpdate()
            .first();
        const permission = await trx("permissions")
            .select("permission_id")
            .where({ permission_code: permissionCode })
            .forUpdate()
            .first();
        return { adminRoleId: role?.role_id || null, permissionId: permission?.permission_id || null };
    }

    async function authorizeAdmin(trx, actorId, authorization) {
        if (!authorization.adminRoleId || !authorization.permissionId) {
            throw new AppError("You do not have permission", 403);
        }
        const assignments = await trx("user_roles")
            .select("role_id")
            .where({ user_id: actorId })
            .orderBy("role_id")
            .forUpdate();
        const roleIds = [...new Set(assignments.map((row) => row.role_id))];
        const roles = roleIds.length
            ? await trx("roles")
                .select("role_id", "role_code")
                .whereIn("role_id", roleIds)
                .orderBy("role_id")
                .forUpdate()
            : [];
        if (!roles.some((row) => row.role_id === authorization.adminRoleId
            && row.role_code === USER_ROLES.ADMIN)) {
            throw new AppError("Active administrator authorization is required", 403);
        }
        // ADMIN_ONLY: only a grant made directly to the ADMIN role authorizes merges.
        const permissionAssignments = await trx("role_permissions")
            .select("role_id")
            .where({
                role_id: authorization.adminRoleId,
                permission_id: authorization.permissionId
            })
            .orderBy("role_id")
            .forUpdate();
        if (permissionAssignments.length === 0) {
            throw new AppError("You do not have permission", 403);
        }
    }

    async function requireActiveActor(actorId, userRows) {
        const actor = userRows.get(actorId);
        if (!actor || actor.status !== "ACTIVE") {
            throw new AppError("Active user authorization is required", 403);
        }
    }

    async function lockContext(trx, actorId, customerIds, customerHints, permissionCode) {
        const normalizedCustomerIds = [...new Set(customerIds.map(normalizeCustomerId))];
        const authorization = permissionCode
            ? await lockAdminRole(trx, permissionCode)
            : null;
        const candidateUserIds = actorId ? [actorId] : [];
        for (const customerId of normalizedCustomerIds) {
            const hint = customerHints.get(normalizeCustomerId(customerId));
            if (hint?.user_id) {
                candidateUserIds.push(hint.user_id);
            }
        }
        const userRows = await lockUsers(trx, candidateUserIds);
        if (authorization) {
            const actor = userRows.get(actorId);
            if (!actor || actor.status !== "ACTIVE") {
                throw new AppError("Active administrator authorization is required", 403);
            }
            await authorizeAdmin(trx, actorId, authorization);
        }
        const customerRows = await lockCustomers(trx, normalizedCustomerIds, ["row_version"]);
        const exactVersions = normalizedCustomerIds.length
            ? await trx("customers")
                .select("customer_id")
                .select(trx.raw("CAST(`row_version` AS CHAR) AS row_version_text"))
                .whereIn("customer_id", normalizedCustomerIds.sort())
                .orderBy("customer_id")
                .forUpdate()
            : [];
        const versionsByCustomerId = new Map(
            exactVersions.map((row) => [
                normalizeCustomerId(row.customer_id),
                row.row_version_text
            ])
        );
        for (const [customerId, customer] of customerRows) {
            customer.row_version = versionsByCustomerId.get(normalizeCustomerId(customerId));
        }
        for (const customerId of normalizedCustomerIds) {
            const normalizedId = normalizeCustomerId(customerId);
            const hint = customerHints.get(normalizedId);
            const locked = customerRows.get(normalizedId);
            if (!hint && locked) {
                throw makeRetryError("Customer appeared while acquiring locks");
            }
            if (hint && locked
                && (hint.user_id !== locked.user_id
                    || String(hint.row_version) !== String(locked.row_version))) {
                throw makeRetryError("Customer mapping changed while acquiring locks");
            }
            if (hint && !locked) {
                throw makeRetryError("Customer disappeared while acquiring locks");
            }
            if (locked?.user_id && !userRows.has(locked.user_id)) {
                throw makeRetryError("Customer user changed while acquiring locks");
            }
        }
        return { userRows, customerRows, authorization };
    }

    async function readDatabaseNow(trx) {
        const result = await trx.raw("SELECT UTC_TIMESTAMP(3) AS db_now");
        const row = rawResultRow(result);
        const milliseconds = toUtcMilliseconds(row?.db_now);
        if (!Number.isFinite(milliseconds)) {
            throw new Error("Database UTC clock is unavailable");
        }
        return milliseconds;
    }

    async function writeAudit(
        trx,
        actorId,
        action,
        customerId,
        reason,
        requestId,
        mergeRequestId
    ) {
        const auditId = await auditLog.record(trx, {
            actor_user_id: actorId,
            action,
            target_entity_type: "customer",
            target_entity_id: customerId,
            outcome: "SUCCESS",
            request_id: requestId || null,
            metadata: {
                merge_request_id: mergeRequestId,
                ...(reason ? { reason } : {})
            }
        });
        if (typeof auditId !== "string" || auditId.length === 0) {
            throw new Error("Audit service did not return the inserted audit ID");
        }
        return auditId;
    }

    async function lockRequest(trx, mergeRequestId, requestHint) {
        const request = await trx("customer_merge_requests")
            .select(
                "*",
                trx.raw("CAST(`source_version` AS CHAR) AS source_version_text"),
                trx.raw("CAST(`target_version` AS CHAR) AS target_version_text")
            )
            .where({ request_id: mergeRequestId })
            .forUpdate()
            .first();
        if (!request) {
            throw new AppError("Merge request not found", 404);
        }
        if (!requestHint
            || requestHint.source_customer_id !== request.source_customer_id
            || requestHint.target_customer_id !== request.target_customer_id) {
            throw makeRetryError("Merge request mapping changed while acquiring locks");
        }
        request.source_version = request.source_version_text;
        request.target_version = request.target_version_text;
        return request;
    }

    async function lockAndValidateReservations(trx, request) {
        const rows = await trx("customer_merge_reservations")
            .select("customer_id", "request_id", "participant")
            .where({ request_id: request.request_id })
            .orderBy("customer_id")
            .forUpdate();
        if (!isPendingReservationSet(rows, request)) {
            throw new AppError("Merge reservations are inconsistent", 503);
        }
    }

    async function releaseReservations(trx, request) {
        await lockAndValidateReservations(trx, request);
        const deleted = await trx("customer_merge_reservations")
            .where({ request_id: request.request_id })
            .del();
        if (deleted !== 2) {
            throw new AppError("Merge reservations are inconsistent", 503);
        }
    }

    function assertPendingBeforeExpiry(request, databaseNow) {
        assertPending(request);
        const expiry = toUtcMilliseconds(request.expires_at);
        if (!Number.isFinite(expiry)) {
            throw new AppError("Merge request expiry is invalid", 503);
        }
        if (databaseNow >= expiry) {
            throw new AppError("Merge request has expired", 409);
        }
    }

    function assertPending(request) {
        if (request.status !== "PENDING") {
            throw new AppError("Merge request is no longer pending", 409);
        }
    }

    async function finalPendingUpdate(trx, request, updateValues, requireUnexpired = false) {
        let query = trx("customer_merge_requests")
            .where({ request_id: request.request_id, status: "PENDING" });
        if (requireUnexpired) {
            query = query.where("expires_at", ">", trx.raw("UTC_TIMESTAMP(3)"));
        }
        const changed = await query.update({
            ...updateValues,
            decided_at: trx.raw("UTC_TIMESTAMP(3)")
        });
        if (changed !== 1) {
            throw new AppError("Merge request is no longer pending", 409);
        }
    }

    async function initiateUnaudited(actorId, input, requestId = null) {
        const parsedActor = actorIdSchema.safeParse(actorId);
        const parsed = initiateInputSchema.safeParse(input);
        const parsedRequestId = requestIdSchema.safeParse(requestId);
        if (!parsedActor.success || !parsed.success || !parsedRequestId.success) {
            throw new AppError("Invalid customer merge request", 400);
        }
        const actor = parsedActor.data;
        const { source_customer_id: sourceId, target_customer_id: targetId } = parsed.data;
        if (sourceId === targetId) {
            throw new AppError("Source and target customers must differ", 400);
        }
        const mergeReason = parsed.data.merge_reason || null;
        const requestDigest = digestInitiation(sourceId, targetId, mergeReason);

        try {
            return await withDeadlockRetry(async () => {
                const idempotencyHint = await readIdempotencyHint(actor, parsed.data.idempotency_key);
                const customerIds = idempotencyHint
                    ? [idempotencyHint.source_customer_id, idempotencyHint.target_customer_id]
                    : [sourceId, targetId];
                const customerHints = await readCustomerHints(customerIds);
                return db.transaction(async (trx) => {
                    const context = await lockContext(
                        trx,
                        actor,
                        customerIds,
                        customerHints,
                        CUSTOMER_MERGE_PERMISSIONS.REQUEST
                    );
                    const source = context.customerRows.get(sourceId);
                    const target = context.customerRows.get(targetId);
                    // Current read after the lock phase: a stale null hint must still replay.
                    const original = await trx("customer_merge_requests")
                        .select("*")
                        .where({
                            initiated_by_user_id: actor,
                            idempotency_key: parsed.data.idempotency_key
                        })
                        .forUpdate()
                        .first();
                    if (idempotencyHint && !original) {
                        throw makeRetryError("Idempotency record changed while locking");
                    }
                    if (original) {
                        if (!digestMatches(original.request_digest, requestDigest)
                            || original.digest_version !== digestVersion) {
                            throw new AppError("Idempotency key was used with different data", 409);
                        }
                        return requestResult(original);
                    }
                    if (!source || !target) {
                        throw new AppError("Customer not found", 404);
                    }
                    validateRegisteredCustomer(source);
                    validateRegisteredCustomer(target);
                    if (!context.userRows.has(source.user_id)
                        || !context.userRows.has(target.user_id)) {
                        throw new AppError("Customer account mapping is unavailable", 409);
                    }
                    const existingReservations = await trx("customer_merge_reservations")
                        .select("customer_id")
                        .whereIn("customer_id", [sourceId, targetId])
                        .orderBy("customer_id")
                        .forUpdate();
                    if (existingReservations.length > 0) {
                        throw new AppError("Customer is already reserved by another merge", 409);
                    }

                    const requestIdValue = createId();
                    const auditId = await writeAudit(
                        trx,
                        actor,
                        "CUSTOMER.MERGE_REQUESTED",
                        sourceId,
                        mergeReason,
                        parsedRequestId.data,
                        requestIdValue
                    );
                    await trx("customer_merge_requests").insert({
                        request_id: requestIdValue,
                        source_customer_id: sourceId,
                        target_customer_id: targetId,
                        source_user_id_snapshot: source.user_id,
                        target_user_id_snapshot: target.user_id,
                        source_version: source.row_version,
                        target_version: target.row_version,
                        initiated_by_user_id: actor,
                        idempotency_key: parsed.data.idempotency_key,
                        request_digest: requestDigest,
                        digest_version: digestVersion,
                        merge_reason: mergeReason,
                        status: "PENDING",
                        initiated_audit_id: auditId
                    });
                    await trx("customer_merge_reservations").insert([
                        {
                            customer_id: sourceId,
                            request_id: requestIdValue,
                            participant: "SOURCE"
                        },
                        {
                            customer_id: targetId,
                            request_id: requestIdValue,
                            participant: "TARGET"
                        }
                    ]);
                    const created = await trx("customer_merge_requests")
                        .select("*")
                        .where({ request_id: requestIdValue })
                        .first();
                    if (!created) {
                        throw new Error("Merge request was not persisted");
                    }
                    return requestResult(created);
                });
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            if (isDuplicateKeyError(error)) {
                try {
                    const original = await db("customer_merge_requests")
                        .select("*")
                        .where({
                            initiated_by_user_id: actor,
                            idempotency_key: parsed.data.idempotency_key
                        })
                        .first();
                    if (original) {
                        if (original.digest_version !== digestVersion
                            || !digestMatches(original.request_digest, requestDigest)) {
                            throw new AppError(
                                "Idempotency key was used with different data",
                                409
                            );
                        }
                        return requestResult(original);
                    }
                    const reservation = await db("customer_merge_reservations")
                        .select("customer_id")
                        .whereIn("customer_id", [sourceId, targetId])
                        .first();
                    if (reservation) {
                        throw new AppError(
                            "Customer is already reserved by another merge",
                            409
                        );
                    }
                    throw new AppError("Customer merge service unavailable", 503);
                } catch (lookupError) {
                    if (lookupError instanceof AppError) {
                        throw lookupError;
                    }
                    throw new AppError("Customer merge service unavailable", 503);
                }
            }
            throw new AppError("Customer merge service unavailable", 503);
        }
    }

    function validateRegisteredCustomer(customer) {
        if (customer.customer_type !== "REGISTERED"
            || !customer.user_id
            || customer.merged_into_customer_id !== null) {
            throw new AppError("Only unmerged registered customers can be merged", 409);
        }
    }

    async function runDecision(actorId, mergeRequestId, input, requestId, decision) {
        const parsedActor = actorIdSchema.safeParse(actorId);
        const parsedMergeRequestId = customerIdSchema.safeParse(mergeRequestId);
        const parsedRequestId = requestIdSchema.safeParse(requestId);
        const parsed = decision === "COMPLETED"
            ? verificationInputSchema.safeParse(input)
            : reasonInputSchema.safeParse(input);
        if (!parsedActor.success || !parsedMergeRequestId.success
            || !parsedRequestId.success || !parsed.success) {
            throw new AppError("Invalid customer merge decision", 400);
        }
        const actor = parsedActor.data;
        const id = parsedMergeRequestId.data;

        try {
            return await withDeadlockRetry(async () => {
                const requestHint = await readRequestHint(id);
                if (!requestHint) {
                    throw new AppError("Merge request not found", 404);
                }
                const customerIds = [
                    requestHint.source_customer_id,
                    requestHint.target_customer_id
                ];
                const customerHints = await readCustomerHints(customerIds);
                return db.transaction(async (trx) => {
                    const context = await lockContext(
                        trx,
                        actor,
                        customerIds,
                        customerHints,
                        CUSTOMER_MERGE_PERMISSIONS.APPROVE
                    );
                    const request = await lockRequest(trx, id, requestHint);
                    const source = context.customerRows.get(
                        normalizeCustomerId(request.source_customer_id)
                    );
                    const target = context.customerRows.get(
                        normalizeCustomerId(request.target_customer_id)
                    );
                    if (!source || !target) {
                        throw new AppError("Customer not found", 404);
                    }
                    if (actor === request.initiated_by_user_id) {
                        throw new AppError("A different administrator must decide the request", 403);
                    }
                    if (decision === "COMPLETED") {
                        assertPendingBeforeExpiry(request, await readDatabaseNow(trx));
                    } else {
                        assertPending(request);
                    }
                    await lockAndValidateReservations(trx, request);

                    const reason = parsed.data.reason || null;
                    let historyId = null;
                    if (decision === "COMPLETED") {
                        validateRegisteredCustomer(source);
                        validateRegisteredCustomer(target);
                        if (source.user_id !== request.source_user_id_snapshot
                            || target.user_id !== request.target_user_id_snapshot
                            || String(source.row_version) !== String(request.source_version)
                            || String(target.row_version) !== String(request.target_version)) {
                            throw new AppError("Customer changed after merge request", 409);
                        }
                        await assertNoMergeChain(trx, source, target);
                        historyId = createId();
                    }

                    const auditId = await writeAudit(
                        trx,
                        actor,
                        decision === "COMPLETED"
                            ? "CUSTOMER.MERGE_COMPLETED"
                            : "CUSTOMER.MERGE_REJECTED",
                        request.source_customer_id,
                        decision === "COMPLETED" ? null : reason,
                        parsedRequestId.data,
                        request.request_id
                    );
                    if (decision === "COMPLETED") {
                        await trx("customer_merge_history").insert({
                            merge_history_id: historyId,
                            source_customer_id: request.source_customer_id,
                            target_customer_id: request.target_customer_id,
                            target_user_id: request.target_user_id_snapshot,
                            verified_by_user_id: actor,
                            verification_reference: parsed.data.verification_reference,
                            merge_reason: request.merge_reason
                        });
                        const updatedCustomers = await trx("customers")
                            .where({
                                customer_id: request.source_customer_id,
                                user_id: request.source_user_id_snapshot,
                                customer_type: "REGISTERED",
                                merged_into_customer_id: null,
                                row_version: request.source_version
                            })
                            .update({
                                customer_type: "MERGED",
                                merged_into_customer_id: request.target_customer_id
                            });
                        if (updatedCustomers !== 1) {
                            throw new AppError("Customer changed after merge request", 409);
                        }
                    }
                    await releaseReservations(trx, request);
                    await finalPendingUpdate(
                        trx,
                        request,
                        {
                            status: decision,
                            decided_by_user_id: actor,
                            decision_reason: decision === "COMPLETED" ? null : reason,
                            verification_reference: decision === "COMPLETED"
                                ? parsed.data.verification_reference
                                : null,
                            history_id: historyId,
                            decision_audit_id: auditId
                        },
                        decision === "COMPLETED"
                    );
                    const updatedRequest = await trx("customer_merge_requests")
                        .select("*")
                        .where({ request_id: request.request_id })
                        .first();
                    return requestResult(updatedRequest);
                });
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Customer merge service unavailable", 503);
        }
    }

    async function assertNoMergeChain(trx, source, target) {
        if (target.merged_into_customer_id !== null) {
            throw new AppError("Merge target is already merged", 409);
        }
        const priorTarget = await trx("customer_merge_history")
            .select("merge_history_id")
            .where({ target_customer_id: source.customer_id })
            .forUpdate()
            .first();
        if (priorTarget) {
            throw new AppError("Customer was a prior merge target", 409);
        }
        const incomingMerge = await trx("customers")
            .select("customer_id")
            .where({ merged_into_customer_id: source.customer_id })
            .first();
        if (incomingMerge) {
            throw new AppError("Customer has incoming merge pointers", 409);
        }
    }

    async function cancelUnaudited(actorId, mergeRequestId, input = {}, requestId = null) {
        const parsedActor = actorIdSchema.safeParse(actorId);
        const parsedMergeRequestId = customerIdSchema.safeParse(mergeRequestId);
        const parsedRequestId = requestIdSchema.safeParse(requestId);
        const parsed = reasonInputSchema.safeParse(input);
        if (!parsedActor.success || !parsedMergeRequestId.success
            || !parsedRequestId.success || !parsed.success) {
            throw new AppError("Invalid customer merge cancellation", 400);
        }
        const actor = parsedActor.data;
        const id = parsedMergeRequestId.data;

        try {
            return await withDeadlockRetry(async () => {
                const requestHint = await readRequestHint(id);
                if (!requestHint) {
                    throw new AppError("Merge request not found", 404);
                }
                const customerIds = [
                    requestHint.source_customer_id,
                    requestHint.target_customer_id
                ];
                const customerHints = await readCustomerHints(customerIds);
                return db.transaction(async (trx) => {
                    const context = await lockContext(
                        trx,
                        actor,
                        customerIds,
                        customerHints,
                        null
                    );
                    await requireActiveActor(actor, context.userRows);
                    const request = await lockRequest(trx, id, requestHint);
                    if (actor !== request.initiated_by_user_id) {
                        throw new AppError("Only the initiator can cancel this request", 403);
                    }
                    assertPending(request);
                    const reason = parsed.data.reason || null;
                    const auditId = await writeAudit(
                        trx,
                        actor,
                        "CUSTOMER.MERGE_CANCELLED",
                        request.source_customer_id,
                        reason,
                        parsedRequestId.data,
                        request.request_id
                    );
                    await releaseReservations(trx, request);
                    await finalPendingUpdate(trx, request, {
                        status: "CANCELLED",
                        decided_by_user_id: actor,
                        decision_reason: reason,
                        verification_reference: null,
                        history_id: null,
                        decision_audit_id: auditId
                    });
                    const updatedRequest = await trx("customer_merge_requests")
                        .select("*")
                        .where({ request_id: request.request_id })
                        .first();
                    return requestResult(updatedRequest);
                });
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Customer merge service unavailable", 503);
        }
    }

    async function expire(mergeRequestId, requestId = null) {
        const parsedMergeRequestId = customerIdSchema.safeParse(mergeRequestId);
        const parsedRequestId = requestIdSchema.safeParse(requestId);
        if (!parsedMergeRequestId.success || !parsedRequestId.success) {
            throw new AppError("Invalid customer merge expiration", 400);
        }
        const id = parsedMergeRequestId.data;

        try {
            return await withDeadlockRetry(async () => {
                const requestHint = await readRequestHint(id);
                if (!requestHint) {
                    throw new AppError("Merge request not found", 404);
                }
                const customerIds = [
                    requestHint.source_customer_id,
                    requestHint.target_customer_id
                ];
                const customerHints = await readCustomerHints(customerIds);
                return db.transaction(async (trx) => {
                    const context = await lockContext(
                        trx,
                        null,
                        customerIds,
                        customerHints,
                        null
                    );
                    const request = await lockRequest(trx, id, requestHint);
                    if (request.status !== "PENDING") {
                        return { ...requestResult(request), performed: false };
                    }
                    const databaseNow = await readDatabaseNow(trx);
                    const expiry = toUtcMilliseconds(request.expires_at);
                    if (!Number.isFinite(expiry)) {
                        throw new AppError("Merge request expiry is invalid", 503);
                    }
                    if (databaseNow < expiry) {
                        return { ...requestResult(request), performed: false };
                    }
                    const auditId = await writeAudit(
                        trx,
                        null,
                        "CUSTOMER.MERGE_EXPIRED",
                        request.source_customer_id,
                        null,
                        parsedRequestId.data,
                        request.request_id
                    );
                    await releaseReservations(trx, request);
                    const changed = await trx("customer_merge_requests")
                        .where({ request_id: request.request_id, status: "PENDING" })
                        .where("expires_at", "<=", trx.raw("UTC_TIMESTAMP(3)"))
                        .update({
                            status: "EXPIRED",
                            decided_by_user_id: null,
                            decision_reason: null,
                            verification_reference: null,
                            history_id: null,
                            decision_audit_id: auditId,
                            decided_at: trx.raw("UTC_TIMESTAMP(3)")
                        });
                    if (changed !== 1) {
                        throw new AppError("Merge request has not expired", 409);
                    }
                    const updatedRequest = await trx("customer_merge_requests")
                        .select("*")
                        .where({ request_id: request.request_id })
                        .first();
                    return { ...requestResult(updatedRequest), performed: true };
                });
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Customer merge service unavailable", 503);
        }
    }

    // Business rejections (403/404/409) are audited as FAILURE in their own
    // transaction after the operation has rolled back. Malformed input (400)
    // and outages (503) are not audited. The operation's lock order is unchanged.
    const auditedFailureStatuses = new Set([403, 404, 409]);

    async function recordFailure(error, action, actorId, customerId, mergeRequestId, requestId) {
        if (!(error instanceof AppError) || !auditedFailureStatuses.has(error.statusCode)) {
            return;
        }
        const parsedActor = actorIdSchema.safeParse(actorId);
        const parsedCustomer = customerIdSchema.safeParse(customerId);
        const parsedMergeRequest = customerIdSchema.safeParse(mergeRequestId);
        const parsedRequestId = requestIdSchema.safeParse(requestId);
        try {
            await db.transaction((trx) => auditLog.record(trx, {
                actor_user_id: parsedActor.success ? parsedActor.data : null,
                action,
                target_entity_type: "customer",
                target_entity_id: parsedCustomer.success ? parsedCustomer.data : null,
                outcome: "FAILURE",
                request_id: parsedRequestId.success ? parsedRequestId.data ?? null : null,
                metadata: {
                    ...(parsedMergeRequest.success
                        ? { merge_request_id: parsedMergeRequest.data }
                        : {}),
                    reason: error.message
                }
            }));
        } catch {
            throw new AppError("Customer merge service unavailable", 503);
        }
    }

    async function withFailureAudit(operation, action, actorId, customerId, mergeRequestId, requestId) {
        try {
            return await operation();
        } catch (error) {
            await recordFailure(error, action, actorId, customerId, mergeRequestId, requestId);
            throw error;
        }
    }

    async function initiate(actorId, input, requestId = null) {
        return withFailureAudit(
            () => initiateUnaudited(actorId, input, requestId),
            "CUSTOMER.MERGE_REQUESTED",
            actorId,
            input?.source_customer_id,
            undefined,
            requestId
        );
    }

    async function approve(actorId, mergeRequestId, input, requestId = null) {
        return withFailureAudit(
            () => runDecision(actorId, mergeRequestId, input, requestId, "COMPLETED"),
            "CUSTOMER.MERGE_COMPLETED",
            actorId,
            undefined,
            mergeRequestId,
            requestId
        );
    }

    async function reject(actorId, mergeRequestId, input = {}, requestId = null) {
        return withFailureAudit(
            () => runDecision(actorId, mergeRequestId, input, requestId, "REJECTED"),
            "CUSTOMER.MERGE_REJECTED",
            actorId,
            undefined,
            mergeRequestId,
            requestId
        );
    }

    async function cancel(actorId, mergeRequestId, input = {}, requestId = null) {
        return withFailureAudit(
            () => cancelUnaudited(actorId, mergeRequestId, input, requestId),
            "CUSTOMER.MERGE_CANCELLED",
            actorId,
            undefined,
            mergeRequestId,
            requestId
        );
    }

    return { initiate, approve, reject, cancel, expire };
}

module.exports = {
    createCustomerMergeService
};
