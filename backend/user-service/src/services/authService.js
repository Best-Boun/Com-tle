const bcrypt = require("bcryptjs");
const { createHash, createPublicKey, randomBytes } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { USER_ROLES } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
const { createAuditLogService } = require("./auditLogService");
const { createUuid } = require("../utils/uuid");

const SALT_ROUNDS = 12;
const validRoleCodes = new Set(Object.values(USER_ROLES));
const genericAuthenticationError = "Invalid email or password";
const genericRefreshError = "Invalid or expired refresh token";
const refreshTokenSchema = z.object({
    refresh_token: z.string().min(1).max(256)
}).strict();

const registrationSchema = z.object({
    full_name: z.string().trim().min(1).max(150),
    email: z.string().trim().email().max(255),
    password: z.string()
        .min(8)
        .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
    phone: z.union([z.string().trim().max(30), z.null()]).optional()
}).strict();

function normalizeEmail(email) {
    return email.trim().toLowerCase();
}

function isDuplicateEmailError(error) {
    return error.code === "ER_DUP_ENTRY" || error.errno === 1062;
}

function createAuthService({
    db,
    jwtConfig,
    now = Date.now,
    auditLog = createAuditLogService({ now }),
    bcryptImplementation = bcrypt,
    jwtImplementation = jwt,
    createId = createUuid,
    generateRefreshToken = () => randomBytes(32).toString("base64url")
}) {
    if (!db || !jwtConfig || !Number.isSafeInteger(jwtConfig.refreshExpiresIn)
        || jwtConfig.refreshExpiresIn < 1) {
        throw new Error("Database and valid JWT configuration are required");
    }
    if (!auditLog || typeof auditLog.record !== "function") {
        throw new Error("A valid audit log service is required");
    }
    function hashRefreshToken(token) {
        return createHash("sha256").update(token, "utf8").digest("hex");
    }

    function getRefreshToken(input) {
        const parsed = refreshTokenSchema.safeParse(input);
        return parsed.success ? parsed.data.refresh_token : null;
    }

    function createAccessToken(userId, roles, issuedAt) {
        return jwtImplementation.sign(
            { roles, iat: issuedAt, token_use: "user_access" },
            jwtConfig.privateKey,
            {
                algorithm: "RS256",
                subject: userId,
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience,
                expiresIn: jwtConfig.expiresIn
            }
        );
    }

    function verifyAccessToken(token) {
        try {
            const publicKey = createPublicKey(jwtConfig.privateKey);
            const decoded = jwtImplementation.verify(token, publicKey, {
                algorithms: ["RS256"],
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience,
                clockTimestamp: Math.floor(now() / 1000)
            });

            if (
                !decoded
                || typeof decoded !== "object"
                || !Number.isFinite(decoded.exp)
                || typeof decoded.sub !== "string"
                || decoded.sub.trim().length === 0
                || (decoded.token_use !== undefined
                    && decoded.token_use !== "user_access")
                || !Array.isArray(decoded.roles)
                || decoded.roles.length === 0
                || !decoded.roles.every(
                    (role) => typeof role === "string" && validRoleCodes.has(role)
                )
            ) {
                throw new Error("Invalid access token claims");
            }

            return decoded;
        } catch {
            throw new AppError("Invalid or expired access token", 401);
        }
    }

    async function insertRefreshToken(trx, { userId, tokenFamilyId, issuedAt }) {
        const refreshToken = generateRefreshToken();
        const sessionId = createId();

        await trx("refresh_token_sessions").insert({
            session_id: sessionId,
            user_id: userId,
            token_hash: hashRefreshToken(refreshToken),
            token_family_id: tokenFamilyId,
            expires_at: new Date(issuedAt + jwtConfig.refreshExpiresIn * 1000),
            revoked_at: null,
            replaced_by_token_id: null,
            created_at: new Date(issuedAt)
        });

        return {
            sessionId,
            refreshToken,
            expiresIn: jwtConfig.refreshExpiresIn
        };
    }

    async function loadUserRoles(query, userId) {
        const assignedRows = await query("user_roles")
            .join("roles", "user_roles.role_id", "roles.role_id")
            .select("roles.role_code")
            .where({ "user_roles.user_id": userId })
            .orderBy("roles.role_code");

        return [...new Set(
            assignedRows
                .map((row) => row.role_code)
                .filter((roleCode) => validRoleCodes.has(roleCode))
        )];
    }

    async function revokeSession(trx, sessionId, revokedAt) {
        await trx("refresh_token_sessions")
            .where({ session_id: sessionId })
            .whereNull("revoked_at")
            .update({ revoked_at: new Date(revokedAt) });
    }

    async function revokeFamily(trx, tokenFamilyId, revokedAt) {
        return trx("refresh_token_sessions")
            .where({ token_family_id: tokenFamilyId })
            .whereNull("revoked_at")
            .update({ revoked_at: new Date(revokedAt) });
    }

    async function runAuthTransaction(callback) {
        try {
            return await db.transaction(callback);
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Authentication service unavailable", 503);
        }
    }

    async function recordFailedAuthentication(
        action,
        reason,
        requestId,
        targetUserId = null,
        targetEntityType = "user"
    ) {
        await runAuthTransaction((trx) => auditLog.record(trx, {
            actor_user_id: null,
            action,
            target_entity_type: targetEntityType,
            target_entity_id: targetUserId,
            outcome: "FAILURE",
            request_id: requestId || null,
            metadata: { reason }
        }));
    }

    async function register(input, requestId = null) {
        const parsed = registrationSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid registration details", 400);
        }

        const { full_name: fullName, password } = parsed.data;
        const email = normalizeEmail(parsed.data.email);
        const phone = parsed.data.phone?.trim() || null;

        try {
            return await db.transaction(async (trx) => {
                const existingUser = await trx("users")
                    .select("user_id")
                    .where({ email })
                    .first();

                if (existingUser) {
                    throw new AppError("An account with this email already exists", 409);
                }

                const customerRole = await trx("roles")
                    .select("role_id")
                    .where({ role_code: USER_ROLES.CUSTOMER })
                    .first();

                if (!customerRole) {
                    throw new AppError("Customer role is not configured", 503);
                }

                const userId = createId();
                const customerId = createId();
                const passwordHash = await bcryptImplementation.hash(password, SALT_ROUNDS);

                await trx("users").insert({
                    user_id: userId,
                    email,
                    password_hash: passwordHash,
                    phone,
                    status: "ACTIVE"
                });

                await trx("customers").insert({
                    customer_id: customerId,
                    user_id: userId,
                    full_name: fullName,
                    phone,
                    email,
                    customer_type: "REGISTERED"
                });

                await trx("user_roles").insert({
                    user_id: userId,
                    role_id: customerRole.role_id,
                    assigned_by: null
                });

                await auditLog.record(trx, {
                    actor_user_id: userId,
                    action: "USER.REGISTERED",
                    target_entity_type: "user",
                    target_entity_id: userId,
                    outcome: "SUCCESS",
                    request_id: requestId,
                    metadata: { role_codes: [USER_ROLES.CUSTOMER] }
                });

                return {
                    user: {
                        user_id: userId,
                        email,
                        phone,
                        full_name: fullName
                    },
                    roles: [USER_ROLES.CUSTOMER]
                };
            });
        } catch (error) {
            if (isDuplicateEmailError(error)
                || (error instanceof AppError && error.statusCode === 409)) {
                // Audited without the email so the event cannot enumerate accounts.
                await recordFailedAuthentication(
                    "USER.REGISTERED",
                    "DUPLICATE_EMAIL",
                    requestId
                );
                throw new AppError("An account with this email already exists", 409);
            }
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Registration service unavailable", 503);
        }
    }

    async function login(input, requestId = null) {
        const email = typeof input?.email === "string"
            ? normalizeEmail(input.email)
            : "";
        const password = typeof input?.password === "string"
            ? input.password
            : "";

        if (!email || !password) {
            await recordFailedAuthentication(
                "AUTH.LOGIN",
                "INVALID_CREDENTIALS",
                requestId
            );
            throw new AppError(genericAuthenticationError, 401);
        }

        const user = await db("users")
            .select("user_id", "email", "password_hash", "phone", "status")
            .where({ email })
            .first();

        if (
            !user
            || user.status !== "ACTIVE"
            || !(await bcryptImplementation.compare(password, user.password_hash))
        ) {
            await recordFailedAuthentication(
                "AUTH.LOGIN",
                !user || user.status === "ACTIVE"
                    ? "INVALID_CREDENTIALS"
                    : "INACTIVE_ACCOUNT",
                requestId,
                user?.user_id || null
            );
            throw new AppError(genericAuthenticationError, 401);
        }

        const roles = await loadUserRoles(db, user.user_id);

        if (roles.length === 0) {
            await recordFailedAuthentication(
                "AUTH.LOGIN",
                "NO_VALID_ROLE",
                requestId,
                user.user_id
            );
            throw new AppError(genericAuthenticationError, 401);
        }

        const issuedAtMilliseconds = now();
        const issuedAt = Math.floor(issuedAtMilliseconds / 1000);
        const accessToken = createAccessToken(user.user_id, roles, issuedAt);
        const refresh = await runAuthTransaction(async (trx) => {
            const result = await insertRefreshToken(trx, {
                userId: user.user_id,
                tokenFamilyId: createId(),
                issuedAt: issuedAtMilliseconds
            });
            await auditLog.record(trx, {
                actor_user_id: user.user_id,
                action: "AUTH.LOGIN",
                target_entity_type: "user",
                target_entity_id: user.user_id,
                outcome: "SUCCESS",
                request_id: requestId,
                metadata: { role_codes: roles }
            });
            return result;
        });

        return {
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: jwtConfig.expiresIn,
            refresh_token: refresh.refreshToken,
            refresh_expires_in: refresh.expiresIn,
            user: {
                user_id: user.user_id,
                email: user.email,
                phone: user.phone
            },
            roles
        };
    }

    async function refresh(input, requestId = null) {
        const rawToken = getRefreshToken(input);
        if (!rawToken) {
            await recordFailedAuthentication(
                "AUTH.REFRESH_REJECTED",
                "INVALID_TOKEN",
                requestId,
                null,
                "refresh_session"
            );
            throw new AppError(genericRefreshError, 401);
        }

        const tokenHash = hashRefreshToken(rawToken);
        const currentTime = now();
        const outcome = await runAuthTransaction(async (trx) => {
            const storedToken = await trx("refresh_token_sessions")
                .where({ token_hash: tokenHash })
                .forUpdate()
                .first();

            if (!storedToken) {
                await auditLog.record(trx, {
                    actor_user_id: null,
                    action: "AUTH.REFRESH_REJECTED",
                    target_entity_type: "refresh_session",
                    target_entity_id: null,
                    outcome: "FAILURE",
                    request_id: requestId,
                    metadata: { reason: "UNKNOWN_TOKEN" }
                });
                return { error: true };
            }

            if (storedToken.revoked_at !== null) {
                await revokeFamily(trx, storedToken.token_family_id, currentTime);
                await auditLog.record(trx, {
                    actor_user_id: null,
                    action: "AUTH.REFRESH_REUSE_DETECTED",
                    target_entity_type: "refresh_session",
                    target_entity_id: storedToken.session_id,
                    outcome: "FAILURE",
                    request_id: requestId,
                    metadata: { reason: "REVOKED_TOKEN" }
                });
                return { error: true };
            }

            if (new Date(storedToken.expires_at).getTime() <= currentTime) {
                await revokeSession(trx, storedToken.session_id, currentTime);
                await auditLog.record(trx, {
                    actor_user_id: null,
                    action: "AUTH.REFRESH_REJECTED",
                    target_entity_type: "refresh_session",
                    target_entity_id: storedToken.session_id,
                    outcome: "FAILURE",
                    request_id: requestId,
                    metadata: { reason: "EXPIRED_TOKEN" }
                });
                return { error: true };
            }

            const user = await trx("users")
                .select("user_id", "status")
                .where({ user_id: storedToken.user_id })
                .forUpdate()
                .first();

            if (!user || user.status !== "ACTIVE") {
                await revokeSession(trx, storedToken.session_id, currentTime);
                await auditLog.record(trx, {
                    actor_user_id: null,
                    action: "AUTH.REFRESH_REJECTED",
                    target_entity_type: "user",
                    target_entity_id: storedToken.user_id,
                    outcome: "FAILURE",
                    request_id: requestId,
                    metadata: { reason: "INACTIVE_ACCOUNT" }
                });
                return { error: true };
            }

            const roles = await loadUserRoles(trx, user.user_id);
            if (roles.length === 0) {
                await revokeSession(trx, storedToken.session_id, currentTime);
                await auditLog.record(trx, {
                    actor_user_id: user.user_id,
                    action: "AUTH.REFRESH_REJECTED",
                    target_entity_type: "user",
                    target_entity_id: user.user_id,
                    outcome: "FAILURE",
                    request_id: requestId,
                    metadata: { reason: "NO_VALID_ROLE" }
                });
                return { error: true };
            }

            const issuedAt = now();
            const replacement = await insertRefreshToken(trx, {
                userId: user.user_id,
                tokenFamilyId: storedToken.token_family_id,
                issuedAt
            });

            const updated = await trx("refresh_token_sessions")
                .where({ session_id: storedToken.session_id })
                .whereNull("revoked_at")
                .update({
                    revoked_at: new Date(issuedAt),
                    replaced_by_token_id: replacement.sessionId
                });

            if (updated !== 1) {
                throw new AppError(genericRefreshError, 401);
            }

            await auditLog.record(trx, {
                actor_user_id: user.user_id,
                action: "AUTH.REFRESH_ROTATED",
                target_entity_type: "refresh_session",
                target_entity_id: storedToken.session_id,
                outcome: "SUCCESS",
                request_id: requestId
            });

            return {
                accessToken: createAccessToken(
                    user.user_id,
                    roles,
                    Math.floor(issuedAt / 1000)
                ),
                refreshToken: replacement.refreshToken,
                refreshExpiresIn: replacement.expiresIn,
                userId: user.user_id,
                roles
            };
        });

        if (outcome.error) {
            throw new AppError(genericRefreshError, 401);
        }

        return {
            access_token: outcome.accessToken,
            token_type: "Bearer",
            expires_in: jwtConfig.expiresIn,
            refresh_token: outcome.refreshToken,
            refresh_expires_in: outcome.refreshExpiresIn,
            user: { user_id: outcome.userId },
            roles: outcome.roles
        };
    }

    async function logout(input, requestId = null) {
        const rawToken = getRefreshToken(input);
        if (!rawToken) {
            await recordFailedAuthentication(
                "AUTH.LOGOUT",
                "INVALID_TOKEN",
                requestId,
                null,
                "refresh_session"
            );
            throw new AppError("Refresh token is required", 400);
        }

        const tokenHash = hashRefreshToken(rawToken);
        const revoked = await runAuthTransaction(async (trx) => {
            const storedToken = await trx("refresh_token_sessions")
                .where({ token_hash: tokenHash })
                .forUpdate()
                .first();

            if (!storedToken) {
                await auditLog.record(trx, {
                    actor_user_id: null,
                    action: "AUTH.LOGOUT",
                    target_entity_type: "refresh_session",
                    target_entity_id: null,
                    outcome: "SUCCESS",
                    request_id: requestId,
                    metadata: { revoked: false }
                });
                return false;
            }

            const revokedCount = await revokeFamily(
                trx,
                storedToken.token_family_id,
                now()
            );
            await auditLog.record(trx, {
                actor_user_id: storedToken.user_id,
                action: "AUTH.LOGOUT",
                target_entity_type: "refresh_session",
                target_entity_id: storedToken.session_id,
                outcome: "SUCCESS",
                request_id: requestId,
                metadata: { revoked: revokedCount > 0 }
            });
            return revokedCount > 0;
        });

        return { revoked };
    }

    return {
        register,
        login,
        refresh,
        logout,
        verifyAccessToken
    };
}

module.exports = {
    createAuthService
};
