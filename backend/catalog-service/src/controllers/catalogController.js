const { successResponse } = require("../../../shared/utils/responseFormatter");

function handle(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res);
        } catch (error) {
            next(error);
        }
    };
}

function createCatalogController(catalogService) {
    const s = catalogService;

    return {
        // categories
        listCategories: handle(async (req, res) => {
            res.status(200).json(successResponse("Categories retrieved", await s.listCategories(req.query, req.user)));
        }),
        createCategory: handle(async (req, res) => {
            res.status(201).json(successResponse("Category created", await s.createCategory(req.body, req.user)));
        }),
        updateCategory: handle(async (req, res) => {
            res.status(200).json(successResponse("Category updated", await s.updateCategory(req.params.categoryId, req.body, req.user)));
        }),
        setCategoryStatus: handle(async (req, res) => {
            res.status(200).json(successResponse("Category status updated", await s.setCategoryStatus(req.params.categoryId, req.body, req.user)));
        }),

        // services
        listServices: handle(async (req, res) => {
            const { items, meta } = await s.listServices(req.query, req.user);
            res.status(200).json(successResponse("Services retrieved", items, meta));
        }),
        getService: handle(async (req, res) => {
            res.status(200).json(successResponse("Service retrieved", await s.getService(req.params.serviceId, req.user)));
        }),
        createService: handle(async (req, res) => {
            res.status(201).json(successResponse("Service created", await s.createService(req.body, req.user)));
        }),
        updateService: handle(async (req, res) => {
            res.status(200).json(successResponse("Service updated", await s.updateService(req.params.serviceId, req.body, req.user)));
        }),
        setServiceStatus: handle(async (req, res) => {
            res.status(200).json(successResponse("Service status updated", await s.setServiceStatus(req.params.serviceId, req.body, req.user)));
        }),

        // audit
        listAuditLogs: handle(async (req, res) => {
            const { items, meta } = await s.listAuditLogs(req.query, req.user);
            res.status(200).json(successResponse("Audit logs retrieved", items, meta));
        })
    };
}

module.exports = {
    createCatalogController
};
