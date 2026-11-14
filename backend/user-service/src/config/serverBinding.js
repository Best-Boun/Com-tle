function getServerBindHost(env = process.env) {
    return env.USER_SERVICE_HTTP_INTEGRATION_TEST === "1"
        ? "127.0.0.1"
        : null;
}

module.exports = {
    getServerBindHost
};
