// Real SettingsView/ForEach callbacks + documented Observable<EditMode> contract, offline only.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript'), root = path.resolve(__dirname, '..')
class EditMode {
  constructor(value) { this.value = value; this.isEditing = value === 'active' }
  static active() { return new EditMode('active') }
  static inactive() { return new EditMode('inactive') }
}
function runtime(options = {}) {
  const modules = {}, store = new Map(), kc = new Map(), states = []
  let hook = 0, reloads = 0, fetches = 0
  const observable = initial => {
    const i = hook++
    if (!(i in states)) states[i] = { value: typeof initial === 'function' ? initial() : initial, setValue(v) { this.value = v } }
    return states[i]
  }
  const scripting = new Proxy({
    EditMode: Object.hasOwn(options, 'mode') ? options.mode : EditMode,
    useObservable: options.noObservable ? undefined : observable,
    EditButton: options.noNative ? undefined : 'EditButton', ForEach: options.noNative ? undefined : 'ForEach',
    useState(initial) { const i = hook++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v }] },
    useEffect() {}, Navigation: { useDismiss: () => () => {} },
    Widget: { reloadAll: async () => { reloads++ } },
    modifiers: () => { const m = new Proxy({}, { get: () => () => m }); return m },
  }, { get: (o, k) => k in o ? o[k] : k })
  const context = vm.createContext({ console, Date, Map, Set, Math, Promise,
    Storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, JSON.parse(JSON.stringify(v))), remove: k => store.delete(k) },
    Keychain: { get: k => kc.get(k) ?? null, set: (k, v) => { kc.set(k, v); return true }, remove: k => kc.delete(k) },
    UIImage: { fromBase64String: s => ({ base64: s }) },
    fetch: () => { fetches++; throw Error('no network permitted') },
    setTimeout: () => { throw Error('no timer expected') }, clearTimeout() {},
  })
  function load(name) {
    if (modules[name]) return modules[name].exports
    let source = fs.readFileSync(path.join(root, name), 'utf8')
    if (name === 'index.tsx') source = source.replace(/\nrun\(\)\s*$/, '\nexport { SettingsView, AccountOrderPage }')
    const out = ts.transpileModule(source, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'scripting' }, reportDiagnostics: true })
    assert.equal(out.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, name)
    const m = modules[name] = { exports: {} }, jsx = (type, props) => ({ type, props })
    const req = n => n === 'scripting' ? scripting : n === 'scripting/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'Fragment' } : load(n.slice(2) + '.ts')
    vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`, context)(req, m, m.exports)
    return m.exports
  }
  const api = load('api.ts'), app = load('index.tsx')
  function walk(n, out = [], ancestors = []) {
    if (n == null || n === false) return out
    if (Array.isArray(n)) { n.forEach(x => walk(x, out, ancestors)); return out }
    if (typeof n !== 'object') return out
    if (typeof n.type === 'function') return walk(n.type(n.props), out, ancestors)
    out.push({ node: n, ancestors })
    const next = [...ancestors, n]
    walk(n.props?.children, out, next); walk(n.props?.header, out, next)
    if (n.type === 'ForEach') for (let i = 0; i < n.props.count; i++) walk(n.props.itemBuilder(i), out, next)
    return out
  }
  const render = () => { hook = 0; return walk(app.SettingsView()) }
  const accounts = ['antigravity:1', 'antigravity:2', 'antigravity:3'].map((id, i) => ({
    id, name: `Fixture ${i}`, provider: 'antigravity', enabled: true, available: true,
    fiveHour: { remainingPercent: 70, usedPercent: 30, resetsAt: null }, sevenDay: { remainingPercent: 70, usedPercent: 30, resetsAt: null }, resetCredits: null,
  }))
  function seed(count = 3) {
    api.saveSource('official'); states.length = 0
    kc.set('ai_usage_antigravity_oauth_v1', JSON.stringify(accounts.slice(0, count).map(a => ({ id: a.id, email: a.name, access: 'SYNTHETIC', refresh: 'SYNTHETIC', expiresAt: Date.now() + 3600000 }))))
    for (const key of ['ai_usage_official_cache_v1', 'ai_usage_cache_v1', 'ai_usage_sub2api_quota_v1']) store.set(key, { accounts: accounts.slice(0, count), today: null, month: null, todayByFamily: {}, monthByFamily: {}, fetchedAt: Date.now() })
  }
  return { api, app, store, kc, render, seed, walk, reopen: () => { states.length = 0 }, counts: () => ({ reloads, fetches }) }
}
const nodes = tree => tree.map(x => x.node)
const button = (tree, title) => { const b = nodes(tree).find(n => n.type === 'Button' && n.props.title === title); assert.ok(b, title); return b }
const each = tree => { const n = nodes(tree).find(n => n.type === 'ForEach'); assert.ok(n); return n }
const section = (tree, title) => {
  const row = tree.find(x => x.node.type === 'Text' && x.node.props.children === title)
  assert.ok(row, title); return row.ancestors.findLast(n => n.type === 'Section')
}
const ids = xs => Array.from(xs, x => x.id)
async function main() {
  const r = runtime(); r.seed()
  let tree = r.render(), sec = section(tree, '登录账号')
  const mode = sec.props.environments.editMode
  assert.equal(mode.value.value, 'inactive'); assert.equal(mode.value.isEditing, false)
  assert.equal(nodes(tree).some(n => n.type === 'EditButton'), false)
  assert.equal(nodes(tree).some(n => n.type === 'NavigationLink' && n.props.destination.type === r.app.AccountOrderPage), false, 'same-page native sort retained')
  const snapshot = JSON.stringify([...r.store]), credentials = JSON.stringify([...r.kc])
  button(tree, '编辑排序').props.action()
  assert.equal(mode.value.value, 'active'); assert.equal(mode.value.isEditing, true)
  tree = r.render(); assert.equal(section(tree, '登录账号').props.environments.editMode, mode)
  for (const row of tree.filter(x => x.node === each(tree) || x.node === button(tree, '完成'))) {
    assert.ok(row.ancestors.includes(section(tree, '登录账号')), 'header button and ForEach share the bound Section')
  }
  assert.equal(nodes(tree).filter(n => n.props?.environments?.editMode).length, 1, 'no environment on Form/NavigationStack or unrelated Section')
  assert.equal(JSON.stringify([...r.store]), snapshot); assert.equal(JSON.stringify([...r.kc]), credentials)
  each(tree).props.onMove([0], 3)
  assert.deepEqual(ids(r.api.sortAccounts(r.api.officialAccounts(), 'official')), ['antigravity:2', 'antigravity:3', 'antigravity:1'])
  assert.deepEqual(r.store.get('ai_usage_official_order_v1'), ['antigravity:2', 'antigravity:3', 'antigravity:1'])
  assert.equal(r.counts().reloads, 1, 'existing move persistence/reload unchanged')
  tree = r.render()
  assert.deepEqual(nodes(tree).filter(n => n.type === 'Text' && /^Fixture [0-2]$/.test(n.props.children)).map(n => n.props.children), ['Fixture 1', 'Fixture 2', 'Fixture 0'], 'actual native list row order updated')
  button(tree, '完成').props.action()
  assert.equal(mode.value.value, 'inactive'); assert.equal(mode.value.isEditing, false)
  assert.ok(button(r.render(), '编辑排序'))
  r.reopen(); assert.deepEqual(ids(r.api.sortAccounts(r.api.officialAccounts(), 'official')), ['antigravity:2', 'antigravity:3', 'antigravity:1'])
  tree = r.render()
  assert.deepEqual(nodes(tree).filter(n => n.type === 'Text' && /^Fixture [0-2]$/.test(n.props.children)).map(n => n.props.children), ['Fixture 1', 'Fixture 2', 'Fixture 0'], 'reopened list renders persisted order')
  button(tree, '编辑排序').props.action()
  // Switch while official mode is ACTIVE: only its own Section had an environment.
  for (const source of ['parrot', 'sub2api']) {
    const picker = nodes(r.render()).find(n => n.type === 'Picker' && n.props.title === '账号来源')
    await picker.props.onChanged(source)
    tree = r.render(); sec = section(tree, '目前账号')
    assert.equal(sec.props.environments, undefined)
    assert.equal(nodes(tree).filter(n => n.type === 'EditButton').length, 1)
    assert.equal(nodes(tree).some(n => n.props?.environments?.editMode), false)
    assert.equal(nodes(tree).some(n => n.type === 'Button' && ['编辑排序', '完成'].includes(n.props.title)), false)
    each(tree).props.onMove([0], 3)
    assert.deepEqual(ids(r.api.cachedAccounts()), ['antigravity:2', 'antigravity:3', 'antigravity:1'], source + ' keeps original native move')
  }
  assert.equal(r.counts().fetches, 0)
  assert.equal(JSON.stringify([...r.kc]), credentials, 'buttons and moves never change credentials')
  for (const count of [0, 1]) { const small = runtime(); small.seed(count); const tree = nodes(small.render()); assert.equal(tree.some(n => n.type === 'Button' && ['编辑排序', '完成'].includes(n.props.title)), false) }
  console.log('PASS production TSX: 编辑排序 -> shared native editMode active -> 完成 -> inactive; original ForEach move persists across reopen; only official Section bound; remote EditButton/move unaffected even after switching from active official mode; zero network/credential mutation')
  for (const options of [{ mode: undefined }, { mode: null }, { mode: {} }, { mode: { active: EditMode.active } }, { mode: { inactive: EditMode.inactive } }, { noObservable: true }]) {
    const old = runtime(options); old.seed(); const tree = old.render()
    assert.equal(nodes(tree).filter(n => n.type === 'EditButton').length, 1, 'old native EditButton retained, not fake renamed')
    assert.equal(section(tree, '登录账号').props.environments, undefined)
    assert.equal(nodes(tree).some(n => n.type === 'Button' && n.props.title === '编辑排序'), false)
    each(tree).props.onMove([0], 3)
    assert.deepEqual(ids(old.api.sortAccounts(old.api.officialAccounts(), 'official')), ['antigravity:2', 'antigravity:3', 'antigravity:1'])
    assert.equal(old.counts().fetches, 0)
  }
  {
  const old = runtime({ noNative: true }); old.seed(); const tree = old.render()
  assert.equal(nodes(tree).some(n => n.type === 'EditButton' || n.type === 'ForEach'), false)
  assert.equal(section(tree, '登录账号').props.environments, undefined)
  const link = nodes(tree).find(n => n.type === 'NavigationLink' && n.props.destination.type === old.app.AccountOrderPage)
  assert.ok(link, 'preexisting sort-page fallback retained')
  const reorder = nodes(old.walk(link.props.destination)).find(n => n.type === 'ReorderableForEach')
  assert.ok(reorder); reorder.props.onMove([0], 2)
  assert.deepEqual(ids(old.api.sortAccounts(old.api.officialAccounts(), 'official')), ['antigravity:2', 'antigravity:3', 'antigravity:1'])
  assert.equal(old.counts().fetches, 0)
  }
  console.log('PASS old APIs: missing/null/incomplete EditMode or absent useObservable retain real native EditButton and persistence; missing native sort exports retain working existing sort page. Observable host model is not native gesture/animation proof.')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
