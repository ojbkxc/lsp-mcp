/**
 * LSP protocol type definitions.
 * Re-exports from vscode-languageserver-types plus our own config types.
 */
export type { Position, Range, Location, LocationLink, Hover, MarkupContent, MarkedString, DocumentSymbol, SymbolInformation, SymbolKind, CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall, Diagnostic, DiagnosticSeverity, WorkspaceEdit, TextEdit, TextDocumentEdit, CodeAction, Command, } from 'vscode-languageserver-types';
export type { InitializeParams, InitializeResult, ServerCapabilities, } from 'vscode-languageserver-protocol';
/**
 * LSP server state machine states.
 * - stopped: server not running, can be started
 * - starting: server process spawning / initializing
 * - running: server ready to handle requests
 * - stopping: server shutting down
 * - error: server failed or crashed
 */
export type LspServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
/**
 * Base LSP server configuration (matches cc-haha's LspServerConfigSchema).
 */
export type LspServerConfig = {
    /** Command to execute the LSP server (e.g., "typescript-language-server") */
    command: string;
    /** Command-line arguments to pass to the server */
    args?: string[];
    /** Mapping from file extension (e.g., ".ts") to LSP language ID (e.g., "typescript") */
    extensionToLanguage: Record<string, string>;
    /** Communication transport mechanism (always "stdio" for now) */
    transport?: 'stdio' | 'socket';
    /** Environment variables to set when starting the server */
    env?: Record<string, string>;
    /** Initialization options passed to the server during initialization */
    initializationOptions?: unknown;
    /** Settings passed to the server via workspace/didChangeConfiguration */
    settings?: unknown;
    /** Workspace folder path to use for the server */
    workspaceFolder?: string;
    /** Maximum time to wait for server startup (milliseconds) */
    startupTimeout?: number;
    /** Maximum time to wait for graceful shutdown (milliseconds) */
    shutdownTimeout?: number;
    /** Whether to restart the server if it crashes */
    restartOnCrash?: boolean;
    /** Maximum number of restart attempts before giving up */
    maxRestarts?: number;
};
/**
 * Scoped LSP server configuration — LspServerConfig plus scope metadata.
 */
export type ScopedLspServerConfig = LspServerConfig & {
    /** Scope: 'static' for built-in, 'dynamic' for plugin-provided */
    scope?: 'static' | 'dynamic';
    /** Source identifier (e.g., plugin name) */
    source?: string;
};
/**
 * Top-level configuration file format for ~/.pi/agent/lsp-config.json
 */
export type LspConfigFile = {
    servers: Record<string, LspServerConfig>;
};
//# sourceMappingURL=types.d.ts.map