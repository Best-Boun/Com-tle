
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const keys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: "spki",
        format: "pem"
    },
    privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
    }
});

const keyDirectory = path.join(__dirname, "user-service", "keys");

fs.writeFileSync(
    path.join(keyDirectory, "private.pem"),
    keys.privateKey
);

fs.writeFileSync(
    path.join(keyDirectory, "public.pem"),
    keys.publicKey
);

console.log("RSA Key Pair generated successfully!");
