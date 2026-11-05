import { Type } from './compat.js';
import { type LspCore } from './core.js';
export declare function createLspTool(core: LspCore): import("./compat.js").CompatToolDefinition<Type.TObject<{
    action: Type.TUnion<Type.TLiteral<"definition" | "references" | "hover" | "document_symbol" | "workspace_symbol" | "implementation" | "type_definition" | "call_hierarchy_incoming" | "call_hierarchy_outgoing" | "diagnostics" | "rename" | "code_actions">[]>;
    filePath: Type.TOptional<Type.TString>;
    line: Type.TOptional<Type.TNumber>;
    character: Type.TOptional<Type.TNumber>;
    query: Type.TOptional<Type.TString>;
    newName: Type.TOptional<Type.TString>;
    only: Type.TOptional<Type.TString>;
    apply: Type.TOptional<Type.TBoolean>;
}>, unknown>;
//# sourceMappingURL=tool.d.ts.map