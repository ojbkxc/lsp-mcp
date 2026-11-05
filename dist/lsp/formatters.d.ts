import type { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, CodeAction, Command, DocumentSymbol, Hover, Location, LocationLink, SymbolInformation, WorkspaceEdit } from 'vscode-languageserver-types';
export declare function formatGoToDefinitionResult(result: Location | Location[] | LocationLink | LocationLink[] | null, cwd?: string): string;
export declare function formatFindReferencesResult(result: Location[] | null, cwd?: string): string;
export declare function formatHoverResult(result: Hover | null, _cwd?: string): string;
export declare function formatDocumentSymbolResult(result: DocumentSymbol[] | SymbolInformation[] | null, cwd?: string): string;
export declare function formatWorkspaceSymbolResult(result: SymbolInformation[] | null, cwd?: string): string;
export declare function formatPrepareCallHierarchyResult(result: CallHierarchyItem[] | null, cwd?: string): string;
export declare function formatIncomingCallsResult(result: CallHierarchyIncomingCall[] | null, cwd?: string): string;
export declare function formatOutgoingCallsResult(result: CallHierarchyOutgoingCall[] | null, cwd?: string): string;
/**
 * 格式化 WorkspaceEdit（rename / codeAction 等的编辑集合）。
 * 按文件分组，逐个列出待改位置，便于用户确认后再应用。
 */
export declare function formatWorkspaceEdit(edit: WorkspaceEdit | null | undefined, cwd?: string): string;
/**
 * 格式化 codeAction 结果列表（标题 + 类型 + 是否首选）。
 */
export declare function formatCodeActions(actions: Array<CodeAction | Command> | null | undefined, _cwd?: string): string;
//# sourceMappingURL=formatters.d.ts.map