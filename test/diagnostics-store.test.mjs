import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DiagnosticsStore,
  diagnosticIdentity,
  formatDiagnosticsList,
  mapLspDiagnostics,
  summarizeDiagnostics,
} from "../dist/ext/diagnostics.js";

function mk(line, character, message, severity = "Error") {
  return {
    line,
    character,
    endLine: line,
    endCharacter: character + 1,
    message,
    severity,
    severityNumber: severity === "Error" ? 1 : 2,
  };
}

test("mapLspDiagnostics 把 0 基 LSP 位置转成 1 基并保留严重度", () => {
  const mapped = mapLspDiagnostics([
    { range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } }, message: "boom", severity: 1, code: "TS1" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: "hmm", severity: 2 },
  ]);
  assert.equal(mapped[0].line, 3);
  assert.equal(mapped[0].character, 5);
  assert.equal(mapped[0].severity, "Error");
  assert.equal(mapped[0].code, "TS1");
  assert.equal(mapped[1].severity, "Warning");
});

test("去重账本：同一诊断只上报一次，消失后再次出现会重新上报", () => {
  const store = new DiagnosticsStore();
  const path = "D:/tmp/a.ts";

  store.record(path, [mk(3, 1, "Type 'string' is not assignable to type 'number'.")]);
  assert.equal(store.reduce(path).length, 1, "首次应上报");

  // 行号漂移但消息相同 → 视为同一诊断，不再上报
  store.record(path, [mk(7, 1, "Type 'string' is not assignable to type 'number'.")]);
  assert.equal(store.reduce(path).length, 0, "同一诊断不应重复上报");

  // 修复后清零
  store.record(path, []);
  assert.equal(store.reduce(path).length, 0);

  // 再次出现 → 视为新问题，重新上报
  store.record(path, [mk(9, 1, "Type 'string' is not assignable to type 'number'.")]);
  assert.equal(store.reduce(path).length, 1, "问题复现应重新上报");
});

test("版本基线随每次报告推进", () => {
  const store = new DiagnosticsStore();
  const path = "D:/tmp/b.ts";
  assert.equal(store.version(path), 0);
  store.record(path, []);
  assert.equal(store.version(path), 1);
  store.record(path, []);
  assert.equal(store.version(path), 2);
});

test("markSeen 后账本视其为已见", () => {
  const store = new DiagnosticsStore();
  const path = "D:/tmp/c.ts";
  store.record(path, [mk(1, 1, "err")]);
  store.markSeen(path);
  assert.equal(store.reduce(path).length, 0);
});

test("summarize/format 输出中文可读文本", () => {
  const diags = [mk(1, 1, "e1", "Error"), mk(2, 1, "w1", "Warning")];
  assert.equal(summarizeDiagnostics(diags), "1 error, 1 warning");
  const text = formatDiagnosticsList(diags);
  assert.match(text, /发现 2 条诊断/);
  assert.match(text, /Error 第 1:1 行/);
});

test("diagnosticIdentity 忽略位置前缀", () => {
  assert.equal(
    diagnosticIdentity(mk(1, 1, "src/a.ts:3:5 Something wrong")),
    diagnosticIdentity(mk(9, 9, "Something wrong")),
  );
});
