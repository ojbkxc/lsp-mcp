/**
 * 单个 `lsp` 工具 + action 枚举。
 *
 * 为什么收成一个工具：9 个独立工具会长期占用模型工具面（tool surface），
 * 而它们参数高度同构（filePath/line/character），语义上天然是同一能力的枚举。
 * 收成一个后与 oh-my-pi 的 LSP 工具形态一致，且新增 action 零成本（不会再加工具槽）。
 */
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import { Type, defineCompatTool, toolTextResult, type CompatToolContext } from './compat.js'
import { LSP_ACTIONS, type LspAction, type LspCore } from './core.js'

const ACTION_DESCRIPTIONS: Record<LspAction, string> = {
  definition: '跳转到符号的定义位置',
  references: '查找符号的所有引用',
  hover: '获取符号的悬停类型/文档信息',
  document_symbol: '获取文件的符号大纲',
  workspace_symbol: '按名称全工作区搜索符号',
  implementation: '查找接口/抽象方法的实现',
  type_definition: '跳转到符号的类型定义（与 definition 不同，指向类型而非值）',
  call_hierarchy_incoming: '调用层次（进来）：谁调用了这个函数',
  call_hierarchy_outgoing: '调用层次（出去）：这个函数调用了谁',
  diagnostics: '获取文件的诊断信息（错误/警告），基于版本基线与静默窗口等待',
  rename: '重命名符号并预览编辑（apply: true 时落盘）',
  code_actions: '获取（或应用）当前位置可用的代码操作（快速修复等）',
}

const POSITION_ACTIONS: readonly LspAction[] = [
  'definition',
  'type_definition',
  'implementation',
  'references',
  'hover',
  'call_hierarchy_incoming',
  'call_hierarchy_outgoing',
  'rename',
  'code_actions',
]

export function createLspTool(core: LspCore) {
  return defineCompatTool({
    name: 'lsp',
    label: 'LSP 语言服务',
    description:
      '通过语言服务器协议（LSP）查询代码语义信息，用 action 选择具体能力：\n' +
      LSP_ACTIONS.map((a) => `  - ${a}: ${ACTION_DESCRIPTIONS[a]}`).join('\n') +
      '\n位置类 action 需要 filePath（文件路径）与 line/character（1 基行列，缺省为 1:1）；' +
      'workspace_symbol 需要 query；rename 需要 newName。',
    parameters: Type.Object({
      action: Type.Union(
        LSP_ACTIONS.map((a) => Type.Literal(a)),
        {
          description:
            '要执行的语言服务动作之一：' +
            LSP_ACTIONS.map((a) => `${a}（${ACTION_DESCRIPTIONS[a]}）`).join('；'),
        },
      ),
      filePath: Type.Optional(
        Type.String({ description: '文件路径（绝对或相对当前工作目录）。位置类 action 必填。' }),
      ),
      line: Type.Optional(Type.Number({ description: '行号（从 1 开始，缺省 1）。' })),
      character: Type.Optional(Type.Number({ description: '列号（从 1 开始，缺省 1）。' })),
      query: Type.Optional(Type.String({ description: 'workspace_symbol 的符号名查询（支持模糊匹配）。' })),
      newName: Type.Optional(Type.String({ description: 'rename 的新符号名。' })),
      only: Type.Optional(Type.String({ description: 'code_actions 的 kind 前缀过滤，如 "quickfix"。' })),
      apply: Type.Optional(
        Type.Boolean({ description: 'rename / code_actions 是否把编辑真正写入磁盘（默认 false，仅预览）。' }),
      ),
    }),
    async execute(
      _toolCallId,
      params,
      signal,
      _onUpdate,
      ctx: CompatToolContext,
    ): Promise<AgentToolResult<unknown>> {
      if (signal?.aborted) throw new Error('操作已取消。')
      core.setCwd(ctx.cwd)

      const action = params.action as LspAction

      if (action === 'workspace_symbol') {
        if (!params.query) throw new Error('workspace_symbol 需要参数 query。')
      } else if (POSITION_ACTIONS.includes(action)) {
        if (!params.filePath) throw new Error(`${action} 需要参数 filePath。`)
      } else if (action === 'document_symbol' || action === 'diagnostics') {
        if (!params.filePath) throw new Error(`${action} 需要参数 filePath。`)
      }
      if (action === 'rename' && !params.newName) {
        throw new Error('rename 需要参数 newName。')
      }

      const result = await core.op(action, {
        filePath: params.filePath,
        line: params.line,
        character: params.character,
        query: params.query,
        newName: params.newName,
        only: params.only,
        apply: params.apply,
      })
      return toolTextResult(result.text, result.details)
    },
  })
}
