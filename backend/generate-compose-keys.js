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

function write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
}

const user = pair();
const payment = pair();

write(path.join(__dirname, "user-service", "keys", "private.pem"), user.privateKey);
write(path.join(__dirname, "user-service", "keys", "public.pem"), user.publicKey);
write(path.join(__dirname, "api-gateway", "keys", "public.pem"), user.publicKey);
write(path.join(__dirname, "payment-service", "keys", "private.pem"), payment.privateKey);
write(path.join(__dirname, "payment-service", "keys", "public.pem"), payment.publicKey);
write(path.join(__dirname, "payment-service", "keys", "user-public.pem"), user.publicKey);

write(path.join(__dirname, "user-service", "keys", "internal-public-keys", "payment-key-1.pem"), payment.publicKey);

console.log("Docker Compose RSA key pairs generated.");
