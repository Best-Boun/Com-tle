const fs = require("node:fs");

function hasExited(child) {
    return child.exitCode !== null || child.signalCode !== null;
}

function signalAndWait(child, signal, timeoutMs) {
    if (hasExited(child)) {
        return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
        let timer;
        let settled = false;
        const finish = (error, exited) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            child.removeListener("exit", onExit);
            child.removeListener("error", onError);
            if (error) {
                reject(error);
            } else {
                resolve(exited);
            }
        };
        const onExit = () => finish(null, true);
        const onError = (error) => finish(error);
        child.once("exit", onExit);
        child.once("error", onError);
        timer = setTimeout(() => finish(null, hasExited(child)), timeoutMs);

        try {
            if (!child.kill(signal) && hasExited(child)) {
                finish(null, true);
            }
        } catch (error) {
            finish(error);
        }
    });
}

async function stopChild(child, timeoutMs = 5000) {
    if (hasExited(child)) {
        return "already-exited";
    }
    if (child.pid === undefined) {
        return "not-started";
    }

    let gracefulSignalFailed = false;
    try {
        if (await signalAndWait(child, "SIGTERM", timeoutMs)) {
            return "sigterm-exited";
        }
    } catch {
        gracefulSignalFailed = true;
    }

    if (await signalAndWait(child, "SIGKILL", timeoutMs)) {
        return gracefulSignalFailed ? "forced-after-signal-error" : "forced";
    }
    throw new Error("Child process exit was not confirmed");
}

async function cleanupHarness(resources, {
    timeoutMs = 5000,
    removeDirectory = (directory) => fs.rmSync(directory, { recursive: true, force: true })
} = {}) {
    const result = {
        child: "not-started",
        database: "not-created",
        temporaryDirectory: "not-created",
        errors: []
    };

    if (resources.child) {
        try {
            result.child = await stopChild(resources.child, timeoutMs);
        } catch {
            result.child = "failed";
            result.errors.push(new Error("Child process cleanup failed"));
        }
    }
    if (resources.db) {
        try {
            await resources.db.destroy();
            result.database = "destroyed";
        } catch {
            result.database = "failed";
            result.errors.push(new Error("Knex cleanup failed"));
        }
    }
    if (resources.temporaryDirectory) {
        try {
            await removeDirectory(resources.temporaryDirectory);
            result.temporaryDirectory = "removed";
        } catch {
            result.temporaryDirectory = "failed";
            result.errors.push(new Error("Temporary key directory cleanup failed"));
        }
    }
    return result;
}

async function withHarnessCleanup(run, resources, {
    logger = console,
    ...cleanupOptions
} = {}) {
    let probeFailed = false;
    try {
        return await run();
    } catch (error) {
        probeFailed = true;
        throw error;
    } finally {
        const result = await cleanupHarness(resources, cleanupOptions);
        logger.log("Harness cleanup:", {
            child: result.child,
            database: result.database,
            temporaryDirectory: result.temporaryDirectory
        });
        if (result.errors.length) {
            logger.error("Harness cleanup failures:", result.errors.map((error) => error.message));
            if (!probeFailed) {
                throw new AggregateError(result.errors, "Harness cleanup failed");
            }
        }
    }
}

module.exports = {
    stopChild,
    cleanupHarness,
    withHarnessCleanup
};
