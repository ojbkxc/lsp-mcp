/**
 * lsp 跨端扩展入口（默认导出工厂）。
 *
 * 同一份 dist 入口两端通用：
 *   - pi-agent-desktop 内置：`import factory from "lsp-mcp"; builtin("lsp", factory)`
 *   - oh-my-pi marketplace：package.json 的 `omp.extensions` / `pi.extensions` 指向本文件
 *
 * 职责：
 *   1. 注册单个 `lsp` 工具（action 枚举，含 callHierarchy）。
 *   2. 订阅 `tool_result`，把 write/edit 之后的诊断摘要**织入**工具结果
 *      （优先并入 content；宿主返回的 details 因「未返回即保持原样」而得以保留）。
 *   3. 会话关闭时优雅关停 LSP 服务器。
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createLspCore, type LspCore } from './core.js';
import { createLspTool } from './tool.js';
export declare function createLspExtension(pi: ExtensionAPI, core?: LspCore): void;
export default function lspExtension(pi: ExtensionAPI): void;
export { createLspCore, createLspTool };
export type { LspCore };
export { LSP_ACTIONS } from './core.js';
//# sourceMappingURL=index.d.ts.map