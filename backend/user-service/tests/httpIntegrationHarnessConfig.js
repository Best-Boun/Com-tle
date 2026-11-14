function buildChildEnvironment(parentEnv, {
    publicKeysDirectory,
    privateKeyPath,
    issuer,
    audience,
    keyId
}) {
    const childEnv = { ...parentEnv };
    for (const name of Object.keys(childEnv)) {
        if (name.startsWith("INTERNAL_SERVICE_JWT_")) {
            delete childEnv[name];
        }
    }

    delete childEnv.USER_SERVICE_ALLOW_RAILWAY_HTTP_HARNESS;
    delete childEnv.USER_SERVICE_ALLOW_VALID_INTERNAL_TOKEN_HTTP_TESTS;
    delete childEnv.USER_SERVICE_SA_APPROVED_REPLAY_WRITES;

    Object.assign(childEnv, {
        USER_SERVICE_HTTP_INTEGRATION_TEST: "1",
        PORT: "0",
        INTERNAL_SERVICE_JWT_PUBLIC_KEYS_DIR: publicKeysDirectory,
        INTERNAL_SERVICE_JWT_ISSUER: issuer,
        INTERNAL_SERVICE_JWT_AUDIENCE: audience,
        INTERNAL_SERVICE_JWT_ALLOWED_SERVICES: "payment-service",
        INTERNAL_SERVICE_JWT_KEY_SERVICES: `${keyId}:payment-service`,
        INTERNAL_SERVICE_JWT_MAX_LIFETIME_SECONDS: "300",
        JWT_PRIVATE_KEY_PATH: privateKeyPath,
        JWT_ISSUER: "user-service-http-test",
        JWT_AUDIENCE: "user-service-http-test",
        JWT_EXPIRES_IN: "900",
        JWT_REFRESH_EXPIRES_IN: "2592000"
    });

    return childEnv;
}

function validTokenTestsEnabled(env = process.env) {
    return env.USER_SERVICE_ALLOW_VALID_INTERNAL_TOKEN_HTTP_TESTS === "1"
        && env.USER_SERVICE_SA_APPROVED_REPLAY_WRITES === "1";
}

function preflightError(error, stage) {
    const safeCode = (code) => typeof code === "string"
        && /^(?:E[A-Z][A-Z0-9_]*|PROTOCOL_[A-Z0-9_]+|KNEX_[A-Z0-9_]+)$/.test(code)
        && code.length <= 80
        ? code
        : null;
    const safeNames = new Set([
        "Error", "TypeError", "RangeError", "TimeoutError", "KnexTimeoutError"
    ]);
    const safeMessages = new Set([
        "Connection lost: The server closed the connection.",
        "connect ETIMEDOUT",
        "Knex: Timeout acquiring a connection. The pool is probably full."
    ]);
    const location = typeof error?.stack === "string"
        ? error.stack.match(
            /(?:^|[\\/])((?:connection|client|pool|index|railwayPermissionsHttp\.integration\.test|httpIntegrationHarnessConfig)\.js:\d+:\d+)/m
        )?.[1] ?? null
        : null;
    const details = {
        stage,
        code: safeCode(error?.code),
        name: safeNames.has(error?.name) ? error.name : "Error",
        message: safeMessages.has(error?.message)
            ? error.message
            : "Error message withheld to protect sensitive data",
        causeCode: safeCode(error?.cause?.code),
        stackLocation: location
    };
    return new Error(`Railway preflight failed: ${JSON.stringify(details)}`);
}

async function runPreflightQuery(db, sql, queryStage) {
    let connection;
    try {
        connection = await db.client.acquireConnection();
    } catch (error) {
        throw preflightError(error, "connection acquisition");
    }

    let queryError;
    try {
        try {
            return await db.raw(sql).connection(connection);
        } catch (error) {
            queryError = preflightError(error, queryStage);
            throw queryError;
        }
    } finally {
        try {
            await db.client.releaseConnection(connection);
        } catch (error) {
            const releaseError = preflightError(error, "connection release");
            if (queryError) {
                throw new AggregateError(
                    [queryError, releaseError],
                    "Railway preflight query and connection release failed"
                );
            }
            throw releaseError;
        }
    }
}

module.exports = {
    buildChildEnvironment,
    validTokenTestsEnabled,
    preflightError,
    runPreflightQuery
};
