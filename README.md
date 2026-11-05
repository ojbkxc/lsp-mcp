# lsp-mcp

LSP 代码智能，**一份源码两个形态**：

- **跨端 pi 扩展**（默认入口 `dist/ext/index.js`）：pi-agent-desktop 内置 / oh-my-pi marketplace，暴露**单个 `lsp` 工具 + action 枚举**，并把编辑后的诊断织入工具结果。
- **旧 MCP stdio 入口**（`dist/mcp-server.js`）：保留 9 个既有工具并补齐 3 个，供任意 MCP 客户端（Pi Agent / Claude Code）继续使用。

两者共用同一份 LSP 操作核心（`src/ext/core.ts`），能力不会漂移。

## 单工具 + action 枚举

跨端形态只注册一个工具 `lsp`，用 `action` 选择能力（参数：`filePath` / `line` / `character` / `query` / `newName` / `only` / `apply`）：

| action | 用途 |
|---|---|
| `definition` | 跳转到定义 |
| `type_definition` | 跳转到类型定义 |
| `references` | 查找所有引用 |
| `hover` | 悬停类型/文档信息 |
| `document_symbol` | 当前文件符号大纲 |
| `workspace_symbol` | 全工作区符号搜索（需 `query`） |
| `implementation` | 接口/抽象方法的实现 |
| `call_hierarchy_incoming` | 谁调用了它 |
| `call_hierarchy_outgoing` | 它调用了谁 |
| `diagnostics` | 文件诊断（错误/警告） |
| `rename` | 重命名（预览；`apply: true` 落盘，需 `newName`） |
| `code_actions` | 代码操作/快速修复（`apply: true` 应用） |

比 grep 准：找"函数在哪定义/谁在调用"、分析 TypeScript/JavaScript 结构时优先使用。

## 诊断织入（核心特性）

订阅宿主的 `tool_result` 事件：每次 `write` / `edit` 之后，自动对该文件取诊断，并把摘要并入结果 content。实现要点：

- **版本基线**：每次收到 `textDocument/publishDiagnostics` 递增版本号，先记基线再等待，确认拿到的是本次触发的新报告（不再 `sleep(500)` 碰运气）。
- **拉取优先**：服务端支持 `textDocument/diagnostic` 时直接拉取。
- **静默窗口**：推送模式下等版本前进后再观察一小段静默期才返回，整体有超时上限。
- **去重账本**：同一诊断只上报一次；修复后消失、复现时才会再报。

## 构建与验证

```bash
npm install
npm run build          # tsc → dist/
npm test               # 单测 + 禁忌扫描（无需真实 LSP）
npm run verify         # 真实 TS 文件端到端：12 个 action + 诊断织入
```

## 宿主席位

- **pi-agent-desktop**：`import factory from "lsp-mcp"; builtin("lsp", factory)`（`pi.extensions` 亦指向 `dist/ext/index.js`）。
- **oh-my-pi**：`omp.extensions` → `dist/ext/index.js`。
- **MCP 客户端**：`node <lsp-mcp>/dist/mcp-server.js`，安装后也可直接 `npx lsp-mcp`（12 个 `lsp_*` 工具）。

语言服务器配置 `~/.pi/agent/lsp-config.json`（也可用环境变量 `LSP_MCP_CONFIG` 指向别的路径）：

```json
{
  "servers": {
    "typescript-language-server": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": { ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact" }
    }
  }
}
```

> Windows 上请避免让 `command` 指向 `.cmd` 垫片；建议 `command: "node"` +
> `args: ["<abs>/node_modules/typescript-language-server/lib/cli.mjs", "--stdio"]`。

首次调用会启动 language server，慢几秒属正常。诊断等待上限可用 `LSP_MCP_DIAG_TIMEOUT_MS` 调整（默认 2500ms）。
