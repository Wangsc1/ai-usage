// Offline cleanup regression; optional CLEANUP_BASELINE_DIR compares fully expanded trees.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript')
const root = path.resolve(__dirname, '..'), now = 1800000000000
function runtime(dir) {
  const modules = {}, store = new Map()
  const scripting = new Proxy({
    Widget: { family: 'systemSmall', parameter: '', displaySize: { width: 360, height: 380 } },
    AppIntentProtocol: { AppIntent: 0 }, AppIntentManager: { register: () => () => ({}) },
    modifiers: () => { const calls = []; const m = new Proxy({ calls }, { get: (o, k) => k === 'calls' ? calls : v => { calls.push([k, v]); return m } }); return m },
  }, { get: (o, k) => k in o ? o[k] : k })
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const context = vm.createContext({ Date: Clock, console, Map, Set, Math, Promise,
    Storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    Keychain: { get: () => null }, UIImage: { fromBase64String: s => ({ base64: s }) },
    fetch: () => { throw Error('cleanup tests must not contact a network') },
  })
  function load(name) {
    if (modules[name]) return modules[name].exports
    let source = fs.readFileSync(path.join(dir, name), 'utf8')
    if (name === 'index.tsx') source = source.replace(/\nrun\(\)\s*$/, '\nexport { AccountCacheSections }')
    if (name === 'widget.tsx') source = source.replace(/\nrun\(\)\s*$/, '\nexport { Root }')
    const out = ts.transpileModule(source, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'scripting' }, reportDiagnostics: true })
    assert.equal(out.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, name)
    const m = modules[name] = { exports: {} }
    const jsx = (type, props, key) => ({ type, props, ...(key === undefined ? {} : { key }) })
    const req = n => n === 'scripting' ? scripting : n === 'scripting/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'Fragment' } : load(n.slice(2) + (fs.existsSync(path.join(dir, n.slice(2) + '.tsx')) ? '.tsx' : '.ts'))
    vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`, context)(req, m, m.exports)
    return m.exports
  }
  function expand(n) {
    if (n == null || typeof n !== 'object') return n
    if (Array.isArray(n)) return n.map(expand)
    if (Object.hasOwn(n, 'type') && typeof n.type === 'function') return expand(n.type(n.props))
    if (n.type === 'GeometryReader') return expand(n.props.children({ size: { width: 330, height: 134 } }))
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, typeof v === 'function' ? '[callback]' : expand(v)]))
  }
  return { load, scripting, snapshot: n => JSON.stringify(expand(n)) }
}
const current = runtime(root), api = current.load('api.ts'), app = current.load('index.tsx'), widget = current.load('widget.tsx')
assert.equal(api.VERSION, '1.52')
assert.equal(api.VERSION, JSON.parse(fs.readFileSync(path.join(root, 'script.json'))).version)
const index = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
assert.ok(!index.includes('const VERSION ='))
assert.match(index, /import \{ VERSION,.*\} from "\.\/api"/)
assert.equal('WORKBUDDY_SVG' in api, false)
const svg = fs.readFileSync(path.join(root, 'assets/workbuddy-original.svg'), 'utf8')
assert.ok(svg.startsWith('<svg ') && svg.trimEnd().endsWith('</svg>'))
const files = ['api.ts', 'index.tsx', 'widget.tsx', 'app_intents.tsx'].map(f => path.join(root, f))
const program = ts.createProgram(files, { noEmit: true, noUnusedLocals: true, noUnusedParameters: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, skipLibCheck: true })
assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d => [6133, 6192, 6196, 6198].includes(d.code)).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')), [])
for (const v of [null, '', 'invalid', new Date(now - 1).toISOString()]) assert.equal(api.fmtResetDays(v), '--')
assert.equal(api.fmtResetDays(new Date(now + 90061000).toISOString()), '1d 01:01')
const win = { remainingPercent: 62.5, usedPercent: 37.5, resetsAt: '2027-01-01T00:00:00Z' }
const account = { id: 'fixture', name: 'Fixture', provider: 'claude', enabled: true, available: true, resetCredits: null, fiveHour: win, sevenDay: win }
const detail = a => current.snapshot(app.AccountCacheSections({ account: a }))
assert.ok(detail(account).includes('重置时间 2027-01-01 08:00:00'))
for (const v of [null, undefined, '', 'invalid', '1970-01-01T00:00:00Z', '1969-12-31T16:00:00Z', '2027-01-01T09:02:03+09:00']) {
  const expected = !v ? '未提供' : v === 'invalid' ? v : v.startsWith('2027') ? '2027-01-01 08:02:03' : v.startsWith('1969') ? '1970-01-01 00:00:00' : '1970-01-01 08:00:00'
  assert.ok(detail({ ...account, fiveHour: { ...win, resetsAt: v } }).includes('重置时间 ' + expected))
}
for (const at of [null, undefined, NaN, Infinity, -1, 0, 8640000000000001]) {
  assert.ok(detail({ ...account, provider: 'deepseek', balance: { fetchedAt: at, money: [] } }).includes('余额采集时间 未提供'))
}
assert.ok(detail({ ...account, provider: 'deepseek', balance: { fetchedAt: 1, money: [] } }).includes('余额采集时间 1970-01-01 08:00:00'))
console.log('PASS cleanup: shared 1.52 version, standalone SVG, zero unused symbols, reset and Beijing date valid/missing/invalid/epoch behavior')
if (process.env.CLEANUP_BASELINE_DIR) {
  const baselineDir = process.env.CLEANUP_BASELINE_DIR, previous = runtime(baselineDir), oldApi = previous.load('api.ts'), oldApp = previous.load('index.tsx'), oldWidget = previous.load('widget.tsx')
  assert.equal(svg, oldApi.WORKBUDDY_SVG ?? fs.readFileSync(path.join(baselineDir, 'assets/workbuddy-original.svg'), 'utf8'), 'SVG source preserved byte-for-byte')
  for (const muted of [false, true]) assert.equal(JSON.stringify(api.workBuddyBrandImage(muted)), JSON.stringify(oldApi.workBuddyBrandImage(muted)), 'all embedded PNG bytes unchanged')
  let details = 0, trees = 0
  for (const at of [undefined, null, NaN, Infinity, -1, 0, 1, now, 8640000000000000, 8640000000000001]) {
    const a = { ...account, provider: 'deepseek', balance: { fetchedAt: at, weekFetchedAt: at, auth: '网页Token', money: [{ currency: 'CNY', total: '1', weekCost: '0' }] } }
    assert.equal(detail(a), previous.snapshot(oldApp.AccountCacheSections({ account: a, source: 'official' }))); details++
  }
  for (const value of [undefined, null, '', 'invalid', '1970-01-01T00:00:00Z', '1969-12-31T16:00:00Z', '2027-01-01T09:02:03+09:00', '+275760-09-13T00:00:00.000Z']) {
    for (const a of [{ ...account, fiveHour: { ...win, resetsAt: value } }, { ...account, provider: 'workbuddy', credits: { packages: [{ name: 'Fixture', expiresAt: value, cycleEnd: value }] } }]) {
      assert.equal(detail(a), previous.snapshot(oldApp.AccountCacheSections({ account: a, source: 'parrot' }))); details++
    }
  }
  const metric = { requests: 2, inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheCreationTokens: 6, totalTokens: 18, costUsd: 0.1 }
  for (const family of ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryRectangular', 'accessoryCircular', 'accessoryInline'])
    for (const count of [0, 1, 2, 3, 4]) for (const stale of [false, true]) for (const stats of [false, true]) {
      current.scripting.Widget.family = previous.scripting.Widget.family = family
      const data = { accounts: Array.from({ length: count }, (_, i) => ({ ...account, id: 'fixture-' + i })), fetchedAt: now, today: stats ? metric : null, month: stats ? metric : null, todayByFamily: {}, monthByFamily: {} }
      assert.equal(current.snapshot(widget.Root({ data, error: null })), previous.snapshot(oldWidget.Root({ data, stale, error: null })), family + '/' + count + '/' + stale + '/' + stats); trees++
    }
  for (const error of [null, 'fixture failure']) assert.equal(current.snapshot(widget.Root({ data: null, error })), previous.snapshot(oldWidget.Root({ data: null, stale: true, error })))
  console.log(`PASS baseline: exact SVG/PNG bytes; ${details} detail trees (including date boundaries); ${trees} expanded widget trees plus missing-data states identical including layout/fonts`)
}
