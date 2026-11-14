const AppError = require("../../../shared/errors/AppError");
const { z } = require("zod");

const supportedPermissionRequests = new Set([
    "payment.record",
    "payment.view_own",
    "can_refund"
]);
const resourceSchema = z.object({
    work_order_id: z.string().trim().min(1).max(36).optional(),
    payment_id: z.string().trim().min(1).max(36).optional(),
    refund_id: z.string().trim().min(1).max(36).optional()
}).strict();
const customerIdentityResponseSchema = z.object({
    success: z.literal(true),
    message: z.string(),
    data: z.object({
        user_id: z.string().min(1).max(36),
        customer_id: z.string().min(1).max(36),
        customer_type: z.literal("REGISTERED")
    }).strict()
}).strict();

function createUserAuthorizationAdapter({
    userJwtVerifier,
    internalServiceTokenIssuer,
    userServiceUrl,
    fetchImplementation = globalThis.fetch,
    timeoutMs = 3000,
    nodeEnv = process.env.NODE_ENV,
    paymentDb
} = {}) {
    if (!userJwtVerifier
        || typeof userJwtVerifier.verify !== "function"
        || !internalServiceTokenIssuer
        || typeof internalServiceTokenIssuer.createToken !== "function"
        || typeof fetchImplementation !== "function"
        || typeof userServiceUrl !== "string"
        || !Number.isSafeInteger(timeoutMs)
        || timeoutMs < 1) {
        throw new Error("Trusted User-Service authorization dependencies are required");
    }
    const userServiceBase = new URL(userServiceUrl);
    const allowsLocalHttp = nodeEnv === "development"
        && userServiceBase.protocol === "http:"
        && ["localhost", "127.0.0.1", "[::1]"].includes(userServiceBase.hostname);
    if (userServiceBase.username
        || userServiceBase.password
        || userServiceBase.search
        || userServiceBase.hash
        || userServiceBase.pathname !== "/"
        || (userServiceBase.protocol !== "https:" && !allowsLocalHttp)) {
        throw new Error(
            "User-Service URL must use HTTPS or localhost HTTP in development"
        );
    }
    const permissionEndpoint = new URL(
        "/internal/permissions/check",
        userServiceBase
    ).toString();
    const customerIdentityEndpoint = new URL(
        "/internal/customers/resolve",
        userServiceBase
    ).toString();
    const authenticatedContexts = new WeakSet();
    const userTokensByContext = new WeakMap();

    function authenticateToken(token) {
        let verified;
        try {
            verified = userJwtVerifier.verify(token);
        } catch {
            throw new AppError("Invalid or expired User access token", 401);
        }
        if (!verified || typeof verified.userId !== "string" || !verified.userId.trim()) {
            throw new AppError("Invalid or expired User access token", 401);
        }
        const authContext = Object.freeze({ userId: verified.userId });
        authenticatedContexts.add(authContext);
        userTokensByContext.set(authContext, token);
        return authContext;
    }

    function requireUserAuth(req, res, next) {
        const authorization = req.get("authorization");
        const match = typeof authorization === "string"
            ? authorization.match(/^Bearer\s+([^\s]+)$/i)
            : null;
        if (!match) {
            return next(new AppError("Authentication required", 401));
        }
        try {
            req.auth = authenticateToken(match[1]);
            return next();
        } catch (error) {
            return next(error);
        }
    }

    async function requestPermission(authContext, permission, resource = {}) {
        if (!authenticatedContexts.has(authContext)) {
            throw new AppError("Authentication required", 401);
        }
        if (!supportedPermissionRequests.has(permission)) {
            return false;
        }
        const parsedResource = resourceSchema.safeParse(resource);
        if (!parsedResource.success) {
            throw new AppError("Invalid authorization resource", 400);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        let body;
        try {
            const serviceToken = await internalServiceTokenIssuer.createToken();
            response = await fetchImplementation(permissionEndpoint, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${serviceToken}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    user_id: authContext.userId,
                    permission,
                    resource: parsedResource.data
                }),
                signal: controller.signal,
                redirect: "error"
            });

            if (!response
                || !Number.isInteger(response.status)
                || typeof response.ok !== "boolean"
                || typeof response.json !== "function") {
                throw new AppError("Invalid User-Service authorization response", 503);
            }
            if (response.status === 401) {
                throw new AppError("Internal service authentication failed", 401);
            }
            if (!response.ok) {
                throw new AppError("User-Service authorization unavailable", 503);
            }

            body = await response.json();
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("User-Service authorization unavailable", 503);
        } finally {
            clearTimeout(timeout);
        }
        const decision = body?.success === true ? body.data : null;
        if (!decision
            || decision.user_id !== authContext.userId
            || decision.permission !== permission
            || typeof decision.allowed !== "boolean") {
            throw new AppError("Invalid User-Service authorization response", 503);
        }
        return decision.allowed;
    }

    async function authorizePaymentRecorder(authContext) {
        if (!await requestPermission(authContext, "payment.record")) {
            throw new AppError("Payment recording is not authorized", 403);
        }
        return authContext.userId;
    }

    async function authorizeRefundActor(authContext, permission) {
        if (permission !== "can_refund"
            || !await requestPermission(authContext, "can_refund")) {
            throw new AppError("Refund operation is not authorized", 403);
        }
        return authContext.userId;
    }

    async function requestCustomerIdentity(userId, authContext) {
        if (!authenticatedContexts.has(authContext)
            || authContext.userId !== userId) {
            throw new AppError("Authentication required", 401);
        }
        const originalUserToken = userTokensByContext.get(authContext);
        if (!originalUserToken) {
            throw new AppError("Authentication required", 401);
        }

        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        let response;
        try {
            const serviceToken = await internalServiceTokenIssuer.createToken();
            response = await fetchImplementation(customerIdentityEndpoint, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${serviceToken}`,
                    "content-type": "application/json",
                    "x-user-access-token": originalUserToken
                },
                body: JSON.stringify({ user_id: authContext.userId }),
                signal: controller.signal,
                redirect: "error"
            });
            if (!response
                || !Number.isInteger(response.status)
                || typeof response.ok !== "boolean"
                || typeof response.json !== "function") {
                throw new Error("Invalid User-Service response");
            }
            if (response.status === 401
                || response.status === 403
                || response.status === 404) {
                await response.body?.cancel();
                if (timedOut) {
                    throw new Error("User-Service identity lookup timed out");
                }
                return null;
            }
            if (!response.ok) {
                throw new Error("User-Service identity lookup failed");
            }

            const body = await response.json();
            if (timedOut) {
                throw new Error("User-Service identity lookup timed out");
            }
            const parsed = customerIdentityResponseSchema.safeParse(body);
            if (!parsed.success
                || parsed.data.data.user_id !== authContext.userId) {
                throw new Error("Invalid User-Service identity response");
            }
            return parsed.data.data.customer_id;
        } catch {
            controller.abort();
            try {
                await response?.body?.cancel();
            } catch {
                // The fetch signal already cancels a response body being consumed.
            }
            throw new AppError("Customer ownership verification unavailable", 503);
        } finally {
            clearTimeout(timeout);
        }
    }

    async function resolveWorkOrderId(resource) {
        if (typeof resource?.work_order_id === "string") {
            return resource.work_order_id;
        }
        if (!paymentDb || typeof resource?.payment_id !== "string") {
            return null;
        }
        const payment = await paymentDb("payments")
            .select("work_order_id")
            .where({ payment_id: resource.payment_id })
            .first();
        return payment?.work_order_id || null;
    }

    async function verifyWorkOrderOwnership(authContext, resource) {
        if (!paymentDb) {
            return false;
        }
        const workOrderId = await resolveWorkOrderId(resource);
        if (!workOrderId) {
            return false;
        }
        const customerId = await requestCustomerIdentity(
            authContext.userId,
            authContext
        );
        if (typeof customerId !== "string" || !customerId.trim()) {
            return false;
        }
        const account = await paymentDb("work_order_payment_accounts")
            .select("customer_id")
            .where({ work_order_id: workOrderId })
            .first();
        return account?.customer_id === customerId;
    }

    async function authorizePaymentQuery(authContext, resource) {
        if (!await requestPermission(authContext, "payment.view_own", resource)) {
            return false;
        }
        try {
            if (!await verifyWorkOrderOwnership(authContext, resource)) {
                return false;
            }
        } catch {
            throw new AppError("Customer ownership verification unavailable", 503);
        }
        return { allowed: true, include_recorded_by: false };
    }

    async function authorizeRefundQuery(authContext) {
        if (!authenticatedContexts.has(authContext)) {
            throw new AppError("Authentication required", 401);
        }
        return false;
    }

    return {
        authenticateToken,
        requireUserAuth,
        requestPermission,
        authorizePaymentRecorder,
        authorizePaymentQuery,
        authorizeRefundActor,
        authorizeRefundQuery
    };
}

module.exports = {
    createUserAuthorizationAdapter
};
