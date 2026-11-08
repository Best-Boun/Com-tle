const { randomUUID } = require("node:crypto");

function createUuid() {
    return randomUUID();
}

module.exports = {
    createUuid
};
