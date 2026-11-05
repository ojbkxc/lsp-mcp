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
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { asCompatApi, onCompat, textContent } from './compat.js'
import { createLspCore, type LspCore } from './core.js'
import { createLspTool } from './tool.js'

/** 会触发诊断织入的内置工具。 */
const DIAGNOSTIC_TOOLS = new Set(['write', 'edit'])

export function createLspExtension(pi: ExtensionAPI, core: LspCore = createLspCore()): void {
  const compat = asCompatApi(pi)

  compat.registerTool(createLspTool(core))

  onCompat(compat, 'session_start', (event, ctx) => {
    core.setCwd(ctx.cwd)
    void event
  })

  // 核心：编辑路径织入诊断
  onCompat(compat, 'tool_result', async (event, ctx) => {
    if (event.isError) return
    if (!event.toolName || !DIAGNOSTIC_TOOLS.has(event.toolName)) return
    const filePath = typeof event.input.path === 'string' ? event.input.path : undefined
    if (!filePath) return

    core.setCwd(ctx.cwd)
    let summary: string | undefined
    try {
      summary = await core.diagnoseAfterEdit(filePath)
    } catch {
      // 诊断失败绝不影响 edit/write 本身的结果
      return
    }
    if (!summary) return

    return {
      content: [...event.content, textContent(`\n${summary}`)],
    }
  })

  onCompat(compat, 'session_shutdown', () => {
    void core.shutdown()
  })
}

export default function lspExtension(pi: ExtensionAPI): void {
  createLspExtension(pi)
}

export { createLspCore, createLspTool }
export type { LspCore }
export { LSP_ACTIONS } from './core.js'
