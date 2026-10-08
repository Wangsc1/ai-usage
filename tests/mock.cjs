// Local simulation only; never contacts a network or reads real credentials.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
let now = 1800000000000, handler, calls = [], reads = []
const kc = new Map(), storage = new Map(), storageWrites = []
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
const modules = {}
const scripting = new Proxy({ Widget: { family: 'systemLarge', parameter: '' } }, { get(o,k) { return o[k] || k } })
const jsx = (type, props) => ({type, props})
const context = vm.createContext({ console, Date: Clock, Math, Map, Set, Promise,
  Keychain: { get(k) { reads.push(k); return kc.get(k) ?? null }, set(k,v) { kc.set(k,v); return true }, remove(k) { kc.delete(k); return true } },
  Storage: { get(k) { return storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : null }, set(k,v) { storageWrites.push(k); storage.set(k,JSON.parse(JSON.stringify(v))) }, remove(k) { storage.delete(k) } },
  Data: { fromBase64String(s) { return { toRawString: () => Buffer.from(s,'base64').toString() } } },
  fetch: async (url, options) => { calls.push({url,options}); return handler(url,options) }
})
function load(name) {
  if (modules[name]) return modules[name].exports
  const m = modules[name] = {exports:{}}
  let code = fs.readFileSync(name === 'baseline-widget.tsx' ? process.env.BASELINE_WIDGET_PATH : path.join(root,name),'utf8')
  if (name === 'widget.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root, PeriodStats, statsWidthBudget }')
  if (name === 'baseline-widget.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root }')
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
  storage.set('ai_usage_selected_accounts_v1',['parrot-account']); api.saveRefreshMinutes(30)
  storage.set('ai_usage_official_selected_v1',['official-account']); api.saveSource('parrot')
  assert.equal(api.getRefreshMinutes(),30)
  assert.deepEqual(Array.from(api.widgetAccounts([{id:'a'},{id:'b'},{id:'c'}], '3，1 3 0 x').map(a=>a.id)),['c','a'])
  // Stable-ID ordering is independent by source; every legacy selected-ID value is ignored.
  const list=[{id:'a',enabled:true},{id:'b',enabled:false},{id:'c',enabled:true},{id:'d',enabled:true},{id:'e',enabled:true}]
  api.saveAccountOrder(['c','a','b'])
  for(const legacy of [[],['e'],['b','a','c'],['removed-id']]) {
    storage.set('ai_usage_selected_accounts_v1',legacy)
    assert.deepEqual(Array.from(api.widgetAccounts(list).map(a=>a.id)),['c','a','b','d'])
  }
  assert.deepEqual(Array.from(api.widgetAccounts(list,'3,1').map(a=>a.id)),['b','c'])
  assert.deepEqual(Array.from(api.sortAccounts(list).map(a=>a.id)),['c','a','b','d','e'])
  assert.deepEqual(Array.from(api.sortAccounts(list.filter(a=>a.id!=='a')).map(a=>a.id)),['c','b','d','e'])
  api.saveSource('official'); api.saveAccountOrder(['a','c','b'])
  assert.deepEqual(Array.from(api.sortAccounts(list).map(a=>a.id)),['a','c','b','d','e'])
  for(const legacy of [[],['e']]) {
    storage.set('ai_usage_official_selected_v1',legacy)
    assert.deepEqual(Array.from(api.widgetAccounts(list).map(a=>a.id)),['a','c','b','d'])
  }
  api.saveSource('parrot'); assert.deepEqual(Array.from(api.sortAccounts(list).map(a=>a.id)),['c','a','b','d','e'])
  storage.delete('ai_usage_selected_accounts_v1')
  assert.deepEqual(Array.from(api.widgetAccounts(list).map(a=>a.id)),['c','a','b','d'])
  storage.set('ai_usage_selected_accounts_v1',['parrot-account'])
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
  // Logout only this account; cache/order pruned, obsolete selected IDs untouched and ignored.
  const legacyOfficial=[first.id]; storage.set('ai_usage_official_selected_v1',legacyOfficial); official.logoutOfficial(first.id)
  assert.equal(official.officialAccounts().length,1); assert.ok(!official.officialCached().accounts.some(a=>a.id===first.id)); assert.ok(!storage.get('ai_usage_official_order_v1').includes(first.id))
  assert.equal(storage.get('ai_usage_official_selected_v1'),legacyOfficial)
  assert.ok(!api.widgetAccounts(official.officialCached().accounts).some(a=>a.id===first.id))
  assert.equal(kc.get('parrot_management_key'),'mock-management'); api.saveSource('parrot'); assert.equal(storage.get('ai_usage_selected_accounts_v1')[0],'parrot-account')
  // JSX tree simulation verifies official stats not rendered as zero and unchanged family geometry.
  const {Root,PeriodStats,statsWidthBudget}=load('widget.tsx')
  let proposedStatsWidth=null
  function expand(n) { if(n==null)return [];if(Array.isArray(n))return n.flatMap(expand);if(typeof n!=='object')return [n];if(typeof n.type==='function')return expand(n.type(n.props));if(n.type==='GeometryReader')return [n,...expand(n.props.children({size:{width:proposedStatsWidth??(scripting.Widget.family==='systemSmall'?130:330),height:n.props.frame.height}}))];return [n,...expand(n.props?.children)] }
  const accounts=Array.from({length:4},(_,i)=>({id:'p'+i,name:'匿名'+i,provider:'openai',enabled:i!==0,available:true,...mapped}))
  const data={today:null,month:null,accounts,fetchedAt:now,todayByFamily:{},monthByFamily:{}}
  for (const family of ['systemSmall','systemMedium','systemLarge']) {
    scripting.Widget.family=family
    const tree=expand(Root({data,stale:false,error:null})), texts=tree.filter(x=>typeof x==='string')
    assert.ok(texts.includes(new Date(now).getHours().toString().padStart(2,'0')+':'+new Date(now).getMinutes().toString().padStart(2,'0')))
    assert.equal(texts.filter(x=>x==='Codex').length,family==='systemSmall'?2:4)
    assert.ok(!texts.some(x=>x.includes('已停用')));assert.ok(texts.includes('匿名0'))
    const fullList={...data,accounts:[...accounts,{...accounts[1],id:'p4',name:'末尾第五'}]}
    const allTexts=expand(Root({data:fullList,stale:false,error:null})).filter(x=>typeof x==='string')
    assert.ok(!allTexts.includes('末尾第五'))
    for(let i=0;i<(family==='systemSmall'?2:4);i++)assert.ok(allTexts.includes('匿名'+i))
    if(family==='systemSmall')assert.ok(!allTexts.includes('匿名2'))
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
  const parrotTree=expand(Root({data:result.data,stale:false,error:null}))
  function checkStatsLayout(tree,count,labelFont,valueFont,gap,verticalGap){
    const readers=tree.filter(x=>x.type==='GeometryReader');assert.equal(readers.length,1)
    assert.equal(readers[0].props.frame.height,4*Math.ceil(labelFont*1.2)+2*Math.ceil(valueFont*1.2)+3*verticalGap+2)
    assert.ok(!tree.some(x=>x.type==='Grid'||x.type==='GridRow'))
    const row=tree.find(x=>x.type==='HStack'&&x.props.spacing===0&&x.props.children?.length===count*2-1)
    assert.ok(row);assert.equal(row.props.frame.alignment,'leading');assert.equal(row.props.alignment,'top')
    const cells=Array.from(row.props.children);assert.equal(cells[0].type,'VStack');assert.equal(cells.at(-1).type,'VStack')
    const columns=cells.filter(x=>x.type==='VStack')
    const scale=columns[0].props.children[0].props.children[0].props.font/labelFont
    assert.ok(scale>0&&scale<=1)
    for(let i=0;i<cells.length;i++){
      const cell=cells[i]
      if(i%2){assert.equal(cell.type,'Spacer');assert.ok(Math.abs(cell.props.frame.minWidth-gap*scale)<1e-9);assert.equal(cell.props.frame.maxWidth,'infinity')}
      else {
        assert.equal(cell.props.alignment,'leading');assert.equal(cell.props.spacing,verticalGap)
        assert.equal(cell.props.fixedSize.horizontal,true);assert.equal(cell.props.fixedSize.vertical,true)
        assert.equal(cell.props.frame,undefined);assert.equal(cell.props.children.length,2)
        for(let p=0;p<2;p++){
          const group=cell.props.children[p];assert.equal(group.props.alignment,'leading');assert.equal(group.props.spacing,verticalGap)
          const [heading,stat]=group.props.children
          assert.equal(heading.props.children,p?'本月':'今日');assert.equal(heading.props.opacity,i===0?1:0)
          assert.equal(stat.props.alignment,'leading');assert.equal(stat.props.spacing,1)
          const texts=[heading,...stat.props.children]
          for(const t of texts){assert.equal(t.props.fixedSize.horizontal,true);assert.equal(t.props.fixedSize.vertical,true);assert.equal(t.props.lineLimit,1);assert.equal(t.props.minScaleFactor,undefined)}
          assert.ok(Math.abs(heading.props.font-labelFont*scale)<1e-9);assert.ok(Math.abs(stat.props.children[0].props.font-labelFont*scale)<1e-9)
          assert.ok(Math.abs(stat.props.children[1].props.font-valueFont*scale)<1e-9)
        }
      }
    }
    return [0,1].map(p=>({props:{children:columns.map(col=>col.props.children[p].props.children[1])}}))
  }
  // Screenshot-sized examples, including longer month values. These are width-model checks, not native glyph measurements.
  const exampleToday=['4.4M','275.1K','80.7M','93.2%','85.4M','$31.3']
  const exampleMonth=['26.4M','1.3M','440M','91.1%','468M','$199.9']
  const exampleLabels=['输入','输出','缓存','缓存率','Token','估算花费']
  const exampleColumns=exampleLabels.map((label,i)=>({label,today:exampleToday[i],month:exampleMonth[i]}))
  for(const [indexes,lf,vf,gap,vg,widths] of [[[0,1,2,3,4,5],9,12,4,6,[330,300]],[[2,3,4,5],7,9,2,2,[130,120]]]){
    const cols=indexes.map(i=>({...exampleColumns[i],label:i===5&&indexes.length===4?'花费':exampleColumns[i].label}))
    for(const width of widths){
      const budget=statsWidthBudget(cols,lf,vf,gap,width)
      assert.ok(budget.fitted<=width+1e-9);assert.ok(budget.scale>0.7&&budget.scale<=1)
      const rescaled=statsWidthBudget(cols,lf*budget.scale,vf*budget.scale,gap*budget.scale,width)
      assert.ok(rescaled.natural<=width+1e-9)
      proposedStatsWidth=width
      const tree=expand(PeriodStats({columns:cols,labelFont:lf,valueFont:vf,gap,verticalGap:vg}))
      const rows=checkStatsLayout(tree,cols.length,lf,vf,gap,vg)
      for(let p=0;p<2;p++)assert.deepEqual(Array.from(rows[p].props.children,x=>x.props.children[1].props.children),cols.map(c=>c[p?'month':'today']))
      assert.ok(!tree.some(x=>typeof x==='string'&&(x.includes('...')||x.includes('…'))))
      console.log(`MODEL: ${cols.length} columns, width=${width}, budget=${budget.natural.toFixed(2)}, shared scale=${budget.scale.toFixed(3)}, fitted=${budget.fitted.toFixed(2)}`)
    }
  }
  proposedStatsWidth=null
  const labels=checkStatsLayout(parrotTree,6,9,12,4,6)
  // Each uncompressed column owns both periods; a shared factor fits the measured container width.
  const varied={...result.data,month:{...result.data.month,inputTokens:987654321,outputTokens:1,cacheReadTokens:70000000,costUsd:1234.56,totalTokens:1057654322}}
  const variedRows=checkStatsLayout(expand(Root({data:varied,stale:false,error:null})),6,9,12,4,6)
  assert.notEqual(variedRows[0].props.children[0].props.children[1].props.children,variedRows[1].props.children[0].props.children[1].props.children)
  for(const family of ['systemSmall','systemMedium','systemLarge']) {
    scripting.Widget.family=family
    for(const stale of [false,true]) {
      const images=expand(Root({data:result.data,stale,error:null})).filter(x=>x.type==='Image')
      const icon=images.find(x=>x.props.systemName===(stale?'wifi.slash':'arrow.triangle.2.circlepath'))
      assert.ok(icon);assert.equal(icon.props.font,8);assert.ok(!images.some(x=>x.props.systemName==='arrow.clockwise'))
    }
  }
  // Provider title AND explicit SVG fill respect enabled, never infer disabled from 0%/available/stale.
  const gray={light:'#5E6068',dark:'#8E8E93'}, normal={light:'#1C1C1E',dark:'#FFFFFF'}
  const statusAccounts=Array.from({length:4},(_,i)=>({...accounts[1],id:'status'+i,provider:i%2?'openai':'claude',name:'状态'+i,enabled:i>=2,available:false,
    fiveHour:{usedPercent:100,remainingPercent:0,resetsAt:null},sevenDay:{usedPercent:100,remainingPercent:0,resetsAt:null}}))
  for(const family of ['systemSmall','systemMedium','systemLarge']){
    scripting.Widget.family=family
    for(let i=0;i<statusAccounts.length;i++){
      scripting.Widget.parameter=String(i+1)
      for(const stale of [false,true]){
        const statusTree=expand(Root({data:{...data,accounts:statusAccounts},stale,error:stale?'network failed':null}))
        const a=statusAccounts[i], title=statusTree.find(x=>x.type==='Text'&&x.props.fontWeight==='semibold'&&x.props.children===(a.provider==='claude'?'Claude':'Codex'))
        assert.ok(title);assert.equal(JSON.stringify(title.props.foregroundStyle),JSON.stringify(a.enabled?normal:gray))
        const brand=statusTree.find(x=>x.type==='SVG'&&(typeof x.props.code==='string'?x.props.code:x.props.code?.light)?.includes('<path '))
        assert.ok(brand)
        if(!a.enabled){assert.ok(brand.props.code.light.includes('fill="'+gray.light+'"'));assert.ok(brand.props.code.dark.includes('fill="'+gray.dark+'"'))}
        else if(a.provider==='claude'){assert.ok(brand.props.code.includes('fill="#D97757"'))}
        else{assert.ok(brand.props.code.light.includes('fill="#1C1C1E"'));assert.ok(brand.props.code.dark.includes('fill="#FFFFFF"'))}
        assert.ok(!statusTree.some(x=>typeof x==='string'&&x.includes('已停用')))
        // The same exhausted windows keep their quota colors/bars, irrespective of disabled title treatment.
        const quota=JSON.stringify(statusTree.filter(x=>x.type==='RoundedRectangle'||(x.type==='SVG'&&!(typeof x.props.code==='string'?x.props.code:x.props.code?.light)?.includes('<path '))))
        const enabledTree=expand(Root({data:{...data,accounts:statusAccounts.map(b=>({...b,enabled:true}))},stale,error:null}))
        const enabledQuota=JSON.stringify(enabledTree.filter(x=>x.type==='RoundedRectangle'||(x.type==='SVG'&&!(typeof x.props.code==='string'?x.props.code:x.props.code?.light)?.includes('<path '))))
        assert.equal(quota,enabledQuota)
      }
    }
  }
  scripting.Widget.parameter=''
  // Small stats are conditional on the final selection (also numeric parameters).
  scripting.Widget.family='systemSmall'
  scripting.Widget.parameter='1'
  const singleData={...result.data,accounts,month:varied.month}
  const single=expand(Root({data:singleData,stale:false,error:null}))
  const smallRows=checkStatsLayout(single,4,7,9,2,2)
  for(const row of smallRows)assert.deepEqual(Array.from(row.props.children,x=>x.props.children[0].props.children),['缓存','缓存率','Token','花费'])
  assert.deepEqual(Array.from(smallRows[0].props.children,x=>x.props.children[1].props.children),['70','17.6%','370','$0.1'])
  assert.equal(smallRows[1].props.children[3].props.children[1].props.children,'$1234.6')
  const singleTexts=single.filter(x=>typeof x==='string')
  assert.equal(singleTexts.filter(x=>x==='Codex').length,1);assert.ok(singleTexts.includes('5 h'));assert.ok(singleTexts.includes('每周'))
  assert.ok(single.some(x=>x.type==='Image'&&x.props.systemName==='arrow.triangle.2.circlepath'))
  const missing=expand(Root({data:{...singleData,today:null,month:null},stale:false,error:null}))
  assert.ok(missing.some(x=>x==='今日/本月统计未提供'));assert.ok(!missing.some(x=>x.type==='GeometryReader'));assert.ok(!missing.some(x=>x==='$0.0'))
  scripting.Widget.parameter='1,2'
  const double=expand(Root({data:singleData,stale:false,error:null}))
  assert.ok(!double.some(x=>x.type==='GeometryReader'));assert.ok(!double.some(x=>x==='今日'||x==='本月'))
  assert.equal(double.filter(x=>x==='Codex').length,2)
  // Optional direct comparison with a real pre-change widget (no fixture copied into project).
  if(process.env.BASELINE_WIDGET_PATH){
    const baseline=load('baseline-widget.tsx').Root
    for(const family of ['systemSmall','systemMedium']){
      scripting.Widget.family=family
      const enabledData={...singleData,accounts:singleData.accounts.map(a=>({...a,enabled:true}))}
      const current=expand(Root({data:enabledData,stale:false,error:null}))
      const previous=expand(baseline({data:enabledData,stale:false,error:null}))
      const visualProps=(key,value)=>key==='muted'&&value===false?undefined:value // new opt-in metadata does not alter enabled visuals
      assert.equal(JSON.stringify(current,visualProps),JSON.stringify(previous,visualProps),family+' unchanged baseline layout tree')
    }
    console.log('PASS: exact baseline layout tree comparison: Small two-account, Medium')
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
  api.saveAccountOrder(accounts.map(a=>a.id));storage.set('ai_usage_selected_accounts_v1',[accounts[3].id,accounts[0].id])
  const {SettingsView}=load('index.tsx')
  const render=()=>{hook=0;return expand(SettingsView())}
  let ui=render()
  assert.ok(!ui.some(x=>x.type==='Toggle'))
  assert.ok(ui.some(x=>x.type==='Section'&&x.props.header?.props?.children==='小组件账号'))
  assert.ok(!ui.some(x=>x.type==='Section'&&x.props.header?.props?.children==='小组件账号（最多4个）'))
  assert.ok(ui.some(x=>typeof x==='string'&&x==='1. Codex · 匿名0'))
  assert.ok(!ui.some(x=>typeof x==='string'&&x.includes('已停用')))
  const appDisabled=ui.find(x=>x.type==='Text'&&x.props.children==='1. Codex · 匿名0')
  assert.equal(appDisabled.props.foregroundStyle,undefined)
  const appEnabled=ui.find(x=>x.type==='Text'&&x.props.children==='2. Codex · 匿名1')
  assert.equal(appEnabled.props.foregroundStyle,undefined)
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
  assert.ok(render().some(x=>typeof x==='string'&&x.startsWith('3. Codex · 匿名0')))
  assert.deepEqual(Array.from(api.widgetAccounts(accounts),a=>a.id),['p1','p2','p0','p3'])
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
  storage.set('ai_usage_cache_v1',{...data,accounts:statusAccounts});api.saveAccountOrder(statusAccounts.map(a=>a.id))
  states.length=0
  const statusUI=render()
  for(let i=0;i<statusAccounts.length;i++){
    const a=statusAccounts[i]
    const appRow=statusUI.find(x=>x.type==='Text'&&x.props.children===`${i+1}. ${a.provider==='claude'?'Claude':'Codex'} · ${a.name}`)
    assert.ok(appRow)
    assert.equal(appRow.props.foregroundStyle,undefined) // App never inherits widget disabled foreground
  }
  assert.ok(!statusUI.some(x=>typeof x==='string'&&x.includes('已停用')))
  for(const [n,s] of [[1.15,'$1.2'],[12.34,'$12.3'],[12.35,'$12.4'],[0.05,'$0.1'],[0,'$0.0'],[1234.56,'$1234.6']])assert.equal(api.fmtUsd(n),s)
  assert.equal(api.VERSION,'1.7.7')
  assert.ok(storageWrites.every(k=>!['ai_usage_selected_accounts_v1','ai_usage_official_selected_v1'].includes(k)))
  // Syntax-only compilation of settings, plus version/updater integration.
  const index=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
  assert.equal(ts.transpileModule(index,{fileName:'index.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true}).diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
  assert.ok(index.includes('const FILES = ["api.ts", "widget.tsx", "index.tsx"]')); assert.ok(!index.includes('from "./official"')); assert.ok(index.includes('const VERSION = "'+JSON.parse(fs.readFileSync(path.join(root,'script.json'))).version+'"'))
  console.log('PASS: device pending/throttle/expired/cancel/in-flight cancel/success/dedup; refresh/401/rotation; duration mapping/reset cards; source isolation/logout; 3 widget trees; syntax/version/old updater; stable-ID sorting/default first accounts including disabled/parameters/pruning; obsolete selections ignored and never written; no UI Toggles; large label gap/six stat columns; Parrot grant/total; native drag/drop scope/up/down/cancel/self/invalid/cross-source; one-decimal rounding; fixedSize intrinsic 6-column HStack/one column owns both periods/leading/no edge Spacer/uniform font factor and width budget; dual-arrow refresh icon in 3 families; Small one-account 4 stats/uncompressed shared columns/equal internal Spacers/summary scope; Small two-account no stats; official missing; Codex/Claude disabled gray title+SVG fill in 3 widget families, App foreground always normal, enabled 0%/unavailable/stale unchanged, no disabled words; quota colors unchanged')
}
main().catch(e=>{console.error(e);process.exitCode=1})
