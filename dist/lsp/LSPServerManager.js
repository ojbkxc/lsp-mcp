import * as path from 'path';
import { pathToFileURL } from 'url';
import { createLSPServerInstance, } from './LSPServerInstance.js';
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
/**
 * Creates an LSP server manager instance.
 *
 * Manages multiple LSP server instances and routes requests based on file extensions.
 * Uses factory function pattern with closures for state encapsulation.
 *
 * Unlike cc-haha's version which loads config from the plugin system,
 * this version accepts a configuration object directly in initialize().
 */
export function createLSPServerManager() {
    const servers = new Map();
    const extensionMap = new Map();
    const openedFiles = new Map();
    // 每个已打开文件的 LSP 文档版本号。didChange 必须严格递增，
    // 否则服务端会忽略变更（编辑后重新同步诊断时尤为关键）。
    const fileVersions = new Map();
    /**
     * Initialize the manager with a configuration object.
     *
     * @param configs - Server configurations keyed by server name
     * @throws {Error} If configuration validation fails
     */
    async function initialize(configs) {
        // Build extension -> server mapping
        for (const [serverName, config] of Object.entries(configs)) {
            try {
                // Validate config
                if (!config.command) {
                    throw new Error(`Server ${serverName} missing required 'command' field`);
                }
                if (!config.extensionToLanguage ||
                    Object.keys(config.extensionToLanguage).length === 0) {
                    throw new Error(`Server ${serverName} missing required 'extensionToLanguage' field`);
                }
                // Map file extensions to this server
                const fileExtensions = Object.keys(config.extensionToLanguage);
                for (const ext of fileExtensions) {
                    const normalized = ext.toLowerCase();
                    if (!extensionMap.has(normalized)) {
                        extensionMap.set(normalized, []);
                    }
                    const serverList = extensionMap.get(normalized);
                    if (serverList) {
                        serverList.push(serverName);
                    }
                }
                // Create server instance
                const instance = createLSPServerInstance(serverName, config);
                servers.set(serverName, instance);
                // Register handler for workspace/configuration requests from the server
                instance.onRequest('workspace/configuration', (params) => {
                    logForDebugging(`LSP: Received workspace/configuration request from ${serverName}`);
                    return params.items.map(() => null);
                });
            }
            catch (error) {
                const err = error;
                logError(new Error(`Failed to initialize LSP server ${serverName}: ${err.message}`));
                // Continue with other servers
            }
        }
        logForDebugging(`LSP manager initialized with ${servers.size} servers`);
    }
    async function shutdown() {
        const toStop = Array.from(servers.entries()).filter(([, s]) => s.state === 'running' || s.state === 'error');
        const results = await Promise.allSettled(toStop.map(([, server]) => server.stop()));
        servers.clear();
        extensionMap.clear();
        openedFiles.clear();
        fileVersions.clear();
        const errors = results
            .map((r, i) => r.status === 'rejected'
            ? `${toStop[i][0]}: ${errorMessage(r.reason)}`
            : null)
            .filter((e) => e !== null);
        if (errors.length > 0) {
            const err = new Error(`Failed to stop ${errors.length} LSP server(s): ${errors.join('; ')}`);
            logError(err);
            throw err;
        }
    }
    function getServerForFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const serverNames = extensionMap.get(ext);
        if (!serverNames || serverNames.length === 0) {
            return undefined;
        }
        const serverName = serverNames[0];
        if (!serverName) {
            return undefined;
        }
        return servers.get(serverName);
    }
    async function ensureServerStarted(filePath) {
        const server = getServerForFile(filePath);
        if (!server)
            return undefined;
        if (server.state === 'stopped' || server.state === 'error') {
            try {
                await server.start();
            }
            catch (error) {
                const err = error;
                logError(new Error(`Failed to start LSP server for file ${filePath}: ${err.message}`));
                throw error;
            }
        }
        return server;
    }
    async function sendRequest(filePath, method, params) {
        const server = await ensureServerStarted(filePath);
        if (!server)
            return undefined;
        try {
            return await server.sendRequest(method, params);
        }
        catch (error) {
            const err = error;
            logError(new Error(`LSP request failed for file ${filePath}, method '${method}': ${err.message}`));
            throw error;
        }
    }
    function getAllServers() {
        return servers;
    }
    async function openFile(filePath, content) {
        const server = await ensureServerStarted(filePath);
        if (!server)
            return;
        const fileUri = pathToFileURL(path.resolve(filePath)).href;
        if (openedFiles.get(fileUri) === server.name) {
            logForDebugging(`LSP: File already open, skipping didOpen for ${filePath}`);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const languageId = server.config.extensionToLanguage[ext] || 'plaintext';
        try {
            await server.sendNotification('textDocument/didOpen', {
                textDocument: {
                    uri: fileUri,
                    languageId,
                    version: 1,
                    text: content,
                },
            });
            openedFiles.set(fileUri, server.name);
            fileVersions.set(fileUri, 1);
            logForDebugging(`LSP: Sent didOpen for ${filePath} (languageId: ${languageId})`);
        }
        catch (error) {
            const err = new Error(`Failed to sync file open ${filePath}: ${errorMessage(error)}`);
            logError(err);
            throw err;
        }
    }
    async function changeFile(filePath, content) {
        const server = getServerForFile(filePath);
        if (!server || server.state !== 'running') {
            return openFile(filePath, content);
        }
        const fileUri = pathToFileURL(path.resolve(filePath)).href;
        if (openedFiles.get(fileUri) !== server.name) {
            return openFile(filePath, content);
        }
        try {
            const nextVersion = (fileVersions.get(fileUri) ?? 1) + 1;
            await server.sendNotification('textDocument/didChange', {
                textDocument: {
                    uri: fileUri,
                    version: nextVersion,
                },
                contentChanges: [{ text: content }],
            });
            fileVersions.set(fileUri, nextVersion);
            logForDebugging(`LSP: Sent didChange for ${filePath} (version ${nextVersion})`);
        }
        catch (error) {
            const err = new Error(`Failed to sync file change ${filePath}: ${errorMessage(error)}`);
            logError(err);
            throw err;
        }
    }
    async function saveFile(filePath) {
        const server = getServerForFile(filePath);
        if (!server || server.state !== 'running')
            return;
        try {
            await server.sendNotification('textDocument/didSave', {
                textDocument: {
                    uri: pathToFileURL(path.resolve(filePath)).href,
                },
            });
            logForDebugging(`LSP: Sent didSave for ${filePath}`);
        }
        catch (error) {
            const err = new Error(`Failed to sync file save ${filePath}: ${errorMessage(error)}`);
            logError(err);
            throw err;
        }
    }
    async function closeFile(filePath) {
        const server = getServerForFile(filePath);
        if (!server || server.state !== 'running')
            return;
        const fileUri = pathToFileURL(path.resolve(filePath)).href;
        try {
            await server.sendNotification('textDocument/didClose', {
                textDocument: {
                    uri: fileUri,
                },
            });
            openedFiles.delete(fileUri);
            fileVersions.delete(fileUri);
            logForDebugging(`LSP: Sent didClose for ${filePath}`);
        }
        catch (error) {
            const err = new Error(`Failed to sync file close ${filePath}: ${errorMessage(error)}`);
            logError(err);
            throw err;
        }
    }
    function isFileOpen(filePath) {
        const fileUri = pathToFileURL(path.resolve(filePath)).href;
        return openedFiles.has(fileUri);
    }
    return {
        initialize,
        shutdown,
        getServerForFile,
        ensureServerStarted,
        sendRequest,
        getAllServers,
        openFile,
        changeFile,
        saveFile,
        closeFile,
        isFileOpen,
    };
}
//# sourceMappingURL=LSPServerManager.js.map