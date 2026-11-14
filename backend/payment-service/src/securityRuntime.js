const {
    loadInternalServiceTokenConfig,
    loadUserJwtVerifierConfig,
    loadUserServiceBaseUrl
} = require("./config/authorization");
const {
    createInternalServiceTokenIssuer
} = require("./services/internalServiceTokenIssuer");
const {
    createUserAuthorizationAdapter
} = require("./services/userAuthorizationAdapter");
const {
    createUserJwtVerifier
} = require("./services/userJwtVerifier");

function createSecurityRuntime({
    env = process.env,
    fetchImplementation = globalThis.fetch
} = {}) {
    const userJwtVerifierConfig = loadUserJwtVerifierConfig(env);
    const internalServiceTokenConfig = loadInternalServiceTokenConfig(env);
    const userServiceBaseUrl = loadUserServiceBaseUrl(env);

    const userJwtVerifier = createUserJwtVerifier(userJwtVerifierConfig);
    const internalServiceTokenIssuer = createInternalServiceTokenIssuer(
        internalServiceTokenConfig
    );
    const userAuthorizationAdapter = createUserAuthorizationAdapter({
        userJwtVerifier,
        internalServiceTokenIssuer,
        userServiceUrl: userServiceBaseUrl,
        fetchImplementation,
        nodeEnv: env.NODE_ENV
    });

    return Object.freeze({
        userJwtVerifier,
        internalServiceTokenIssuer,
        userAuthorizationAdapter
    });
}

module.exports = {
    createSecurityRuntime
};
