import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  FORBIDDEN_API,
  FORBIDDEN_EVENTS,
  FORBIDDEN_IMPORT_PREFIXES,
  FORBIDDEN_TOOL_FIELDS,
} from "../dist/ext/policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "ext");
const distDir = join(here, "..", "dist", "ext");

/** policy.ts 是禁忌名单的唯一事实来源，必须写出这些字面量。 */
const EXEMPT = new Set(["policy.ts"]);

/** 去掉块注释与行注释，避免注释/文档里的示例词误报。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TOKENS = [
  ...FORBIDDEN_EVENTS,
  ...FORBIDDEN_TOOL_FIELDS,
  ...FORBIDDEN_API,
  ...FORBIDDEN_IMPORT_PREFIXES,
];

test("跨端源码（src/ext，除 policy.ts）不得出现禁忌字面量", () => {
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !EXEMPT.has(f));
  assert.ok(files.length > 0, "src/ext 应至少有一个共享源文件");
  const violations = [];
  for (const file of files) {
    const code = stripComments(readFileSync(join(srcDir, file), "utf8"));
    for (const token of TOKENS) {
      if (code.includes(token)) violations.push(`${file}: 出现禁忌字面量 "${token}"`);
    }
  }
  assert.deepEqual(violations, []);
});

test("跨端源码只从允许的宿主导入源取 API", () => {
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const code = stripComments(readFileSync(join(srcDir, file), "utf8"));
    const specs = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) {
      if (spec.startsWith(".") || spec === "typebox" || spec.startsWith("node:")) continue;
      assert.equal(
        spec,
        "@earendil-works/pi-coding-agent",
        `${file} 只能从 @earendil-works/pi-coding-agent 导入宿主 API，实为 "${spec}"`,
      );
    }
  }
});

test("编译产物 dist/ext 不得把 MCP SDK / vscode-* 拖进扩展入口", () => {
  const files = readdirSync(distDir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 0, "dist/ext 应有编译产物（先 npm run build）");
  for (const file of files) {
    const code = stripComments(readFileSync(join(distDir, file), "utf8"));
    const specs = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) {
      assert.ok(
        !spec.startsWith("@modelcontextprotocol/"),
        `${file} 不应把 MCP SDK 引入扩展入口（实为 "${spec}"）`,
      );
      assert.ok(
        !spec.startsWith("vscode-"),
        `${file} 不应直接依赖 vscode-* 包（实为 "${spec}"）`,
      );
      assert.ok(!spec.startsWith("@oh-my-pi/"), `${file} 不应引入 oh-my-pi 内部包（实为 "${spec}"）`);
    }
  }
  // 入口应存在且是工厂形态
  const entry = readFileSync(join(distDir, "index.js"), "utf8");
  assert.match(entry, /export default/, "dist/ext/index.js 应有默认导出工厂");
});
