// Local simulation only; never contacts a network or reads real credentials.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
let now = 1800000000000, handler, calls = [], reads = []
const kc = new Map(), storage = new Map()
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
const modules = {}
const scripting = new Proxy({ Widget: { family: 'systemLarge', parameter: '' } }, { get(o,k) { return o[k] || k } })
const jsx = (type, props) => ({type, props})
const context = vm.createContext({ console, Date: Clock, Math, Map, Set, Promise,
  Keychain: { get(k) { reads.push(k); return kc.get(k) ?? null }, set(k,v) { kc.set(k,v); return true }, remove(k) { kc.delete(k); return true } },
  Storage: { get(k) { return storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : null }, set(k,v) { storage.set(k,JSON.parse(JSON.stringify(v))) }, remove(k) { storage.delete(k) } },
  Data: { fromBase64String(s) { return { toRawString: () => Buffer.from(s,'base64').toString() } } },
  fetch: async (url, options) => { calls.push({url,options}); return handler(url,options) }
})
function load(name) {
  if (modules[name]) return modules[name].exports
  const m = modules[name] = {exports:{}}
  let code = fs.readFileSync(name === 'baseline-widget.tsx' ? process.env.BASELINE_WIDGET_PATH : path.join(root,name),'utf8')
  if (name === 'widget.tsx' || name === 'baseline-widget.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root }')
  if (name === 'index.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { SettingsView }')
  const out = ts.transpileModule(code, { fileName:name, compilerOptions: {target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'}, reportDiagnostics:true })
  assert.equal((out.diagnostics || []).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,name+' syntax')
  const req = n => n === 'scripting' ? scripting : n === 'scripting/jsx-runtime' ? {jsx,jsxs:jsx,Fragment:'Fragment'} : load(n.replace('./','') + '.ts')
  vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`,context)(req,m,m.exports)
  return m.exports
}
const api = load('api.ts'), official = api
function resp(status,b={}) { return {status,json:async()=>b} }
function token(account='account-A',user='user-A',expires=now+3600000) {
  const payload = {sub:user,exp:Math.floor(expires/1000),'https://api.openai.com/auth':{chatgpt_account_id:account,chatgpt_user_id:user}}
  return 'mock.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.mock'
}
function authFlow(account='account-A', user='user-A') {
  handler = async (u,o) => {
    if(u.endsWith('/usercode')) return resp(200,{device_auth_id:'mock-device',usercode:'MOCK-CODE',interval:'5'})
    if(u.endsWith('/deviceauth/token')) return resp(200,{authorization_code:'mock-code',code_verifier:'mock-verifier'})
    if(u.endsWith('/oauth/token')) { assert.equal(o.headers['Content-Type'],'application/x-www-form-urlencoded'); assert.equal(new URLSearchParams(o.body).get('redirect_uri'),'https://auth.openai.com/deviceauth/callback'); return resp(200,{access_token:token(account,user),refresh_token:'mock-refresh'}) }
    throw new Error('Unexpected URL')
  }
}
async function main() {
  // Namespace isolation, numeric parameters and existing Parrot config preservation.
  kc.set('parrot_management_key','mock-management'); kc.set('parrot_base_url','mock-base')
  api.saveSelectedAccounts(['parrot-account']); api.saveRefreshMinutes(30)
  api.saveSource('official'); assert.equal(api.getSelectedAccounts(),null)
  api.saveSelectedAccounts(['official-account']); api.saveSource('parrot')
  assert.equal(api.getSelectedAccounts()[0],'parrot-account'); assert.equal(api.getRefreshMinutes(),30)
  assert.deepEqual(Array.from(api.widgetAccounts([{id:'a'},{id:'b'},{id:'c'}], '3，1 3 0 x').map(a=>a.id)),['c','a'])
  // Stable-ID sorting is independent by source, selection order is NOT display order.
  const list=[{id:'a',enabled:true},{id:'b',enabled:false},{id:'c',enabled:true},{id:'d',enabled:true},{id:'e',enabled:true}]
  api.saveAccountOrder(['c','a','b']); api.saveSelectedAccounts(['b','a','c'])
  assert.deepEqual(Array.from(api.widgetAccounts(list).map(a=>a.id)),['c','a','b'])
  assert.deepEqual(Array.from(api.widgetAccounts(list,'3,1').map(a=>a.id)),['b','c'])
  assert.deepEqual(Array.from(api.sortAccounts(list).map(a=>a.id)),['c','a','b','d','e'])
  assert.deepEqual(Array.from(api.sortAccounts(list.filter(a=>a.id!=='a')).map(a=>a.id)),['c','b','d','e'])
  api.saveSource('official'); api.saveAccountOrder(['a','c','b'])
  assert.deepEqual(Array.from(api.sortAccounts(list).map(a=>a.id)),['a','c','b','d','e'])
  api.saveSource('parrot'); assert.deepEqual(Array.from(api.sortAccounts(list).map(a=>a.id)),['c','a','b','d','e'])
  storage.delete('ai_usage_selected_accounts_v1')
  assert.deepEqual(Array.from(api.widgetAccounts(list).map(a=>a.id)),['c','a','d','e'])
  api.saveSelectedAccounts(['parrot-account'])
  api.saveSource('official')
  authFlow(); const d = await official.beginDeviceLogin()
  assert.equal(d.interval,5000)
  handler=async()=>resp(403); assert.equal(await official.checkDeviceLogin(d),'pending')
  const count=calls.length; assert.equal(await official.checkDeviceLogin(d),'pending'); assert.equal(calls.length,count)
  now+=5000; handler=async()=>resp(404); assert.equal(await official.checkDeviceLogin(d),'pending')
  d.expiresAt=now; await assert.rejects(()=>official.checkDeviceLogin(d),/过期/)
  authFlow(); const cancelled=await official.beginDeviceLogin(); official.cancelDeviceLogin(cancelled)
  await assert.rejects(()=>official.checkDeviceLogin(cancelled),/取消/)
  authFlow(); const inflight=await official.beginDeviceLogin(); let resolve
  handler=()=>new Promise(r=>resolve=r); const pending=official.checkDeviceLogin(inflight)
  official.cancelDeviceLogin(inflight); resolve(resp(200,{authorization_code:'unused',code_verifier:'unused'}))
  await assert.rejects(()=>pending,/取消/); assert.equal(official.officialAccounts().length,0)
  authFlow(); const success=await official.beginDeviceLogin(); assert.equal(await official.checkDeviceLogin(success),'complete')
  const first=official.officialAccounts()[0]; assert.equal(first.name,'官方账号 1'); assert.ok(!JSON.stringify(storage).includes('mock-refresh'))
  await assert.rejects(()=>official.checkDeviceLogin(success),/取消/)
  authFlow(); await official.checkDeviceLogin(await official.beginDeviceLogin()); assert.equal(official.officialAccounts().length,1)
  authFlow('account-B','user-B'); await official.checkDeviceLogin(await official.beginDeviceLogin()); assert.equal(official.officialAccounts().length,2)
  // Map by duration even when swapped; keep custom/monthly and missing metrics unknown.
  const usage={rate_limit:{primary_window:{used_percent:25,limit_window_seconds:604800,reset_at:now/1000+700},secondary_window:{used_percent:70,limit_window_seconds:18000,reset_after_seconds:100}},rate_limit_reset_credits:{available_count:12}}
  const mapped=official.mapOfficialUsage(usage); assert.equal(mapped.fiveHour.remainingPercent,30); assert.equal(mapped.sevenDay.remainingPercent,75); assert.equal(mapped.resetCredits,12)
  assert.equal(mapped.fiveHour.resetsAt,new Date(now+100000).toISOString())
  const monthly=official.mapOfficialUsage({rate_limit:{primary_window:{used_percent:30,limit_window_seconds:2592000}}})
  assert.equal(monthly.fiveHour.remainingPercent,null); assert.equal(monthly.sevenDay.remainingPercent,null)
  assert.equal(official.mapOfficialUsage({rate_limit:{primary_window:{used_percent:0}}}).fiveHour.remainingPercent,100)
  for(const b of [{},{available_count:-1},{available_count:'2'},{credits:new Array(10).fill({})}]) assert.equal(official.resetCount(b),null)
  assert.equal(official.resetCount({available_count:0}),0)
  // Force expiry and verify rotated refresh persistence. GET must only target official hosts.
  const raw=JSON.parse(kc.get('ai_usage_official_oauth_v1')); raw[0].expiresAt=now; kc.set('ai_usage_official_oauth_v1',JSON.stringify(raw)); reads=[]
  let refreshes=0
  handler=async(u,o)=>{
    if(u.endsWith('/oauth/token')) { refreshes++; assert.equal(JSON.parse(o.body).grant_type,'refresh_token'); return resp(200,{access_token:token(),refresh_token:'mock-rotated'}) }
    assert.ok(u.startsWith('https://chatgpt.com/backend-api/wham/'))
    assert.ok(o.headers.Authorization.startsWith('Bearer ')); assert.ok(o.headers['ChatGPT-Account-ID'])
    return resp(200,usage)
  }
  api.saveAccountOrder([official.officialAccounts()[1].id,first.id,'removed-id'])
  let result=await api.loadUsage();
  assert.equal(result.data.accounts[0].id,official.officialAccounts()[1].id)
  assert.ok(!storage.get('ai_usage_official_order_v1').includes('removed-id'))
   assert.equal(result.stale,false); assert.equal(result.data.today,null); assert.equal(result.data.month,null); assert.equal(refreshes,1)
  assert.equal(JSON.parse(kc.get('ai_usage_official_oauth_v1'))[0].refresh,'mock-rotated')
  assert.ok(reads.every(k=>!k.startsWith('parrot_')))
  // 401 recovery once and absent refresh-token replacement retention.
  let denied=false; refreshes=0
  handler=async(u,o)=>{ if(u.endsWith('/oauth/token')) {refreshes++;return resp(200,{access_token:token()})} if(!denied){denied=true;return resp(401)}return resp(200,usage) }
  result=await official.loadOfficialUsage(); assert.equal(result.stale,false); assert.equal(refreshes,1)
  assert.equal(JSON.parse(kc.get('ai_usage_official_oauth_v1'))[0].refresh,'mock-rotated')
  // Optional reset-card GET supplies authoritative count, not length (endpoint caps details).
  handler=async u=>u.endsWith('/usage')?resp(200,{rate_limit:usage.rate_limit}):resp(200,{available_count:20,credits:new Array(10).fill({})})
  result=await official.loadOfficialUsage(); assert.equal(result.data.accounts[0].resetCredits,20)
  handler=async u=>u.endsWith('/usage')?resp(200,{rate_limit:usage.rate_limit}):resp(404)
  result=await official.loadOfficialUsage(); assert.equal(result.data.accounts[0].resetCredits,null)
  handler=async()=>resp(500,{error:'private-secret'}); result=await official.loadOfficialUsage(); assert.equal(result.stale,true); assert.ok(!result.error.includes('private-secret'))
  handler=async()=>resp(401); result=await official.loadOfficialUsage(); assert.equal(result.stale,true); assert.match(result.error,/登录已失效/)
  // Logout only this account; caches/selection can't retain it; Parrot untouched.
  api.saveSelectedAccounts(official.officialAccounts().map(a=>a.id)); official.logoutOfficial(first.id)
  assert.equal(official.officialAccounts().length,1); assert.ok(!official.officialCached().accounts.some(a=>a.id===first.id)); assert.ok(!api.getSelectedAccounts().includes(first.id))
  assert.equal(kc.get('parrot_management_key'),'mock-management'); api.saveSource('parrot'); assert.equal(api.getSelectedAccounts()[0],'parrot-account')
  // JSX tree simulation verifies official stats not rendered as zero and unchanged family geometry.
  const {Root}=load('widget.tsx')
  function expand(n) { if(n==null)return [];if(Array.isArray(n))return n.flatMap(expand);if(typeof n!=='object')return [n];if(typeof n.type==='function')return expand(n.type(n.props));return [n,...expand(n.props?.children)] }
  const accounts=Array.from({length:4},(_,i)=>({id:'p'+i,name:'匿名'+i,provider:'openai',enabled:true,available:true,...mapped}))
  api.saveSelectedAccounts(accounts.map(a=>a.id))
  const data={today:null,month:null,accounts,fetchedAt:now,todayByFamily:{},monthByFamily:{}}
  for (const family of ['systemSmall','systemMedium','systemLarge']) {
    scripting.Widget.family=family
    const tree=expand(Root({data,stale:false,error:null})), texts=tree.filter(x=>typeof x==='string')
    assert.ok(texts.includes(new Date(now).getHours().toString().padStart(2,'0')+':'+new Date(now).getMinutes().toString().padStart(2,'0')))
    assert.equal(texts.filter(x=>x==='Codex').length,family==='systemSmall'?2:4)
    if(family==='systemLarge'){
      assert.ok(texts.includes('官方未提供今日/本月Token与花费'));assert.ok(!texts.includes('$0.00'))
      const labels=tree.filter(x=>x.type==='HStack' && x.props.spacing===1 && Array.isArray(x.props.children) && x.props.children[0]?.props?.frame?.width===20)
      assert.equal(labels.length,8);assert.ok(labels.every(x=>x.props.children[1].props.frame.width===65))
    }
  }
  // Original Parrot managementKey grant and actual toMetric total, then six-column JSX.
  api.saveSource('parrot')
  handler=async(u,o)=>{
    assert.ok(u.startsWith('mock-base/api/management/v1/'))
    if(u.endsWith('/auth/sessions')){assert.equal(JSON.parse(o.body).grantType,'managementKey');return resp(201,{data:{credential:'mock-session'}})}
    if(u.includes('/stats/summary'))return resp(200,{data:{overall:{inputTokens:100,outputTokens:200,cacheReadTokens:30,cacheCreationTokens:40,total:5,costTicks:1000000000}}})
    if(u.includes('/oauth/accounts?pageSize'))return resp(200,{data:{items:[{accountId:'parrot-account',enabled:true,provider:'openai',displayName:'mock-name',available:true}]}})
    return resp(200,{data:{usageWindows:[],resetCreditCount:0}})
  }
  result=await api.loadUsage(); assert.equal(result.stale,false);assert.equal(result.data.today.totalTokens,370)
  api.saveSelectedAccounts(result.data.accounts.map(a=>a.id))
  const parrotTree=expand(Root({data:result.data,stale:false,error:null}))
  const labels=parrotTree.filter(x=>x.type==='LazyVGrid' && Array.isArray(x.props.children) && x.props.children.length===6)
  assert.equal(labels.length,2)
  assert.equal(labels[0].props.columns,labels[1].props.columns) // exact shared definition, not independent content sizing
  for(const row of labels) {
    assert.equal(row.props.alignment,'leading');assert.equal(row.props.frame.alignment,'leading')
    assert.equal(row.props.columns.length,6)
    for(const col of row.props.columns){assert.equal(col.size.type,'flexible');assert.equal(col.size.min,0);assert.equal(col.size.max,'infinity');assert.equal(col.spacing,4);assert.equal(col.alignment,'leading')}
    for(const cell of row.props.children){assert.equal(cell.props.alignment,'leading');assert.equal(cell.props.frame.alignment,'leading');assert.equal(cell.props.spacing,1);assert.equal(cell.props.children[0].props.font,9);assert.equal(cell.props.children[1].props.font,12)}
  }
  // Deliberately different string widths must not alter shared column tracks.
  const varied={...result.data,month:{...result.data.month,inputTokens:987654321,outputTokens:1,cacheReadTokens:70000000,costUsd:1234.56,totalTokens:1057654322}}
  const variedRows=expand(Root({data:varied,stale:false,error:null})).filter(x=>x.type==='LazyVGrid')
  assert.equal(variedRows[0].props.columns,variedRows[1].props.columns)
  assert.notEqual(variedRows[0].props.children[0].props.children[1].props.children,variedRows[1].props.children[0].props.children[1].props.children)
  for(const family of ['systemSmall','systemMedium','systemLarge']) {
    scripting.Widget.family=family
    for(const stale of [false,true]) {
      const images=expand(Root({data:result.data,stale,error:null})).filter(x=>x.type==='Image')
      const icon=images.find(x=>x.props.systemName===(stale?'wifi.slash':'arrow.triangle.2.circlepath'))
      assert.ok(icon);assert.equal(icon.props.font,8);assert.ok(!images.some(x=>x.props.systemName==='arrow.clockwise'))
    }
  }
  // Small stats are conditional on the final selection (also numeric parameters).
  scripting.Widget.family='systemSmall'
  scripting.Widget.parameter='1'
  const singleData={...result.data,accounts,month:varied.month}
  const single=expand(Root({data:singleData,stale:false,error:null}))
  const smallRows=single.filter(x=>x.type==='LazyVGrid')
  assert.equal(smallRows.length,2);assert.equal(smallRows[0].props.columns,smallRows[1].props.columns)
  for(const row of smallRows){
    assert.equal(row.props.columns.length,4);assert.equal(row.props.alignment,'leading')
    assert.deepEqual(Array.from(row.props.children,x=>x.props.children[0].props.children),['缓存','缓存率','Token','花费'])
    for(const col of row.props.columns){assert.equal(col.size.type,'flexible');assert.equal(col.size.min,0);assert.equal(col.spacing,2);assert.equal(col.alignment,'leading')}
    for(const cell of row.props.children){assert.equal(cell.props.frame.alignment,'leading');assert.equal(cell.props.children[0].props.font,7);assert.equal(cell.props.children[1].props.font,9)}
  }
  assert.deepEqual(Array.from(smallRows[0].props.children,x=>x.props.children[1].props.children),['70','17.6%','370','$0.1'])
  assert.equal(smallRows[1].props.children[3].props.children[1].props.children,'$1234.6')
  const singleTexts=single.filter(x=>typeof x==='string')
  assert.equal(singleTexts.filter(x=>x==='Codex').length,1);assert.ok(singleTexts.includes('5 h'));assert.ok(singleTexts.includes('每周'))
  assert.ok(single.some(x=>x.type==='Image'&&x.props.systemName==='arrow.triangle.2.circlepath'))
  const missing=expand(Root({data:{...singleData,today:null,month:null},stale:false,error:null}))
  assert.ok(missing.some(x=>x==='今日/本月统计未提供'));assert.ok(!missing.some(x=>x.type==='LazyVGrid'));assert.ok(!missing.some(x=>x==='$0.0'))
  scripting.Widget.parameter='1,2'
  const double=expand(Root({data:singleData,stale:false,error:null}))
  assert.ok(!double.some(x=>x.type==='LazyVGrid'));assert.ok(!double.some(x=>x==='今日'||x==='本月'))
  assert.equal(double.filter(x=>x==='Codex').length,2)
  // Optional direct comparison with the real pre-change 1.7.2 widget (no fixture copied into project).
  if(process.env.BASELINE_WIDGET_PATH){
    const baseline=load('baseline-widget.tsx').Root
    for(const family of ['systemSmall','systemMedium','systemLarge']){
      scripting.Widget.family=family
      const current=expand(Root({data:singleData,stale:false,error:null}))
      const previous=expand(baseline({data:singleData,stale:false,error:null}))
      assert.equal(JSON.stringify(current),JSON.stringify(previous),family+' unchanged 1.7.2 tree')
    }
    console.log('PASS: exact 1.7.2 tree comparison: Small two-account, Medium, Large')
  }
  scripting.Widget.parameter=''
  scripting.Widget.family='systemLarge'
  for(const row of labels){assert.deepEqual(Array.from(row.props.children,x=>x.props.children[0].props.children),['输入','输出','缓存','缓存率','Token','估算花费']);assert.equal(row.props.children[4].props.children[1].props.children,'370');assert.ok(row.props.children.every(x=>x.props.children.every(t=>t.props.lineLimit===1)))}
  // Exercise App sorting controls with persistent mock hook state, not only the data helper.
  const states=[];let hook=0
  scripting.useState=initial=>{const i=hook++;if(!(i in states))states[i]=initial;return [states[i],next=>states[i]=typeof next==='function'?next(states[i]):next]}
  scripting.useEffect=()=>{}
  scripting.Navigation={useDismiss:()=>()=>{}}
  scripting.Widget.reloadAll=async()=>{}
  storage.set('ai_usage_cache_v1',{...data,accounts})
  api.saveAccountOrder(accounts.map(a=>a.id));api.saveSelectedAccounts([accounts[3].id,accounts[0].id])
  const {SettingsView}=load('index.tsx')
  const render=()=>{hook=0;return expand(SettingsView())}
  let ui=render();let toggles=ui.filter(x=>x.type==='Toggle')
  assert.ok(toggles[0].props.title.startsWith('1.'));assert.equal(toggles[0].props.value,true)
  assert.ok(!ui.some(x=>x.type==='Button'&&['上移','下移'].includes(x.props.title)))
  context.ItemProvider={fromText:text=>({loadText:async()=>text})}
  const rows=()=>render().filter(x=>x.props?.onDrag)
  let dragRows=rows(); const provider=dragRows[0].props.onDrag.data()
  const before=JSON.stringify(storage.get('ai_usage_parrot_order_v1'))
  assert.equal(dragRows[2].props.onDrop.dropUpdated(),'move')
  assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),before) // cancelled drag: no writes
  async function drop(row,p) {
    let inScope=false,started=false
    const info={itemProviders:types=>{assert.equal(inScope,true);assert.equal(types[0],'public.plain-text');return [{loadText:()=>{assert.equal(inScope,true);started=true;return p.loadText()}}]}}
    inScope=true;assert.equal(row.props.onDrop.performDrop(info),true);inScope=false
    assert.equal(started,true);await new Promise(r=>setImmediate(r))
  }
  await drop(dragRows[2],provider)
  assert.deepEqual(Array.from(api.cachedAccounts(),a=>a.id),['p1','p2','p0','p3'])
  toggles=render().filter(x=>x.type==='Toggle');assert.ok(toggles[2].props.title.startsWith('3.'));assert.ok(toggles[2].props.title.includes('匿名0'))
  assert.deepEqual(Array.from(api.widgetAccounts(accounts),a=>a.id),['p0','p3'])
  assert.deepEqual(Array.from(api.widgetAccounts(accounts,'3,1'),a=>a.id),['p0','p1'])
  dragRows=rows();await drop(dragRows[0],dragRows[3].props.onDrag.data()) // upward
  assert.deepEqual(Array.from(api.cachedAccounts(),a=>a.id),['p3','p1','p2','p0'])
  const order=JSON.stringify(storage.get('ai_usage_parrot_order_v1'))
  dragRows=rows();await drop(dragRows[0],dragRows[0].props.onDrag.data());assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),order)
  await drop(dragRows[0],{loadText:async()=>'{"session":"external","id":"p0","source":"parrot"}'});assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),order)
  await drop(dragRows[0],{loadText:async()=>'{broken'});assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),order)
  let resolveDrag
  const delayed={loadText:()=>new Promise(r=>resolveDrag=r)}
  assert.equal(dragRows[0].props.onDrop.performDrop({itemProviders:()=>[delayed]}),true)
  api.saveSource('official');resolveDrag(await dragRows[3].props.onDrag.data().loadText());await new Promise(r=>setImmediate(r))
  assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),order)
  assert.equal(dragRows[0].props.onDrop.validateDrop(),false);assert.equal(dragRows[0].props.onDrop.dropUpdated(),'forbidden')
  assert.equal(dragRows[0].props.onDrop.performDrop({itemProviders:()=>{throw Error('must not load')}}),false)
  api.saveSource('parrot')
  for(const [n,s] of [[1.15,'$1.2'],[12.34,'$12.3'],[12.35,'$12.4'],[0.05,'$0.1'],[0,'$0.0'],[1234.56,'$1234.6']])assert.equal(api.fmtUsd(n),s)
  assert.equal(api.VERSION,'1.7.3')
  // Syntax-only compilation of settings, plus version/updater integration.
  const index=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
  assert.equal(ts.transpileModule(index,{fileName:'index.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true}).diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
  assert.ok(index.includes('const FILES = ["api.ts", "widget.tsx", "index.tsx"]')); assert.ok(!index.includes('from "./official"')); assert.ok(index.includes('const VERSION = "'+JSON.parse(fs.readFileSync(path.join(root,'script.json'))).version+'"'))
  console.log('PASS: device pending/throttle/expired/cancel/in-flight cancel/success/dedup; refresh/401/rotation; duration mapping/reset cards; source isolation/logout; 3 widget trees; syntax/version/old updater; stable-ID sorting/selection/parameters/pruning; large label gap/six stat columns; Parrot grant/total; native drag/drop scope/up/down/cancel/self/invalid/cross-source; one-decimal rounding; shared 6 equal grid columns/leading alignment; dual-arrow refresh icon in 3 families; Small one-account 4 stats/shared columns/summary scope; Small two-account no stats; official missing')
}
main().catch(e=>{console.error(e);process.exitCode=1})
