/**
 * Creates every RSA key the services need for a local run, at the paths used
 * by each service's .env.example. Keys are never committed (see .gitignore):
 * run this once after cloning, and again only if you want new keys.
 *
 *   node generate-keys.js
 *
 * - User-Service signs access tokens with its private key; every service that
 *   checks tokens gets a copy of the matching public key.
 * - Payment-Service signs its internal calls to User-Service; User-Service
 *   gets the matching public key (key id "payment-key-1").
 *
 * Docker Compose uses generate-compose-keys.js instead.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function pair() {
    return crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
}

function write(relativePath, value) {
    const file = path.join(__dirname, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
    console.log("  wrote", relativePath);
}

const user = pair();
const payment = pair();

// User-Service token key pair, and the public key for everyone who verifies tokens.
write("user-service/keys/private.pem", user.privateKey);
write("user-service/keys/public.pem", user.publicKey);
for (const service of ["api-gateway", "booking-service", "catalog-service", "repair-service"]) {
    write(`${service}/keys/public.pem`, user.publicKey);
}
write("payment-service/keys/user-public.pem", user.publicKey);

// Payment-Service internal key pair; User-Service trusts its public key.
write("payment-service/keys/private.pem", payment.privateKey);
write("user-service/keys/internal/payment-key-1.pem", payment.publicKey);

console.log("RSA keys generated for all services.");
