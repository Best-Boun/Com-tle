function createCustomerMergeExpiryWorker({
    db,
    customerMergeService,
    logger = console,
    intervalMs = 60_000
}) {
    if (typeof db !== "function"
        || !customerMergeService
        || typeof customerMergeService.expire !== "function"
        || !logger
        || typeof logger.error !== "function"
        || !Number.isInteger(intervalMs)
        || intervalMs <= 0) {
        throw new Error("Database, merge service, logger and interval are required");
    }

    let timer;
    let active;

    async function expireDueRequests() {
        const failures = [];
        let lastRequestId;
        while (true) {
            const query = db("customer_merge_requests")
                .select("request_id")
                .where({ status: "PENDING" })
                .where("expires_at", "<=", db.raw("UTC_TIMESTAMP(3)"))
                .orderBy("request_id")
                .limit(100);
            if (lastRequestId) {
                query.where("request_id", ">", lastRequestId);
            }
            const dueRequests = await query;
            if (dueRequests.length === 0) {
                break;
            }
            for (const request of dueRequests) {
                try {
                    await customerMergeService.expire(request.request_id);
                } catch (error) {
                    failures.push(error);
                }
            }
            lastRequestId = dueRequests[dueRequests.length - 1].request_id;
            if (dueRequests.length < 100) {
                break;
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, "Customer merge expiration failed");
        }
    }

    function runOnce() {
        if (!active) {
            active = expireDueRequests().finally(() => {
                active = undefined;
            });
        }
        return active;
    }

    function start() {
        if (timer) {
            throw new Error("Customer merge expiry worker is already running");
        }
        timer = setInterval(() => {
            runOnce().catch((error) => {
                logger.error("Customer merge expiry worker failed", {
                    code: "CUSTOMER_MERGE_EXPIRY_FAILED",
                    ...(error instanceof AggregateError
                        ? { failedRequests: error.errors.length }
                        : {})
                });
            });
        }, intervalMs);
        timer.unref();
    }

    async function stop() {
        if (timer) {
            clearInterval(timer);
            timer = undefined;
        }
        if (active) {
            await active;
        }
    }

    return { runOnce, start, stop };
}

module.exports = {
    createCustomerMergeExpiryWorker
};
