import { asCompatApi, onCompat, textContent } from './compat.js';
import { createLspCore } from './core.js';
import { createLspTool } from './tool.js';
/** 会触发诊断织入的内置工具。 */
const DIAGNOSTIC_TOOLS = new Set(['write', 'edit']);
export function createLspExtension(pi, core = createLspCore()) {
    const compat = asCompatApi(pi);
    compat.registerTool(createLspTool(core));
    onCompat(compat, 'session_start', (event, ctx) => {
        core.setCwd(ctx.cwd);
        void event;
    });
    // 核心：编辑路径织入诊断
    onCompat(compat, 'tool_result', async (event, ctx) => {
        if (event.isError)
            return;
        if (!event.toolName || !DIAGNOSTIC_TOOLS.has(event.toolName))
            return;
        const filePath = typeof event.input.path === 'string' ? event.input.path : undefined;
        if (!filePath)
            return;
        core.setCwd(ctx.cwd);
        let summary;
        try {
            summary = await core.diagnoseAfterEdit(filePath);
        }
        catch {
            // 诊断失败绝不影响 edit/write 本身的结果
            return;
        }
        if (!summary)
            return;
        return {
            content: [...event.content, textContent(`\n${summary}`)],
        };
    });
    onCompat(compat, 'session_shutdown', () => {
        void core.shutdown();
    });
}
export default function lspExtension(pi) {
    createLspExtension(pi);
}
export { createLspCore, createLspTool };
export { LSP_ACTIONS } from './core.js';
//# sourceMappingURL=index.js.map