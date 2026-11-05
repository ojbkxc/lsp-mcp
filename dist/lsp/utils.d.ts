/**
 * Convert a file system path to a file:// URI.
 * Uses pathToFileURL for cross-platform correctness (Windows drive letters, etc.).
 */
export declare function filePathToUri(filePath: string): string;
/**
 * Convert a file:// URI back to a file system path.
 * Handles Windows drive-letter URIs (file:///C:/path -> C:/path).
 */
export declare function uriToFilePath(uri: string): string;
/**
 * Convert a 1-based user position (line, character) to 0-based LSP position.
 * Users think in 1-based coordinates; LSP protocol uses 0-based.
 */
export declare function toLspPosition(line1Based: number, character1Based: number): {
    line: number;
    character: number;
};
/**
 * Convert a 0-based LSP position to 1-based user-facing position.
 */
export declare function fromLspPosition(line0Based: number, character0Based: number): {
    line: number;
    character: number;
};
//# sourceMappingURL=utils.d.ts.map