function getPagination(page = 1, limit = 10) {
    const currentPage = Math.max(1, Number(page) || 1);

    const pageSize = Math.min(
        100,
        Math.max(1, Number(limit) || 10)
    );

    const offset = (currentPage - 1) * pageSize;

    return {
        page: currentPage,
        limit: pageSize,
        offset
    };
}

function getPaginationMeta(totalItems, page, limit) {
    const totalPages = Math.ceil(totalItems / limit);

    return {
        totalItems,
        totalPages,
        currentPage: page,
        pageSize: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
    };
}

module.exports = {
    getPagination,
    getPaginationMeta
};
