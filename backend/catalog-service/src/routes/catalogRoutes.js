const express = require("express");
const { PERMISSIONS } = require("../../../shared/constants");
const { requireAnyPermission } = require("../../../shared/middleware/serviceAuth");
const { createCatalogController } = require("../controllers/catalogController");

/**
 * Mounted at the service root; the Gateway strips "/api/catalog".
 *   GET /categories, /services, /services/:id  — public (token optional)
 *   everything else                            — catalog.manage
 */
function createCatalogRouter({ catalogService, authenticate }) {
    if (!catalogService || typeof authenticate !== "function") {
        throw new Error("Catalog service and authenticate middleware are required");
    }

    const router = express.Router();
    const c = createCatalogController(catalogService);
    const canManage = requireAnyPermission(PERMISSIONS.CATALOG_MANAGE);

    // Reading the service list and prices is public (home page, price list).
    // A token is optional; when sent it must be valid, and admins may then
    // ask for inactive items with include_inactive=true.
    const optionalAuth = (req, res, next) => (
        req.headers.authorization ? authenticate(req, res, next) : next()
    );
    const manage = [authenticate, canManage];

    router.get("/categories", optionalAuth, c.listCategories);
    router.post("/categories", ...manage, c.createCategory);
    router.patch("/categories/:categoryId", ...manage, c.updateCategory);
    router.patch("/categories/:categoryId/status", ...manage, c.setCategoryStatus);

    router.get("/services", optionalAuth, c.listServices);
    router.get("/services/:serviceId", optionalAuth, c.getService);
    router.post("/services", ...manage, c.createService);
    router.patch("/services/:serviceId", ...manage, c.updateService);
    router.patch("/services/:serviceId/status", ...manage, c.setServiceStatus);

    router.get("/audit-logs", ...manage, c.listAuditLogs);

    return router;
}

module.exports = createCatalogRouter;
