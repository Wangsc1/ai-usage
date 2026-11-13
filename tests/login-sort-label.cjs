const modern = require('./modern-foreach.js')
// Production SettingsView with documented global EditMode/Observable API.
// Resolve BOTH inherited environment and nearest list-owner binding; Section-only injection is NOT
// treated as native list editing. Plain value writes deliberately do NOT notify the native binding.
// Header refresh deliberately requires a useState update, not a forced render after every action.
// This checks the documented notification path, not iOS handle rendering or taps.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript'), root = path.resolve(__dirname, '..')
const EditMode = {
  active: () => ({ value: 'active', isEditing: true }),
  inactive: () => ({ value: 'inactive', isEditing: false }),
}
function runtime(options = {}) {
  const modules = {}, store = new Map(), kc = new Map(), states = []
  let hook = 0, reloads = 0, fetches = 0, activeCalls = 0, inactiveCalls = 0
  let stateUpdates = 0, setValueCalls = 0, nativeNotifications = 0, renderedRevision = -1, lastTree
  let mountedBinding, unsubscribeBinding
  const nativeValues = new WeakMap()
  const observable = initial => {
    const i = hook++
    if (!(i in states)) {
      const listeners = new Set()
      const obs = { value: typeof initial === 'function' ? initial() : initial,
        setValue(v) {
          setValueCalls++
          if (options.throwSetValue) throw Error('synthetic notification failure')
          const previous = this.value; this.value = v
          listeners.forEach(fn => fn(v, previous))
        },
        subscribe(fn) { listeners.add(fn) }, unsubscribe(fn) { listeners.delete(fn) },
      }
      if (options.noSetValue) delete obs.setValue
      if (options.nullSetValue) obs.setValue = null
      states[i] = obs
    }
    return states[i]
  }
  const scripting = new Proxy({
    EditMode: undefined, // Verified device layout: only the host global exists.
    useObservable: options.noObservable ? undefined : observable,
    EditButton: options.noNative ? undefined : 'EditButton', ForEach: options.noNative ? undefined : 'ForEach',
    useState(initial) { const i = hook++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; stateUpdates++ }] },
    useEffect(fn) { modern.effect(fn) }, Navigation: { useDismiss: () => () => {} },
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
  if (!options.missingGlobal) context.EditMode = Object.hasOwn(options, 'mode') ? options.mode : {
    active: () => { activeCalls++; return Object.freeze(EditMode.active()) },
    inactive: () => { inactiveCalls++; return Object.freeze(EditMode.inactive()) },
  }
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
      if (options.indexSource) source = options.indexSource
      if (options.directValueOnly || options.noTitleState) {
        const update = 'officialEditMode.setValue(next)\n          // Match the calendar sort control: notify the binding, then refresh the nested header via state.\n          setSortUI({ editing: next.isEditing, failed: false })'
        assert.ok(source.includes(update))
        source = source.replace(update, options.directValueOnly ? 'officialEditMode.value = next' : 'officialEditMode.setValue(next)')
        if (options.directValueOnly) source = source.replace('title={sortUI.editing ?', 'title={officialEditMode.value.isEditing ?')
      }
      if (options.sectionOnly) {
        const binding = 'environments={source === \"official\" && loginRows && officialEditMode ? { editMode: officialEditMode } : undefined}'
        assert.ok(source.includes(binding))
        source = source.replace(binding, '').replace('<Section header={<HStack frame={{ maxWidth: \"infinity\" }}><Text>登录账号</Text>', '<Section ' + binding + ' header={<HStack frame={{ maxWidth: \"infinity\" }}><Text>登录账号</Text>')
      }
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
    const owner = [...ancestors].reverse().find(a => a.type === 'Form' || a.type === 'List')
    const inherited = [...ancestors].reverse().find(a => a.props?.environments?.editMode)
    out.push({ node: n, ancestors, owner, ownerMode: owner?.props.environments?.editMode, inheritedMode: inherited?.props.environments?.editMode })
    const next = [...ancestors, n]
    walk(n.props?.children, out, next)
    walk(n.props?.header, out, next)
    if (n.type === 'ForEach') for (const row of modern.rows(n.props)) walk(row, out, next)
    return out
  }
  const render = () => {
    hook = 0
    const tree = walk(modern.render(()=>app.SettingsView()))
    const form = tree.find(x => x.node.type === 'Form')?.node
    const mode = form?.props.environments?.editMode
    if (mode !== mountedBinding) {
      unsubscribeBinding?.()
      mountedBinding = mode
      if (mode) {
        nativeValues.set(mode, mode.value)
        const notified = value => { nativeNotifications++; nativeValues.set(mode, value) }
        mode.subscribe(notified)
        unsubscribeBinding = () => mode.unsubscribe(notified)
      } else unsubscribeBinding = undefined
    }
    lastTree = tree; renderedRevision = stateUpdates
    return tree
  }
  const flushUI = () => stateUpdates !== renderedRevision ? render() : lastTree
  const accounts = ['antigravity:1', 'antigravity:2', 'antigravity:3'].map((id, i) => ({
    id, name: `Fixture ${i}`, provider: 'antigravity', enabled: true, available: true,
    fiveHour: { remainingPercent: 70, usedPercent: 30, resetsAt: null }, sevenDay: { remainingPercent: 70, usedPercent: 30, resetsAt: null }, resetCredits: null,
  }))
  function seed(count = 3) {
    api.saveSource('official'); states.length = 0
    kc.set('ai_usage_antigravity_oauth_v1', JSON.stringify(accounts.slice(0, count).map(a => ({ id: a.id, email: a.name, access: 'SYNTHETIC', refresh: 'SYNTHETIC', expiresAt: Date.now() + 3600000 }))))
    for (const key of ['ai_usage_official_cache_v1', 'ai_usage_cache_v1', 'ai_usage_sub2api_quota_v1']) store.set(key, { accounts: accounts.slice(0, count), today: null, month: null, todayByFamily: {}, monthByFamily: {}, fetchedAt: Date.now() })
  }
  return { api, app, store, kc, render, flushUI, seed, walk, nativeValue: mode => nativeValues.get(mode), reopen: () => { states.length = 0 }, counts: () => ({ reloads, fetches, activeCalls, inactiveCalls, stateUpdates, setValueCalls, nativeNotifications }) }
}
const nodes = tree => tree.map(x => x.node)
const each = tree => { const n = nodes(tree).find(n => n.type === 'ForEach'); assert.ok(n); return n }
const section = (tree, title) => {
  const row = tree.find(x => x.node.type === 'Text' && x.node.props.children === title)
  assert.ok(row, title); return row.ancestors.findLast(n => n.type === 'Section')
}
const ids = xs => Array.from(xs, x => x.id)
function assertOwnerScope(tree) {
  const row = tree.find(x => x.node.type === 'ForEach')
  assert.ok(row?.owner && row.owner.type === 'Form', 'Form owns the editable rows')
  assert.ok(row.ownerMode, 'Form itself must receive editMode, not only its Section')
  assert.equal(row.inheritedMode, row.ownerMode)
  const header = section(tree, '登录账号').props.header
  const actions = tree.filter(x => x.node.type === 'Button' && x.ancestors.includes(header))
  assert.equal(actions.length, 1, 'single whole-title Button in header')
  const action = actions[0]
  assert.equal(action.owner, row.owner)
  assert.equal(action.inheritedMode, row.ownerMode)
  assert.equal(section(tree, '登录账号').props.environments, undefined)
  assert.deepEqual(nodes(tree).filter(n => n.props?.environments?.editMode), [row.owner])
  return { mode: row.ownerMode, action: action.node }
}
function assertNotified(r, before, mode, editing) {
  const after = r.counts()
  assert.equal(after.setValueCalls, before.setValueCalls + 1, 'action must invoke setValue, not only store value')
  assert.equal(after.nativeNotifications, before.nativeNotifications + 1, 'mounted Form binding receives subscription notification')
  assert.equal(after.stateUpdates, before.stateUpdates + 1, 'nested header title refresh uses ordinary state')
  assert.equal(r.nativeValue(mode).isEditing, editing)
}
async function main() {
  const r=runtime();r.seed()
  let tree=r.render(), {mode,action}=assertOwnerScope(tree)
  assert.equal(action.props.title,'编辑排序')
  assert.equal(nodes(tree).filter(n=>n.type==='EditButton').length,0)
  assert.equal(nodes(tree).some(n=>n.type==='Text'&&n.props.children==='排序'),false,'no non-clickable suffix')
  assert.equal(nodes(tree).some(n=>n.type==='NavigationLink'&&n.props.destination.type===r.app.AccountOrderPage),false)
  const before=JSON.stringify([...r.kc]), storageBefore=JSON.stringify([...r.store])
  assert.equal(mode.value.isEditing,false)
  let calls=r.counts(); action.props.action()
  assert.equal(r.counts().activeCalls,calls.activeCalls+1,'action invokes global active()')
  assert.equal(mode.value.isEditing,true)
  assertNotified(r,calls,mode,true)
  tree=r.flushUI();let current=assertOwnerScope(tree)
  assert.equal(current.mode,mode);assert.equal(current.action.props.title,'完成')
  assert.equal(tree.find(x=>x.node.type==='ForEach').ownerMode.value.isEditing,true,'list-owner binding becomes active, not merely Section state')
  modern.move(each(tree).props,[0],3)
  assert.deepEqual(ids(r.api.sortAccounts(r.api.officialAccounts(),'official')),['antigravity:2','antigravity:3','antigravity:1'])
  assert.deepEqual(r.store.get('ai_usage_official_order_v1'),['antigravity:2','antigravity:3','antigravity:1'])
  assert.equal(r.counts().reloads,1)
  assert.deepEqual(nodes(r.render()).filter(n=>n.type==='Text'&&/^Fixture [0-2]$/.test(n.props.children)).map(n=>n.props.children),['Fixture 1','Fixture 2','Fixture 0'])
  calls=r.counts();current.action.props.action()
  assert.equal(r.counts().inactiveCalls,calls.inactiveCalls+1,'done invokes global inactive()')
  assert.equal(mode.value.isEditing,false)
  assertNotified(r,calls,mode,false)
  assert.equal(assertOwnerScope(r.flushUI()).action.props.title,'编辑排序')
  r.reopen();tree=r.render();({mode,action}=assertOwnerScope(tree))
  assert.deepEqual(nodes(tree).filter(n=>n.type==='Text'&&/^Fixture [0-2]$/.test(n.props.children)).map(n=>n.props.children),['Fixture 1','Fixture 2','Fixture 0'],'reopened actual rows use persisted order')
  assert.deepEqual(ids(r.api.sortAccounts(r.api.officialAccounts(),'official')),['antigravity:2','antigravity:3','antigravity:1'])
  assert.equal(mode.value.isEditing,false)
  assert.notEqual(JSON.stringify([...r.store]),storageBefore,'only sorting persists data')
  assert.equal(r.counts().fetches,0,'editing/done and local sorting do not request data')
  for (const source of ['parrot','sub2api']) {
    const requestsBefore=r.counts().fetches
    action=assertOwnerScope(r.render()).action;calls=r.counts();action.props.action()
    assertNotified(r,calls,mode,true)
    assert.equal(r.counts().fetches,requestsBefore,'whole-title edit action is local')
    assert.equal(mode.value.isEditing,true)
    const picker=nodes(r.flushUI()).find(n=>n.type==='Picker'&&n.props.title==='账号来源')
    const resetCalls=r.counts()
    await picker.props.onChanged(source)
    assert.equal(r.counts().setValueCalls,resetCalls.setValueCalls+1,'source reset also calls setValue')
    assert.equal(r.counts().nativeNotifications,resetCalls.nativeNotifications+1)
    assert.equal(r.nativeValue(mode).isEditing,false)
    assert.equal(mode.value.isEditing,false,'leaving official clears edit state before dropping binding')
    tree=r.render()
    assert.equal(nodes(tree).some(n=>n.props?.environments?.editMode),false,'remote Form/Section receive no custom editing environment')
    const remoteHeader=section(tree,'目前账号').props.header
    const native=tree.filter(x=>x.node.type==='EditButton'&&x.ancestors.includes(remoteHeader))
    assert.equal(native.length,1);assert.deepEqual(Object.keys(native[0].node.props),[])
    assert.equal(native[0].ownerMode,undefined)
    assert.equal(nodes(tree).some(n=>n.type==='Button'&&n.props.title==='编辑排序'||n.type==='Text'&&n.props.children==='排序'),false)
    modern.move(each(tree).props,[0],3)
    assert.deepEqual(ids(r.api.cachedAccounts()),['antigravity:2','antigravity:3','antigravity:1'])
    action.props.action();assert.equal(mode.value.isEditing,false,'old official button cannot reactivate while remote')
    const back=nodes(r.render()).find(n=>n.type==='Picker'&&n.props.title==='账号来源')
    await back.props.onChanged('official')
    assert.equal(r.counts().fetches,requestsBefore+3,'unchanged source-switch refresh: 3 synthetic account requests, all intercepted')
    current=assertOwnerScope(r.render());assert.equal(current.mode,mode)
    assert.equal(current.mode.value.isEditing,false);assert.equal(current.action.props.title,'编辑排序')
  }
  assert.equal(r.counts().fetches,6);assert.equal(JSON.stringify([...r.kc]),before)
  for(const options of [{missingGlobal:true},{mode:undefined},{mode:null},{mode:{}},{mode:{active:EditMode.active}},{mode:{inactive:EditMode.inactive}},{noObservable:true},{noSetValue:true},{nullSetValue:true}]) {
    const old=runtime(options);old.seed();const tree=old.render()
    assert.equal(nodes(tree).some(n=>n.props?.environments?.editMode),false)
    const header=old.walk(section(tree,'登录账号').props.header)
    const native=nodes(header).filter(n=>n.type==='EditButton')
    const listMissing=options.noObservable||options.noSetValue||options.nullSetValue
    assert.equal(native.length,listMissing?0:1);if(native.length)assert.deepEqual(Object.keys(native[0].props),[])
    assert.equal(nodes(header).some(n=>n.type==='Button'||n.type==='Text'&&n.props.children==='排序'),false)
    if(!listMissing)modern.move(each(tree).props,[0],3)
    assert.deepEqual(ids(old.api.sortAccounts(old.api.officialAccounts(),'official')),listMissing?['antigravity:1','antigravity:2','antigravity:3']:['antigravity:2','antigravity:3','antigravity:1'])
    assert.equal(old.counts().fetches,0)
    if (options.noSetValue || options.nullSetValue) {
      const picker=nodes(old.render()).find(n=>n.type==='Picker'&&n.props.title==='账号来源')
      await picker.props.onChanged('parrot')
      assert.equal(old.counts().setValueCalls,0,'source reset safely skips unsupported notification API')
      assert.equal(nodes(old.flushUI()).some(n=>n.props?.environments?.editMode),false)
    }
  }
  for(const count of [0,1]) {const r=runtime();r.seed(count);const header=r.walk(section(r.render(),'登录账号').props.header);assert.equal(nodes(header).some(n=>n.type==='EditButton'||n.type==='Button'),false)}
  const old=runtime({noNative:true});old.seed();tree=old.render()
  assert.equal(nodes(tree).some(n=>n.type==='EditButton'||n.props?.environments?.editMode),false)
  assert.ok(nodes(tree).find(n=>n.type==='NavigationLink'&&n.props.destination.type===old.app.AccountOrderPage))
  const direct=runtime({directValueOnly:true});direct.seed()
  const original=assertOwnerScope(direct.render()), originalCounts=direct.counts()
  original.action.props.action()
  assert.equal(original.mode.value.isEditing,true,'1.61-style write really changes storage')
  assert.equal(direct.nativeValue(original.mode).isEditing,false,'but must NOT count as a native notification')
  assert.equal(direct.counts().stateUpdates,originalCounts.stateUpdates)
  assert.equal(assertOwnerScope(direct.flushUI()).action.props.title,'编辑排序','cached header remains unchanged without state refresh')
  assert.throws(()=>assertNotified(direct,originalCounts,original.mode,true),/must invoke setValue/)
  const title=runtime({noTitleState:true});title.seed()
  const titleOriginal=assertOwnerScope(title.render())
  titleOriginal.action.props.action()
  assert.equal(title.nativeValue(titleOriginal.mode).isEditing,true,'setValue alone notifies native binding')
  assert.equal(assertOwnerScope(title.flushUI()).action.props.title,'编辑排序','but no implicit header render is assumed')
  const failed=runtime({throwSetValue:true});failed.seed()
  assertOwnerScope(failed.render()).action.props.action()
  const failedTree=failed.flushUI()
  assert.equal(nodes(failedTree).some(n=>n.props?.environments?.editMode),false)
  assert.equal(nodes(failedTree).filter(n=>n.type==='EditButton').length,1,'sync notification failure falls back to real native control')
  const wrong=runtime({sectionOnly:true});wrong.seed();const wrongTree=wrong.render()
  const wrongRow=wrongTree.find(x=>x.node.type==='ForEach')
  assert.ok(wrongRow.inheritedMode,'negative control really does bind Section descendants')
  assert.equal(wrongRow.ownerMode,undefined,'but cannot configure its parent Form')
  assert.throws(()=>assertOwnerScope(wrongTree),/Form itself must receive/,'reject original 1.58 Section-only structure')
  console.log('PASS full production SettingsView: single 编辑排序/完成 Button -> global active/inactive; binding on Form owner and inherited by header/ForEach, not Section; modern native data reorder and reopened row order persist; active -> remote drops binding/resets state -> official inactive; missing APIs native fallback; negative Section-only/direct-value/no-title-state controls distinguished; setValue/native subscriptions + ordinary state verified; edit actions zero fetch, existing source-switch refresh requests intercepted offline. Native handles/taps still require device validation.')
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { runtime, nodes, section, assertOwnerScope, assertNotified }
