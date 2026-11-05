/**
 * 共享 LSP 操作核心（跨端扩展与旧 MCP 入口共用）。
 *
 * 刻意不依赖任何宿主 SDK 或 MCP SDK：只封装「配置装载 + 服务器生命周期 +
 * 各 action 的请求与格式化」。上层（pi 工具 / MCP server）各自负责参数校验与传输。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import {
  createLSPServerManager,
  type LSPServerManager,
} from '../lsp/LSPServerManager.js'
import { filePathToUri, toLspPosition, uriToFilePath } from '../lsp/utils.js'
import { loadConfig } from '../config/server-config.js'
import {
  formatCodeActions,
  formatDocumentSymbolResult,
  formatFindReferencesResult,
  formatGoToDefinitionResult,
  formatHoverResult,
  formatIncomingCallsResult,
  formatOutgoingCallsResult,
  formatWorkspaceEdit,
  formatWorkspaceSymbolResult,
} from '../lsp/formatters.js'
import {
  DiagnosticsStore,
  formatDiagnosticsList,
  mapLspDiagnostics,
  summarizeDiagnostics,
  waitForDiagnostics,
} from './diagnostics.js'
import type {
  CallHierarchyItem,
  CodeAction,
  Command,
  Location,
  LocationLink,
  ScopedLspServerConfig,
  TextEdit,
  WorkspaceEdit,
} from '../lsp/types.js'

/** 单个 lsp 工具的全部 action。 */
export const LSP_ACTIONS = [
  'definition',
  'references',
  'hover',
  'document_symbol',
  'workspace_symbol',
  'implementation',
  'type_definition',
  'call_hierarchy_incoming',
  'call_hierarchy_outgoing',
  'diagnostics',
  'rename',
  'code_actions',
] as const

export type LspAction = (typeof LSP_ACTIONS)[number]

export interface LspActionParams {
  filePath?: string
  /** 1 基行号。 */
  line?: number
  /** 1 基列号。 */
  character?: number
  /** workspace_symbol 的查询词。 */
  query?: string
  /** rename 的新名字。 */
  newName?: string
  /** code_actions 的 kind 前缀过滤。 */
  only?: string
  /** rename / code_actions 是否真正落盘。 */
  apply?: boolean
}

export interface LspOpResult {
  text: string
  details?: unknown
}

export interface LspCoreOptions {
  /** 覆盖配置路径；缺省读 ~/.pi/agent/lsp-config.json（或 LSP_MCP_CONFIG）。 */
  configPath?: string
  /** 日志回调（默认丢弃，避免污染 stdio 型宿主）。 */
  log?: (message: string) => void
}

export interface LspCore {
  /** 设置当前工作目录（来自宿主的 ctx.cwd），用于解析相对路径与默认工作区。 */
  setCwd(cwd: string): void
  /** 惰性初始化 LSP 管理器与配置。 */
  ensureInitialized(): Promise<void>
  /** 执行一个 action。 */
  op(action: LspAction, params: LspActionParams): Promise<LspOpResult>
  /** 编辑后取诊断摘要；无服务器 / 无新诊断时返回 undefined。 */
  diagnoseAfterEdit(filePath: string): Promise<string | undefined>
  /** 关闭所有服务器。 */
  shutdown(): Promise<void>
  readonly diagnostics: DiagnosticsStore
}

/** 由行/列区间算出字符偏移（按 \n 计行，兼容 CRLF）。 */
function offsetAt(content: string, line: number, character: number): number {
  let offset = 0
  let currentLine = 0
  while (currentLine < line && offset < content.length) {
    const next = content.indexOf('\n', offset)
    if (next === -1) return content.length
    offset = next + 1
    currentLine++
  }
  return Math.min(offset + character, content.length)
}

/** 应用一组文本编辑到内容上（倒序应用避免位移影响）。 */
function applyTextEdits(content: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort(
    (a, b) =>
      offsetAt(content, b.range.start.line, b.range.start.character) -
      offsetAt(content, a.range.start.line, a.range.start.character),
  )
  let out = content
  for (const edit of sorted) {
    const start = offsetAt(out, edit.range.start.line, edit.range.start.character)
    const end = offsetAt(out, edit.range.end.line, edit.range.end.character)
    out = out.slice(0, start) + edit.newText + out.slice(end)
  }
  return out
}

/** 把 WorkspaceEdit 落盘，返回变更过的文件相对路径列表。 */
function applyWorkspaceEdit(edit: WorkspaceEdit, cwd: string): string[] {
  const touched: string[] = []
  const applyToFile = (uri: string, edits: TextEdit[]): void => {
    if (edits.length === 0) return
    const absPath = uriToFilePath(uri)
    if (!existsSync(absPath)) return
    const original = readFileSync(absPath, 'utf-8')
    const updated = applyTextEdits(original, edits)
    if (updated !== original) {
      writeFileSync(absPath, updated, 'utf-8')
      touched.push(absPath.startsWith(cwd) ? absPath.slice(cwd.length + 1) : absPath)
    }
  }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      if (Array.isArray(edits)) applyToFile(uri, edits)
    }
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      const asEdit = change as { textDocument?: { uri?: string }; edits?: Array<TextEdit | { newText?: string }> }
      if (asEdit.textDocument?.uri && Array.isArray(asEdit.edits)) {
        applyToFile(
          asEdit.textDocument.uri,
          asEdit.edits.filter((e): e is TextEdit => typeof e === 'object' && e !== null && 'range' in e),
        )
      }
    }
  }
  return touched
}

/** 诊断等待超时（毫秒）；可用 LSP_MCP_DIAG_TIMEOUT_MS 覆盖，默认 2500。 */
function diagTimeoutMs(): number {
  const raw = Number(process.env.LSP_MCP_DIAG_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 2500
}

/**
 * 诊断存储的键归一：服务端回传路径的大小写/分隔符/盘符大小写都可能与本地不同
 * （例如 `d:/x` vs `D:\x`，或 `file:///d%3A/x` 解码后），统一成小写正斜杠形式。
 */
function diagKey(path: string): string {
  return resolve(path).replace(/\\/g, '/').toLowerCase()
}

export function createLspCore(options: LspCoreOptions = {}): LspCore {
  const log = options.log ?? ((): void => {})
  const manager: LSPServerManager = createLSPServerManager()
  const diagnostics = new DiagnosticsStore()
  let cwd = process.cwd()
  let initialized = false

  function abs(filePath: string): string {
    return resolve(cwd, filePath)
  }

  function scopedConfigs(): Record<string, ScopedLspServerConfig> {
    const config = loadConfig(options.configPath)
    const out: Record<string, ScopedLspServerConfig> = {}
    for (const [name, cfg] of Object.entries(config.servers)) {
      out[name] = { ...cfg, scope: 'static', workspaceFolder: cfg.workspaceFolder ?? cwd }
    }
    return out
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return
    await manager.initialize(scopedConfigs())
    for (const [, server] of manager.getAllServers()) {
      server.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
        const p = params as {
          uri?: string
          diagnostics?: Array<{
            range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
            message?: string
            severity?: number
            source?: string
            code?: unknown
          }>
        }
        if (!p?.uri) return
        diagnostics.record(diagKey(uriToFilePath(p.uri)), mapLspDiagnostics(p.diagnostics ?? []))
      })
    }
    initialized = true
  }

  /** 确保文件已在 LSP 侧打开（必要时从磁盘读入并 didOpen）。 */
  async function openFileIfNeeded(absPath: string): Promise<void> {
    if (manager.isFileOpen(absPath)) return
    if (!existsSync(absPath)) return
    await manager.openFile(absPath, readFileSync(absPath, 'utf-8'))
  }

  /** 把磁盘上的最新内容同步给 LSP（未打开则 didOpen，否则 didChange）。 */
  async function syncFileFromDisk(absPath: string): Promise<void> {
    if (!existsSync(absPath)) return
    const content = readFileSync(absPath, 'utf-8')
    if (manager.isFileOpen(absPath)) {
      await manager.changeFile(absPath, content)
    } else {
      await manager.openFile(absPath, content)
    }
  }

  function requireFile(params: LspActionParams): string {
    if (!params.filePath) throw new Error('该 action 需要参数 filePath（文件的绝对或相对路径）。')
    return abs(params.filePath)
  }

  function position(params: LspActionParams): { line: number; character: number } {
    return toLspPosition(params.line ?? 1, params.character ?? 1)
  }

  async function op(action: LspAction, params: LspActionParams): Promise<LspOpResult> {
    await ensureInitialized()

    if (action === 'workspace_symbol') {
      return workspaceSymbol(params.query ?? '')
    }

    const absPath = requireFile(params)
    const uri = filePathToUri(absPath)
    const pos = position(params)

    // 没有匹配的 server 时，位置类 action 会静默返回空结果（sendRequest 返回 undefined），
    // 让「配置里没这个扩展名」和「确实没有定义」看起来一样。这里提前给出可诊断的错误。
    if (!manager.getServerForFile(absPath)) {
      const ext = extname(absPath) || '(无扩展名)'
      throw new Error(
        `配置里没有匹配 ${ext} 的 LSP 服务器：${absPath}。` +
          '请在 ~/.pi/agent/lsp-config.json 的 servers[*].extensionToLanguage 中加入该扩展名' +
          '（可用 LSP_MCP_CONFIG 环境变量覆盖配置文件路径）。',
      )
    }

    switch (action) {
      case 'definition': {
        await openFileIfNeeded(absPath)
        const result = await manager.sendRequest<Location | Location[] | LocationLink | LocationLink[] | null>(
          absPath,
          'textDocument/definition',
          { textDocument: { uri }, position: pos },
        )
        return { text: formatGoToDefinitionResult(result ?? null, cwd) }
      }

      case 'type_definition': {
        await openFileIfNeeded(absPath)
        const result = await manager.sendRequest<Location | Location[] | LocationLink | LocationLink[] | null>(
          absPath,
          'textDocument/typeDefinition',
          { textDocument: { uri }, position: pos },
        )
        return { text: formatGoToDefinitionResult(result ?? null, cwd) }
      }

      case 'implementation': {
        await openFileIfNeeded(absPath)
        const result = await manager.sendRequest<Location | Location[] | LocationLink | LocationLink[] | null>(
          absPath,
          'textDocument/implementation',
          { textDocument: { uri }, position: pos },
        )
        return { text: formatGoToDefinitionResult(result ?? null, cwd) }
      }

      case 'references': {
        await openFileIfNeeded(absPath)
        const result = await manager.sendRequest<Location[] | null>(absPath, 'textDocument/references', {
          textDocument: { uri },
          position: pos,
          context: { includeDeclaration: true },
        })
        return { text: formatFindReferencesResult(result ?? null, cwd) }
      }

      case 'hover': {
        await openFileIfNeeded(absPath)
        const result = await manager.sendRequest<{ contents?: unknown; range?: unknown } | null>(
          absPath,
          'textDocument/hover',
          { textDocument: { uri }, position: pos },
        )
        return { text: formatHoverResult(result as never, cwd) }
      }

      case 'document_symbol': {
        await openFileIfNeeded(absPath)
        const result = await manager.sendRequest<unknown[] | null>(absPath, 'textDocument/documentSymbol', {
          textDocument: { uri },
        })
        return { text: formatDocumentSymbolResult(result as never, cwd) }
      }

      case 'call_hierarchy_incoming':
      case 'call_hierarchy_outgoing': {
        await openFileIfNeeded(absPath)
        const prepare = await manager.sendRequest<CallHierarchyItem[] | null>(
          absPath,
          'textDocument/prepareCallHierarchy',
          { textDocument: { uri }, position: pos },
        )
        const items = prepare ?? []
        if (items.length === 0) {
          return { text: '该位置没有可用的调用层次项。' }
        }
        const method =
          action === 'call_hierarchy_incoming' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls'
        const collected: unknown[] = []
        for (const item of items) {
          const result = await manager.sendRequest<unknown[] | null>(absPath, method, { item })
          if (Array.isArray(result)) collected.push(...result)
        }
        const text =
          action === 'call_hierarchy_incoming'
            ? formatIncomingCallsResult(collected as never, cwd)
            : formatOutgoingCallsResult(collected as never, cwd)
        return { text }
      }

      case 'rename': {
        if (!params.newName) throw new Error('rename 需要参数 newName（新符号名）。')
        await openFileIfNeeded(absPath)
        const edit = await manager.sendRequest<WorkspaceEdit | null>(absPath, 'textDocument/rename', {
          textDocument: { uri },
          position: pos,
          newName: params.newName,
        })
        if (!edit) return { text: '重命名未产生任何编辑（可能是该位置不可重命名）。' }
        const preview = formatWorkspaceEdit(edit, cwd)
        if (params.apply === true) {
          const touched = applyWorkspaceEdit(edit, cwd)
          return {
            text: touched.length
              ? `已应用重命名，改动 ${touched.length} 个文件：\n  ${touched.join('\n  ')}`
              : '重命名编辑为空，未改动任何文件。',
            details: { edit },
          }
        }
        return { text: `重命名预览（未落盘，传 apply: true 可应用）：\n${preview}`, details: { edit } }
      }

      case 'code_actions': {
        await openFileIfNeeded(absPath)
        const range = { start: pos, end: { line: pos.line, character: pos.character + 1 } }
        const contextDiagnostics = diagnostics.raw(absPath).map((d) => ({
          range: {
            start: { line: d.line - 1, character: d.character - 1 },
            end: { line: d.endLine - 1, character: d.endCharacter - 1 },
          },
          message: d.message,
          severity: d.severityNumber,
        }))
        let actions = await manager.sendRequest<Array<CodeAction | Command> | null>(
          absPath,
          'textDocument/codeAction',
          {
            textDocument: { uri },
            range,
            context: {
              diagnostics: contextDiagnostics,
              ...(params.only ? { only: [params.only] } : {}),
            },
          },
        )
        actions = actions ?? []
        if (params.only) {
          actions = actions.filter((a) => {
            const kind = (a as CodeAction).kind
            return typeof kind === 'string' && kind.startsWith(params.only as string)
          })
        }
        if (actions.length === 0) {
          return { text: '当前位置没有可用的代码操作。' }
        }
        if (params.apply === true) {
          // 取第一个带编辑（或可 resolve）的操作，解析后落盘。
          for (const action of actions) {
            let candidate = action as CodeAction
            if (!candidate.edit && candidate.data !== undefined) {
              try {
                const resolved = await manager.sendRequest<CodeAction>(absPath, 'codeAction/resolve', candidate)
                if (resolved) candidate = resolved
              } catch {
                candidate = action as CodeAction
              }
            }
            if (candidate.edit) {
              const touched = applyWorkspaceEdit(candidate.edit, cwd)
              if (touched.length) {
                return {
                  text: `已应用代码操作「${candidate.title}」，改动文件：\n  ${touched.join('\n  ')}`,
                  details: { applied: candidate.title },
                }
              }
            }
          }
          return { text: `代码操作均未产生可落盘的编辑。候选：\n${formatCodeActions(actions, cwd)}` }
        }
        return { text: formatCodeActions(actions, cwd) }
      }

      case 'diagnostics': {
        return { text: await collectDiagnostics(absPath, uri, { markSeen: true }) }
      }

      default: {
        const exhaustive: never = action
        throw new Error(`未知 action: ${String(exhaustive)}`)
      }
    }
  }

  /** 触发并收集诊断：版本基线 → 尝试拉取 → 等待推送稳定。 */
  async function collectDiagnostics(
    absPath: string,
    uri: string,
    opts: { markSeen?: boolean } = {},
  ): Promise<string> {
    if (!existsSync(absPath)) {
      return `文件不存在：${absPath}`
    }
    if (!manager.getServerForFile(absPath)) {
      return `没有为该文件类型配置 LSP 服务器：${absPath}`
    }
    // 1) 记下版本基线
    const key = diagKey(absPath)
    const baseline = diagnostics.version(key)
    // 2) 同步磁盘内容，触发服务端重新计算
    await syncFileFromDisk(absPath)
    // 3) 优先尝试「拉取诊断」（服务端支持即拿到确定的本次结果）
    let pulled = false
    try {
      const pulledResult = await manager.sendRequest<{
        kind?: string
        items?: Array<{ range?: unknown; message?: string; severity?: number }>
      }>(absPath, 'textDocument/diagnostic', { textDocument: { uri } })
      if (pulledResult?.kind === 'full' && Array.isArray(pulledResult.items)) {
        diagnostics.record(key, mapLspDiagnostics(pulledResult.items as never))
        pulled = true
      }
    } catch {
      // 服务端未实现 pull 诊断 —— 回退到推送 + 等待窗口
    }
    // 4) 未拉到则等待推送：版本前进 + 静默窗口
    if (!pulled) {
      await waitForDiagnostics(diagnostics, key, baseline, { timeoutMs: diagTimeoutMs() })
    }
    const all = diagnostics.raw(key)
    if (opts.markSeen) diagnostics.markSeen(key)
    if (all.length === 0) {
      return '未发现诊断信息（该文件无错误或警告）。'
    }
    return formatDiagnosticsList(all)
  }

  async function workspaceSymbol(query: string): Promise<LspOpResult> {
    const results: unknown[] = []
    for (const [, server] of manager.getAllServers()) {
      if (server.state !== 'running') continue
      try {
        const r = await server.sendRequest<unknown[]>('workspace/symbol', { query })
        if (Array.isArray(r)) results.push(...r)
      } catch {
        // 单个服务器失败不影响整体
      }
    }
    return { text: formatWorkspaceSymbolResult(results as never, cwd) }
  }

  async function diagnoseAfterEdit(filePath: string): Promise<string | undefined> {
    await ensureInitialized()
    const absPath = abs(filePath)
    if (!existsSync(absPath)) return undefined
    if (!manager.getServerForFile(absPath)) return undefined

    const key = diagKey(absPath)
    const baseline = diagnostics.version(key)
    try {
      await syncFileFromDisk(absPath)
    } catch (error) {
      log(`同步文件失败：${error instanceof Error ? error.message : String(error)}`)
    }

    // 尝试拉取诊断；失败则等待推送
    let pulled = false
    try {
      const pulledResult = await manager.sendRequest<{
        kind?: string
        items?: Array<{ range?: unknown; message?: string; severity?: number }>
      }>(absPath, 'textDocument/diagnostic', { textDocument: { uri: filePathToUri(absPath) } })
      if (pulledResult?.kind === 'full' && Array.isArray(pulledResult.items)) {
        diagnostics.record(key, mapLspDiagnostics(pulledResult.items as never))
        pulled = true
      }
    } catch {
      // 无 pull 能力
    }
    if (!pulled) {
      await waitForDiagnostics(diagnostics, key, baseline, { timeoutMs: diagTimeoutMs(), settleMs: 150 })
    }

    // 只上报账本里没见过的诊断，避免每次编辑重复刷屏
    const fresh = diagnostics.reduce(key)
    if (fresh.length === 0) return undefined

    const rel = absPath.startsWith(cwd) ? absPath.slice(cwd.length + 1) : absPath
    return `LSP 诊断（${rel}）：${summarizeDiagnostics(fresh)}\n${formatDiagnosticsList(fresh, 20)}`
  }

  async function shutdown(): Promise<void> {
    if (!initialized) return
    try {
      await manager.shutdown()
    } finally {
      diagnostics.clear()
      initialized = false
    }
  }

  return {
    setCwd: (next) => {
      if (typeof next === 'string' && next.length > 0) cwd = next
    },
    ensureInitialized,
    op,
    diagnoseAfterEdit,
    shutdown,
    diagnostics,
  }
}
