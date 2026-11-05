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
/** 取出消息里可能带的 `file:line:col` 前缀，用于身份归一。 */
const LOCATION_PREFIX_RE = /^\s*(?:[A-Za-z]:)?[^\s:]*:\d+:\d+\s+/;
/** 诊断身份：严重度 + 归一后的消息，忽略行号漂移带来的重复。 */
export function diagnosticIdentity(d) {
    return `${d.severity}|${d.message.replace(LOCATION_PREFIX_RE, '').trim()}`;
}
function severityLabel(severity) {
    switch (severity) {
        case 1:
            return 'Error';
        case 2:
            return 'Warning';
        case 3:
            return 'Info';
        case 4:
            return 'Hint';
        default:
            return 'Info';
    }
}
/** 把 LSP 原始诊断数组映射成本模块的记录结构。 */
export function mapLspDiagnostics(raw) {
    const out = [];
    for (const d of raw ?? []) {
        const startLine = d.range?.start?.line ?? 0;
        const startChar = d.range?.start?.character ?? 0;
        const endLine = d.range?.end?.line ?? startLine;
        const endChar = d.range?.end?.character ?? startChar;
        out.push({
            line: startLine + 1,
            character: startChar + 1,
            endLine: endLine + 1,
            endCharacter: endChar + 1,
            message: d.message ?? '',
            severity: severityLabel(d.severity),
            severityNumber: d.severity ?? 3,
            source: d.source,
            code: d.code === undefined ? undefined : String(d.code),
        });
    }
    return out;
}
/** 一句话摘要："2 errors, 1 warning"。 */
export function summarizeDiagnostics(diags) {
    const counts = new Map();
    for (const d of diags)
        counts.set(d.severity, (counts.get(d.severity) ?? 0) + 1);
    const order = ['Error', 'Warning', 'Info', 'Hint'];
    const parts = [];
    for (const sev of order) {
        const n = counts.get(sev);
        if (!n)
            continue;
        const label = sev.toLowerCase();
        parts.push(`${n} ${label}${n === 1 ? '' : 's'}`);
    }
    return parts.length ? parts.join(', ') : 'no diagnostics';
}
/** 逐条列出诊断，供工具直接回给模型。 */
export function formatDiagnosticsList(diags, limit = 50) {
    if (diags.length === 0)
        return '未发现诊断信息。';
    const lines = [`发现 ${diags.length} 条诊断（${summarizeDiagnostics(diags)}）：`];
    for (const d of diags.slice(0, limit)) {
        const code = d.code ? ` [${d.code}]` : '';
        const src = d.source ? ` (${d.source})` : '';
        lines.push(`  ${d.severity} 第 ${d.line}:${d.character} 行 - ${d.message}${code}${src}`);
    }
    if (diags.length > limit)
        lines.push(`  …（其余 ${diags.length - limit} 条已省略）`);
    return lines.join('\n');
}
/**
 * 诊断存储：按文件缓存最新报告 + 版本基线 + 去重账本。
 */
export class DiagnosticsStore {
    #byFile = new Map();
    #version = new Map();
    #seen = new Map();
    /** 记入一份新报告并推进版本号（版本基线由此前进）。 */
    record(path, diagnostics) {
        this.#byFile.set(path, diagnostics);
        this.#version.set(path, (this.#version.get(path) ?? 0) + 1);
    }
    /** 当前版本号，用作等待基线。 */
    version(path) {
        return this.#version.get(path) ?? 0;
    }
    /** 该文件最新一次报告的全部诊断。 */
    raw(path) {
        return this.#byFile.get(path) ?? [];
    }
    /** 只返回「账本里没见过」的诊断，并把当前全部记入账本。 */
    reduce(path) {
        const diags = this.raw(path);
        const previous = this.#seen.get(path);
        const current = new Set();
        const fresh = [];
        for (const d of diags) {
            const id = diagnosticIdentity(d);
            current.add(id);
            if (!previous?.has(id))
                fresh.push(d);
        }
        if (current.size === 0)
            this.#seen.delete(path);
        else
            this.#seen.set(path, current);
        return fresh;
    }
    /** 把当前诊断直接记入账本而不返回（用于显式查询后避免后续重复上报）。 */
    markSeen(path) {
        const diags = this.raw(path);
        if (diags.length === 0) {
            this.#seen.delete(path);
            return;
        }
        this.#seen.set(path, new Set(diags.map(diagnosticIdentity)));
    }
    clear() {
        this.#byFile.clear();
        this.#version.clear();
        this.#seen.clear();
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * 等待「基线之后」的新诊断报告稳定下来。
 *
 * 语义：等到文件版本号超过 `baselineVersion`（说明服务端针对本次触发发了新报告），
 * 然后观察 `settleMs` 静默窗口，期间版本不再前进即视为稳定；超过 `timeoutMs` 则放弃，
 * 返回当前已知结果（不抛错，交由调用方决定提示）。
 */
export async function waitForDiagnostics(store, path, baselineVersion, options = {}) {
    const timeoutMs = options.timeoutMs ?? 2500;
    const settleMs = options.settleMs ?? 180;
    const startedAt = Date.now();
    let lastVersion = store.version(path);
    let lastChangeAt = Date.now();
    for (;;) {
        if (options.signal?.aborted) {
            throw new Error('诊断等待已中止');
        }
        const now = Date.now();
        const current = store.version(path);
        if (current !== lastVersion) {
            lastVersion = current;
            lastChangeAt = now;
        }
        const sawFreshReport = lastVersion > baselineVersion;
        if (sawFreshReport && now - lastChangeAt >= settleMs)
            return;
        if (now - startedAt >= timeoutMs)
            return;
        await sleep(25);
    }
}
//# sourceMappingURL=diagnostics.js.map