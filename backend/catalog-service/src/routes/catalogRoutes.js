const express = require("express");
const { PERMISSIONS } = require("../../../shared/constants");
const { requireAnyPermission } = require("../../../shared/middleware/serviceAuth");
const { createCatalogController } = require("../controllers/catalogController");

/**
 * Mounted at the service root; the Gateway strips "/api/catalog".
 *   /categories..., /services..., /audit-logs
 */
function createCatalogRouter({ catalogService, authenticate }) {
    if (!catalogService || typeof authenticate !== "function") {
        throw new Error("Catalog service and authenticate middleware are required");
    }

    const router = express.Router();
    const c = createCatalogController(catalogService);
    const canView = requireAnyPermission(PERMISSIONS.CATALOG_VIEW, PERMISSIONS.CATALOG_MANAGE);
    const canManage = requireAnyPermission(PERMISSIONS.CATALOG_MANAGE);

    router.use(authenticate);

    router.get("/categories", canView, c.listCategories);
    router.post("/categories", canManage, c.createCategory);
    router.patch("/categories/:categoryId", canManage, c.updateCategory);
    router.patch("/categories/:categoryId/status", canManage, c.setCategoryStatus);

    router.get("/services", canView, c.listServices);
    router.get("/services/:serviceId", canView, c.getService);
    router.post("/services", canManage, c.createService);
    router.patch("/services/:serviceId", canManage, c.updateService);
    router.patch("/services/:serviceId/status", canManage, c.setServiceStatus);

    router.get("/audit-logs", canManage, c.listAuditLogs);

    return router;
}

module.exports = createCatalogRouter;
