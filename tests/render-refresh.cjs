// Production App/API with an offline host. Counts are local reads/reload requests, not native timing.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript'), root = path.resolve(__dirname, '..')
function runtime(count) {
  const kc = new Map(), store = new Map(), modules = {}; let states = [], hook = 0, reads = 0, orderReads = 0, reloads = 0, requests = 0, failure = false
  const window = { usedPercent: 20, remainingPercent: 80, resetsAt: null }
  const accounts = Array.from({ length: count }, (_, i) => ({ id: `official-${i}`, name: `u${i}@example.test`, provider: 'openai', enabled: true, available: true, fiveHour: window, sevenDay: window, resetCredits: 2 }))
  kc.set('ai_usage_official_oauth_v1', JSON.stringify(accounts.map(a => ({ id: a.id, accountId: a.id, subject: a.id, email: a.name, name: a.name, access: 'fixture-access', refresh: 'fixture-refresh', expiresAt: Date.now() + 3600000 }))))
  store.set('ai_usage_source_v1', 'official'); store.set('ai_usage_official_cache_v1', { accounts, today: null, month: null, todayByFamily: {}, monthByFamily: {}, fetchedAt: 1800000000000 })
  store.set('ai_usage_official_order_v1', accounts.map(a => a.id).reverse())
  const scripting = new Proxy({
    Widget: { reloadAll: async () => { reloads++ } }, Navigation: { useDismiss: () => () => {} },
    useState: v => { const i = hook++; if (!(i in states)) states[i] = v; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v }] },
    useEffect: () => {},
  }, { get: (o, k) => k in o ? o[k] : k })
  const ctx = vm.createContext({ console, Map, Set, Math, Date, Promise,
    Data: { fromBase64String: s => ({ toRawString: () => Buffer.from(s, 'base64').toString() }) },
    Storage: { get: k => { if (k === 'ai_usage_official_order_v1') orderReads++; return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null }, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    Keychain: { get: k => { reads++; return kc.get(k) ?? null }, set: (k, v) => { kc.set(k, v); return true }, remove: k => kc.delete(k) },
    fetch: async url => {
      requests++; if (failure) throw Error('offline fixture failure')
      if (url.includes('/wham/usage')) return { status: 200, json: async () => ({ rate_limit_reset_credits: { available_count: 2 } }) }
      if (url.includes('/api/v1/admin/accounts?')) return { status: 200, json: async () => ({ code: 0, data: { pages: 1, items: [] } }) }
      throw Error('unexpected fixture request')
    },
  })
  function load(name) {
    if (modules[name]) return modules[name].exports
    let source = fs.readFileSync(path.join(root, name), 'utf8')
    if (name === 'index.tsx') source = source.replace(/\nrun\(\)\s*$/, '\nexport { SettingsView }')
    const out = ts.transpileModule(source, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'scripting' }, reportDiagnostics: true })
    assert.equal(out.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
    const m = modules[name] = { exports: {} }, jsx = (type, props, key) => ({ type, props, key })
    vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`, ctx)(n => n === 'scripting' ? scripting : n === 'scripting/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'Fragment' } : load('api.ts'), m, m.exports)
    return m.exports
  }
  function walk(n) {
    if (n == null || n === false) return []
    if (Array.isArray(n)) return n.flatMap(walk)
    if (typeof n !== 'object') return [n]
    if (typeof n.type === 'function') return walk(n.type(n.props))
    if (n.type === 'ForEach') return [n, ...walk(Array.from({ length: n.props.count }, (_, i) => n.props.itemBuilder(i)))]
    return [n, ...walk(n.props?.children)]
  }
  const app = load('index.tsx'), api = load('api.ts')
  const render = () => { hook = 0; reads = 0; orderReads = 0; return walk(app.SettingsView()) }
  return { api, kc, store, accounts, render, counts: () => ({ reads, orderReads, reloads, requests }), fail: value => { failure = value } }
}
async function main() {
  let single
  for (const count of [1, 20]) {
    const r = runtime(count), tree = r.render(), c = r.counts()
    assert.equal(c.requests, 0)
    const details = tree.filter(n => n?.type === 'NavigationLink' && n.props.destination?.type?.name === 'WidgetNamePage')
    assert.deepEqual(details.map(n => n.props.destination.props.account.id), r.accounts.map(a => a.id).reverse())
    if (count === 1) single = c
    else { assert.equal(c.reads, single.reads, 'credential/config reads independent of row count'); assert.equal(c.orderReads, single.orderReads, 'sort-store reads independent of row count') }
    // A later render must see new local quota, not a retained account map.
    const cached = r.store.get('ai_usage_official_cache_v1'); cached.accounts[0] = { ...cached.accounts[0], resetCredits: 7 }; r.store.set('ai_usage_official_cache_v1', cached)
    assert.equal(r.render().filter(n => n?.type === 'NavigationLink' && n.props.destination?.type?.name === 'WidgetNamePage').find(n => n.props.destination.props.account.id === r.accounts[0].id).props.destination.props.account.resetCredits, 7)
    console.log(`PASS ${count} official rows: ${c.reads} Keychain reads, ${c.orderReads} official-order reads per render; order and fresh detail snapshots retained; zero network`)
  }
  for (const success of [true, false]) {
    const r = runtime(2); r.fail(!success)
    r.api.saveSub2APIConfig('https://sub.fixture.invalid', 'fixture-admin', 'Asia/Shanghai')
    const picker = r.render().find(n => n?.type === 'Picker' && n.props.title === '账号来源')
    await picker.props.onChanged('sub2api')
    assert.equal(r.counts().reloads, 1, 'source switch reloads once on success or absent data')
    assert.equal(r.counts().requests, 1, 'one quota list request; unconfigured statistics send none')
  }
  for (const count of [1, 2]) for (const success of [true, false]) {
    const r = runtime(count); r.fail(!success)
    const row = r.render().find(n => n?.type === 'HStack' && n.key === 'official-0')
    assert.ok(row); await row.props.trailingSwipeActions.actions[0].props.action()
    assert.equal(r.counts().reloads, 1, 'local deletion reloads once even when remote read fails')
    assert.equal(r.counts().requests, count - 1, 'only remaining accounts are requested; last-account removal still reloads')
    assert.ok(!r.api.officialAccounts().some(a => a.id === 'official-0'))
  }
  const r = runtime(2)
  for (let i = 0; i < 2; i++) await r.render().find(n => n?.type === 'Form').props.toolbar.primaryAction.props.action()
  assert.equal(r.counts().requests, 4, 'two explicit refreshes each read both accounts; no TTL swallows manual refresh')
  assert.equal(r.counts().reloads, 2)
  console.log('PASS App source/deletion success+failure each requests exactly one reload; repeated explicit refreshes not suppressed. Widget/intent scheduling, batch concurrency and cache handoff unchanged.')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
