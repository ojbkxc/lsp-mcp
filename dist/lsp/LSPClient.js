import { spawn } from 'child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, Trace, } from 'vscode-jsonrpc/node';
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
function subprocessEnv() {
    // Return a copy of process.env filtered to string values
    const result = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
/**
 * Create an LSP client wrapper using vscode-jsonrpc.
 * Manages communication with an LSP server process via stdio.
 *
 * @param serverName - Identifier for this server (used in logs)
 * @param onCrash - Called when the server process exits unexpectedly
 */
export function createLSPClient(serverName, onCrash) {
    // State variables in closure
    let process;
    let connection;
    let capabilities;
    let isInitialized = false;
    let startFailed = false;
    let startError;
    let isStopping = false; // Track intentional shutdown to avoid spurious error logging
    // Queue handlers registered before connection ready (lazy initialization support)
    const pendingHandlers = [];
    const pendingRequestHandlers = [];
    function checkStartFailed() {
        if (startFailed) {
            throw startError || new Error(`LSP server ${serverName} failed to start`);
        }
    }
    return {
        get capabilities() {
            return capabilities;
        },
        get isInitialized() {
            return isInitialized;
        },
        async start(command, args, options) {
            try {
                // 1. Spawn LSP server process
                process = spawn(command, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...subprocessEnv(), ...options?.env },
                    cwd: options?.cwd,
                    // Prevent visible console window on Windows (no-op on other platforms)
                    windowsHide: true,
                });
                if (!process.stdout || !process.stdin) {
                    throw new Error('LSP server process stdio not available');
                }
                // 1.5. Wait for process to successfully spawn before using streams
                // This is CRITICAL: spawn() returns immediately, but the 'error' event
                // (e.g., ENOENT for command not found) fires asynchronously.
                const spawnedProcess = process; // Capture for closure
                await new Promise((resolve, reject) => {
                    const onSpawn = () => {
                        cleanup();
                        resolve();
                    };
                    const onError = (error) => {
                        cleanup();
                        reject(error);
                    };
                    const cleanup = () => {
                        spawnedProcess.removeListener('spawn', onSpawn);
                        spawnedProcess.removeListener('error', onError);
                    };
                    spawnedProcess.once('spawn', onSpawn);
                    spawnedProcess.once('error', onError);
                });
                // Capture stderr for server diagnostics and errors
                if (process.stderr) {
                    process.stderr.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            logForDebugging(`[LSP SERVER ${serverName}] ${output}`);
                        }
                    });
                }
                // Handle process errors (after successful spawn, e.g., crash during operation)
                process.on('error', error => {
                    if (!isStopping) {
                        startFailed = true;
                        startError = error;
                        logError(new Error(`LSP server ${serverName} failed to start: ${error.message}`));
                    }
                });
                process.on('exit', (code, _signal) => {
                    if (code !== 0 && code !== null && !isStopping) {
                        isInitialized = false;
                        startFailed = false;
                        startError = undefined;
                        const crashError = new Error(`LSP server ${serverName} crashed with exit code ${code}`);
                        logError(crashError);
                        onCrash?.(crashError);
                    }
                });
                // Handle stdin stream errors to prevent unhandled promise rejections
                process.stdin.on('error', (error) => {
                    if (!isStopping) {
                        logForDebugging(`LSP server ${serverName} stdin error: ${error.message}`);
                    }
                });
                // 2. Create JSON-RPC connection
                const reader = new StreamMessageReader(process.stdout);
                const writer = new StreamMessageWriter(process.stdin);
                connection = createMessageConnection(reader, writer);
                // 2.5. Register error/close handlers BEFORE listen() to catch all errors
                connection.onError(([error, _message, _code]) => {
                    if (!isStopping) {
                        startFailed = true;
                        startError = error;
                        logError(new Error(`LSP server ${serverName} connection error: ${error.message}`));
                    }
                });
                connection.onClose(() => {
                    if (!isStopping) {
                        isInitialized = false;
                        logForDebugging(`LSP server ${serverName} connection closed`);
                    }
                });
                // 3. Start listening for messages
                connection.listen();
                // 3.5. Enable protocol tracing for debugging
                connection
                    .trace(Trace.Verbose, {
                    log: (message) => {
                        logForDebugging(`[LSP PROTOCOL ${serverName}] ${message}`);
                    },
                })
                    .catch((error) => {
                    logForDebugging(`Failed to enable tracing for ${serverName}: ${error.message}`);
                });
                // 4. Apply any queued notification handlers
                for (const { method, handler } of pendingHandlers) {
                    connection.onNotification(method, handler);
                    logForDebugging(`Applied queued notification handler for ${serverName}.${method}`);
                }
                pendingHandlers.length = 0;
                // 5. Apply any queued request handlers
                for (const { method, handler } of pendingRequestHandlers) {
                    connection.onRequest(method, handler);
                    logForDebugging(`Applied queued request handler for ${serverName}.${method}`);
                }
                pendingRequestHandlers.length = 0;
                logForDebugging(`LSP client started for ${serverName}`);
            }
            catch (error) {
                const err = error;
                logError(new Error(`LSP server ${serverName} failed to start: ${err.message}`));
                throw error;
            }
        },
        async initialize(params) {
            if (!connection) {
                throw new Error('LSP client not started');
            }
            checkStartFailed();
            try {
                const result = await connection.sendRequest('initialize', params);
                capabilities = result.capabilities;
                // Send initialized notification
                await connection.sendNotification('initialized', {});
                isInitialized = true;
                logForDebugging(`LSP server ${serverName} initialized`);
                return result;
            }
            catch (error) {
                const err = error;
                logError(new Error(`LSP server ${serverName} initialize failed: ${err.message}`));
                throw error;
            }
        },
        async sendRequest(method, params) {
            if (!connection) {
                throw new Error('LSP client not started');
            }
            checkStartFailed();
            if (!isInitialized) {
                throw new Error('LSP server not initialized');
            }
            try {
                return await connection.sendRequest(method, params);
            }
            catch (error) {
                const err = error;
                logError(new Error(`LSP server ${serverName} request ${method} failed: ${err.message}`));
                throw error;
            }
        },
        async sendNotification(method, params) {
            if (!connection) {
                throw new Error('LSP client not started');
            }
            checkStartFailed();
            try {
                await connection.sendNotification(method, params);
            }
            catch (error) {
                const err = error;
                logError(new Error(`LSP server ${serverName} notification ${method} failed: ${err.message}`));
                logForDebugging(`Notification ${method} failed but continuing`);
            }
        },
        onNotification(method, handler) {
            if (!connection) {
                pendingHandlers.push({ method, handler });
                logForDebugging(`Queued notification handler for ${serverName}.${method} (connection not ready)`);
                return;
            }
            checkStartFailed();
            connection.onNotification(method, handler);
        },
        onRequest(method, handler) {
            if (!connection) {
                pendingRequestHandlers.push({
                    method,
                    handler: handler,
                });
                logForDebugging(`Queued request handler for ${serverName}.${method} (connection not ready)`);
                return;
            }
            checkStartFailed();
            connection.onRequest(method, handler);
        },
        async stop() {
            let shutdownError;
            isStopping = true;
            try {
                if (connection) {
                    await connection.sendRequest('shutdown', {});
                    await connection.sendNotification('exit', {});
                }
            }
            catch (error) {
                const err = error;
                logError(new Error(`LSP server ${serverName} stop failed: ${err.message}`));
                shutdownError = err;
            }
            finally {
                if (connection) {
                    try {
                        connection.dispose();
                    }
                    catch (error) {
                        logForDebugging(`Connection disposal failed for ${serverName}: ${errorMessage(error)}`);
                    }
                    connection = undefined;
                }
                if (process) {
                    process.removeAllListeners('error');
                    process.removeAllListeners('exit');
                    if (process.stdin) {
                        process.stdin.removeAllListeners('error');
                    }
                    if (process.stderr) {
                        process.stderr.removeAllListeners('data');
                    }
                    try {
                        process.kill();
                    }
                    catch (error) {
                        logForDebugging(`Process kill failed for ${serverName} (may already be dead): ${errorMessage(error)}`);
                    }
                    process = undefined;
                }
                isInitialized = false;
                capabilities = undefined;
                isStopping = false;
                if (shutdownError) {
                    startFailed = true;
                    startError = shutdownError;
                }
                logForDebugging(`LSP client stopped for ${serverName}`);
            }
            if (shutdownError) {
                throw shutdownError;
            }
        },
    };
}
//# sourceMappingURL=LSPClient.js.map