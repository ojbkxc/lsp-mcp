import { resolve } from 'path'
import { pathToFileURL } from 'url'

/**
 * Convert a file system path to a file:// URI.
 * Uses pathToFileURL for cross-platform correctness (Windows drive letters, etc.).
 */
export function filePathToUri(filePath: string): string {
  return pathToFileURL(resolve(filePath)).href
}

/**
 * Convert a file:// URI back to a file system path.
 * Handles Windows drive-letter URIs (file:///C:/path -> C:/path).
 */
export function uriToFilePath(uri: string): string {
  let filePath = uri.replace(/^file:\/\//, '')
  // 先解码：部分服务端（如 typescript-language-server）会把 Windows 盘符冒号
  // 百分号编码成 file:///d%3A/... ，不先解码就识别不出盘符。
  try {
    filePath = decodeURIComponent(filePath)
  } catch {
    // Malformed URI — use un-decoded path as fallback
  }
  // On Windows, file:///C:/path becomes /C:/path after replacing file://
  // Strip the leading slash for Windows drive-letter paths
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1)
  }
  return filePath
}

/**
 * Convert a 1-based user position (line, character) to 0-based LSP position.
 * Users think in 1-based coordinates; LSP protocol uses 0-based.
 */
export function toLspPosition(line1Based: number, character1Based: number): {
  line: number
  character: number
} {
  return {
    line: Math.max(0, line1Based - 1),
    character: Math.max(0, character1Based - 1),
  }
}

/**
 * Convert a 0-based LSP position to 1-based user-facing position.
 */
export function fromLspPosition(line0Based: number, character0Based: number): {
  line: number
  character: number
} {
  return {
    line: line0Based + 1,
    character: character0Based + 1,
  }
}