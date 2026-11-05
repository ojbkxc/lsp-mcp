/**
 * 诊断存储与去重账本（跨端扩展侧，零宿主依赖）。
 *
 * 相对旧 MCP 实现的改进：
 *   1. **版本基线**：每次收到 `textDocument/publishDiagnostics` 递增该文件的版本号，
 *      调用方可先记下基线，再等待「版本号前进」以确认拿到的是本次触发的新报告，
 *      而不是旧缓存。（旧实现是 `sleep(500)` 碰运气。）
 *   2. **拉取优先**：若服务端支持 `textDocument/diagnostic`（pull 诊断），直接拉取，
 *      不依赖推送时序。
 *   3. **等待窗口**：推送模式下等到版本前进后，再观察一小段「静默窗口」，
 *      确认服务端不再追加报告才返回；整体有超时上限，绝不无限等待。
 *   4. **去重账本**：按「位置前缀 + 消息文本」给诊断取身份，同一文件重复出现的
 *      同一诊断只上报一次，避免每次编辑都重复刷屏。
 */
export interface DiagnosticRecord {
    /** 1 基行号。 */
    line: number;
    /** 1 基列号。 */
    character: number;
    /** 结束位置（1 基），用于 codeAction 上下文；服务端未给则与起点相同。 */
    endLine: number;
    endCharacter: number;
    message: string;
    /** "Error" | "Warning" | "Info" | "Hint" */
    severity: string;
    /** 数值型严重度（LSP 原值，1=Error）。 */
    severityNumber: number;
    source?: string;
    code?: string;
}
/** 诊断身份：严重度 + 归一后的消息，忽略行号漂移带来的重复。 */
export declare function diagnosticIdentity(d: DiagnosticRecord): string;
/** 把 LSP 原始诊断数组映射成本模块的记录结构。 */
export declare function mapLspDiagnostics(raw: Array<{
    range?: {
        start?: {
            line?: number;
            character?: number;
        };
        end?: {
            line?: number;
            character?: number;
        };
    };
    message?: string;
    severity?: number;
    source?: string;
    code?: unknown;
}>): DiagnosticRecord[];
/** 一句话摘要："2 errors, 1 warning"。 */
export declare function summarizeDiagnostics(diags: readonly DiagnosticRecord[]): string;
/** 逐条列出诊断，供工具直接回给模型。 */
export declare function formatDiagnosticsList(diags: readonly DiagnosticRecord[], limit?: number): string;
/**
 * 诊断存储：按文件缓存最新报告 + 版本基线 + 去重账本。
 */
export declare class DiagnosticsStore {
    #private;
    /** 记入一份新报告并推进版本号（版本基线由此前进）。 */
    record(path: string, diagnostics: DiagnosticRecord[]): void;
    /** 当前版本号，用作等待基线。 */
    version(path: string): number;
    /** 该文件最新一次报告的全部诊断。 */
    raw(path: string): DiagnosticRecord[];
    /** 只返回「账本里没见过」的诊断，并把当前全部记入账本。 */
    reduce(path: string): DiagnosticRecord[];
    /** 把当前诊断直接记入账本而不返回（用于显式查询后避免后续重复上报）。 */
    markSeen(path: string): void;
    clear(): void;
}
export interface WaitForDiagnosticsOptions {
    /** 等待新报告 + 静默窗口的总超时上限（毫秒）。 */
    timeoutMs?: number;
    /** 版本前进后需保持静默的时长（毫秒）。 */
    settleMs?: number;
    signal?: AbortSignal;
}
/**
 * 等待「基线之后」的新诊断报告稳定下来。
 *
 * 语义：等到文件版本号超过 `baselineVersion`（说明服务端针对本次触发发了新报告），
 * 然后观察 `settleMs` 静默窗口，期间版本不再前进即视为稳定；超过 `timeoutMs` 则放弃，
 * 返回当前已知结果（不抛错，交由调用方决定提示）。
 */
export declare function waitForDiagnostics(store: DiagnosticsStore, path: string, baselineVersion: number, options?: WaitForDiagnosticsOptions): Promise<void>;
//# sourceMappingURL=diagnostics.d.ts.map