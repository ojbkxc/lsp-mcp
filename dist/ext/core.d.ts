import { DiagnosticsStore } from './diagnostics.js';
/** 单个 lsp 工具的全部 action。 */
export declare const LSP_ACTIONS: readonly ["definition", "references", "hover", "document_symbol", "workspace_symbol", "implementation", "type_definition", "call_hierarchy_incoming", "call_hierarchy_outgoing", "diagnostics", "rename", "code_actions"];
export type LspAction = (typeof LSP_ACTIONS)[number];
export interface LspActionParams {
    filePath?: string;
    /** 1 基行号。 */
    line?: number;
    /** 1 基列号。 */
    character?: number;
    /** workspace_symbol 的查询词。 */
    query?: string;
    /** rename 的新名字。 */
    newName?: string;
    /** code_actions 的 kind 前缀过滤。 */
    only?: string;
    /** rename / code_actions 是否真正落盘。 */
    apply?: boolean;
}
export interface LspOpResult {
    text: string;
    details?: unknown;
}
export interface LspCoreOptions {
    /** 覆盖配置路径；缺省读 ~/.pi/agent/lsp-config.json（或 LSP_MCP_CONFIG）。 */
    configPath?: string;
    /** 日志回调（默认丢弃，避免污染 stdio 型宿主）。 */
    log?: (message: string) => void;
}
export interface LspCore {
    /** 设置当前工作目录（来自宿主的 ctx.cwd），用于解析相对路径与默认工作区。 */
    setCwd(cwd: string): void;
    /** 惰性初始化 LSP 管理器与配置。 */
    ensureInitialized(): Promise<void>;
    /** 执行一个 action。 */
    op(action: LspAction, params: LspActionParams): Promise<LspOpResult>;
    /** 编辑后取诊断摘要；无服务器 / 无新诊断时返回 undefined。 */
    diagnoseAfterEdit(filePath: string): Promise<string | undefined>;
    /** 关闭所有服务器。 */
    shutdown(): Promise<void>;
    readonly diagnostics: DiagnosticsStore;
}
export declare function createLspCore(options?: LspCoreOptions): LspCore;
//# sourceMappingURL=core.d.ts.map