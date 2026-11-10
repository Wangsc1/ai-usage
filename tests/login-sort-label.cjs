// Production SettingsView/ForEach callbacks. Host layout follows IMG_5633 read-only device probe:
// scripting.EditMode undefined; global EditMode object with active/inactive; scripting.useObservable function.
// Native implementations remain synthetic; this is not an iOS gesture/animation test.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript'), root = path.resolve(__dirname, '..')
const EditMode = {
  active: () => ({ value: 'active', isEditing: true }),
  inactive: () => ({ value: 'inactive', isEditing: false }),
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
    EditMode: undefined, // Explicitly absent from the module, including its Proxy fallback.
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
  if (!options.missingGlobal) context.EditMode = Object.hasOwn(options, 'mode') ? options.mode : EditMode
  assert.equal(scripting.EditMode, undefined)
  if (!Object.hasOwn(options, 'mode') && !options.missingGlobal) {
    assert.equal(vm.runInContext('typeof EditMode', context), 'object')
    assert.equal(vm.runInContext('typeof EditMode.active', context), 'function')
    assert.equal(vm.runInContext('typeof EditMode.inactive', context), 'function')
  }
  function load(name) {
    if (modules[name]) return modules[name].exports
    let source = fs.readFileSync(path.join(root, name), 'utf8')
    if (name === 'index.tsx') {
      source = source.replace(/\nrun\(\)\s*$/, '\nexport { SettingsView, AccountOrderPage }')
    }
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
  for (const options of [{}, {missingGlobal:true}, {noObservable:true}]) {
    const r=runtime(options);r.seed();let tree=r.render()
    const sec=section(tree,'登录账号')
    assert.equal(sec.props.environments,undefined,'native environment remains untouched')
    const header=r.walk(sec.props.header)
    const group=nodes(header).find(n=>n.type==='HStack' && n.props.spacing===0)
    assert.ok(group)
    assert.deepEqual(Array.from(group.props.children,n=>n.type),['EditButton','Text'])
    assert.equal(group.props.children[1].props.children,'排序')
    assert.equal(Object.keys(group.props.children[0].props).length,0,'original EditButton has no replacement action or custom binding')
    assert.equal(nodes(tree).some(n=>n.type==='Button'&&n.props.title==='编辑排序'),false)
    const before=JSON.stringify([...r.kc])
    each(tree).props.onMove([0],3)
    assert.deepEqual(ids(r.api.sortAccounts(r.api.officialAccounts(),'official')),['antigravity:2','antigravity:3','antigravity:1'])
    r.reopen();assert.deepEqual(ids(r.api.sortAccounts(r.api.officialAccounts(),'official')),['antigravity:2','antigravity:3','antigravity:1'])
    for(const source of ['parrot','sub2api']) {
      const picker=nodes(r.render()).find(n=>n.type==='Picker'&&n.props.title==='账号来源')
      await picker.props.onChanged(source)
      tree=r.render()
      const remoteHeader=r.walk(section(tree,'目前账号').props.header)
      assert.equal(nodes(remoteHeader).filter(n=>n.type==='EditButton').length,1)
      assert.equal(nodes(remoteHeader).some(n=>n.type==='Text'&&n.props.children==='排序'),false)
    }
    assert.equal(r.counts().fetches,0);assert.equal(JSON.stringify([...r.kc]),before)
  }
  for(const count of [0,1]) {const r=runtime();r.seed(count);const header=r.walk(section(r.render(),'登录账号').props.header);assert.equal(nodes(header).some(n=>n.type==='EditButton'||n.props?.children==='排序'),false)}
  const old=runtime({noNative:true});old.seed();const tree=old.render()
  assert.equal(nodes(tree).some(n=>n.type==='EditButton'),false)
  assert.ok(nodes(tree).find(n=>n.type==='NavigationLink'&&n.props.destination.type===old.app.AccountOrderPage))
  console.log('PASS original native EditButton restored with adjacent 排序 text only; no custom editMode/action; original move persistence, source isolation and fallback retained. Native gesture validation requires device.')
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { runtime, nodes, section }
