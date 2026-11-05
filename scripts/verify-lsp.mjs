/**
 * 真实端到端验证：用本机 typescript-language-server 在一个真实 TS 文件上
 *   1) 跑通全部 12 个 action；
 *   2) 验证 `tool_result` 诊断织入（write/edit 后把诊断并入 content），并验证去重账本。
 *
 * 不使用 .cmd：直接 spawn `node <typescript-language-server>/lib/cli.mjs --stdio`。
 */
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const { createLspCore } = await import(pathToFileURL(join(pkgRoot, 'dist', 'ext', 'core.js')).href)
const { default: lspExtension } = await import(pathToFileURL(join(pkgRoot, 'dist', 'ext', 'index.js')).href)

const cli = join(pkgRoot, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')
if (!existsSync(cli)) {
  console.error(`缺少 typescript-language-server：${cli}`)
  process.exit(2)
}

const dir = mkdtempSync(join(tmpdir(), 'lsp-verify-'))

const FIXTURE = `interface Greeter {
  greet(name: string): string
}

class Person implements Greeter {
  greet(name: string): string {
    return 'hi ' + name
  }
}

function helper(x: number): number {
  return x * 2
}

const p = new Person()
const bad: number = "not a number"
const doubled = helper("wrong type")

export { p, bad, doubled, helper, Person }
`

const fixturePath = join(dir, 'sample.ts')
writeFileSync(fixturePath, FIXTURE, 'utf-8')
writeFileSync(
  join(dir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['*.ts'],
    },
    null,
    2,
  ),
  'utf-8',
)

// 显式配置：command=node，args=[cli.mjs, --stdio]，避开 .cmd
// tsserver.path 指向经典的 TypeScript 5.x（本机 typescript@7 是原生端口，无 tsserver.js）
const classicTsserver = join(pkgRoot, 'node_modules', 'ts-classic', 'lib', 'tsserver.js')
const cfgPath = join(dir, 'lsp-config.json')
writeFileSync(
  cfgPath,
  JSON.stringify({
    servers: {
      ts: {
        command: process.execPath,
        args: [cli, '--stdio'],
        extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
        initializationOptions: { tsserver: { path: classicTsserver } },
        workspaceFolder: dir,
      },
    },
  }),
  'utf-8',
)
process.env.LSP_MCP_CONFIG = cfgPath
// 冷启动 tsserver + 首次索引可能较慢，验证时放宽诊断等待上限
process.env.LSP_MCP_DIAG_TIMEOUT_MS = '9000'

/** 取 FIXTURE 中第 n 次出现子串处的 1 基行列。 */
function posOf(needle, occurrence = 1) {
  let index = -1
  for (let i = 0; i < occurrence; i++) {
    index = FIXTURE.indexOf(needle, index + 1)
    if (index < 0) throw new Error(`找不到标记：${needle}`)
  }
  const before = FIXTURE.slice(0, index)
  const line = before.split('\n').length
  const character = index - before.lastIndexOf('\n')
  return { filePath: fixturePath, line, character }
}

const failures = []
function check(action, condition, detail) {
  const status = condition ? 'PASS' : 'FAIL'
  console.log(`  [${status}] ${action}${detail ? ` — ${detail.split('\n')[0].slice(0, 90)}` : ''}`)
  if (!condition) failures.push(action)
}

console.log(`验证目录：${dir}`)
console.log(`fixture：${fixturePath}\n`)

// ---------------- Part A：全部 action ----------------
console.log('== Part A：12 个 action ==')
const core = createLspCore({ configPath: cfgPath, log: () => {} })
core.setCwd(dir)

try {
  const docSymbols = (await core.op('document_symbol', { filePath: fixturePath })).text
  check('document_symbol', /Person/.test(docSymbols) && /helper/.test(docSymbols), docSymbols)

  const def = (await core.op('definition', posOf('Person()'))).text
  check('definition', /Defined in/.test(def), def)

  const hover = (await core.op('hover', posOf('Greeter', 2))).text
  check('hover', /Greeter/.test(hover) && !/No hover/.test(hover), hover)

  const typeDef = (await core.op('type_definition', posOf('p = new Person'))).text
  check('type_definition', /Defined in/.test(typeDef), typeDef)

  const refs = (await core.op('references', posOf('class Person'))).text
  check('references', /reference/i.test(refs), refs)

  const impl = (await core.op('implementation', posOf('interface Greeter'))).text
  check('implementation', /Person/.test(impl) || /Defined in/.test(impl), impl)

  const incoming = (await core.op('call_hierarchy_incoming', posOf('function helper'))).text
  check('call_hierarchy_incoming', /incoming|谁调用|helper/i.test(incoming), incoming)

  const outgoing = (await core.op('call_hierarchy_outgoing', posOf('function helper'))).text
  check('call_hierarchy_outgoing', outgoing.length > 0, outgoing)

  const wsSymbol = (await core.op('workspace_symbol', { query: 'Person' })).text
  check('workspace_symbol', /Person/.test(wsSymbol), wsSymbol)

  const renamePreview = (await core.op('rename', { ...posOf('class Person'), newName: 'Human' })).text
  check('rename', /Human/.test(renamePreview) || /编辑/.test(renamePreview), renamePreview)

  const codeActions = (await core.op('code_actions', posOf('"not a number"'))).text
  check('code_actions', codeActions.length > 0, codeActions)

  const diagnostics = (await core.op('diagnostics', { filePath: fixturePath })).text
  check('diagnostics', /发现 \d+ 条诊断/.test(diagnostics) && /error/i.test(diagnostics), diagnostics)
} catch (error) {
  console.error('Part A 抛出异常：', error)
  failures.push('Part A:exception')
} finally {
  await core.shutdown()
}

// ---------------- Part B：诊断织入 + 去重账本 ----------------
console.log('\n== Part B：tool_result 诊断织入 ==')
function createFakePi() {
  const tools = new Map()
  const handlers = new Map()
  const entries = []
  const ctx = {
    cwd: dir,
    mode: 'rpc',
    hasUI: false,
    signal: undefined,
    isIdle: () => true,
    abort: () => {},
    ui: { notify: () => {} },
  }
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    on: (event, handler) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler),
        )
      }
    },
    appendEntry: (customType, data) => entries.push({ customType, data }),
    getAllTools: () => [...tools.values()].map((t) => ({ name: t.name })),
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
  }
  return { pi, tools, handlers, entries, ctx }
}

const fake = createFakePi()
lspExtension(fake.pi)
check('register_tool', fake.tools.has('lsp'), `已注册工具：${[...fake.tools.keys()].join(',')}`)

const toolResultHandlers = fake.handlers.get('tool_result') ?? []
check('tool_result_handler', toolResultHandlers.length === 1, `处理器数=${toolResultHandlers.length}`)

const writeEvent = {
  type: 'tool_result',
  toolCallId: 'call-1',
  toolName: 'write',
  input: { path: fixturePath, content: FIXTURE },
  content: [{ type: 'text', text: '已写入文件' }],
  isError: false,
}

// 手动触发 session_start（设置 cwd）
for (const h of fake.handlers.get('session_start') ?? []) {
  await h({ type: 'session_start' }, fake.ctx)
}

const woven = await toolResultHandlers[0](writeEvent, fake.ctx)
const wovenText = JSON.stringify(woven ?? null)
check(
  'weave_first',
  !!woven && Array.isArray(woven.content) && /LSP 诊断/.test(JSON.stringify(woven.content)),
  `返回内容：${wovenText.slice(0, 160)}`,
)

// 同一条编辑再来一次：去重账本应让重复诊断不再上报
const woven2 = await toolResultHandlers[0]({ ...writeEvent, toolCallId: 'call-2' }, fake.ctx)
check('weave_dedup', woven2 === undefined || woven2 == null, `二次返回：${JSON.stringify(woven2)}`)

// edit 工具同样织入
const editEvent = {
  type: 'tool_result',
  toolCallId: 'call-3',
  toolName: 'edit',
  input: { path: fixturePath, edits: [] },
  content: [{ type: 'text', text: '已编辑' }],
  isError: false,
}
const woven3 = await toolResultHandlers[0](editEvent, fake.ctx)
check('weave_edit_dedup', woven3 === undefined || woven3 == null, `edit 二次返回：${JSON.stringify(woven3)}`)

// ---------------- Part C：通过宿主注册路径执行 lsp 工具 ----------------
console.log('\n== Part C：注册后的 lsp 工具执行 ==')
const registeredTool = fake.tools.get('lsp')
check('tool_shape', !!registeredTool && registeredTool.name === 'lsp', `name=${registeredTool?.name}`)
check(
  'tool_description',
  typeof registeredTool?.description === 'string' && registeredTool.description.includes('action'),
  registeredTool?.description?.slice(0, 60),
)
if (registeredTool) {
  const res = await registeredTool.execute(
    'toolcall-1',
    { action: 'document_symbol', filePath: fixturePath },
    undefined,
    undefined,
    fake.ctx,
  )
  const text = JSON.stringify(res?.content ?? null)
  check('tool_execute', /Person/.test(text) && /Document symbols|符号/.test(text), text.slice(0, 120))
}

for (const h of fake.handlers.get('session_shutdown') ?? []) {
  await h({ type: 'session_shutdown' }, fake.ctx)
}

console.log('\n== 汇总 ==')
if (failures.length) {
  console.error(`失败项（${failures.length}）：${failures.join(', ')}`)
  process.exit(1)
}
console.log('全部通过：12 个 action 可用，诊断织入可见且去重生效。')
