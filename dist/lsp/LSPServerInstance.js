import * as path from 'path';
import { pathToFileURL } from 'url';
import { createLSPClient } from './LSPClient.js';
// --- Replacement for cc-haha internal utils ---
function logForDebugging(message) {
    console.error(`[LSP DEBUG] ${message}`);
}
function logError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[LSP ERROR] ${msg}`);
}
function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * LSP error code for "content modified" - indicates the server's state changed
 * during request processing (e.g., rust-analyzer still indexing the project).
 * This is a transient error that can be retried.
 */
const LSP_ERROR_CONTENT_MODIFIED = -32801;
/**
 * Maximum number of retries for transient LSP errors like "content modified".
 */
const MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3;
/**
 * Base delay in milliseconds for exponential backoff on transient errors.
 * Actual delays: 500ms, 1000ms, 2000ms
 */
const RETRY_BASE_DELAY_MS = 500;
/**
 * Creates and manages a single LSP server instance.
 *
 * Uses factory function pattern with closures for state encapsulation.
 * Provides state tracking, health monitoring, and request forwarding for an LSP server.
 * Supports manual restart with configurable retry limits.
 *
 * State machine transitions:
 * - stopped -> starting -> running
 * - running -> stopping -> stopped
 * - any -> error (on failure)
 * - error -> starting (on retry)
 */
export function createLSPServerInstance(name, config) {
    // Validate that unimplemented fields are not set
    if (config.restartOnCrash !== undefined) {
        throw new Error(`LSP server '${name}': restartOnCrash is not yet implemented. Remove this field from the configuration.`);
    }
    if (config.shutdownTimeout !== undefined) {
        throw new Error(`LSP server '${name}': shutdownTimeout is not yet implemented. Remove this field from the configuration.`);
    }
    let state = 'stopped';
    let startTime;
    let lastError;
    let restartCount = 0;
    let crashRecoveryCount = 0;
    const client = createLSPClient(name, error => {
        state = 'error';
        lastError = error;
        crashRecoveryCount++;
    });
    async function start() {
        if (state === 'running' || state === 'starting') {
            return;
        }
        const maxRestarts = config.maxRestarts ?? 3;
        if (state === 'error' && crashRecoveryCount > maxRestarts) {
            const error = new Error(`LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`);
            lastError = error;
            logError(error);
            throw error;
        }
        let initPromise;
        try {
            state = 'starting';
            logForDebugging(`Starting LSP server instance: ${name}`);
            // Start the client
            await client.start(config.command, config.args || [], {
                env: config.env,
                cwd: config.workspaceFolder,
            });
            // Initialize with workspace info
            const workspaceFolder = config.workspaceFolder || process.cwd();
            const workspaceUri = pathToFileURL(workspaceFolder).href;
            const initParams = {
                processId: process.pid,
                initializationOptions: config.initializationOptions ?? {},
                workspaceFolders: [
                    {
                        uri: workspaceUri,
                        name: path.basename(workspaceFolder),
                    },
                ],
                rootPath: workspaceFolder,
                rootUri: workspaceUri,
                capabilities: {
                    workspace: {
                        configuration: false,
                        workspaceFolders: false,
                    },
                    textDocument: {
                        synchronization: {
                            dynamicRegistration: false,
                            willSave: false,
                            willSaveWaitUntil: false,
                            didSave: true,
                        },
                        publishDiagnostics: {
                            relatedInformation: true,
                            tagSupport: {
                                valueSet: [1, 2],
                            },
                            versionSupport: false,
                            codeDescriptionSupport: true,
                            dataSupport: false,
                        },
                        hover: {
                            dynamicRegistration: false,
                            contentFormat: ['markdown', 'plaintext'],
                        },
                        definition: {
                            dynamicRegistration: false,
                            linkSupport: true,
                        },
                        references: {
                            dynamicRegistration: false,
                        },
                        documentSymbol: {
                            dynamicRegistration: false,
                            hierarchicalDocumentSymbolSupport: true,
                        },
                        callHierarchy: {
                            dynamicRegistration: false,
                        },
                    },
                    general: {
                        positionEncodings: ['utf-16'],
                    },
                },
            };
            initPromise = client.initialize(initParams);
            if (config.startupTimeout !== undefined) {
                await withTimeout(initPromise, config.startupTimeout, `LSP server '${name}' timed out after ${config.startupTimeout}ms during initialization`);
            }
            else {
                await initPromise;
            }
            state = 'running';
            startTime = new Date();
            crashRecoveryCount = 0;
            logForDebugging(`LSP server instance started: ${name}`);
        }
        catch (error) {
            client.stop().catch(() => { });
            initPromise?.catch(() => { });
            state = 'error';
            lastError = error;
            logError(error);
            throw error;
        }
    }
    async function stop() {
        if (state === 'stopped' || state === 'stopping') {
            return;
        }
        try {
            state = 'stopping';
            await client.stop();
            state = 'stopped';
            logForDebugging(`LSP server instance stopped: ${name}`);
        }
        catch (error) {
            state = 'error';
            lastError = error;
            logError(error);
            throw error;
        }
    }
    async function restart() {
        try {
            await stop();
        }
        catch (error) {
            const stopError = new Error(`Failed to stop LSP server '${name}' during restart: ${errorMessage(error)}`);
            logError(stopError);
            throw stopError;
        }
        restartCount++;
        const maxRestarts = config.maxRestarts ?? 3;
        if (restartCount > maxRestarts) {
            const error = new Error(`Max restart attempts (${maxRestarts}) exceeded for server '${name}'`);
            logError(error);
            throw error;
        }
        try {
            await start();
        }
        catch (error) {
            const startError = new Error(`Failed to start LSP server '${name}' during restart (attempt ${restartCount}/${maxRestarts}): ${errorMessage(error)}`);
            logError(startError);
            throw startError;
        }
    }
    function isHealthy() {
        return state === 'running' && client.isInitialized;
    }
    async function sendRequest(method, params) {
        if (!isHealthy()) {
            const error = new Error(`Cannot send request to LSP server '${name}': server is ${state}` +
                `${lastError ? `, last error: ${lastError.message}` : ''}`);
            logError(error);
            throw error;
        }
        let lastAttemptError;
        for (let attempt = 0; attempt <= MAX_RETRIES_FOR_TRANSIENT_ERRORS; attempt++) {
            try {
                return await client.sendRequest(method, params);
            }
            catch (error) {
                lastAttemptError = error;
                const errorCode = error.code;
                const isContentModifiedError = typeof errorCode === 'number' &&
                    errorCode === LSP_ERROR_CONTENT_MODIFIED;
                if (isContentModifiedError &&
                    attempt < MAX_RETRIES_FOR_TRANSIENT_ERRORS) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    logForDebugging(`LSP request '${method}' to '${name}' got ContentModified error, ` +
                        `retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES_FOR_TRANSIENT_ERRORS})...`);
                    await sleep(delay);
                    continue;
                }
                break;
            }
        }
        const requestError = new Error(`LSP request '${method}' failed for server '${name}': ${lastAttemptError?.message ?? 'unknown error'}`);
        logError(requestError);
        throw requestError;
    }
    async function sendNotification(method, params) {
        if (!isHealthy()) {
            const error = new Error(`Cannot send notification to LSP server '${name}': server is ${state}`);
            logError(error);
            throw error;
        }
        try {
            await client.sendNotification(method, params);
        }
        catch (error) {
            const notificationError = new Error(`LSP notification '${method}' failed for server '${name}': ${errorMessage(error)}`);
            logError(notificationError);
            throw notificationError;
        }
    }
    function onNotification(method, handler) {
        client.onNotification(method, handler);
    }
    function onRequest(method, handler) {
        client.onRequest(method, handler);
    }
    return {
        name,
        config,
        get state() {
            return state;
        },
        get startTime() {
            return startTime;
        },
        get lastError() {
            return lastError;
        },
        get restartCount() {
            return restartCount;
        },
        start,
        stop,
        restart,
        isHealthy,
        sendRequest,
        sendNotification,
        onNotification,
        onRequest,
    };
}
/**
 * Race a promise against a timeout. Cleans up the timer regardless of outcome
 * to avoid unhandled rejections from orphaned setTimeout callbacks.
 */
function withTimeout(promise, ms, message) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout((rej, msg) => rej(new Error(msg)), ms, reject, message);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
//# sourceMappingURL=LSPServerInstance.js.map