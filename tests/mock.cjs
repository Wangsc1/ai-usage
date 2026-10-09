// Local simulation only; never contacts a network or reads real credentials.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
let now = 1800000000000, handler, calls = [], reads = []
const kc = new Map(), storage = new Map(), storageWrites = []
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
const modules = {}
const scripting = new Proxy({ Widget: { family: 'systemLarge', parameter: '' } }, { get(o,k) { return o[k] || k } })
scripting.modifiers=()=>{const calls=[];const m=new Proxy({calls},{get(t,k){if(k==='calls')return calls;if(k==='toJSON')return undefined;return v=>{calls.push([k,v]);return m}}});return m}
const jsx = (type, props, key) => key === undefined ? ({type, props}) : ({type, props, key})
const context = vm.createContext({ console, Date: Clock, Math, Map, Set, Promise, setTimeout: (fn,ms)=>{now+=ms;Promise.resolve().then(fn)}, Safari: {present: async()=>{}},
  Keychain: { get(k) { reads.push(k); return kc.get(k) ?? null }, set(k,v) { kc.set(k,v); return true }, remove(k) { kc.delete(k); return true } },
  Storage: { get(k) { return storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : null }, set(k,v) { storageWrites.push(k); storage.set(k,JSON.parse(JSON.stringify(v))) }, remove(k) { storage.delete(k) } },
  Data: { fromBase64String(s) { return { toRawString: () => Buffer.from(s,'base64').toString() } } },
  fetch: async (url, options) => { calls.push({url,options}); return handler(url,options) }
})
function load(name) {
  if (modules[name]) return modules[name].exports
  const m = modules[name] = {exports:{}}
  let code = fs.readFileSync(name === 'gradient-baseline.tsx' ? process.env.GRADIENT_BASELINE_PATH : name === 'baseline-widget.tsx' ? process.env.BASELINE_WIDGET_PATH : path.join(root,name),'utf8')
  if (name === 'widget.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root, PeriodStats, statsWidthBudget, largeSegmentLayout, SegBar, Lcd, smallRegionLayout, AccountTitle, mediumTwoLayout, mediumThreeStatsLayout }')
  if (name === 'baseline-widget.tsx' || name === 'gradient-baseline.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root }')
  if (name === 'index.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { SettingsView, WidgetNamePage, checkAfterSafari, presentIsolatedAuthorization }')
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
  const first=official.officialAccounts()[0]; assert.equal(first.name,'账号 1（邮箱未提供）'); assert.ok(!JSON.stringify(storage).includes('mock-refresh'))
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
  api.saveWidgetName(first.id,'官方退出清除','official');api.saveWidgetName(first.id,'同ID另一来源','parrot')
  handler=async u=>u.endsWith('/usage')?resp(200,{rate_limit:usage.rate_limit}):resp(404)
  await official.loadOfficialUsage();assert.equal(api.getWidgetName(first.id,'official'),'官方退出清除') // refresh does not rewrite alias store
  const legacyOfficial=[first.id]; storage.set('ai_usage_official_selected_v1',legacyOfficial); official.logoutOfficial(first.id)
  assert.equal(api.getWidgetName(first.id,'official'),'');assert.equal(api.getWidgetName(first.id,'parrot'),'同ID另一来源')
  assert.equal(official.officialAccounts().length,1); assert.ok(!official.officialCached().accounts.some(a=>a.id===first.id)); assert.ok(!storage.get('ai_usage_official_order_v1').includes(first.id))
  assert.equal(storage.get('ai_usage_official_selected_v1'),legacyOfficial)
  assert.ok(!api.widgetAccounts(official.officialCached().accounts).some(a=>a.id===first.id))
  assert.equal(kc.get('parrot_management_key'),'mock-management'); api.saveSource('parrot'); assert.equal(storage.get('ai_usage_selected_accounts_v1')[0],'parrot-account')
  // JSX tree simulation verifies official stats not rendered as zero and unchanged family geometry.
  const {Root,PeriodStats,statsWidthBudget,largeSegmentLayout,SegBar,Lcd,smallRegionLayout,AccountTitle,mediumTwoLayout,mediumThreeStatsLayout}=load('widget.tsx')
  scripting.Widget.displaySize={width:358,height:376}
  let normalizeLargeBar=false
  let skipAccountTitles=false
  let proposedStatsWidth=null
  function expand(n) { if(n==null)return [];if(Array.isArray(n))return n.flatMap(expand);if(typeof n!=='object')return [n];if(typeof n.type==='function'&&skipAccountTitles&&n.type.name==='AccountTitle')return [];if(typeof n.type==='function')return expand(normalizeLargeBar&&n.type.name==='LargeSegBar'?SegBar({remaining:n.props.remaining,count:20,height:5}):n.type(n.props));if(n.type==='ForEach')return [n,...expand(Array.from({length:n.props.count},(_,i)=>n.props.itemBuilder(i)))];if(n.type==='GeometryReader')return [n,...expand(n.props.children({size:{width:n.props.frame?.height===5?330:proposedStatsWidth??(scripting.Widget.family==='systemSmall'?130:330),height:n.props.frame?.height??134}}))];return [n,...expand(n.props?.children)] }
  const accounts=Array.from({length:4},(_,i)=>({id:'p'+i,name:'匿名'+i,provider:'openai',enabled:i!==0,available:true,...mapped}))
  const data={today:null,month:null,accounts,fetchedAt:now,todayByFamily:{},monthByFamily:{}}
  const expectedLight={gradient:[{color:'#FAFDFE',location:0},{color:'#F2F8FC',location:0.45},{color:'#DAEDF9',location:0.75},{color:'#ADD9F3',location:1}],startPoint:{x:0.3,y:0},endPoint:{x:0.7,y:1}}
  const expectedDark={gradient:[{color:'#25282F',location:0},{color:'#232731',location:0.45},{color:'#28303F',location:0.75},{color:'#335A76',location:1}],startPoint:{x:0.3,y:0},endPoint:{x:0.7,y:1}}
  for(const family of ['systemSmall','systemMedium','systemLarge']){
    scripting.Widget.family=family
    const background=Root({data,stale:false,error:null}).props.widgetBackground
    assert.equal(JSON.stringify(background.light),JSON.stringify(expectedLight))
    assert.equal(JSON.stringify(background.dark),JSON.stringify(expectedDark))
  }
  if(process.env.GRADIENT_BASELINE_PATH){
    const baseline=load('gradient-baseline.tsx').Root
    for(const family of ['systemSmall','systemMedium','systemLarge','systemExtraLarge'])for(const parameter of ['1','1,2','3,1,4','4,2,3,1']){
      scripting.Widget.family=family;scripting.Widget.parameter=parameter
      const previous=baseline({data,stale:false,error:null}),current=Root({data,stale:false,error:null})
      assert.equal(JSON.stringify(current.props.widgetBackground.dark),JSON.stringify(previous.props.widgetBackground.dark))
      current.props.widgetBackground=previous.props.widgetBackground
      assert.equal(JSON.stringify(expand(current)),JSON.stringify(expand(previous)),family+' '+parameter+' only light BG changed')
    }
    scripting.Widget.parameter=''
    console.log('PASS: gradient stop checks and 16 no-alias layout trees equal supplied pre-change baseline; dark background unchanged')
  }
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
    const readers=tree.filter(x=>x.type==='GeometryReader'&&x.props.frame?.height!==5&&x.props.frame?.height!=null)
    assert.ok(readers.length<=1)
    if(readers.length)assert.equal(readers[0].props.frame.height,4*Math.ceil(labelFont*1.2)+2*Math.ceil(valueFont*1.2)+3*verticalGap+2)
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
  const exampleLabels=['输入','输出','缓存','缓存率','Token','花费']
  const exampleColumns=exampleLabels.map((label,i)=>({label,today:exampleToday[i],month:exampleMonth[i]}))
  for(const [indexes,lf,vf,gap,vg,widths] of [[[0,1,2,3,4,5],9,11,4,3,[330,300]],[[2,3,4,5],7,9,2,2,[130,120]]]){
    const cols=indexes.map(i=>({...exampleColumns[i],label:i===5&&indexes.length===4?'花费':exampleColumns[i].label}))
    for(const width of widths){
      const sizingFont=indexes.length===6?12:vf
      const budget=statsWidthBudget(cols,lf,sizingFont,gap,width)
      assert.ok(budget.fitted<=width+1e-9);assert.ok(budget.scale>0.7&&budget.scale<=1)
      const rescaled=statsWidthBudget(cols,lf*budget.scale,sizingFont*budget.scale,gap*budget.scale,width)
      assert.ok(rescaled.natural<=width+1e-9)
      proposedStatsWidth=width
      const tree=expand(PeriodStats({columns:cols,labelFont:lf,valueFont:vf,sizingValueFont:sizingFont,gap,verticalGap:vg}))
      const rows=checkStatsLayout(tree,cols.length,lf,vf,gap,vg)
      for(let p=0;p<2;p++)assert.deepEqual(Array.from(rows[p].props.children,x=>x.props.children[1].props.children),cols.map(c=>c[p?'month':'today']))
      assert.ok(!tree.some(x=>typeof x==='string'&&(x.includes('...')||x.includes('…'))))
      console.log(`MODEL: ${cols.length} columns, width=${width}, budget=${budget.natural.toFixed(2)}, shared scale=${budget.scale.toFixed(3)}, fitted=${budget.fitted.toFixed(2)}`)
    }
  }
  proposedStatsWidth=null
  const labels=checkStatsLayout(parrotTree,6,9,11,4,3)
  // Each uncompressed column owns both periods; a shared factor fits the measured container width.
  const varied={...result.data,month:{...result.data.month,inputTokens:987654321,outputTokens:1,cacheReadTokens:70000000,costUsd:1234.56,totalTokens:1057654322}}
  const variedRows=checkStatsLayout(expand(Root({data:varied,stale:false,error:null})),6,9,11,4,3)
  assert.notEqual(variedRows[0].props.children[0].props.children[1].props.children,variedRows[1].props.children[0].props.children[1].props.children)
  for(const family of ['systemSmall','systemMedium','systemLarge']) {
    scripting.Widget.family=family
    for(const stale of [false,true]) {
      const images=expand(Root({data:result.data,stale,error:null})).filter(x=>x.type==='Image')
      const icon=images.find(x=>x.props.systemName===(stale?'wifi.slash':'arrow.triangle.2.circlepath'))
      assert.ok(icon);assert.equal(icon.props.font,6.3);assert.ok(!images.some(x=>x.props.systemName==='arrow.clockwise'))
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
  assert.ok(missing.some(x=>x==='今日/本月统计未提供'));assert.ok(!missing.some(x=>x.type==='GeometryReader'&&x.props.frame?.height!=null));assert.ok(!missing.some(x=>x==='$0.0'))
  scripting.Widget.parameter='1,2'
  const double=expand(Root({data:singleData,stale:false,error:null}))
  assert.ok(!double.some(x=>x.type==='GeometryReader'&&x.props.frame?.height!=null));assert.ok(!double.some(x=>x==='今日'||x==='本月'))
  assert.equal(double.filter(x=>x==='Codex').length,2)
  // Small double (baseline), Small single and Medium: identical 8pt label/time, fixed label width, no per-text scaling.
  function quotaHeaders(tree){return tree.filter(x=>x.type==='HStack'&&x.props.alignment==='bottom'&&x.props.spacing===2&&x.props.children?.[1]?.props?.monospacedDigit)}
  const headerStyle=h=>{const [label,time]=h.props.children;return JSON.stringify([label.props.font,label.props.frame,label.props.foregroundStyle,label.props.lineLimit,label.props.minScaleFactor,time.props.font,time.props.monospacedDigit,time.props.foregroundStyle,time.props.lineLimit,time.props.minScaleFactor,time.props.frame])}
  let baselineStyle=null
  for(const days of [5,15,365]){
    const iso=new Date(now+(days*24*60+15*60+33)*60000).toISOString()
    const longData={...singleData,accounts:singleData.accounts.map(a=>({...a,sevenDay:{...a.sevenDay,resetsAt:iso}}))}
    for(const [family,parameter,count] of [['systemSmall','1,2',4],['systemSmall','1',2],['systemMedium','',8]]){
      scripting.Widget.family=family;scripting.Widget.parameter=parameter
      const tree=expand(Root({data:longData,stale:false,error:null}))
      assert.ok(!tree.some(x=>x.type==='Text'&&x.props.styledText))
      const headers=quotaHeaders(tree);assert.equal(headers.length,count)
      for(const h of headers){
        const [label,time]=h.props.children
        assert.equal(label.props.font,8);assert.equal(time.props.font,8);assert.equal(label.props.frame.width,8*2.1)
        assert.equal(label.props.minScaleFactor,undefined);assert.equal(time.props.minScaleFactor,undefined)
        assert.equal(time.props.monospacedDigit,true)
        baselineStyle??=headerStyle(h);assert.equal(headerStyle(h),baselineStyle,family+parameter)
        const text=Array.from(time.props.children).join('')
        if(label.props.children==='每周')assert.equal(text,`· ${days}天 15:33`)
        else assert.equal(text,'· '+api.fmtReset(longData.accounts[0].fiveHour.resetsAt))
      }
    }
  }
  function quotaRows(tree){return tree.filter(x=>x.type==='VStack'&&x.props.children?.[0]?.type==='HStack'&&x.props.children?.[1]?.type?.name==='SegBar')}
  scripting.Widget.family='systemMedium';scripting.Widget.parameter=''
  const mediumRowGap=quotaRows(expand(Root({data:singleData,stale:false,error:null})))[0].props.spacing
  assert.equal(mediumRowGap,2)
  for(const parameter of ['1','1,2']){
    scripting.Widget.family='systemSmall';scripting.Widget.parameter=parameter
    const rows=quotaRows(expand(Root({data:singleData,stale:false,error:null})));assert.equal(rows.length,parameter==='1'?2:4)
    for(const row of rows){
      assert.equal(row.props.spacing,mediumRowGap);assert.equal(row.props.children[0].props.alignment,'bottom')
      const lcd=row.props.children[0].props.children.at(-1);assert.equal(lcd.type.name,'Lcd')
      const lcdTree=expand(lcd);assert.equal(lcdTree[0].props.alignment,'bottom')
      assert.equal(lcdTree.find(x=>x.type==='SVG').props.frame.height,lcd.props.height)
    }
  }
  // Lit bottom segment reaches viewBox y=18: the LCD has no bottom padding or baseline modifier.
  for(const height of [10,11]){
    const svg=expand(Lcd({value:88,height})).find(x=>x.type==='SVG')
    const rects=Array.from(svg.props.code.light.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"/g))
    assert.equal(Math.max(...rects.map(r=>Number(r[1])+Number(r[2]))),18)
    assert.equal(svg.props.frame.height,height)
  }
  scripting.Widget.family='systemLarge';scripting.Widget.parameter=''
  const largeTree=expand(Root({data:singleData,stale:false,error:null}))
  assert.ok(!largeTree.some(x=>x.type==='GeometryReader'),'no GeometryReader anywhere in Large')
  const largeBarRows=largeTree.filter(x=>x.type==='HStack'&&x.props.spacing===2.25)
  assert.equal(largeBarRows.length,8)
  for(const row of largeBarRows)assert.equal(row.props.children.length,largeSegmentLayout(330,358).count)
  for(const [widgetWidth,barWidth] of [[320,292],[358,330],[390,362]]){
    const layout=largeSegmentLayout(barWidth,widgetWidth)
    assert.ok(Math.abs(layout.segmentWidth-layout.target)<1)
    assert.ok(layout.count>=20);assert.ok(layout.count>=1)
    assert.ok(Math.abs(layout.segmentWidth*layout.count+(layout.count-1)*2.25-barWidth)<1e-9)
    console.log(`MODEL: widget=${widgetWidth}, large bar=${barWidth}, target segment=${layout.target.toFixed(2)}, count=${layout.count}, actual segment=${layout.segmentWidth.toFixed(2)}`)
    for(const remaining of [null,0,21,60,100]){
      const tree=expand(SegBar({remaining,count:layout.count,height:5}))
      assert.equal(tree.filter(x=>x.type==='RoundedRectangle').length,layout.count)
      assert.equal(tree[0].props.spacing,2.25)
      const cells=tree.filter(x=>x.type==='RoundedRectangle')
      assert.ok(cells.every(x=>x.props.frame.height===5))
      const lit=remaining==null?0:Math.round(remaining/100*layout.count)
      const head=remaining<=20?{light:'#D93025',dark:'#FF453A'}:remaining<=60?{light:'#D9770B',dark:'#FF9F0A'}:{light:'#2E9E4F',dark:'#7ED957'}
      for(let i=0;i<cells.length;i++)assert.equal(JSON.stringify(cells[i].props.fill),JSON.stringify(i<lit-1?{light:'#1C1C1E',dark:'#FFFFFF'}:i===lit-1?head:{light:'rgba(0, 0, 0, 0.13)',dark:'rgba(255, 255, 255, 0.14)'}))
    }
  }
  const largeWindows=largeTree.filter(x=>x.type==='VStack'&&x.props.children?.[1]?.type?.name==='LargeSegBar')
  assert.equal(largeWindows.length,8)
  for(const window of largeWindows){
    assert.equal(window.props.alignment,'leading');assert.equal(window.props.spacing,mediumRowGap)
    assert.equal(JSON.stringify(window.props.modifiers.calls),JSON.stringify([['fixedSize',{horizontal:false,vertical:true}],['frame',{minHeight:19,maxWidth:'infinity'}]]))
    const top=window.props.children[0];assert.equal(top.type,'HStack');assert.equal(top.props.alignment,'bottom');assert.equal(top.props.frame.maxWidth,'infinity')
    const [texts,spacer,lcd]=top.props.children;assert.equal(spacer.type,'Spacer');assert.equal(lcd.type.name,'Lcd');assert.equal(lcd.props.height,12)
    assert.equal(texts.props.children[0].props.font,9);assert.equal(texts.props.children[1].props.font,9)
  }
  // Native intrinsic-height protection replaces the discredited theoretical height budget.
  const largeContainer=largeTree.find(x=>x.type==='VStack'&&x.props.children?.[0]?.type?.name==='PeriodStats')
  assert.ok(largeContainer);assert.equal(largeContainer.props.spacing,3)
  assert.equal(JSON.stringify(largeContainer.props.modifiers.calls),JSON.stringify([
    ['fixedSize',{horizontal:false,vertical:true}],['frame',{maxWidth:'infinity',maxHeight:'infinity',alignment:'topLeading'}]]))
  const [stats,divider,accountList]=largeContainer.props.children
  assert.equal(stats.props.contentWidth,330);assert.equal(stats.props.verticalGap,3)
  const statsTree=expand(stats);assert.ok(!statsTree.some(x=>x.type==='GeometryReader'))
  assert.equal(statsTree[0].props.fixedSize.vertical,true);assert.equal(statsTree[0].props.frame.height,undefined)
  assert.equal(accountList.props.fixedSize.vertical,true);assert.equal(accountList.props.frame.maxHeight,undefined);assert.equal(accountList.props.spacing,2)
  assert.equal(JSON.stringify(divider.props.modifiers.calls),JSON.stringify([['frame',{height:1}],['frame',{maxWidth:'infinity'}]]))
  for(const block of accountList.props.children){
    assert.equal(block.props.fixedSize.vertical,true);assert.equal(block.props.spacing,1);assert.equal(block.props.frame.maxHeight,undefined)
    const title=block.props.children[1];assert.equal(title.props.fixedSize.vertical,true)
    const windows=block.props.children[2];assert.equal(windows.props.spacing,3);assert.equal(windows.props.fixedSize.vertical,true)
    assert.equal(windows.props.children.length,2)
    const line=block.props.children[0]
    if(line)assert.equal(JSON.stringify(line.props.modifiers.calls),JSON.stringify([['frame',{height:1}],['frame',{maxWidth:'infinity'}],['padding',{top:1}]]))
  }
  for(const bar of largeTree.filter(x=>x.type==='RoundedRectangle')){
    assert.equal(JSON.stringify(bar.props.modifiers.calls),JSON.stringify([['frame',{height:5}],['frame',{maxWidth:'infinity'}]]))
  }
  const sourceWidget=fs.readFileSync(path.join(root,'widget.tsx'),'utf8')
  assert.ok(!sourceWidget.includes('largeHeightBudget'))
  for(const height of [132,134,142]){
    const region=smallRegionLayout(height);assert.equal(region.fits,true);assert.ok(region.dividerY-66>=3);assert.ok(region.lowerY+52<=height)
  }
  assert.equal(smallRegionLayout(120).fits,false)
  const smallRegions=[]
  for(const parameter of ['1','1,2']){
    scripting.Widget.family='systemSmall';scripting.Widget.parameter=parameter
    const tree=expand(Root({data:singleData,stale:false,error:null}))
    const shared=tree.find(x=>x.type==='VStack'&&x.props.spacing===0&&x.props.frame?.width===130&&x.props.frame?.height===134)
    assert.ok(shared);const [upper,divider,lower]=shared.props.children
    assert.equal(divider.type,'Rectangle');assert.equal(divider.props.frame.height,1);assert.equal(lower.props.padding.top,4)
    assert.equal(upper.props.frame.alignment,'topLeading');assert.equal(lower.props.frame.alignment,'topLeading')
    smallRegions.push([upper.props.frame.height,upper.props.frame.height+1+lower.props.padding.top,lower.props.frame.height])
  }
  assert.equal(JSON.stringify(smallRegions[0]),JSON.stringify(smallRegions[1]))
  // All family layouts: common AccountTitle places one valid positive reset count at the full-width trailing edge.
  for(const [family,parameter,titleCount,font] of [['systemSmall','1',1,11],['systemSmall','1,2',2,11],['systemMedium','',4,12],['systemLarge','',4,12]]){
    scripting.Widget.family=family;scripting.Widget.parameter=parameter
    for(const reset of [1,37,0,null,undefined,-1,NaN,Infinity]){
      const resetData={...singleData,accounts:singleData.accounts.map(a=>({...a,resetCredits:reset,name:'很长的账号用户名用于测试压缩但不挤掉重置卡'}))}
      const tree=expand(Root({data:resetData,stale:false,error:null}))
      const titleRows=tree.filter(x=>x.type==='HStack'&&x.props.children?.[0]?.type?.name==='ProviderIcon')
      assert.equal(titleRows.length,titleCount)
      const show=typeof reset==='number'&&Number.isFinite(reset)&&reset>0
      const texts=tree.filter(x=>x.type==='Text'&&[].concat(x.props.children).join('').startsWith('RE:'))
      assert.equal(texts.length,show?titleCount:0)
      assert.ok(!tree.some(x=>typeof x==='string'&&x.startsWith('重置:')))
      for(const row of titleRows){
        const children=Array.from(row.props.children).filter(Boolean),name=children[2]
        assert.equal(name.props.font,font-3);assert.equal(name.props.lineLimit,1)
        if(show){
          assert.equal(row.props.alignment,'bottom');assert.equal(row.props.frame.maxWidth,'infinity')
          const [spacer,text]=children.slice(-2);assert.equal(spacer.type,'Spacer');assert.equal(text.type,'Text')
          assert.equal([].concat(text.props.children).join(''),`RE:${reset}`)
          assert.equal(JSON.stringify(text.props.foregroundStyle),JSON.stringify({light:'#5E6068',dark:'#8E8E93'}))
          assert.equal(text.props.font,name.props.font);assert.equal(text.props.lineLimit,1)
          assert.equal(text.props.fixedSize.horizontal,true);assert.equal(text.props.fixedSize.vertical,true)
          assert.equal(text.props.minScaleFactor,undefined)
        } else {assert.equal(row.props.frame,undefined);assert.equal(row.props.alignment,undefined);assert.ok(!children.some(x=>x.type==='Spacer'))}
      }
    }
  }
  // Exactly three FINAL selected accounts: shared SmallStats in top-left, original Quads in the other slots.
  scripting.Widget.family='systemMedium'
  const findCells=tree=>{
    const grid=tree.find(x=>x.type==='ZStack'&&x.props.children?.[0]?.type==='Rectangle'&&x.props.children?.[0]?.props.frame?.width===1)
    assert.ok(grid);assert.equal(grid.props.children[1].props.frame.height,1)
    const rows=grid.props.children[2].props.children
    return {grid,cells:rows.flatMap(row=>row.props.children)}
  }
  scripting.Widget.displaySize={width:358,height:170}
  for(const [parameter,input] of [['',{...singleData,accounts:accounts.slice(0,3)}],['3,1,4',singleData],['3,3,x,1,9,4',singleData]]){
    scripting.Widget.parameter=parameter;proposedStatsWidth=130
    const tree=expand(Root({data:input,stale:false,error:null})),{cells}=findCells(tree)
    assert.equal(cells.length,4);assert.equal(cells[0].props.children.type.name,'SmallStats')
    const selected=Array.from(api.widgetAccounts(input.accounts,parameter),a=>a.id)
    assert.equal(selected.length,3)
    assert.deepEqual(Array.from(cells.slice(1),c=>c.props.children.props.acc.id),selected)
    assert.ok(cells.slice(1).every(c=>c.props.children.type.name==='Quad'))
    assert.equal(tree.filter(x=>x.type==='HStack'&&x.props.children?.[0]?.type?.name==='ProviderIcon').length,3)
    assert.equal(new Set(cells.slice(1).map(c=>c.props.children.props.acc.id)).size,3)
    const statsTree=expand(cells[0].props.children)
    const rows=checkStatsLayout(statsTree,4,7,9,2,0)
    assert.deepEqual(Array.from(rows[0].props.children,c=>c.props.children[0].props.children),['缓存','缓存率','Token','花费'])
    assert.deepEqual(Array.from(rows[0].props.children,c=>c.props.children[1].props.children),['70','17.6%','370','$0.1'])
    // Identical shared statistics component rendering at identical available width, not native pixel proof.
    scripting.Widget.family='systemSmall';scripting.Widget.parameter='1'
    const small=expand(Root({data:input,stale:false,error:null})).find(x=>x.props?.children?.type?.name==='SmallStats')?.props.children
    assert.ok(small)
    assert.equal(JSON.stringify(cells[0].props.children.type(cells[0].props.children.props).props.children.props.columns),JSON.stringify(small.type(small.props).props.columns))
    assert.ok(!statsTree.some(x=>x.type==='GeometryReader'))
    assert.equal(cells[0].props.padding.bottom,7)
    assert.equal(statsTree[0].type,'VStack');assert.equal(statsTree[1].props.frame.width,155)
    scripting.Widget.family='systemMedium';scripting.Widget.parameter=parameter
    for(const missing of [{...input,today:null},{...input,month:null},{...input,today:null,month:null}]){
      const missingTree=expand(Root({data:missing,stale:false,error:null})),missingCells=findCells(missingTree).cells
      const blank=expand(missingCells[0].props.children)
      assert.ok(blank.includes('今日/本月统计未提供'));assert.ok(!blank.some(x=>x.type==='GeometryReader'))
      assert.ok(!blank.some(x=>typeof x==='string'&&(x.includes('$0')||x==='--')))
      assert.deepEqual(Array.from(missingCells.slice(1),c=>c.props.children.props.acc.id),selected)
    }
  }
  proposedStatsWidth=null
  scripting.Widget.family='systemMedium';scripting.Widget.displaySize={width:358,height:170}
  const findTwo=tree=>{
    const grid=tree.find(x=>x.type==='ZStack'&&x.props.frame?.width===330&&x.props.frame?.height===132)
    assert.ok(grid);return {grid,upper:grid.props.children[2].props.children[0],lower:grid.props.children[2].props.children[1]}
  }
  for(const [parameter,input] of [['',{...singleData,accounts:accounts.slice(0,2)}],['4,2',singleData],['4,x,4,2,9',singleData]]){
    scripting.Widget.parameter=parameter
    const tree=expand(Root({data:input,stale:false,error:null})),{grid,upper,lower}=findTwo(tree)
    const selected=Array.from(api.widgetAccounts(input.accounts,parameter),a=>a.id)
    assert.equal(selected.length,2);assert.deepEqual(Array.from(lower.props.children,c=>c.props.children.props.acc.id),selected)
    const vertical=grid.props.children[0];assert.equal(vertical.props.children[0].type,'Spacer');assert.equal(vertical.props.children[0].props.frame.height,66)
    assert.equal(JSON.stringify(vertical.props.children[1].props.modifiers.calls),JSON.stringify([['frame',{width:1,height:66}]]))
    assert.equal(JSON.stringify(grid.props.children[1].props.modifiers.calls),JSON.stringify([['frame',{height:1}],['frame',{maxWidth:'infinity'}]]))
    assert.equal(JSON.stringify(upper.props.modifiers.calls),JSON.stringify([['padding',{bottom:4}],['frame',{height:66}],['frame',{maxWidth:'infinity',alignment:'topLeading'}]]))
    assert.equal(JSON.stringify(lower.props.modifiers.calls),JSON.stringify([['frame',{height:66}],['frame',{maxWidth:'infinity'}]]))
    const statsTree=expand(upper.props.children),rows=checkStatsLayout(statsTree,6,7,8,2,0)
    assert.ok(!statsTree.some(x=>x.type==='GeometryReader'))
    assert.deepEqual(Array.from(rows[0].props.children,c=>c.props.children[0].props.children),['输入','输出','缓存','缓存率','Token','花费'])
    assert.deepEqual(Array.from(rows[0].props.children,c=>c.props.children[1].props.children),['100','200','70','17.6%','370','$0.1'])
    assert.equal(tree.filter(x=>x.type==='HStack'&&x.props.children?.[0]?.type?.name==='ProviderIcon').length,2)
    assert.ok(!statsTree.some(x=>x.type==='SVG'||x.type==='RoundedRectangle'))
    scripting.Widget.family='systemLarge'
    const largeStats=expand(Root({data:input,stale:false,error:null})).find(x=>x.props?.children?.[0]?.type?.name==='PeriodStats').props.children[0]
    assert.equal(JSON.stringify(upper.props.children.props.columns),JSON.stringify(largeStats.props.columns))
    scripting.Widget.family='systemMedium'
    for(const missing of [{...input,today:null},{...input,month:null},{...input,today:null,month:null}]){
      const absent=findTwo(expand(Root({data:missing,stale:false,error:null})))
      assert.equal(absent.upper.props.children.props.children,'官方未提供今日/本月Token与花费')
      assert.deepEqual(Array.from(absent.lower.props.children,c=>c.props.children.props.acc.id),selected)
      assert.ok(!expand(absent.upper).some(x=>x.type==='GeometryReader'))
    }
  }
  for(const height of [162,170,180]){
    const budget=mediumTwoLayout(height)
    assert.equal(budget.half,(height-24-14)/2)
    assert.ok(58*budget.statsScale+4<=budget.half)
    // Unmodified lower Quad: title≈14.4 + gaps6 + 2×(LCD11+gap2+bar4) + top inset7 =61.4pt MODEL.
    assert.ok(61.4<=budget.half)
    console.log('MODEL: Medium two-account height='+height+', half='+budget.half+', compact stats=58+4, quota=61.4; NOT native pixel proof')
  }
  for(const height of [162,166,170,180]){
    const layout=mediumThreeStatsLayout(height)
    const natural=4*Math.ceil(layout.labelFont*1.2)+2*Math.ceil(layout.valueFont*1.2)+2
    assert.ok(natural+4<=layout.half);assert.ok(layout.half-natural>=6)
    assert.ok(61.4<=layout.half) // unchanged lower quota model still fits
    scripting.Widget.displaySize={width:358,height};scripting.Widget.family='systemMedium';scripting.Widget.parameter='3,1,4'
    const grid=findCells(expand(Root({data:singleData,stale:false,error:null}))).grid
    const cells=findCells(expand(Root({data:singleData,stale:false,error:null}))).cells
    const statsNode=cells[0].props.children.type(cells[0].props.children.props)
    assert.equal(statsNode.type,'VStack') // render-only descent compensation wrapper
    assert.ok(Math.abs(statsNode.props.offset.y-layout.valueFont*(7/3)/9)<1e-9);assert.equal(statsNode.props.offset.x,0)
    assert.equal(statsNode.props.frame,undefined);assert.equal(statsNode.props.padding,undefined) // no layout-size change
    if(height===170)assert.ok(Math.abs(statsNode.props.offset.y*3-7)<0.5) // IMG_4469 @3x measured 7px digit-bottom→bar-bottom
    assert.ok(layout.half-7+statsNode.props.offset.y<layout.half-4) // shifted text frame still >4pt above divider
    const stats=expand(cells[0].props.children)
    checkStatsLayout(stats,4,layout.labelFont,layout.valueFont,2,0)
    assert.equal(grid.props.children[2].props.children[0].props.alignment,'bottom')
    for(const cell of cells.slice(0,2)){
      assert.equal(cell.props.padding.bottom,7);assert.equal(cell.props.frame.alignment,'bottomLeading')
    }
    const upperQuad=cells[1].props.children.type(cells[1].props.children.props)
    assert.equal(upperQuad.props.frame.maxHeight,undefined)
    assert.equal(upperQuad.props.fixedSize.vertical,true) // no expanded center-aligned Quad between bar and shared bottom anchor
    assert.ok(layout.half-7-natural>=-1) // conservative line model may extend 1pt into existing Root12 top inset, not towards divider
    assert.equal(cells[1].props.padding.bottom,7)
    assert.equal(cells[2].props.padding.top,7);assert.equal(cells[3].props.padding.top,7)
    assert.equal(grid.props.children[1].props.frame.height,1)
    console.log('MODEL: Medium3 height='+height+', stats='+natural+', divider='+layout.half+', shared bottom anchor='+(layout.half-7)+', divider clearance=7'+'; NOT pixel proof')
  }
  scripting.Widget.displaySize={width:358,height:376}
  // Direct pre-change baseline: ALL other sizes and Medium selections 1/2/4 remain byte-identical component trees.
  if(process.env.BASELINE_WIDGET_PATH){
    const baseline=load('baseline-widget.tsx').Root
    scripting.Widget.family='systemMedium';scripting.Widget.parameter='4,2';scripting.Widget.displaySize={width:358,height:170}
    const newTwo=findTwo(expand(Root({data:singleData,stale:false,error:null})))
    const originalTwo=findTwo(expand(baseline({data:singleData,stale:false,error:null})))
    assert.equal(JSON.stringify(newTwo),JSON.stringify(originalTwo)) // existing two-account safe-gap layout remains identical
    scripting.Widget.displaySize={width:358,height:376}
    scripting.Widget.family='systemMedium';scripting.Widget.parameter='3,1,4'
    const currentCells=findCells(expand(Root({data:singleData,stale:false,error:null}))).cells
    const oldCells=findCells(expand(baseline({data:singleData,stale:false,error:null}))).cells
    assert.equal(JSON.stringify(currentCells.slice(2)),JSON.stringify(oldCells.slice(2))) // both lower accounts untouched
    assert.equal(JSON.stringify(expand(currentCells[0].props.children).slice(1)),JSON.stringify(expand(oldCells[0].props.children))) // statistics fonts/gaps/data unchanged
    const nowQuad=currentCells[1].props.children.type(currentCells[1].props.children.props)
    const oldQuad=oldCells[1].props.children.type(oldCells[1].props.children.props)
    assert.equal(JSON.stringify(expand(nowQuad.props.children)),JSON.stringify(expand(oldQuad.props.children))) // title/reset/quota labels/LCD/bar internal tree unchanged
    assert.equal(JSON.stringify(currentCells[1].props.padding),JSON.stringify(oldCells[1].props.padding)) // right insets unchanged
    const currentGrid=findCells(expand(Root({data:singleData,stale:false,error:null}))).grid
    const previousGrid=findCells(expand(baseline({data:singleData,stale:false,error:null}))).grid
    assert.equal(JSON.stringify(currentGrid.props.children.slice(0,2)),JSON.stringify(previousGrid.props.children.slice(0,2))) // line positions untouched
    for(const [family,parameter] of [['systemSmall','1'],['systemSmall','1,2'],['systemSmall','3,1,4'],['systemLarge',''],['systemLarge','3,1,4'],['systemMedium','1'],['systemMedium','1,2'],['systemMedium',''],['systemMedium','4,2,3,1']]){
      scripting.Widget.family=family;scripting.Widget.parameter=parameter
      assert.equal(JSON.stringify(expand(Root({data:singleData,stale:false,error:null}))),JSON.stringify(expand(baseline({data:singleData,stale:false,error:null}))),family+' '+parameter+' unchanged pre-change tree')
    }
    // Default final counts 1/2/4: same statistics insertion as before, identical original slot padding/Quads.
    for(const count of [1,2,4]){
      scripting.Widget.family='systemMedium';scripting.Widget.parameter=''
      const input={...singleData,accounts:accounts.slice(0,count)}
      assert.equal(JSON.stringify(expand(Root({data:input,stale:false,error:null}))),JSON.stringify(expand(baseline({data:input,stale:false,error:null}))))
    }
    console.log('PASS: Medium exactly2 full-width compact six-column stats and lower-only vertical divider; exactly3 final selection (default/parameters/dedup) shared SmallStats top-left, Quads in selected order, missing statistics truthful; Medium1/2/4 and Small/Large exact pre-change trees; Medium3 top cells share bottom anchor/padding7, intrinsic right Quad; fonts/data/window contents and lower cells/dividers unchanged')
  }
  scripting.Widget.parameter=''
  scripting.Widget.family='systemLarge'
  for(const row of labels){assert.deepEqual(Array.from(row.props.children,x=>x.props.children[0].props.children),['输入','输出','缓存','缓存率','Token','花费']);assert.equal(row.props.children[4].props.children[1].props.children,'370');assert.ok(row.props.children.every(x=>x.props.children.every(t=>t.props.lineLimit===1)))}
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
  // Read-only Form list + NavigationLink to a separate ScrollView page using ReorderableForEach (no List/Form drag).
  const indexSource=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
  for(const old of ['onDrag','onDrop','ItemProvider','DropInfo','UTType','dragSession','EditButton','ForEach count','onMove={busy'])assert.ok(!indexSource.includes(old),old)
  assert.ok(!ui.some(x=>x.type==='ForEach'||x.type==='EditButton'||x?.props?.onDrag||x?.props?.onDrop))
  assert.equal(render().find(x=>x.type==='Form').props.toolbar.confirmationAction,undefined)
  // Minimal documented-shape mocks: Observable{value,setValue}, chainable modifiers() recorder.
  let obsStore=[],obsIndex=0
  scripting.useObservable=init=>{const i=obsIndex++;if(!(i in obsStore)){const o={value:typeof init==='function'?init():init,setValue(v){o.value=v}};obsStore[i]=o}return obsStore[i]}
  scripting.modifiers=()=>{const calls=[];const m=new Proxy({calls},{get(t,k){if(k==='calls')return calls;if(k==='toJSON')return undefined;return v=>{calls.push([k,v]);return m}}});return m}
  const ids=()=>Array.from(api.cachedAccounts(),a=>a.id)
  const link=()=>render().find(x=>x.type==='NavigationLink'&&x.props.destination?.type?.name==='AccountOrderPage')
  assert.ok(link());assert.equal(link().props.children.props.children,'账号排序')
  const openPage=()=>{obsStore=[];obsIndex=0;const d=link().props.destination;assert.equal(d.props.source,'parrot');return d}
  const pageTree=d=>{obsIndex=0;return expand(d.type(d.props))}
  let dest=openPage(),page=pageTree(dest)
  const scroll=page.find(x=>x.type==='ScrollView');assert.equal(scroll.props.navigationTitle,'账号排序')
  assert.ok(page.some(x=>x.type==='LazyVGrid'&&x.props.columns.length===1))
  assert.ok(!page.some(x=>x.type==='List'||x.type==='Form'))
  let reorder=page.find(x=>x.type==='ReorderableForEach')
  assert.equal(typeof reorder.props.onMove,'function');assert.equal(reorder.props.active.value,null)
  assert.deepEqual(Array.from(reorder.props.data,a=>a.id),['p0','p1','p2','p3'])
  const card=reorder.props.builder(reorder.props.data[0],0)
  assert.equal(card.key,'p0');assert.equal(card.props.children.props.children,'1. Codex · 匿名0')
  const cardMods=card.props.modifiers.calls
  assert.equal(JSON.stringify(cardMods.find(c=>c[0]==='contentShape')[1]),JSON.stringify({kind:'dragPreview',shape:{type:'rect',cornerRadius:12}}))
  assert.equal(cardMods.find(c=>c[0]==='background')[1].props.cornerRadius,12)
  assert.equal(cardMods.find(c=>c[0]==='background')[1].props.fill,'secondarySystemGroupedBackground')
  reorder.props.active.setValue(reorder.props.data[0])
  assert.equal(reorder.props.builder(reorder.props.data[0],0).props.modifiers.calls.find(c=>c[0]==='background')[1].props.fill,'tertiarySystemFill')
  reorder.props.active.setValue(null)
  // Documented standard: remove moving items, then insert at newOffset in the remaining array.
  const move=(from,to)=>{page=pageTree(dest);reorder=page.find(x=>x.type==='ReorderableForEach');reorder.props.onMove(from,to);page=pageTree(dest);reorder=page.find(x=>x.type==='ReorderableForEach')}
  move([0],2) // down
  assert.deepEqual(ids(),['p1','p2','p0','p3']);assert.deepEqual(Array.from(reorder.props.data,a=>a.id),ids())
  assert.equal(reorder.props.builder(reorder.props.data[2],2).props.children.props.children,'3. Codex · 匿名0')
  assert.ok(render().some(x=>typeof x==='string'&&x==='3. Codex · 匿名0')) // Form summary updated via onSaved
  assert.deepEqual(Array.from(api.widgetAccounts(accounts),a=>a.id),['p1','p2','p0','p3'])
  assert.deepEqual(Array.from(api.widgetAccounts(accounts,'3,1'),a=>a.id),['p0','p1'])
  move([3],0) // up
  assert.deepEqual(ids(),['p3','p1','p2','p0'])
  move([0,2],2) // multiple items to end of remaining array
  assert.deepEqual(ids(),['p1','p0','p3','p2'])
  move([1],3) // to end
  assert.deepEqual(ids(),['p1','p3','p2','p0'])
  const order=JSON.stringify(storage.get('ai_usage_parrot_order_v1'))
  for(const [from,to] of [[[1],1],[[],0],[[9],0]]){move(from,to);assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),order)}
  const officialOrder=JSON.stringify(storage.get('ai_usage_official_order_v1'))
  api.saveSource('official');move([0],3) // stale Parrot page after source switch writes nothing
  assert.equal(JSON.stringify(storage.get('ai_usage_parrot_order_v1')),order);assert.equal(JSON.stringify(storage.get('ai_usage_official_order_v1')),officialOrder)
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
  assert.equal(api.VERSION,'1.7.34')
  assert.ok(storageWrites.every(k=>!['ai_usage_selected_accounts_v1','ai_usage_official_selected_v1'].includes(k)))
  // Syntax-only compilation of settings, plus version/updater integration.
  const index=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
  assert.equal(ts.transpileModule(index,{fileName:'index.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true}).diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
  assert.ok(index.includes('const FILES = ["api.ts", "widget.tsx", "index.tsx"]')); assert.ok(!index.includes('from "./official"')); assert.ok(index.includes('const VERSION = "'+JSON.parse(fs.readFileSync(path.join(root,'script.json'))).version+'"'))
  // Local widget aliases: never modify account records, stable-ID/source scoped, preserve all input except trim.
  const alias='🦜 工作@local · '+ '名字'.repeat(80)
  api.saveWidgetName('p0','  '+alias+'  ','parrot');api.saveWidgetName('p0','官方🐻','official')
  assert.equal(api.getWidgetName('p0','parrot'),alias);assert.equal(api.getWidgetName('p0','official'),'官方🐻')
  assert.equal(api.getWidgetName('toString','parrot'),'')
  api.saveWidgetName('__proto__','独立ID','parrot');assert.equal(api.getWidgetName('__proto__','parrot'),'独立ID')
  const remoteAccounts=JSON.stringify(accounts)
  for(const source of ['parrot','official']){
    api.saveSource(source)
    for(const [family,parameter] of [['systemSmall','1'],['systemSmall','1,2'],['systemMedium','1,2'],['systemMedium','1,2,3'],['systemMedium','1,2,3,4'],['systemLarge','1,2,3,4']]){
      scripting.Widget.family=family;scripting.Widget.parameter=parameter
      api.saveAccountOrder(accounts.map(a=>a.id),source)
      const tree=expand(Root({data:{...singleData,accounts},stale:false,error:null}))
      const name=api.getWidgetName('p0',source)
      assert.ok(tree.includes(name),family+parameter+source)
      const text=tree.find(x=>x.type==='Text'&&x.props.children===name);assert.equal(text.props.lineLimit,1)
      assert.ok(tree.includes('Codex'))
    }
    api.saveAccountOrder(accounts.map(a=>a.id).reverse(),source)
    const fresh=accounts.map(a=>({...a,name:a.name+' refreshed'}))
    assert.equal(api.getWidgetName(api.sortAccounts(fresh,source).find(a=>a.id==='p0').id,source),source==='parrot'?alias:'官方🐻')
  }
  assert.equal(JSON.stringify(accounts),remoteAccounts)
  api.saveSource('parrot');api.saveWidgetName('p0',' \n ','parrot');assert.equal(api.getWidgetName('p0','parrot'),'')
  const email={...accounts[0],name:'real@example.com'}
  const title=expand(AccountTitle({acc:email,font:12}));assert.ok(title.includes('real'));assert.ok(!title.includes(alias))
  scripting.Widget.parameter='';assert.ok(expand(Root({data:{...data,accounts:[]},stale:false,error:null})).includes('没有订阅账号'))
  // Real TextField state/edit/save interaction; editing alone does not persist.
  const {WidgetNamePage}=load('index.tsx');states.length=0
  let callbacks=0,reloads=0;scripting.Widget.reloadAll=async()=>{reloads++}
  const editor=()=>{hook=0;return expand(WidgetNamePage({account:accounts[0],source:'parrot',onSaved:()=>callbacks++}))}
  let editTree=editor();editTree.find(x=>x.type==='TextField').props.onChanged('  🐈 别名@keep  ')
  assert.equal(api.getWidgetName('p0','parrot'),'')
  editTree=editor();await editTree.find(x=>x.type==='Button'&&x.props.title==='保存').props.action()
  assert.equal(api.getWidgetName('p0','parrot'),'🐈 别名@keep');assert.equal(callbacks,1);assert.equal(reloads,1);assert.ok(editor().includes('已保存'))
  editor().find(x=>x.type==='TextField').props.onChanged('   ')
  await editor().find(x=>x.type==='Button'&&x.props.title==='保存').props.action();assert.equal(api.getWidgetName('p0','parrot'),'')
  api.saveWidgetName('p0',alias,'parrot');storage.set('ai_usage_cache_v1',{...data,accounts});states.length=0
  const aliasUI=render();assert.ok(aliasUI.some(x=>typeof x==='string'&&x.includes('匿名0')))
  assert.ok(aliasUI.includes(alias));assert.ok(aliasUI.some(x=>x.type==='NavigationLink'&&x.props.destination?.type?.name==='WidgetNamePage'))
  // Logout is explicitly official-scoped even when another source is currently active.
  api.saveWidgetName('p1','保留官方','official');api.logoutOfficial('p0')
  assert.equal(api.getWidgetName('p0','official'),'');assert.equal(api.getWidgetName('p1','official'),'保留官方');assert.equal(api.getWidgetName('p0','parrot'),alias)
  api.clearConfig();assert.equal(api.getWidgetName('p0','parrot'),'');assert.equal(api.getWidgetName('__proto__','parrot'),'');assert.equal(api.getWidgetName('p1','official'),'保留官方')
  // Latest official names derive only from legal local OAuth claims; ID/order/aliases survive duplicate login.
  const namedToken=(nameClaims,account='named-A',user='named-user')=>{
    const parts=token(account,user).split('.'),payload=JSON.parse(Buffer.from(parts[1],'base64url').toString())
    return 'mock.'+Buffer.from(JSON.stringify({...payload,...nameClaims})).toString('base64url')+'.mock'
  }
  const namedFlow=(nameClaims,account='named-A',idClaims=null)=>{
    handler=async (u,o)=>{
      if(u.endsWith('/usercode'))return resp(200,{device_auth_id:'mock',user_code:'MOCK',interval:5})
      if(u.endsWith('/deviceauth/token'))return resp(200,{authorization_code:'mock-code',code_verifier:'mock'})
      if(u.endsWith('/oauth/token'))return resp(200,{access_token:namedToken(nameClaims,account),id_token:idClaims?namedToken(idClaims,account):undefined,refresh_token:'mock-named-refresh'})
      if(u.endsWith('/usage'))return resp(200,{rate_limit:usage.rate_limit})
      return resp(404)
    }
  }
  api.saveSource('official');namedFlow({name:'测试名',preferred_username:'测试用户名',email:'mock@example.test'})
  await api.checkDeviceLogin(await api.beginDeviceLogin())
  const named=api.officialAccounts().find(a=>a.email==='mock@example.test');assert.ok(named)
  assert.equal(named.name,'mock@example.test');assert.equal(JSON.parse(kc.get('ai_usage_official_oauth_v1')).find(a=>a.id===named.id).name,'测试名')
  api.saveWidgetName(named.id,'保留别名','official');api.saveAccountOrder([named.id],'official')
  namedFlow({preferred_username:'更新用户名',email:'mock@example.test'})
  await api.checkDeviceLogin(await api.beginDeviceLogin())
  assert.equal(api.officialAccounts().find(a=>a.id===named.id).name,'mock@example.test');assert.equal(JSON.parse(kc.get('ai_usage_official_oauth_v1')).find(a=>a.id===named.id).name,'更新用户名');assert.equal(api.getWidgetName(named.id,'official'),'保留别名')
  assert.equal(api.officialAccounts().filter(a=>a.id===named.id).length,1)
  namedFlow({email:'mock@example.test'},'named-B');await api.checkDeviceLogin(await api.beginDeviceLogin())
  assert.ok(api.officialAccounts().some(a=>a.name==='mock@example.test'))
  namedFlow({name:'访问令牌姓名'},'named-C',{email:'id@example.test'});await api.checkDeviceLogin(await api.beginDeviceLogin())
  assert.ok(api.officialAccounts().some(a=>a.name==='id@example.test'));assert.ok(JSON.parse(kc.get('ai_usage_official_oauth_v1')).some(a=>a.name==='访问令牌姓名')) // email separate from name
  const stored=JSON.parse(kc.get('ai_usage_official_oauth_v1'))
  const migrate=stored.find(a=>a.id===named.id);migrate.name='官方账号 9';delete migrate.email;migrate.access=namedToken({name:'迁移名称','https://api.openai.com/profile':{email:'migrated@example.test'}})
  kc.set('ai_usage_official_oauth_v1',JSON.stringify(stored))
  assert.equal(api.officialAccounts().find(a=>a.id===named.id).name,'migrated@example.test');assert.equal(api.getWidgetName(named.id,'official'),'保留别名')
  storage.set('ai_usage_official_cache_v1',{...data,accounts:[{...accounts[0],id:named.id,name:'官方账号 9'}]})
  assert.equal(api.officialCached().accounts[0].name,'migrated@example.test')
  // Legacy access profile migration, nested ID profile, explicit missing-email fallback, full email App vs widget prefix.
  namedFlow({name:'真实名字但无邮箱'},'missing-email');await api.checkDeviceLogin(await api.beginDeviceLogin())
  const noEmail=api.officialAccounts().find(a=>a.id===JSON.parse(kc.get('ai_usage_official_oauth_v1')).find(a=>a.name==='真实名字但无邮箱').id)
  assert.equal(noEmail.email,'');assert.match(noEmail.name,/邮箱未提供/);assert.ok(!noEmail.name.includes('真实名字'))
  namedFlow({name:'昵称'},'nested-email',{'https://api.openai.com/profile':{email:'nested@example.test'}})
  await api.checkDeviceLogin(await api.beginDeviceLogin())
  const nested=api.officialAccounts().find(a=>a.email==='nested@example.test');assert.ok(nested)
  assert.ok(!Object.keys(JSON.parse(kc.get('ai_usage_official_oauth_v1')).find(a=>a.id===nested.id)).includes('id_token'))
  api.saveAccountOrder([nested.id,named.id],'official')
  await api.loadOfficialUsage();assert.equal(api.getWidgetName(named.id,'official'),'保留别名')
  const officialData=api.officialCached(),nestedAccount=officialData.accounts.find(a=>a.id===nested.id)
  assert.equal(nestedAccount.name,'nested@example.test')
  for(const family of ['systemSmall','systemMedium','systemLarge']){
    scripting.Widget.family=family;scripting.Widget.parameter=''
    const tree=expand(Root({data:{...officialData,accounts:[nestedAccount]},stale:false,error:null}))
    assert.ok(tree.includes('nested'));assert.ok(!tree.includes('昵称'));assert.ok(!tree.includes('nested@example.test'))
    api.saveWidgetName(nested.id,'自定义🐈@不截断','official')
    assert.ok(expand(Root({data:{...officialData,accounts:[nestedAccount]},stale:false,error:null})).includes('自定义🐈@不截断'))
    api.saveWidgetName(nested.id,'','official')
  }
  states.length=0;let emailUI=render()
  assert.ok(emailUI.some(x=>x.type==='Button'&&x.props.title==='退出 nested@example.test'))
  assert.ok(emailUI.some(x=>typeof x==='string'&&x.includes('Codex · nested@example.test')))
  const orderLink=emailUI.find(x=>x.type==='NavigationLink'&&x.props.destination?.type?.name==='AccountOrderPage')
  obsStore=[];obsIndex=0;const emailOrder=expand(orderLink.props.destination.type(orderLink.props.destination.props))
  const orderBuilder=emailOrder.find(x=>x.type==='ReorderableForEach')
  assert.ok(expand(orderBuilder.props.builder(nestedAccount,0)).some(x=>typeof x==='string'&&x.includes('nested@example.test')))
  await emailUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  emailUI=render();assert.ok(emailUI.some(x=>typeof x==='string'&&x.includes('Codex nested：5 h')))
  // Refresh response omitting email preserves the previously authorized stored email and aliases.
  const refreshRecord=JSON.parse(kc.get('ai_usage_official_oauth_v1'));const nr=refreshRecord.find(a=>a.id===nested.id)
  nr.expiresAt=now-1;kc.set('ai_usage_official_oauth_v1',JSON.stringify(refreshRecord))
  namedFlow({name:'续期昵称'},'nested-email');await api.loadOfficialUsage()
  assert.equal(api.officialAccounts().find(a=>a.id===nested.id).email,'nested@example.test')
  assert.equal(api.officialCached().accounts.find(a=>a.id===nested.id).name,'nested@example.test')
  api.saveWidgetName(nested.id,'待清理别名','official');api.saveWidgetName(nested.id,'另一来源保留','parrot')
  const beforeExitOrder=Array.from(api.sortAccounts(api.officialCached().accounts,"official"),a=>a.id)
  api.logoutOfficial(nested.id)
  assert.ok(!JSON.parse(kc.get('ai_usage_official_oauth_v1')).some(a=>a.id===nested.id))
  assert.ok(!api.officialCached().accounts.some(a=>a.id===nested.id));assert.equal(api.getWidgetName(nested.id,'official'),'')
  assert.equal(api.getWidgetName(nested.id,'parrot'),'另一来源保留')
  assert.deepEqual(Array.from(api.sortAccounts(api.officialCached().accounts,"official"),a=>a.id),beforeExitOrder.filter(id=>id!==nested.id))
  console.log('PASS: separate email/name; top+profile claims; legacy access migration; full-email App logout/list/order; status email prefix; widget prefix/alias priority; refresh email retention; scoped exit cleanup')
  // Safari Promise closes before exactly one check. Early-close interval is respected with one bounded wait.
  const {checkAfterSafari}=load('index.tsx')
  namedFlow({},'pending-test');let autoDevice=await api.beginDeviceLogin(),browserClose
  context.Safari.present=()=>new Promise(r=>browserClose=r)
  let active=true,before=calls.length
  const afterClose=checkAfterSafari(autoDevice,()=>active);await Promise.resolve();assert.equal(calls.length,before)
  handler=async()=>resp(403);browserClose();assert.equal(await afterClose,'pending');assert.equal(autoDevice.cancelled,false)
  before=calls.length;let waited=[]
  context.Safari.present=async()=>{}
  assert.equal(await checkAfterSafari(autoDevice,()=>true,async ms=>{waited.push(ms);now+=ms}),'pending')
  assert.deepEqual(waited,[5000]);assert.equal(calls.length,before+1)
  for(const mode of ['cancel','source','dismiss']){
    context.Safari.present=()=>new Promise(r=>browserClose=r);active=true
    const promise=checkAfterSafari(autoDevice,()=>active&&api.getSource()==='official')
    await Promise.resolve();before=calls.length
    if(mode==='cancel')api.cancelDeviceLogin(autoDevice)
    else if(mode==='source')api.saveSource('parrot')
    else active=false
    browserClose();assert.equal(await promise,null);assert.equal(calls.length,before)
    api.saveSource('official');namedFlow({},'pending-test');autoDevice=await api.beginDeviceLogin()
  }
  context.Safari.present=async()=>{};autoDevice.nextPoll=now+5000;before=calls.length
  assert.equal(await checkAfterSafari(autoDevice,()=>true,async ms=>{api.cancelDeviceLogin(autoDevice);now+=ms}),null)
  assert.equal(calls.length,before)
  namedFlow({},'expired-auto');autoDevice=await api.beginDeviceLogin();autoDevice.expiresAt=now
  await assert.rejects(()=>checkAfterSafari(autoDevice,()=>true),/过期/)
  // Full Settings action: browser closes, check succeeds, quota cache/list and widget refresh follow.
  states.length=0;context.Safari.present=async()=>{};namedFlow({name:'自动授权名称',email:'automatic@example.test'},'automatic-user')
  let reloadCount=0;scripting.Widget.reloadAll=async()=>{reloadCount++}
  let authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用授权页').props.action()
  authUI=render();assert.ok(authUI.some(x=>typeof x==='string'&&x.includes('automatic@example.test')))
  assert.ok(api.officialCached().accounts.some(a=>a.name==='automatic@example.test'));assert.ok(reloadCount>0)
  assert.ok(!authUI.some(x=>x.type==='Button'&&x.props.title==='检查授权'))
  // Cancel/dismiss during open Safari makes the captured UI action inert, no token save or request.
  for(const mode of ['cancel','dismiss','source']){
    states.length=0;namedFlow({},'abandoned-'+mode);context.Safari.present=()=>new Promise(r=>browserClose=r)
    authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
    authUI=render();const action=authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用授权页').props.action()
    await Promise.resolve();before=calls.length
    await authUI.find(x=>x.type==='Button'&&x.props.title==='检查授权').props.action();assert.equal(calls.length,before) // busy lock blocks competing checks
    if(mode==='cancel')authUI.find(x=>x.type==='Button'&&x.props.title==='取消登录').props.action()
    else if(mode==='dismiss')authUI.find(x=>x.type==='Form').props.toolbar.cancellationAction.props.action()
    else await authUI.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('parrot')
    browserClose();await action;assert.equal(calls.length,before);api.saveSource('official')
  }
  states.length=0;namedFlow({},'ui-pending');context.Safari.present=async()=>{}
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  handler=async()=>resp(403)
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用授权页').props.action()
  authUI=render();assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='检查授权'));assert.ok(authUI.some(x=>typeof x==='string'&&x.startsWith('等待授权')))
  context.Safari.present=async()=>{throw new Error('mock failure')}
  await authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用授权页').props.action()
  authUI=render();assert.ok(authUI.includes('无法打开官方授权页，请稍后重试'));assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='检查授权'))
  // Documented-shape WebViewController: each attempt has its own non-persistent store and finally disposal.
  const instances=[];let presentBrowser=async()=>{},loadBrowser=async()=>true
  scripting.WebViewController=class {
    constructor(options){this.options=options;this.disposed=0;this.urls=[];instances.push(this)}
    async loadURL(url){this.urls.push(url);return loadBrowser(this)}
    async present(options){this.presentation=options;await presentBrowser(this)}
    dispose(){this.disposed++}
  }
  const {presentIsolatedAuthorization}=load('index.tsx')
  for(let i=0;i<2;i++)await presentIsolatedAuthorization()
  assert.notEqual(instances[0],instances[1])
  for(const b of instances){assert.equal(b.options.ephemeral,true);assert.deepEqual(b.urls,['https://auth.openai.com/codex/device']);assert.equal(b.disposed,1)}
  for(const failure of ['loadFalse','loadThrow','presentThrow']){
    loadBrowser=async()=>{if(failure==='loadThrow')throw new Error('mock-load');return failure!=='loadFalse'}
    presentBrowser=async()=>{if(failure==='presentThrow')throw new Error('mock-present')}
    await assert.rejects(()=>presentIsolatedAuthorization());assert.equal(instances.at(-1).disposed,1)
  }
  loadBrowser=async()=>true;presentBrowser=async()=>{}
  api.saveSource('official');namedFlow({},'isolated-interval')
  const intervalDevice=await api.beginDeviceLogin();intervalDevice.nextPoll=now+3000
  handler=async()=>resp(403);before=calls.length;waited=[]
  assert.equal(await checkAfterSafari(intervalDevice,()=>true,async ms=>{waited.push(ms);now+=ms},presentIsolatedAuthorization),'pending')
  assert.deepEqual(waited,[3000]);assert.equal(calls.length,before+1);assert.equal(intervalDevice.cancelled,false);assert.equal(instances.at(-1).disposed,1)
  api.saveSource('official');states.length=0;namedFlow({email:'isolated@example.test'},'isolated-user')
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  authUI=render();assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='Safari备用授权页'))
  assert.ok(authUI.some(x=>typeof x==='string'&&x.includes('外部无痕授权网址')))
  await authUI.find(x=>x.type==='Button'&&x.props.title==='打开官方授权页').props.action()
  assert.equal(instances.at(-1).disposed,1)
  assert.ok(api.officialCached().accounts.some(a=>a.name==='isolated@example.test'))
  // Default temporary-browser action remains inert after cancel, source change or settings dismissal.
  for(const mode of ['cancel','source','dismiss']){
    api.saveSource('official');states.length=0;namedFlow({},'isolated-abandoned-'+mode)
    let closeBrowser;presentBrowser=()=>new Promise(resolve=>closeBrowser=resolve)
    authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
    authUI=render();const pendingAction=authUI.find(x=>x.type==='Button'&&x.props.title==='打开官方授权页').props.action()
    for(let i=0;i<8&&!closeBrowser;i++)await Promise.resolve()
    assert.ok(closeBrowser);before=calls.length
    if(mode==='cancel')authUI.find(x=>x.type==='Button'&&x.props.title==='取消登录').props.action()
    else if(mode==='dismiss')authUI.find(x=>x.type==='Form').props.toolbar.cancellationAction.props.action()
    else await authUI.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('parrot')
    const afterControl=calls.length
    closeBrowser();await pendingAction;assert.equal(calls.length,afterControl);assert.equal(instances.at(-1).disposed,1)
  }
  api.saveSource('official');states.length=0;namedFlow({},'isolated-failure');presentBrowser=async()=>{throw new Error('blocked identity provider')}
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  authUI=render();before=calls.length
  await authUI.find(x=>x.type==='Button'&&x.props.title==='打开官方授权页').props.action()
  assert.equal(calls.length,before);assert.equal(instances.at(-1).disposed,1)
  authUI=render();assert.ok(authUI.includes('无法打开官方授权页，请稍后重试'));assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='Safari备用授权页'))
  console.log('PASS: new ephemeral WebView per attempt; finally dispose normal/load/present failure; default close auto-refresh; cancel/source/dismiss guards; retryable embedded failure; explicit Safari fallback preserved')
  console.log('PASS: Safari dismissal pending/success/one interval wait/cancel/source/dismiss; UI auto cache+list+reload; claims names/fallback/duplicate IDs/alias preservation/local migration')
  console.log('PASS: aliases stable-ID persistence/source isolation/trim+Emoji+long names/prototype IDs/fallback/6 widget cases per source/refresh+order stability/zero accounts/editor save/reset/official logout+Parrot clear isolation; remote records unchanged')
  console.log('PASS: device pending/throttle/expired/cancel/in-flight cancel/success/dedup; refresh/401/rotation; duration mapping/reset cards; source isolation/logout; 3 widget trees; syntax/version/old updater; stable-ID sorting/default first accounts including disabled/parameters/pruning; obsolete selections ignored and never written; no UI Toggles; large label gap/six stat columns; Parrot grant/total; read-only Form list + NavigationLink to ScrollView/LazyVGrid ReorderableForEach (dragPreview rounded, active highlight) down/up/multi/end/no-op/invalid/cross-source/persistence; old onDrag/EditButton removed; one-decimal rounding; fixedSize intrinsic 6-column HStack/one column owns both periods/leading/no edge Spacer/uniform font factor and width budget; dual-arrow refresh icon in 3 families; Small one-account 4 stats/uncompressed shared columns/equal internal Spacers/summary scope; Small two-account no stats; official missing; Codex/Claude disabled gray title+SVG fill in 3 widget families, App foreground always normal, enabled 0%/unavailable/stale unchanged, no disabled words; quota colors unchanged')
}
main().catch(e=>{console.error(e);process.exitCode=1})
