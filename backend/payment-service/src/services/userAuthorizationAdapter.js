const AppError = require("../../../shared/errors/AppError");
const { z } = require("zod");

const supportedPermissionRequests = new Set([
    "payment.record",
    "payment.view_own",
    "payment.refund",
    "payment.view_all"
]);
// Which role holds which payment permission. Mirrors the grants in user_db
// (user-service/seeds/002_permissions.js): staff money operations are ADMIN
// only, customers see their own payments. Checked here from the verified
// token's roles, so payments keep working while User-Service is down.
// Trade-off: a role change takes effect when the user's access token is
// renewed (at most JWT_EXPIRES_IN, 15 minutes), like in the other services.
const PAYMENT_ROLE_PERMISSIONS = Object.freeze({
    ADMIN: Object.freeze(["payment.record", "payment.view_all", "payment.refund"]),
    CUSTOMER: Object.freeze(["payment.view_own"]),
    TECHNICIAN: Object.freeze([])
});
// user_id -> customer_id never changes once resolved, so it is remembered:
// customers who already used payments keep working while User-Service is down.
const CUSTOMER_ID_CACHE_LIMIT = 10_000;
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
    nodeEnv = process.env.NODE_ENV
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
    const customerIdentityEndpoint = new URL(
        "/internal/customers/resolve",
        userServiceBase
    ).toString();
    const authenticatedContexts = new WeakSet();
    const userTokensByContext = new WeakMap();
    const rolesByContext = new WeakMap();
    const customerIdByUser = new Map();

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
        // Kept beside the context, never on it: callers cannot supply roles.
        rolesByContext.set(authContext, Array.isArray(verified.roles) ? verified.roles : []);
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
        if (!resourceSchema.safeParse(resource).success) {
            throw new AppError("Invalid authorization resource", 400);
        }
        // Ownership of a resource is checked by the payment rules themselves
        // (customer id / booking owner); this only says whether the role may act.
        const roles = rolesByContext.get(authContext) || [];
        return roles.some((role) => PAYMENT_ROLE_PERMISSIONS[role]?.includes(permission));
    }

    async function authorizePaymentRecorder(authContext) {
        if (!await requestPermission(authContext, "payment.record")) {
            throw new AppError("Payment recording is not authorized", 403);
        }
        return authContext.userId;
    }

    async function authorizeRefundActor(authContext, permission) {
        if (permission !== "payment.refund"
            || !await requestPermission(authContext, "payment.refund")) {
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

    // Customer ID of the verified caller, or null when User-Service says the
    // caller has no customer identity. Ownership is decided by the caller.
    async function requestCustomerId(authContext) {
        if (!authenticatedContexts.has(authContext)) {
            throw new AppError("Authentication required", 401);
        }
        if (customerIdByUser.has(authContext.userId)) {
            return customerIdByUser.get(authContext.userId);
        }
        const customerId = await requestCustomerIdentity(authContext.userId, authContext);
        if (customerId) {
            if (customerIdByUser.size >= CUSTOMER_ID_CACHE_LIMIT) {
                customerIdByUser.delete(customerIdByUser.keys().next().value);
            }
            customerIdByUser.set(authContext.userId, customerId);
        }
        return customerId;
    }

    return {
        authenticateToken,
        requireUserAuth,
        requestPermission,
        authorizePaymentRecorder,
        authorizeRefundActor,
        requestCustomerId
    };
}

module.exports = {
    createUserAuthorizationAdapter
};
