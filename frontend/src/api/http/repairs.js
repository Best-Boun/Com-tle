/** Repair workflow API through the API Gateway (/api/repairs/*). */
import { query, request } from "./client.js";

const ROOT = "/repairs/work-orders";
const quotePath = (quotationId) => `/repairs/quotations/${encodeURIComponent(quotationId)}`;

export const repairs = {
    async listMine() {
        return request(`${ROOT}/me`);
    },

    async listAssigned() {
        return request(`${ROOT}/assigned`);
    },

    /** Task 12: open a free warranty-claim work order for a repaired device. */
    async openWarrantyClaim(workOrderId, { reported_symptom, accessories, intake_terms_acknowledged } = {}) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/warranty-claims`, {
            method: "POST",
            body: {
                reported_symptom: reported_symptom?.trim() || "",
                accessories: accessories?.trim() || null,
                intake_terms_acknowledged: intake_terms_acknowledged === true
            }
        });
    },

    /** Received devices nobody has taken yet (oldest first). */
    async queue() {
        return request(`${ROOT}/queue`);
    },

    /** A technician takes a job from the queue; 409 if someone was faster. */
    async claim(workOrderId) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/claim`, { method: "POST" });
    },

    async listAll({ status, search } = {}) {
        return request(`${ROOT}${query({ status, search })}`);
    },

    async get(workOrderId) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}`);
    },

    async assignTechnician(workOrderId, technicianUserId) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/assign`, {
            method: "POST",
            body: { technician_user_id: technicianUserId }
        });
    },

    createWalkIn(input) {
        return request(`${ROOT}/walk-in`, { method: "POST", body: input });
    },

    startDiagnosis(workOrderId) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/diagnosis/start`, {
            method: "POST",
            body: {}
        });
    },

    saveDiagnosis(workOrderId, diagnosis) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/diagnosis`, {
            method: "PUT",
            body: { diagnosis }
        });
    },

    /** Technician sends priced options; the server adds the "no repair" option. */
    proposeQuotation(workOrderId, input) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/quotations`, {
            method: "POST",
            body: input
        });
    },

    decideQuotation(quotationId, input) {
        return request(`${quotePath(quotationId)}/decision`, {
            method: "POST",
            body: input
        });
    },

    startRepair(workOrderId) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/repair/start`, {
            method: "POST",
            body: {}
        });
    },

    waitForParts(workOrderId, note) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/parts/wait`, {
            method: "POST",
            body: { note }
        });
    },

    /** Repair-Service registers the bill with Payment-Service from the approved quotations. */
    syncBill(workOrderId) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/bill`, {
            method: "POST",
            body: {}
        });
    },

    recordResult(workOrderId, result) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/repair/result`, {
            method: "PUT",
            body: { result }
        });
    },

    recordTest(workOrderId, input) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/tests`, {
            method: "POST",
            body: input
        });
    },

    handover(workOrderId, input) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/handover`, {
            method: "POST",
            body: input
        });
    },

    cancel(workOrderId, input) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/cancel`, {
            method: "POST",
            body: input
        });
    }
};

export const inventory = {
    listParts() {
        return request("/repairs/parts");
    },

    listMovements({ partId } = {}) {
        return request(`/repairs/parts/movements${query({ partId })}`);
    },

    createPart(input) {
        return request("/repairs/parts", { method: "POST", body: input });
    },

    receive(partId, input) {
        return request(`/repairs/parts/${encodeURIComponent(partId)}/receive`, {
            method: "POST",
            body: input
        });
    },

    issueForWorkOrder(workOrderId, input) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/parts/issue`, {
            method: "POST",
            body: input
        });
    }
};