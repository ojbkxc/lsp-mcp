import { relative } from 'path';
function plural(n, word) {
    return n === 1 ? word : word + 's';
}
/**
 * Formats a URI by converting it to a relative path if possible.
 */
function formatUri(uri, cwd) {
    if (!uri) {
        return '<unknown location>';
    }
    let filePath = uri.replace(/^file:\/\//, '');
    if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
    }
    try {
        filePath = decodeURIComponent(filePath);
    }
    catch {
        // Malformed URI — use un-decoded path as fallback
    }
    if (cwd) {
        const relativePath = relative(cwd, filePath).replaceAll('\\', '/');
        if (relativePath.length < filePath.length &&
            !relativePath.startsWith('../../')) {
            return relativePath;
        }
    }
    return filePath.replaceAll('\\', '/');
}
/**
 * Groups items by their file URI.
 */
function groupByFile(items, cwd) {
    const byFile = new Map();
    for (const item of items) {
        const uri = 'uri' in item ? item.uri : item.location.uri;
        const filePath = formatUri(uri, cwd);
        const existingItems = byFile.get(filePath);
        if (existingItems) {
            existingItems.push(item);
        }
        else {
            byFile.set(filePath, [item]);
        }
    }
    return byFile;
}
function formatLocation(location, cwd) {
    const filePath = formatUri(location.uri, cwd);
    const line = location.range.start.line + 1;
    const character = location.range.start.character + 1;
    return `${filePath}:${line}:${character}`;
}
function locationLinkToLocation(link) {
    return {
        uri: link.targetUri,
        range: link.targetSelectionRange || link.targetRange,
    };
}
function isLocationLink(item) {
    return 'targetUri' in item;
}
export function formatGoToDefinitionResult(result, cwd) {
    if (!result) {
        return 'No definition found.';
    }
    if (Array.isArray(result)) {
        const locations = result.map(item => isLocationLink(item) ? locationLinkToLocation(item) : item);
        const validLocations = locations.filter(loc => loc && loc.uri);
        if (validLocations.length === 0) {
            return 'No definition found.';
        }
        if (validLocations.length === 1) {
            return `Defined in ${formatLocation(validLocations[0], cwd)}`;
        }
        const locationList = validLocations
            .map(loc => `  ${formatLocation(loc, cwd)}`)
            .join('\n');
        return `Found ${validLocations.length} definitions:\n${locationList}`;
    }
    const location = isLocationLink(result)
        ? locationLinkToLocation(result)
        : result;
    return `Defined in ${formatLocation(location, cwd)}`;
}
export function formatFindReferencesResult(result, cwd) {
    if (!result || result.length === 0) {
        return 'No references found.';
    }
    const validLocations = result.filter(loc => loc && loc.uri);
    if (validLocations.length === 0) {
        return 'No references found.';
    }
    if (validLocations.length === 1) {
        return `Found 1 reference:\n  ${formatLocation(validLocations[0], cwd)}`;
    }
    const byFile = groupByFile(validLocations, cwd);
    const lines = [
        `Found ${validLocations.length} references across ${byFile.size} files:`,
    ];
    for (const [filePath, locations] of byFile) {
        lines.push(`\n${filePath}:`);
        for (const loc of locations) {
            const line = loc.range.start.line + 1;
            const character = loc.range.start.character + 1;
            lines.push(`  Line ${line}:${character}`);
        }
    }
    return lines.join('\n');
}
function extractMarkupText(contents) {
    if (Array.isArray(contents)) {
        return contents
            .map(item => {
            if (typeof item === 'string') {
                return item;
            }
            return item.value;
        })
            .join('\n\n');
    }
    if (typeof contents === 'string') {
        return contents;
    }
    if ('kind' in contents) {
        return contents.value;
    }
    return contents.value;
}
export function formatHoverResult(result, _cwd) {
    if (!result) {
        return 'No hover information available.';
    }
    const content = extractMarkupText(result.contents);
    if (result.range) {
        const line = result.range.start.line + 1;
        const character = result.range.start.character + 1;
        return `Hover info at ${line}:${character}:\n\n${content}`;
    }
    return content;
}
function symbolKindToString(kind) {
    const kinds = {
        1: 'File',
        2: 'Module',
        3: 'Namespace',
        4: 'Package',
        5: 'Class',
        6: 'Method',
        7: 'Property',
        8: 'Field',
        9: 'Constructor',
        10: 'Enum',
        11: 'Interface',
        12: 'Function',
        13: 'Variable',
        14: 'Constant',
        15: 'String',
        16: 'Number',
        17: 'Boolean',
        18: 'Array',
        19: 'Object',
        20: 'Key',
        21: 'Null',
        22: 'EnumMember',
        23: 'Struct',
        24: 'Event',
        25: 'Operator',
        26: 'TypeParameter',
    };
    return kinds[kind] || 'Unknown';
}
function formatDocumentSymbolNode(symbol, indent = 0) {
    const lines = [];
    const prefix = '  '.repeat(indent);
    const kind = symbolKindToString(symbol.kind);
    let line = `${prefix}${symbol.name} (${kind})`;
    if (symbol.detail) {
        line += ` ${symbol.detail}`;
    }
    line += ` - Line ${symbol.range.start.line + 1}`;
    lines.push(line);
    if (symbol.children && symbol.children.length > 0) {
        for (const child of symbol.children) {
            lines.push(...formatDocumentSymbolNode(child, indent + 1));
        }
    }
    return lines;
}
export function formatDocumentSymbolResult(result, cwd) {
    if (!result || result.length === 0) {
        return 'No symbols found in document.';
    }
    const firstSymbol = result[0];
    const isSymbolInformation = firstSymbol && 'location' in firstSymbol;
    if (isSymbolInformation) {
        return formatWorkspaceSymbolResult(result, cwd);
    }
    const lines = ['Document symbols:'];
    for (const symbol of result) {
        lines.push(...formatDocumentSymbolNode(symbol));
    }
    return lines.join('\n');
}
export function formatWorkspaceSymbolResult(result, cwd) {
    if (!result || result.length === 0) {
        return 'No symbols found in workspace.';
    }
    const validSymbols = result.filter(sym => sym && sym.location && sym.location.uri);
    if (validSymbols.length === 0) {
        return 'No symbols found in workspace.';
    }
    const lines = [
        `Found ${validSymbols.length} ${plural(validSymbols.length, 'symbol')} in workspace:`,
    ];
    const byFile = groupByFile(validSymbols, cwd);
    for (const [filePath, symbols] of byFile) {
        lines.push(`\n${filePath}:`);
        for (const symbol of symbols) {
            const kind = symbolKindToString(symbol.kind);
            const line = symbol.location.range.start.line + 1;
            let symbolLine = `  ${symbol.name} (${kind}) - Line ${line}`;
            if (symbol.containerName) {
                symbolLine += ` in ${symbol.containerName}`;
            }
            lines.push(symbolLine);
        }
    }
    return lines.join('\n');
}
function formatCallHierarchyItem(item, cwd) {
    if (!item.uri) {
        return `${item.name} (${symbolKindToString(item.kind)}) - <unknown location>`;
    }
    const filePath = formatUri(item.uri, cwd);
    const line = item.range.start.line + 1;
    const kind = symbolKindToString(item.kind);
    let result = `${item.name} (${kind}) - ${filePath}:${line}`;
    if (item.detail) {
        result += ` [${item.detail}]`;
    }
    return result;
}
export function formatPrepareCallHierarchyResult(result, cwd) {
    if (!result || result.length === 0) {
        return 'No call hierarchy item found at this position';
    }
    if (result.length === 1) {
        return `Call hierarchy item: ${formatCallHierarchyItem(result[0], cwd)}`;
    }
    const lines = [`Found ${result.length} call hierarchy items:`];
    for (const item of result) {
        lines.push(`  ${formatCallHierarchyItem(item, cwd)}`);
    }
    return lines.join('\n');
}
export function formatIncomingCallsResult(result, cwd) {
    if (!result || result.length === 0) {
        return 'No incoming calls found (nothing calls this function)';
    }
    const lines = [
        `Found ${result.length} incoming ${plural(result.length, 'call')}:`,
    ];
    const byFile = new Map();
    for (const call of result) {
        if (!call.from)
            continue;
        const filePath = formatUri(call.from.uri, cwd);
        const existing = byFile.get(filePath);
        if (existing) {
            existing.push(call);
        }
        else {
            byFile.set(filePath, [call]);
        }
    }
    for (const [filePath, calls] of byFile) {
        lines.push(`\n${filePath}:`);
        for (const call of calls) {
            if (!call.from)
                continue;
            const kind = symbolKindToString(call.from.kind);
            const line = call.from.range.start.line + 1;
            let callLine = `  ${call.from.name} (${kind}) - Line ${line}`;
            if (call.fromRanges && call.fromRanges.length > 0) {
                const callSites = call.fromRanges
                    .map(r => `${r.start.line + 1}:${r.start.character + 1}`)
                    .join(', ');
                callLine += ` [calls at: ${callSites}]`;
            }
            lines.push(callLine);
        }
    }
    return lines.join('\n');
}
export function formatOutgoingCallsResult(result, cwd) {
    if (!result || result.length === 0) {
        return 'No outgoing calls found (this function calls nothing)';
    }
    const lines = [
        `Found ${result.length} outgoing ${plural(result.length, 'call')}:`,
    ];
    const byFile = new Map();
    for (const call of result) {
        if (!call.to)
            continue;
        const filePath = formatUri(call.to.uri, cwd);
        const existing = byFile.get(filePath);
        if (existing) {
            existing.push(call);
        }
        else {
            byFile.set(filePath, [call]);
        }
    }
    for (const [filePath, calls] of byFile) {
        lines.push(`\n${filePath}:`);
        for (const call of calls) {
            if (!call.to)
                continue;
            const kind = symbolKindToString(call.to.kind);
            const line = call.to.range.start.line + 1;
            let callLine = `  ${call.to.name} (${kind}) - Line ${line}`;
            if (call.fromRanges && call.fromRanges.length > 0) {
                const callSites = call.fromRanges
                    .map(r => `${r.start.line + 1}:${r.start.character + 1}`)
                    .join(', ');
                callLine += ` [called from: ${callSites}]`;
            }
            lines.push(callLine);
        }
    }
    return lines.join('\n');
}
/** 单条文本替换的可读预览。 */
function formatTextEdit(edit) {
    const line = edit.range.start.line + 1;
    const character = edit.range.start.character + 1;
    const preview = edit.newText.length > 60 ? `${edit.newText.slice(0, 60)}…` : edit.newText;
    const singleLine = preview.replace(/\r?\n/g, '\\n');
    return `Line ${line}:${character} → "${singleLine}"`;
}
/**
 * 格式化 WorkspaceEdit（rename / codeAction 等的编辑集合）。
 * 按文件分组，逐个列出待改位置，便于用户确认后再应用。
 */
export function formatWorkspaceEdit(edit, cwd) {
    if (!edit) {
        return '未产生任何编辑。';
    }
    const byFile = new Map();
    const push = (uri, edits) => {
        const key = formatUri(uri, cwd);
        const existing = byFile.get(key);
        if (existing)
            existing.push(...edits);
        else
            byFile.set(key, [...edits]);
    };
    if (edit.changes) {
        for (const [uri, edits] of Object.entries(edit.changes)) {
            if (Array.isArray(edits))
                push(uri, edits);
        }
    }
    if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
            // TextDocumentEdit 有 textDocument.uri + edits；CreateFile/RenameFile/DeleteFile 另有字段，
            // 这里只汇总文本编辑，其余类型给出提示即可。
            const asEdit = change;
            if (asEdit.textDocument?.uri && Array.isArray(asEdit.edits)) {
                const textEdits = asEdit.edits.filter((e) => typeof e === 'object' && e !== null && 'range' in e);
                push(asEdit.textDocument.uri, textEdits);
            }
        }
    }
    if (byFile.size === 0) {
        return '未产生任何编辑。';
    }
    let total = 0;
    const lines = [];
    for (const [filePath, edits] of byFile) {
        total += edits.length;
        lines.push(`${filePath}:`);
        for (const e of edits)
            lines.push(`  ${formatTextEdit(e)}`);
    }
    return `共 ${total} 处编辑，涉及 ${byFile.size} 个文件：\n${lines.join('\n')}`;
}
/**
 * 格式化 codeAction 结果列表（标题 + 类型 + 是否首选）。
 */
export function formatCodeActions(actions, _cwd) {
    if (!actions || actions.length === 0) {
        return '当前位置没有可用的代码操作。';
    }
    const lines = [`发现 ${actions.length} 个代码操作：`];
    actions.forEach((action, index) => {
        const title = action.title || '(无标题)';
        const codeAction = action;
        const kind = codeAction.kind ? ` [${codeAction.kind}]` : '';
        const preferred = codeAction.isPreferred ? ' ★首选' : '';
        const hasEdit = codeAction.edit ? ' (含编辑)' : '';
        lines.push(`  ${index}: ${title}${kind}${preferred}${hasEdit}`);
    });
    return lines.join('\n');
}
//# sourceMappingURL=formatters.js.map