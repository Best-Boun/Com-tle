const AppError = require("../../../shared/errors/AppError");
const {
    INTERNAL_JWT_CLOCK_SKEW_SECONDS
} = require("../constants/internalServiceAuth");

function toUtcDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new AppError("Invalid replay expiration", 500);
    }
    return date.toISOString().replace("T", " ").replace("Z", "");
}

function createInternalTokenReplayRepository({ db, now = Date.now } = {}) {
    if (typeof db !== "function") {
        throw new Error("User-Service database is required for replay protection");
    }
    if (typeof now !== "function") {
        throw new Error("Replay repository clock must be a function");
    }

    async function consumeJti({ issuer, jti, clientId, expiresAt } = {}) {
        if (typeof issuer !== "string"
            || issuer.length === 0
            || issuer.length > 255
            || typeof jti !== "string"
            || !/^[A-Za-z0-9._-]{8,128}$/.test(jti)
            || typeof clientId !== "string"
            || clientId.length === 0
            || clientId.length > 64
            || !Number.isSafeInteger(expiresAt)) {
            throw new AppError("Invalid replay record", 500);
        }

        const replayExpiresAt = toUtcDateTime(
            (expiresAt + INTERNAL_JWT_CLOCK_SKEW_SECONDS) * 1000
        );
        const createdAt = toUtcDateTime(now());
        try {
            const inserted = await db("internal_token_replays").insert({
                issuer,
                jti,
                client_id: clientId,
                expires_at: replayExpiresAt,
                created_at: createdAt
            });
            if (!Array.isArray(inserted)
                || inserted.length !== 1
                || inserted[0] === undefined
                || inserted[0] === null) {
                throw new Error("Replay insert result could not be verified");
            }
            return true;
        } catch (error) {
            if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
                return false;
            }
            throw new AppError("Internal authentication service unavailable", 503);
        }
    }

    async function cleanupExpired(nowUtc = now()) {
        // Match the verifier's whole-second expiry check before pruning rows.
        const cleanupSecond = Math.floor(
            new Date(nowUtc).getTime() / 1000
        ) * 1000;
        const cleanupCutoff = toUtcDateTime(cleanupSecond);
        try {
            return await db("internal_token_replays")
                .where("expires_at", "<", cleanupCutoff)
                .delete();
        } catch {
            throw new AppError("Internal authentication service unavailable", 503);
        }
    }

    return {
        consumeJti,
        cleanupExpired
    };
}

module.exports = {
    createInternalTokenReplayRepository,
    toUtcDateTime
};
