function createLoginRateLimiter({ windowMs, max, now = Date.now }) {
    if (
        !Number.isSafeInteger(windowMs)
        || windowMs < 1
        || !Number.isSafeInteger(max)
        || max < 1
    ) {
        throw new Error("Login rate limit window and maximum must be positive integers");
    }

    const attemptsByIp = new Map();
    let nextCleanupAt = 0;

    return (req, res, next) => {
        const currentTime = now();
        if (currentTime >= nextCleanupAt) {
            for (const [ip, record] of attemptsByIp) {
                if (currentTime - record.windowStartedAt >= windowMs) {
                    attemptsByIp.delete(ip);
                }
            }
            nextCleanupAt = currentTime + Math.min(windowMs, 60_000);
        }

        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        let record = attemptsByIp.get(ip);
        if (!record || currentTime - record.windowStartedAt >= windowMs) {
            record = { windowStartedAt: currentTime, count: 0 };
            attemptsByIp.set(ip, record);
        }

        if (record.count >= max) {
            const retryAfterSeconds = Math.ceil(
                (record.windowStartedAt + windowMs - currentTime) / 1000
            );
            res.set("Retry-After", String(Math.max(retryAfterSeconds, 1)));
            return res.status(429).json({
                success: false,
                message: "Too many login attempts"
            });
        }

        record.count += 1;
        return next();
    };
}

module.exports = {
    createLoginRateLimiter
};
