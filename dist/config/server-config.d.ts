import type { LspConfigFile, LspServerConfig } from '../lsp/types.js';
/**
 * Read and parse the LSP config file.
 * Returns empty config if file doesn't exist.
 */
export declare function loadConfig(configPath?: string): LspConfigFile;
/**
 * Get a server config by name.
 */
export declare function getServerConfig(config: LspConfigFile, name: string): LspServerConfig | undefined;
/**
 * Find a server config that handles the given file extension.
 * Returns the first matching server config.
 */
export declare function findServerForExtension(config: LspConfigFile, ext: string): {
    name: string;
    config: LspServerConfig;
} | undefined;
/**
 * Get all server configs as an array.
 */
export declare function getAllServers(config: LspConfigFile): Array<{
    name: string;
    config: LspServerConfig;
}>;
//# sourceMappingURL=server-config.d.ts.map