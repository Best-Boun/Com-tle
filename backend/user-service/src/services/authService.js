const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { USER_ROLES } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
const { createUuid } = require("../utils/uuid");

const SALT_ROUNDS = 12;
const validRoleCodes = new Set(Object.values(USER_ROLES));
const genericAuthenticationError = "Invalid email or password";

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
    bcryptImplementation = bcrypt,
    jwtImplementation = jwt,
    createId = createUuid,
    now = Date.now
}) {
    if (!db || !jwtConfig) {
        throw new Error("Database and JWT configuration are required");
    }

    async function register(input) {
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
            if (isDuplicateEmailError(error)) {
                throw new AppError("An account with this email already exists", 409);
            }
            throw error;
        }
    }

    async function login(input) {
        const email = typeof input?.email === "string"
            ? normalizeEmail(input.email)
            : "";
        const password = typeof input?.password === "string"
            ? input.password
            : "";

        if (!email || !password) {
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
            throw new AppError(genericAuthenticationError, 401);
        }

        const assignedRows = await db("user_roles")
            .join("roles", "user_roles.role_id", "roles.role_id")
            .select("roles.role_code")
            .where({ "user_roles.user_id": user.user_id })
            .orderBy("roles.role_code");

        const roles = [...new Set(
            assignedRows
                .map((row) => row.role_code)
                .filter((roleCode) => validRoleCodes.has(roleCode))
        )];

        if (roles.length === 0) {
            throw new AppError(genericAuthenticationError, 401);
        }

        const issuedAt = Math.floor(now() / 1000);
        const accessToken = jwtImplementation.sign(
            { roles, iat: issuedAt },
            jwtConfig.privateKey,
            {
                algorithm: "RS256",
                subject: user.user_id,
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience,
                expiresIn: jwtConfig.expiresIn
            }
        );

        return {
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: jwtConfig.expiresIn,
            user: {
                user_id: user.user_id,
                email: user.email,
                phone: user.phone
            },
            roles
        };
    }

    return {
        register,
        login
    };
}

module.exports = {
    createAuthService
};
