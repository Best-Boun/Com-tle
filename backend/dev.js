#!/usr/bin/env node
/**
 * Runs the SmartFix backend locally: API Gateway + every service that is set up.
 *
 *   cd backend
 *   node dev.js                      # all services that have a .env
 *   node dev.js user payment         # only these (the gateway always starts)
 *
 * Setup per service (once):
 *   1. copy <service>/.env.example to <service>/.env and fill in DB settings
 *   2. put the shared private keys in place (they are not in git):
 *        user-service/keys/private.pem     signs user tokens
 *        payment-service/keys/private.pem  signs Payment -> User-Service calls
 *      Ask the team for them. generate-keys.js makes a NEW user key pair, which
 *      no longer matches the public keys committed for the other services.
 *   3. npm install inside the service folder
 *
 * A service without .env, node_modules or a required key is skipped with the
 * reason. Each service reads its own .env; this script never prints secrets.
 * Ctrl+C stops everything.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const SERVICES = [
    { name: "user", dir: "user-service", port: 3001, keys: ["keys/private.pem"] },
    { name: "booking", dir: "booking-service", port: 3002 },
    { name: "catalog", dir: "catalog-service", port: 3003 },
    { name: "repair", dir: "repair-service", port: 3004 },
    { name: "inventory", dir: "inventory-service", port: 3005 },
    { name: "payment", dir: "payment-service", port: 3006, keys: ["keys/private.pem"] },
    { name: "gateway", dir: "api-gateway", port: 3000 }
];
const COLORS = [36, 33, 35, 32, 34, 31, 37];

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !SERVICES.some((s) => s.name === name));
if (unknown.length > 0) {
    console.error(`Unknown service: ${unknown.join(", ")}. Choose from: ${SERVICES.map((s) => s.name).join(", ")}`);
    process.exit(1);
}

function problem(service) {
    const root = path.join(__dirname, service.dir);
    if (!fs.existsSync(path.join(root, ".env"))) return "no .env (copy .env.example)";
    if (!fs.existsSync(path.join(root, "node_modules"))) return "no node_modules (run npm install)";
    const missing = (service.keys || []).filter((key) => !fs.existsSync(path.join(root, key)));
    if (missing.length > 0) return `missing ${missing.join(", ")} (ask the team)`;
    return null;
}

const children = [];
let stopping = false;

function start(service, color) {
    const tag = `\x1b[${color}m[${service.name}]\x1b[0m`;
    // Railway MySQL stores DATETIME in UTC; app-written times must be UTC too.
    const child = spawn(process.execPath, ["server.js"], {
        cwd: path.join(__dirname, service.dir),
        env: { ...process.env, TZ: "UTC" }
    });
    const print = (stream) => (chunk) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) stream.write(`${tag} ${line}\n`);
        }
    };
    child.stdout.on("data", print(process.stdout));
    child.stderr.on("data", print(process.stderr));
    child.on("exit", (code) => {
        if (!stopping) console.log(`${tag} exited with code ${code}`);
    });
    children.push(child);
}

// True when something (often an earlier `node dev.js`) already listens on the port.
function portInUse(port) {
    return new Promise((resolve) => {
        const probe = net.createServer()
            .once("error", (error) => resolve(error.code === "EADDRINUSE"))
            .once("listening", () => probe.close(() => resolve(false)))
            .listen(port);
    });
}

async function main() {
    const selected = SERVICES.filter((s) => s.name === "gateway"
        || requested.length === 0
        || requested.includes(s.name));
    const busy = [];
    let started = 0;
    for (const [index, service] of selected.entries()) {
        const reason = problem(service);
        if (reason) {
            console.log(`[skip] ${service.name}: ${reason}`);
            continue;
        }
        if (await portInUse(service.port)) {
            console.log(`[skip] ${service.name}: port ${service.port} is already in use`);
            busy.push(service.port);
            continue;
        }
        console.log(`[start] ${service.name} on http://localhost:${service.port}`);
        start(service, COLORS[index % COLORS.length]);
        started += 1;
    }
    if (busy.length > 0) {
        console.log(`\nPorts ${busy.join(", ")} are taken, probably by a backend that is already running.`
            + "\nStop it first (Ctrl+C in its window), or keep using it.");
    }
    if (started === 0) {
        console.error("Nothing to start.");
        process.exit(1);
    }
}
main();

function stopAll() {
    if (stopping) return;
    stopping = true;
    console.log("Stopping...");
    for (const child of children) child.kill("SIGINT");
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
