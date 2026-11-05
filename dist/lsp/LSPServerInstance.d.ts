import type { LspServerState, ScopedLspServerConfig } from './types.js';
/**
 * LSP server instance interface returned by createLSPServerInstance.
 * Manages the lifecycle of a single LSP server with state tracking and health monitoring.
 */
export type LSPServerInstance = {
    readonly name: string;
    readonly config: ScopedLspServerConfig;
    readonly state: LspServerState;
    readonly startTime: Date | undefined;
    readonly lastError: Error | undefined;
    readonly restartCount: number;
    start(): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    isHealthy(): boolean;
    sendRequest<T>(method: string, params: unknown): Promise<T>;
    sendNotification(method: string, params: unknown): Promise<void>;
    onNotification(method: string, handler: (params: unknown) => void): void;
    onRequest<TParams, TResult>(method: string, handler: (params: TParams) => TResult | Promise<TResult>): void;
};
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
export declare function createLSPServerInstance(name: string, config: ScopedLspServerConfig): LSPServerInstance;
//# sourceMappingURL=LSPServerInstance.d.ts.map