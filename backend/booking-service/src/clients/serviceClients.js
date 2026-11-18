const AppError = require("../../../shared/errors/AppError");

/**
 * HTTP clients for the services Booking calls. The caller's access token is
 * forwarded so the downstream service can apply its own authorization.
 */
async function callJson(fetchImpl, url, { timeoutMs, ...options }) {
    let response;
    try {
        response = await fetchImpl(url, {
            ...options,
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        return { ok: false, unreachable: true, timedOut };
    }

    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    return { ok: response.ok, status: response.status, body };
}

function createCatalogClient({ baseUrl, timeoutMs = 5000, fetchImpl = fetch }) {
    return {
        /** Returns the active service, or throws 400 if it does not exist / is inactive. */
        async getActiveService(serviceId, { authorization }) {
            const result = await callJson(
                fetchImpl,
                `${baseUrl}/services/${encodeURIComponent(serviceId)}`,
                {
                    method: "GET",
                    headers: { authorization, accept: "application/json" },
                    timeoutMs
                }
            );

            if (result.ok && result.body?.data?.service_id === serviceId) {
                const service = result.body.data;
                if (!service.is_active || service.category_is_active === false) {
                    throw new AppError("Selected service is not available", 400);
                }
                return service;
            }
            if (result.status === 404) {
                throw new AppError("Selected service is not available", 400);
            }
            throw new AppError("Catalog Service is unavailable, please try again", 503);
        }
    };
}

function createRepairClient({ baseUrl, timeoutMs = 5000, fetchImpl = fetch }) {
    return {
        /**
         * Ask Repair Service to create the Work Order for a booking.
         * The Idempotency-Key (booking id) makes retries safe: Repair must return
         * the existing Work Order instead of creating a second one.
         */
        async createWorkOrderFromBooking(payload, { authorization, idempotencyKey }) {
            const result = await callJson(fetchImpl, `${baseUrl}/work-orders`, {
                method: "POST",
                headers: {
                    authorization,
                    "content-type": "application/json",
                    accept: "application/json",
                    "idempotency-key": idempotencyKey
                },
                body: JSON.stringify(payload),
                timeoutMs
            });

            const workOrderId = result.body?.data?.work_order_id;
            if (result.ok && typeof workOrderId === "string" && workOrderId.length > 0) {
                return { workOrderId };
            }
            if (result.unreachable) {
                throw new AppError(
                    "Repair Service is unavailable, booking was not checked in. Please retry.",
                    503
                );
            }
            if (result.status === 409 || result.status === 400) {
                throw new AppError(
                    result.body?.message || "Repair Service rejected the work order",
                    409
                );
            }
            throw new AppError(
                "Repair Service could not create the work order, booking was not checked in. Please retry.",
                502
            );
        }
    };
}

module.exports = {
    createCatalogClient,
    createRepairClient
};
