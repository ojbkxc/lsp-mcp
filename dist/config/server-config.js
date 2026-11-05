import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
/**
 * Default config path: ~/.pi/agent/lsp-config.json
 * 可用环境变量 `LSP_MCP_CONFIG` 覆盖（测试或非默认布局时用）。
 */
function getDefaultConfigPath() {
    return process.env.LSP_MCP_CONFIG || join(homedir(), '.pi', 'agent', 'lsp-config.json');
}
/**
 * Read and parse the LSP config file.
 * Returns empty config if file doesn't exist.
 */
export function loadConfig(configPath) {
    const path = configPath || getDefaultConfigPath();
    if (!existsSync(path)) {
        return { servers: {} };
    }
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.servers || typeof parsed.servers !== 'object') {
        return { servers: {} };
    }
    return parsed;
}
/**
 * Get a server config by name.
 */
export function getServerConfig(config, name) {
    return config.servers[name];
}
/**
 * Find a server config that handles the given file extension.
 * Returns the first matching server config.
 */
export function findServerForExtension(config, ext) {
    // Normalize extension to start with a dot
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    for (const [name, serverConfig] of Object.entries(config.servers)) {
        if (serverConfig.extensionToLanguage && normalizedExt in serverConfig.extensionToLanguage) {
            return { name, config: serverConfig };
        }
    }
    return undefined;
}
/**
 * Get all server configs as an array.
 */
export function getAllServers(config) {
    return Object.entries(config.servers).map(([name, config]) => ({ name, config }));
}
//# sourceMappingURL=server-config.js.map