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

    proposeItems(workOrderId, input) {
        return request(`${ROOT}/${encodeURIComponent(workOrderId)}/quotations`, {
            method: "POST",
            body: input
        });
    },

    priceAndSend(quotationId, input) {
        return request(`${quotePath(quotationId)}/send`, {
            method: "PUT",
            body: input
        });
    },

    reviseQuotation(quotationId) {
        return request(`${quotePath(quotationId)}/revise`, {
            method: "POST",
            body: {}
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