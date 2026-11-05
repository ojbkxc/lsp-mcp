/**
 * 旧 MCP 入口（向后兼容）。
 *
 * 保留 9 个既有工具，并补齐 3 个新 action（type_definition / rename / code_actions）的
 * 独立工具形态，使 MCP 客户端与新的跨端 `lsp` 工具能力对齐。
 * 所有能力都委托给 `./ext/core.js` 的共享实现，避免两份逻辑漂移。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLspCore } from './ext/core.js';
const cwd = process.cwd();
const core = createLspCore();
core.setCwd(cwd);
const TOOLS = [
    { name: 'lsp_definition', description: '跳转到符号的定义位置', action: 'definition', shape: 'position' },
    { name: 'lsp_references', description: '查找符号的所有引用', action: 'references', shape: 'position' },
    { name: 'lsp_hover', description: '获取符号的悬停类型信息', action: 'hover', shape: 'position' },
    { name: 'lsp_document_symbol', description: '获取文件的符号大纲', action: 'document_symbol', shape: 'file' },
    { name: 'lsp_workspace_symbol', description: '全工作区符号搜索', action: 'workspace_symbol', shape: 'symbol' },
    { name: 'lsp_implementation', description: '查找接口的实现', action: 'implementation', shape: 'position' },
    { name: 'lsp_type_definition', description: '跳转到符号的类型定义', action: 'type_definition', shape: 'position' },
    {
        name: 'lsp_call_hierarchy_incoming',
        description: '调用层次（进来）：谁调用了这个函数',
        action: 'call_hierarchy_incoming',
        shape: 'position',
    },
    {
        name: 'lsp_call_hierarchy_outgoing',
        description: '调用层次（出去）：这个函数调用了谁',
        action: 'call_hierarchy_outgoing',
        shape: 'position',
    },
    { name: 'lsp_diagnostics', description: '获取文件的诊断信息（错误/警告）', action: 'diagnostics', shape: 'file' },
    { name: 'lsp_rename', description: '重命名符号（apply=true 时落盘，否则预览）', action: 'rename', shape: 'rename' },
    {
        name: 'lsp_code_actions',
        description: '获取或应用当前位置的代码操作（快速修复等）',
        action: 'code_actions',
        shape: 'codeaction',
    },
];
function inputSchemaFor(spec) {
    const properties = {};
    const required = [];
    if (spec.shape !== 'symbol') {
        properties.filePath = { type: 'string', description: '文件的绝对路径' };
        required.push('filePath');
    }
    if (spec.shape === 'position' || spec.shape === 'rename' || spec.shape === 'codeaction' || spec.shape === 'file') {
        if (spec.shape !== 'file') {
            properties.line = { type: 'number', description: '行号（从 1 开始）' };
            properties.character = { type: 'number', description: '列位置（从 1 开始）' };
        }
    }
    if (spec.shape === 'symbol') {
        properties.query = { type: 'string', description: '符号名查询（支持模糊匹配）' };
        required.push('query');
    }
    if (spec.shape === 'rename') {
        properties.newName = { type: 'string', description: '新符号名' };
        properties.apply = { type: 'boolean', description: '是否真正写入磁盘（默认仅预览）' };
        required.push('newName');
    }
    if (spec.shape === 'codeaction') {
        properties.only = { type: 'string', description: 'kind 前缀过滤，如 quickfix' };
        properties.apply = { type: 'boolean', description: '是否应用第一个可落盘的代码操作' };
    }
    return { type: 'object', properties, required };
}
const server = new Server({ name: 'lsp-mcp', version: '1.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchemaFor(t) })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {});
    const spec = TOOLS.find((t) => t.name === request.params.name);
    if (!spec) {
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
    }
    try {
        core.setCwd(cwd);
        const result = await core.op(spec.action, {
            filePath: typeof args.filePath === 'string' ? args.filePath : undefined,
            line: typeof args.line === 'number' ? args.line : undefined,
            character: typeof args.character === 'number' ? args.character : undefined,
            query: typeof args.query === 'string' ? args.query : undefined,
            newName: typeof args.newName === 'string' ? args.newName : undefined,
            only: typeof args.only === 'string' ? args.only : undefined,
            apply: args.apply === true,
        });
        return { content: [{ type: 'text', text: result.text }] };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${msg}` }] };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('lsp-mcp server started (legacy MCP entry)');
}
main().catch((error) => {
    console.error(error);
});
//# sourceMappingURL=mcp-server.js.map