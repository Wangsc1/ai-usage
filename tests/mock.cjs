// Local simulation only; never contacts a network or reads real credentials.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
let now = 1800000000000, handler, calls = [], reads = []
const kc = new Map(), storage = new Map(), storageWrites = []
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
const modules = {}
const scripting = new Proxy({ Widget: { family: 'systemLarge', parameter: '' } }, { get(o,k) { if(k==='WebViewController')return undefined;return o[k] || k } })
scripting.modifiers=()=>{const calls=[];const m=new Proxy({calls},{get(t,k){if(k==='calls')return calls;if(k==='toJSON')return undefined;return v=>{calls.push([k,v]);return m}}});return m}
const registeredIntents=new Map()
scripting.AppIntentProtocol={AppIntent:0}
scripting.AppIntentManager={register:options=>{registeredIntents.set(options.name,options);return params=>({script:'mock-script',name:options.name,protocol:options.protocol,params})}}
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
  let code = fs.readFileSync(name === 'gradient-baseline.tsx' ? process.env.GRADIENT_BASELINE_PATH : name === 'pre-accessory-widget.tsx' ? process.env.PRE_ACCESSORY_WIDGET_PATH : name === 'baseline-widget.tsx' ? process.env.BASELINE_WIDGET_PATH : path.join(root,name),'utf8')
  if (name === 'widget.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root, PeriodStats, statsWidthBudget, largeSegmentLayout, SegBar, Lcd, smallRegionLayout, AccountTitle, mediumTwoLayout, mediumThreeStatsLayout, run as runWidget }')
  if (name === 'baseline-widget.tsx' || name === 'gradient-baseline.tsx' || name === 'pre-accessory-widget.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { Root }')
  if (name === 'index.tsx') code = code.replace(/\nrun\(\)\s*$/, '\nexport { SettingsView, WidgetNamePage, checkAfterSafari, presentIsolatedAuthorization, updateFromGitHub }')
  const out = ts.transpileModule(code, { fileName:name, compilerOptions: {target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'}, reportDiagnostics:true })
  assert.equal((out.diagnostics || []).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,name+' syntax')
  const req = n => n === 'scripting' ? scripting : n === 'scripting/jsx-runtime' ? {jsx,jsxs:jsx,Fragment:'Fragment'} : load(n.replace('./','') + (fs.existsSync(path.join(root,n.replace('./','')+'.tsx'))?'.tsx':'.ts'))
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
  assert.ok(reads.includes('parrot_base_url'));assert.ok(reads.includes('ai_usage_official_oauth_v1'))
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
      assert.ok(texts.includes('Parrot今日/本月统计未提供'));assert.ok(!texts.includes('$0.00'))
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
      const icon=images.find(x=>x.props.systemName===('arrow.triangle.2.circlepath'))
      assert.ok(icon);assert.equal(icon.props.font,9);assert.ok(!images.some(x=>x.props.systemName==='arrow.clockwise'||x.props.systemName==='wifi.slash'))
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
          assert.equal(row.props.alignment,undefined);assert.equal(row.props.frame.maxWidth,'infinity')
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
  // Direct same-account parity: reset=1 adds only trailing Spacer/RE, never changes title vertical alignment.
  // This checks real emitted props against the pre-existing Parrot/no-reset default-center baseline,
  // not native glyph/pixel positions (those still require a phone).
  for(const source of ['parrot','official'])for(const font of [11,12])for(const enabled of [true,false])for(const available of [true,false]){
    api.saveSource(source)
    const a={...singleData.accounts[0],id:'title-layout-parity',name:'gpt2',enabled,available,resetCredits:null}
    const noReset=AccountTitle({acc:a,font}),withReset=AccountTitle({acc:{...a,resetCredits:1},font})
    assert.equal(noReset.props.alignment,undefined);assert.equal(withReset.props.alignment,noReset.props.alignment)
    assert.equal(withReset.props.spacing,noReset.props.spacing)
    const original=Array.from(noReset.props.children).filter(Boolean),added=Array.from(withReset.props.children).filter(Boolean)
    assert.equal(JSON.stringify(added.slice(0,original.length)),JSON.stringify(original))
    const username=original[2],re=added.at(-1)
    assert.equal(re.props.font,username.props.font);assert.equal(re.props.foregroundStyle,username.props.foregroundStyle)
    for(const text of [username,re])for(const forbidden of ['offset','padding','alignmentGuide','baselineOffset'])assert.equal(text.props[forbidden],undefined)
    assert.equal(added.at(-2).type,'Spacer');assert.equal(withReset.props.frame.maxWidth,'infinity')
  }
  api.saveSource('parrot')
  console.log('PASS: reset/no-reset title parity in both sources/fonts/enabled/availability; original leading children/spacing/default center identical; RE retains gray size/trailing edge; NOT native pixel proof')
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
      assert.equal(absent.upper.props.children.props.children,'Parrot今日/本月统计未提供')
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
  assert.equal(api.VERSION,'1.9.1')
  assert.ok(storageWrites.every(k=>!['ai_usage_selected_accounts_v1','ai_usage_official_selected_v1'].includes(k)))
  // Syntax-only compilation of settings, plus version/updater integration.
  const index=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
  assert.equal(ts.transpileModule(index,{fileName:'index.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true}).diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
  assert.ok(index.includes('const FILES = ["api.ts", "app_intents.tsx", "widget.tsx", "index.tsx"]')); assert.ok(!index.includes('from "./official"')); assert.ok(index.includes('const VERSION = "'+JSON.parse(fs.readFileSync(path.join(root,'script.json'))).version+'"'))
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
  assert.ok(emailUI.some(x=>x.type==='Text'&&x.props.children==='Codex nested@example.test'))
  assert.ok(emailUI.some(x=>typeof x==='string'&&x.includes('Codex · nested@example.test')))
  const orderLink=emailUI.find(x=>x.type==='NavigationLink'&&x.props.destination?.type?.name==='AccountOrderPage')
  obsStore=[];obsIndex=0;const emailOrder=expand(orderLink.props.destination.type(orderLink.props.destination.props))
  const orderBuilder=emailOrder.find(x=>x.type==='ReorderableForEach')
  assert.ok(expand(orderBuilder.props.builder(nestedAccount,0)).some(x=>typeof x==='string'&&x.includes('nested@example.test')))
  await emailUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  emailUI=render();assert.ok(emailUI.some(x=>typeof x==='string'&&x.includes('Codex nested@example.test：5 h')))
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
  console.log('PASS: separate email/name; top+profile claims; legacy access migration; full-email App logout/list/order; status full email; widget prefix/alias priority; refresh email retention; scoped exit cleanup')
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
  const browserTimers=new Map();let timerId=0
  context.setTimeout=(fn,ms)=>{if(ms===20000){const id=++timerId;browserTimers.set(id,fn);return id}now+=ms;Promise.resolve().then(fn);return 0}
  context.clearTimeout=id=>browserTimers.delete(id)
  const instances=[];let presentBrowser=async()=>{},loadBrowser=async()=>true
  context.WebViewController=class {
    constructor(options){this.options=options;this.disposed=0;this.urls=[];instances.push(this)}
    async loadURL(url){this.urls.push(url);return loadBrowser(this)}
    async present(options){this.presentation=options;await presentBrowser(this)}
    dispose(){this.disposed++}
  }
  assert.equal(scripting.WebViewController,undefined)
  // The old module-import construction fails despite a valid GLOBAL API.
  const legacy=ts.transpileModule('import {WebViewController} from "scripting"; export function open(){return new WebViewController({ephemeral:true})}',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
  const legacyModule={exports:{}}
  vm.runInContext(`(function(require,module,exports){${legacy}})`,context)(()=>scripting,legacyModule,legacyModule.exports)
  assert.throws(()=>legacyModule.exports.open(),/not a constructor/);assert.equal(instances.length,0)
  const {presentIsolatedAuthorization}=load('index.tsx')
  for(let i=0;i<2;i++)await presentIsolatedAuthorization()
  assert.notEqual(instances[0],instances[1])
  for(const b of instances){assert.equal(b.options.ephemeral,true);assert.deepEqual(b.urls,['https://auth.openai.com/codex/device']);assert.equal(b.disposed,1)}
  for(const failure of ['loadFalse','loadThrow','presentThrow']){
    loadBrowser=async()=>{if(failure==='loadThrow')throw new Error('mock-load');return failure!=='loadFalse'}
    presentBrowser=async()=>{if(failure==='presentThrow')throw new Error('mock-present');await new Promise(()=>{})}
    await assert.rejects(()=>presentIsolatedAuthorization());assert.equal(instances.at(-1).disposed,1)
  }
  // Real delayed navigation: the former await-load-before-present would NEVER invoke present in this test.
  let finishLoad,closeDelayed;loadBrowser=()=>new Promise(resolve=>finishLoad=resolve)
  presentBrowser=b=>{assert.equal(b.urls.length,0);return new Promise(resolve=>closeDelayed=resolve)}
  let settled=false
  const delayed=presentIsolatedAuthorization().then(()=>{settled=true})
  assert.ok(closeDelayed);assert.ok(finishLoad);assert.equal(instances.at(-1).disposed,0)
  assert.equal(browserTimers.size,1)
  finishLoad(true);for(let i=0;i<8;i++)await Promise.resolve();assert.equal(settled,false);assert.equal(browserTimers.size,0)
  closeDelayed();await delayed;assert.equal(instances.at(-1).disposed,1)
  // Hung navigation has a bounded failure, not an invisible indefinitely-busy button.
  loadBrowser=()=>new Promise(()=>{});presentBrowser=()=>new Promise(()=>{})
  const hung=presentIsolatedAuthorization();assert.equal(browserTimers.size,1)
  Array.from(browserTimers.values())[0]()
  await assert.rejects(()=>hung,/加载超时/);assert.equal(instances.at(-1).disposed,1);assert.equal(browserTimers.size,0)
  // Dismiss before load settles: no unhandled rejection/false-success from later navigation completion.
  let rejectLate,closeEarly
  loadBrowser=()=>new Promise((_,reject)=>rejectLate=reject);presentBrowser=()=>new Promise(resolve=>closeEarly=resolve)
  const early=presentIsolatedAuthorization();closeEarly();await early;rejectLate(new Error('late navigation failure'))
  await Promise.resolve();assert.equal(instances.at(-1).disposed,1);assert.equal(browserTimers.size,0)
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
    await pendingAction;assert.equal(calls.length,afterControl);assert.equal(instances.at(-1).disposed,1)
    assert.equal(browserTimers.size,0);closeBrowser() // native dismiss may settle later; cancellation already released and completed
  }
  api.saveSource('official');states.length=0;namedFlow({},'isolated-failure');presentBrowser=async()=>{throw new Error('blocked identity provider')}
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  authUI=render();before=calls.length
  await authUI.find(x=>x.type==='Button'&&x.props.title==='打开官方授权页').props.action()
  assert.equal(calls.length,before);assert.equal(instances.at(-1).disposed,1)
  authUI=render();assert.ok(authUI.includes('无法打开官方授权页，请稍后重试'));assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='Safari备用授权页'))
  states.length=0;api.saveSource('official');namedFlow({},'ui-navigation-hung')
  loadBrowser=()=>new Promise(()=>{});presentBrowser=()=>new Promise(()=>{})
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  authUI=render();before=calls.length
  const hungUI=authUI.find(x=>x.type==='Button'&&x.props.title==='打开官方授权页').props.action()
  assert.ok(render().some(x=>typeof x==='string'&&x.startsWith('正在打开官方授权页')))
  Array.from(browserTimers.values())[0]();await hungUI
  authUI=render();assert.equal(calls.length,before)
  assert.ok(authUI.some(x=>typeof x==='string'&&x.startsWith('授权页面加载超时')))
  assert.equal(authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用授权页').props.disabled,false)
  assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='检查授权'))
  assert.equal(instances.at(-1).disposed,1);assert.equal(browserTimers.size,0)
  // Global absent: accurate error displayed adjacent to opening buttons, device remains retryable.
  const supportedBrowser=context.WebViewController;delete context.WebViewController
  states.length=0;api.saveSource('official');namedFlow({},'unsupported-global')
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
  authUI=render();before=calls.length
  await authUI.find(x=>x.type==='Button'&&x.props.title==='打开官方授权页').props.action()
  authUI=render();assert.equal(calls.length,before);assert.equal(browserTimers.size,0)
  const unsupported=authUI.find(x=>x.type==='Text'&&x.props.foregroundStyle==='systemRed')
  assert.ok(unsupported.props.children.startsWith('当前Scripting不支持WebViewController'))
  const section=authUI.find(x=>x.type==='Section'&&x.props.header?.props.children==='官方账号（独立登录）')
  assert.ok(expand(section).includes(unsupported))
  assert.equal(authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用授权页').props.disabled,false)
  context.WebViewController=supportedBrowser
  // Long press uses official contextMenu and Pasteboard, copying ONLY this code value.
  let copied=[];context.Pasteboard={setString:async value=>copied.push(value)}
  for(const mode of ['cancel','source','dismiss','expired','success']){
    states.length=0;api.saveSource('official');namedFlow({},'copy-'+mode)
    authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
    authUI=render();const codeText=authUI.find(x=>x.type==='Text'&&x.props.contextMenu)
    assert.equal(codeText.props.children[0],'一次性代码：')
    const copy=expand(codeText.props.contextMenu.menuItems).find(x=>x.type==='Button'&&x.props.title==='复制代码')
    const beforeCopies=copied.length, beforeStorage=storageWrites.length
    await copy.props.action();assert.equal(copied.length,beforeCopies+1);assert.equal(copied.at(-1),codeText.props.children[1]);assert.ok(!copied.at(-1).includes('一次性代码'));assert.equal(storageWrites.length,beforeStorage)
    if(mode==='cancel')authUI.find(x=>x.type==='Button'&&x.props.title==='取消登录').props.action()
    else if(mode==='source')await authUI.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('parrot')
    else if(mode==='dismiss')authUI.find(x=>x.type==='Form').props.toolbar.cancellationAction.props.action()
    else if(mode==='expired')now+=15*60*1000
    else await authUI.find(x=>x.type==='Button'&&x.props.title==='检查授权').props.action()
    await copy.props.action();assert.equal(copied.length,beforeCopies+1,'stale copy blocked: '+mode)
    if(mode!=='expired')assert.ok(!render().some(x=>x.type==='Text'&&x.props.contextMenu))
    else assert.equal(expand(render().find(x=>x.type==='Text'&&x.props.contextMenu).props.contextMenu.menuItems).find(x=>x.type==='Button').props.disabled,true)
  }
  // Real loadUsage + widget run + App refresh: aggregate is always Parrot; quota source stays independent.
  api.clearConfig();api.saveConfig('mock-base','mock-management');api.saveSource('official')
  const seed=JSON.parse(kc.get('ai_usage_official_oauth_v1'))[0]
  const quotaItems=[0,1,2].map(i=>({...seed,id:'combined-official-'+i,accountId:'combined-account-'+i,subject:'combined-user-'+i,
    access:token('combined-account-'+i,'combined-user-'+i),expiresAt:now+3600000}))
  kc.set('ai_usage_official_oauth_v1',JSON.stringify(quotaItems));storage.delete('ai_usage_official_cache_v1')
  let statsFailure=false,quotaFailure=false,missingOverall=false,denyStatsOnce=false
  const combinedHandler=async(u,o)=>{
    if(u.startsWith('mock-base/api/management/v1/')){
      assert.ok(!o.headers['ChatGPT-Account-ID']);assert.ok(!String(o.headers.Authorization).includes('mock.'))
      if(u.endsWith('/auth/sessions')){assert.equal(JSON.parse(o.body).managementKey,'mock-management');return resp(201,{data:{credential:'combined-session'}})}
      assert.equal(o.headers.Authorization,'Bearer combined-session')
      if(u.includes('/stats/summary')){
        if(denyStatsOnce){denyStatsOnce=false;return resp(401,{error:{code:'EXPIRED'}})}
        if(statsFailure)return resp(503,{error:{code:'UNAVAILABLE'}})
        return resp(200,{data:missingOverall?{overall:{}}:{overall:{total:u.includes("period=month")?46:23,inputTokens:u.includes("period=month")?2400:1200,outputTokens:3400,cacheReadTokens:500,cacheCreationTokens:600,costTicks:78000000000},families:{all:{total:23,inputTokens:1200}}}})
      }
      if(u.includes('/oauth/accounts?pageSize'))return resp(200,{data:{items:[{accountId:'combined-parrot',enabled:true,provider:'claude',displayName:'only-parrot',available:true}]}})
      if(u.endsWith('/oauth/accounts/combined-parrot'))return resp(200,{data:{usageWindows:[],resetCreditCount:0}})
      throw new Error('unexpected Parrot path')
    }
    assert.ok(u.startsWith('https://chatgpt.com/backend-api/wham/'))
    assert.ok(o.headers.Authorization.startsWith('Bearer mock.'));assert.ok(o.headers['ChatGPT-Account-ID'].startsWith('combined-account-'))
    return quotaFailure?resp(503):resp(200,{...usage,rate_limit_reset_credits:{available_count:1}})
  }
  handler=combinedHandler;before=calls.length
  let combined=await api.loadUsage(),batch=calls.slice(before)
  assert.equal(combined.stale,false);assert.equal(combined.data.today.totalTokens,5700);assert.equal(combined.data.today.requests,23);assert.equal(combined.data.today.costUsd,7.8);assert.equal(combined.data.month.requests,46);assert.equal(combined.data.month.totalTokens,6900)
  assert.equal(combined.data.accounts.length,3);assert.ok(combined.data.accounts.every(a=>a.id.startsWith('combined-official-')))
  assert.equal(batch.filter(c=>c.url.includes('/stats/summary')).length,2);assert.equal(batch.filter(c=>c.url.endsWith('/auth/sessions')).length,1)
  assert.equal(batch.filter(c=>c.url.includes('/oauth/accounts')).length,0)
  assert.equal(batch.filter(c=>c.url.endsWith('/usage')).length,3)
  assert.equal(storage.get('ai_usage_official_cache_v1').today,null);assert.equal(storage.get('ai_usage_cache_v1'),undefined)
  assert.equal(storage.get('ai_usage_parrot_stats_v1').accounts,undefined)
  function assertOriginalRefreshFooter(data,stale){
    const tree=expand(Root({data,stale,error:null}))
    const footers=tree.filter(x=>x.type==='HStack'&&x.props.spacing===3&&Array.isArray(x.props.children)&&x.props.children[0]?.type==='Button'&&x.props.children[0]?.props.children?.type==='Image')
    assert.equal(footers.length,1)
    const children=Array.from(footers[0].props.children);assert.deepEqual(children.map(x=>x.type),['Button','Text']);assert.equal(children[0].props.intent.name,'RefreshUsageIntent');assert.equal(children[0].props.action,undefined);assert.equal(children[0].props.buttonStyle,'plain')
    assert.equal(children[0].props.children.props.systemName,'arrow.triangle.2.circlepath');assert.equal(children[0].props.children.props.font,9);assert.deepEqual({...children[0].props.frame},{width:12,height:12})
    assert.equal(children[0].props.children.props.foregroundStyle.light,'#5E6068');assert.equal(children[0].props.children.props.foregroundStyle.dark,'#8E8E93')
    assert.equal(children[1].props.children,api.fmtTime(data.fetchedAt));assert.equal(children[1].props.font,9);assert.equal(children[1].props.monospacedDigit,true)
    assert.equal(children[1].props.foregroundStyle.light,'#5E6068');assert.equal(children[1].props.foregroundStyle.dark,'#8E8E93')
    assert.ok(!tree.some(x=>typeof x==='string'&&x.includes('统计P')))
  }
  assert.ok(!fs.readFileSync(path.join(root,'widget.tsx'),'utf8').includes('statsAge'))
  let statsTimestamp=combined.data.statistics.fetchedAt;const quotaTimestamp=combined.data.fetchedAt
  // Every layout that owns statistics uses the actual combined load result, not filtered account values.
  for(const [family,param] of [['systemSmall','1'],['systemMedium','1,2'],['systemMedium','1,2,3'],['systemLarge','']]){
    scripting.Widget.family=family;scripting.Widget.parameter=param
    const tree=expand(Root({data:combined.data,stale:false,error:null})),texts=tree.filter(x=>x.type==='Text').map(x=>[].concat(x.props.children).join(''))
    assert.ok(texts.includes(api.fmtTokens(5700)));assert.ok(texts.includes(api.fmtTokens(6900)));assert.ok(texts.includes(api.fmtUsd(7.8)))
    assert.ok(!tree.includes('only-parrot'));assertOriginalRefreshFooter(combined.data,false);assertOriginalRefreshFooter(combined.data,true)
  }
  for(const family of ['systemSmall','systemMedium','systemLarge']){
    scripting.Widget.family=family
    for(const statistics of [undefined,{...combined.data.statistics,fetchedAt:null,error:'stats unavailable',stale:false},{...combined.data.statistics,fetchedAt:now-2880*60000,error:'stats failed',stale:true}]){
      const footerData={...combined.data,statistics}
      for(const stale of [false,true])assertOriginalRefreshFooter(footerData,stale)
    }
  }
  console.log('PASS: interactive footer all families: ONLY refresh Button+data.fetchedAt time; spacing3/icon-font9/hit-frame12/time-font9/monospaced/SUB; intent unchanged; stale shows refresh not wifi; no 统计P/extra Text')
  const clickableTree=expand(Root({data:combined.data,stale:false,error:null}))
  const refreshButton=clickableTree.find(x=>x.type==='Button'&&x.props.intent?.name==='RefreshUsageIntent')
  assert.ok(refreshButton);assert.equal(refreshButton.props.intent.params,undefined)
  assert.equal(clickableTree.filter(x=>x.type==='Button'&&x.props.intent?.name==='RefreshUsageIntent').length,1)
  assert.equal(registeredIntents.get('RefreshUsageIntent').protocol,0)
  const performRefresh=()=>registeredIntents.get(refreshButton.props.intent.name).perform(refreshButton.props.intent.params)
  const previousReload=scripting.Widget.reloadAll;let intentReloads=0
  scripting.Widget.reloadAll=async()=>{intentReloads++}
  now+=1000;before=calls.length;await performRefresh()
  assert.equal(intentReloads,1);assert.equal(calls.slice(before).filter(x=>x.url.includes('/stats/summary')).length,2)
  assert.equal(calls.slice(before).filter(x=>x.url.endsWith('/usage')).length,3)
  assert.ok(api.officialCached().fetchedAt>quotaTimestamp)
  const refreshedAt=api.officialCached().fetchedAt,statsAt=storage.get('ai_usage_parrot_stats_v1').fetchedAt
  now+=1000;quotaFailure=true;statsFailure=true;before=calls.length
  await performRefresh();assert.equal(intentReloads,2)
  assert.equal(api.officialCached().fetchedAt,refreshedAt);assert.equal(storage.get('ai_usage_parrot_stats_v1').fetchedAt,statsAt)
  assert.equal(calls.slice(before).filter(x=>x.url.includes('/stats/summary')).length,2)
  const failedIntentResult=await api.loadUsage();assert.equal(failedIntentResult.stale,true)
  assertOriginalRefreshFooter(failedIntentResult.data,true)
  // Same registered intent resolves current source at execution, not a serialized token/source parameter.
  quotaFailure=false;statsFailure=false;api.saveSource('parrot');before=calls.length
  await performRefresh();assert.equal(intentReloads,3)
  assert.ok(calls.slice(before).some(x=>x.url.includes('/oauth/accounts?pageSize')))
  assert.equal(calls.slice(before).filter(x=>x.url.includes('/stats/summary')).length,2)
  assert.ok(calls.slice(before).every(x=>x.url.startsWith('mock-base')))
  api.saveSource('official');storage.delete('ai_usage_cache_v1');scripting.Widget.reloadAll=previousReload
  console.log('PASS: rendered Button.intent executes registered app_intents perform; official quota+Parrot stats real loader requests then Widget.reloadAll; failed requests retain cache timestamps and still reload; Parrot current-source execution; one button/no whole-widget action/no settings')
  // The executable widget entry itself must call the composed loader.
  let presented;scripting.Widget.present=(tree,options)=>{presented={tree,options}}
  before=calls.length;await load('widget.tsx').runWidget()
  assert.equal(calls.slice(before).filter(c=>c.url.includes('/stats/summary')).length,2)
  assert.equal(presented.tree.props.data.today.requests,23);assert.ok(presented.tree.props.data.accounts.every(a=>a.id.startsWith('combined-official-')))
  assert.equal(presented.options.reloadPolicy.policy,'after')
  // Actual Settings Picker -> persisted minutes -> reloadAll -> widget entry passes a Date (ms), not a numeric timer.
  {
    const savedRefresh=storage.get('ai_usage_refresh_minutes_v1'),savedReload=scripting.Widget.reloadAll
    let reloads=0;scripting.Widget.reloadAll=async()=>{reloads++}
    storage.delete('ai_usage_refresh_minutes_v1');assert.equal(api.getRefreshMinutes(),15)
    await load('widget.tsx').runWidget();assert.equal(presented.options.reloadPolicy.date.getTime(),now+15*60000)
    for(const minutes of [5,15,30,60]){
      states.length=0;const settings=render(),picker=settings.find(x=>x.type==='Picker'&&x.props.title==='刷新间隔')
      await picker.props.onChanged(String(minutes));assert.equal(storage.get('ai_usage_refresh_minutes_v1'),minutes);assert.equal(api.getRefreshMinutes(),minutes)
      const started=now;await load('widget.tsx').runWidget()
      assert.equal(presented.options.reloadPolicy.policy,'after');assert.equal(presented.options.reloadPolicy.date.getTime(),started+minutes*60000)
      assert.ok(presented.options.reloadPolicy.date instanceof context.Date)
      // Opening a new settings view retains the saved setting.
      states.length=0;assert.equal(render().find(x=>x.type==='Picker'&&x.props.title==='刷新间隔').props.value,String(minutes))
    }
    assert.equal(reloads,4)
    api.saveRefreshMinutes(7);assert.equal(api.getRefreshMinutes(),60)
    storage.set('ai_usage_refresh_minutes_v1',999);assert.equal(api.getRefreshMinutes(),15)
    api.saveRefreshMinutes(30);const beforeManual=now
    await registeredIntents.get('RefreshUsageIntent').perform(undefined);assert.equal(api.getRefreshMinutes(),30);assert.equal(reloads,5)
    now+=2000;await load('widget.tsx').runWidget();assert.equal(presented.options.reloadPolicy.date.getTime(),now+30*60000)
    assert.ok(presented.options.reloadPolicy.date.getTime()>beforeManual+30*60000) // next generated timeline anchored to new render
    if(savedRefresh==null)storage.delete('ai_usage_refresh_minutes_v1');else storage.set('ai_usage_refresh_minutes_v1',savedRefresh)
    scripting.Widget.reloadAll=savedReload;states.length=0
  }
  console.log('PASS: real Settings interval Picker persists/reloads; default15/5/15/30/60/invalid; Widget.present reloadPolicy after Date at render+minutes*60000; reopened settings retains; manual intent leaves setting unchanged and next timeline uses new render time; NOT native scheduling proof')

  // App uses the same composed path and reports source/freshness independently.
  states.length=0;authUI=render();before=calls.length
  await authUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  authUI=render();assert.ok(authUI.includes('统计：Parrot全部账号汇总；额度：官方OAuth（Codex/Claude）'))
  assert.ok(authUI.some(x=>typeof x==='string'&&x.includes('23 次')))
  assert.equal(calls.slice(before).filter(c=>c.url.includes('/stats/summary')).length,2)
  statsTimestamp=storage.get('ai_usage_parrot_stats_v1').fetchedAt
  // Only statistics fails: quota refresh is still current; stats cache has its OWN unchanged time.
  now+=60000;statsFailure=true;combined=await api.loadUsage()
  assert.equal(combined.stale,false);assert.equal(combined.error,null);assert.equal(combined.data.today.totalTokens,5700)
  assert.equal(combined.data.statistics.stale,true);assert.equal(combined.data.statistics.fetchedAt,statsTimestamp)
  assert.ok(combined.data.fetchedAt>quotaTimestamp);assert.ok(combined.data.statistics.error)
  assertOriginalRefreshFooter(combined.data,false);assertOriginalRefreshFooter(combined.data,true)
  for(const minutes of [1,120,2880]){
    const ageData={...combined.data,statistics:{...combined.data.statistics,fetchedAt:now-minutes*60000}}
    assertOriginalRefreshFooter(ageData,false);assertOriginalRefreshFooter(ageData,true)
  }
  states.length=0;authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  assert.ok(render().includes('⚠️ 额度已刷新；Parrot统计独立读取失败'))
  // No statistics cache, malformed response, and no config all yield unknown, never fabricated zero.
  storage.delete('ai_usage_parrot_stats_v1');combined=await api.loadUsage();assert.equal(combined.data.today,null);assert.equal(combined.data.month,null);assert.equal(combined.data.statistics.fetchedAt,null)
  assertOriginalRefreshFooter(combined.data,false);assertOriginalRefreshFooter(combined.data,true)
  statsFailure=false;missingOverall=true;combined=await api.loadUsage();assert.equal(combined.data.today,null);assert.equal(combined.data.statistics.error,'Parrot今日/本月统计未提供');missingOverall=false
  kc.delete('parrot_base_url');before=calls.length;combined=await api.loadUsage()
  assert.equal(combined.data.today,null);assert.equal(combined.data.statistics.error,'Parrot统计未配置');assert.equal(combined.data.accounts.length,3)
  assert.equal(calls.slice(before).filter(c=>c.url.startsWith('mock-base')).length,0)
  api.saveConfig('mock-base','mock-management')
  // Only official quota fails: current stats + official cached accounts, NOT Parrot accounts.
  quotaFailure=true;combined=await api.loadUsage()
  assert.equal(combined.stale,true);assert.equal(combined.data.statistics.stale,false);assert.equal(combined.data.today.totalTokens,5700)
  assert.ok(combined.data.accounts.every(a=>a.id.startsWith('combined-official-')))
  storage.delete('ai_usage_official_cache_v1');combined=await api.loadUsage();assert.equal(combined.data,null);assert.ok(combined.error)
  // Stats 401 refresh retries once without interfering with official credentials.
  quotaFailure=false;denyStatsOnce=true;before=calls.length;const credsBefore=kc.get('ai_usage_official_oauth_v1');combined=await api.loadUsage();batch=calls.slice(before)
  assert.equal(combined.data.statistics.error,null);assert.equal(batch.filter(c=>c.url.endsWith('/auth/sessions')).length,1)
  assert.equal(batch.filter(c=>c.url.includes('/stats/summary')).length,4);assert.equal(kc.get('ai_usage_official_oauth_v1'),credsBefore)
  // Switching to Parrot follows original full loader with exactly two summaries, no extra stats pass.
  api.saveSource('parrot');before=calls.length;combined=await api.loadUsage();batch=calls.slice(before)
  assert.equal(combined.data.accounts[0].id,'combined-parrot');assert.equal(batch.filter(c=>c.url.includes('/stats/summary')).length,2)
  assert.ok(batch.every(c=>c.url.startsWith('mock-base')));assert.equal(combined.data.today.requests,23)
  assert.equal(api.cachedAccounts()[0].id,'combined-parrot')
  api.saveSource('official');assert.ok(api.cachedAccounts().every(a=>a.id.startsWith('combined-official-')))
  // A delayed official App refresh must not replace the newly selected Parrot account list.
  states.length=0;authUI=render();let finishOldQuota;let held=false
  handler=async(u,o)=>{if(u.endsWith('/usage')&&!held){held=true;await new Promise(resolve=>finishOldQuota=resolve)}return combinedHandler(u,o)}
  const delayedRefresh=authUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  for(let i=0;i<8&&!finishOldQuota;i++)await Promise.resolve();assert.ok(finishOldQuota)
  await authUI.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('parrot')
  const beforeOldReturns=JSON.stringify(render().filter(x=>typeof x==='string'))
  finishOldQuota();await delayedRefresh
  assert.equal(JSON.stringify(render().filter(x=>typeof x==='string')),beforeOldReturns)
  assert.ok(render().some(x=>typeof x==='string'&&x.includes('only-parrot')))
  handler=combinedHandler;api.saveSource('official')
  // Full Parrot cache can seed legacy stats fallback but its account IDs never leak.
  storage.set('ai_usage_cache_v1',{...storage.get('ai_usage_cache_v1'),...storage.get('ai_usage_parrot_stats_v1')}) // actual legacy full cache
  storage.delete('ai_usage_parrot_stats_v1');statsFailure=true;combined=await api.loadUsage()
  assert.equal(combined.data.today.requests,23);assert.equal(combined.data.statistics.stale,true);assert.ok(combined.data.accounts.every(a=>a.id.startsWith('combined-official-')))
  api.clearConfig();assert.equal(storage.get('ai_usage_parrot_stats_v1'),undefined);assert.ok(api.officialCached())
  console.log('PASS: real composed loader/App/widget entry; Parrot aggregate unfiltered; stats-only 2 requests official/no account fetch; Parrot no duplicate; isolated headers/caches/accounts; missing/failure/cache times/401; quota failure independent; all statistics layouts preserve source')
  // Claude public OAuth contracts: globals only, actual SHA256/base64url, loopback native-shaped API.
  const nodeCrypto=require('node:crypto'),claudeAPI=api,claudeServers=[],claudeTimers=new Map()
  let nextClaudeTimer=100000
  context.setTimeout=(fn,ms)=>{const id=nextClaudeTimer++;claudeTimers.set(id,{fn,ms});return id}
  context.clearTimeout=id=>claudeTimers.delete(id)
  const binary=buf=>({toBase64String:()=>Buffer.from(buf).toString('base64'),toRawString:()=>Buffer.from(buf).toString(),bytes:Buffer.from(buf)})
  context.Data.fromRawString=value=>binary(Buffer.from(value))
  context.Crypto={generateSymmetricKey:bits=>{assert.equal(bits,256);return binary(nodeCrypto.randomBytes(bits/8))},sha256:data=>binary(nodeCrypto.createHash('sha256').update(data.bytes).digest())}
  context.HttpResponseBody={text:text=>text};context.HttpResponse={ok:body=>({statusCode:200,reasonPhrase:'OK',body})}
  let serverError=false,diagnosticStage=null,startNativeError=null,startThrows=false,startCalls=0,startScenario=null
  context.HttpServer=class {
    constructor(){if(diagnosticStage==='构造')throw new Error('SECRET-native-url-token');this.stops=0;this.port=null;this.state='stopped';this.handlers={};claudeServers.push(this)}
    set listenAddressIPv4(value){if(diagnosticStage==='地址配置')throw new Error('SECRET-address');this.address=value}
    get listenAddressIPv4(){return diagnosticStage==='地址读回'?null:this.address}
    registerHandler(path,handler){if(diagnosticStage==='注册handler')throw new Error('SECRET-register');this.handlers[path]=handler}
    start(options){
      startCalls++;assert.equal(this.listenAddressIPv4,'127.0.0.1');assert.equal(options.forceIPv4,true)
      // Documented start returns string|null, port is null before start and populated after success.
      // Model a native compatibility failure for port0 without making it a proven device cause.
      if(options.port===0)return 'port 0 is not supported'
      assert.equal(options.port,8080)
      if(startScenario){this.state=startScenario.state;this.port=startScenario.port;this.isIPv4=startScenario.ipv4;return startScenario.result}
      if(startNativeError){if(startThrows)throw startNativeError;return startNativeError}
      if(serverError||diagnosticStage==='启动')return 'SECRET-start-url'
      this.port=diagnosticStage==='端口'?null:options.port;this.state='running';return null
    }
    stop(){this.stops++;this.state='stopped';this.port=null}
  }
  kc.delete('ai_usage_claude_oauth_v1')
  let claudeAccount='claude-a',claudeEmail='claude-a@example.test',claudeOrg='org-a',claudePostFailure=false,claudeProfileFailure=false,claudeUsageFailure=false,claudeRefreshFailure=false,omitRefresh=false,usage401=false
  let grantedClaudeScope="user:profile user:inference",lastRefreshBody
  let lastExchange,refreshCount=0,holdToken,holdProfile,releaseClaudeRequest
  const claudeUsage={five_hour:{utilization:37.5,resets_at:'2030-01-01T01:00:00Z'},seven_day:{utilization:81,resets_at:'2030-01-03T01:00:00Z'},seven_day_sonnet:{utilization:2},seven_day_opus:{utilization:3},extra_usage:{utilization:4}}
  const claudeHandler=async(u,o)=>{
    if(u==='https://platform.claude.com/v1/oauth/token'){
      assert.equal(o.method,'POST');assert.equal(typeof o.body,'string');assert.equal(o.timeout,20)
      // RequestInit accepts a header record; interpret it using the actual WHATWG Headers contract.
      const wireHeaders=new Headers(o.headers),b=JSON.parse(o.body)
      assert.equal(wireHeaders.get('content-type'),'application/json')
      assert.equal(b.client_id,'9d1c250a-e61b-44d9-88ed-5944d1962f5e');assert.ok(!b.client_secret)
      if(b.grant_type==='authorization_code'){
        assert.equal(wireHeaders.get('accept'),'application/json');assert.equal(wireHeaders.get('user-agent'),'ai-usage/1.9.1')
        assert.deepEqual([...wireHeaders.keys()].sort(),['accept','content-type','user-agent'])
        assert.deepEqual(Object.keys(b).sort(),['grant_type','code','redirect_uri','client_id','code_verifier','state'].sort())
        assert.equal(wireHeaders.has('cookie'),false);assert.equal(wireHeaders.has('authorization'),false)
        lastExchange=b;if(holdToken)await new Promise(resolve=>releaseClaudeRequest=resolve)
        if(claudePostFailure)return resp(401,{error:'do-not-expose-code-or-token'})
      }else{assert.deepEqual([...wireHeaders.keys()],['content-type']);assert.equal(b.grant_type,'refresh_token');lastRefreshBody=b;assert.ok(b.scope.includes('user:profile'));refreshCount++;if(claudeRefreshFailure)return resp(400,{error:'sensitive-refresh'});if(holdToken)await new Promise(resolve=>releaseClaudeRequest=resolve)}
      return resp(200,{access_token:'mock-claude-access-'+claudeAccount,refresh_token:omitRefresh?undefined:'mock-claude-refresh-'+refreshCount,expires_in:3600,scope:grantedClaudeScope})
    }
    if(u==='https://api.anthropic.com/api/oauth/profile'){
      assert.ok(o.headers.Authorization.startsWith('Bearer mock-claude-'));assert.ok(!o.headers['ChatGPT-Account-ID'])
      if(holdProfile)await new Promise(resolve=>releaseClaudeRequest=resolve)
      return claudeProfileFailure?resp(503):resp(200,{account:{uuid:claudeAccount,email:claudeEmail},organization:{uuid:claudeOrg}})
    }
    if(u==='https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1'){assert.ok(!o.method||o.method==='GET');return resp(200,{})}
    if(u==='https://api.anthropic.com/api/oauth/usage'){
      assert.equal(o.headers['anthropic-beta'],'oauth-2025-04-20');assert.ok(!o.headers['ChatGPT-Account-ID']);assert.ok(o.headers.Authorization.startsWith('Bearer mock-claude-'))
      if(usage401){usage401=false;return resp(401)}
      return claudeUsageFailure?resp(503):resp(200,claudeUsage)
    }
    throw new Error('unexpected Claude path '+u)
  }
  handler=claudeHandler
  let notified=0,cl=claudeAPI.beginClaudeLogin(()=>notified++),server=claudeServers.at(-1)
  const authURL=new URL(cl.url)
  assert.equal(authURL.origin+authURL.pathname,'https://claude.com/cai/oauth/authorize')
  assert.deepEqual(Array.from(authURL.searchParams.keys()).sort(),['client_id','code','code_challenge','code_challenge_method','redirect_uri','response_type','scope','state'].sort())
  assert.equal(authURL.searchParams.get('redirect_uri'),'http://localhost:8080/callback');assert.equal(authURL.searchParams.get('code'),'true')
  assert.equal(authURL.searchParams.get('code_challenge'),nodeCrypto.createHash('sha256').update(cl.verifier).digest('base64url'))
  assert.match(cl.verifier,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(cl.state,cl.verifier);assert.equal(cl.manual,false)
  const callback=(state,code='mock-claude-code',extra=[])=>({method:'GET',queryParams:[{key:'code',value:code},{key:'state',value:state},...extra]})
  const callbackFn=server.handlers['/callback'];before=calls.length
  callbackFn(callback('wrong-state'));callbackFn(callback(cl.state,'mock',[{key:'state',value:cl.state}]))
  assert.equal(cl.code,null);assert.equal(calls.length,before)
  const pkceVerifier=cl.verifier,pkceState=cl.state
  const response=callbackFn(callback(cl.state));assert.ok(!response.body.includes(pkceState));assert.ok(!response.body.includes('mock-claude-code'))
  await Promise.resolve();assert.equal(notified,1)
  const claudeA=await claudeAPI.finishClaudeLogin(cl)
  assert.equal(lastExchange.redirect_uri,'http://localhost:8080/callback');assert.equal(lastExchange.code_verifier,pkceVerifier);assert.equal(lastExchange.state,pkceState)
  assert.equal(claudeA,'claude:claude-a:org-a');assert.equal(claudeAPI.claudeAccounts()[0].name,claudeEmail)
  assert.equal(server.stops,1);assert.equal(cl.verifier,'');assert.equal(cl.state,'');assert.equal(claudeTimers.size,0)
  await assert.rejects(()=>claudeAPI.finishClaudeLogin(cl),/取消或过期/)
  // Native callback unavailable/bind failure -> genuine official manual redirect, not a fake app URL.
  serverError=true;cl=claudeAPI.beginClaudeLogin();assert.equal(cl.manual,true);assert.equal(claudeServers.at(-1).stops,1);claudeAPI.cancelClaudeLogin(cl);serverError=false
  const nativeServer=context.HttpServer;delete context.HttpServer
  cl=claudeAPI.beginClaudeLogin();assert.equal(cl.manual,true);assert.equal(cl.redirect,'https://platform.claude.com/oauth/code/callback')
  before=calls.length;await assert.rejects(()=>claudeAPI.finishClaudeLogin(cl,'wrong#state'),/state不匹配/);assert.equal(calls.length,before)
  claudeAccount='claude-b';claudeEmail='claude-b@example.test'
  const manualState=cl.state,manualVerifier=cl.verifier
  const claudeB=await claudeAPI.finishClaudeLogin(cl,'mock-manual#'+manualState)
  assert.equal(lastExchange.redirect_uri,'https://platform.claude.com/oauth/code/callback');assert.equal(lastExchange.code_verifier,manualVerifier)
  assert.equal(claudeAPI.claudeAccounts().length,2);assert.equal(claudeTimers.size,0)
  // Duplicate account update leaves position/alias intact.
  api.saveWidgetName(claudeB,'自定义Claude','official');cl=claudeAPI.beginClaudeLogin();await claudeAPI.finishClaudeLogin(cl,'mock#'+cl.state)
  assert.equal(claudeAPI.claudeAccounts()[1].id,claudeB);assert.equal(claudeAPI.claudeAccounts().length,2);assert.equal(api.getWidgetName(claudeB,'official'),'自定义Claude')
  for(const failure of ['token','profile','cancelToken','cancelProfile','inactive','expiry']){
    cl=claudeAPI.beginClaudeLogin();const snapshot=kc.get('ai_usage_claude_oauth_v1')
    claudePostFailure=failure==='token';claudeProfileFailure=failure==='profile';holdToken=failure==='cancelToken';holdProfile=failure==='cancelProfile'
    if(failure==='expiry'){claudeTimers.get(cl.timer).fn();await assert.rejects(()=>claudeAPI.finishClaudeLogin(cl,'mock#'+cl.state),/取消或过期/)}
    else{
      const pending=claudeAPI.finishClaudeLogin(cl,'mock#'+cl.state,()=>failure!=='inactive')
      if(holdToken||holdProfile){for(let i=0;i<12&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest);claudeAPI.cancelClaudeLogin(cl);releaseClaudeRequest();releaseClaudeRequest=null}
      await assert.rejects(()=>pending);claudeAPI.cancelClaudeLogin(cl)
    }
    assert.equal(kc.get('ai_usage_claude_oauth_v1'),snapshot);assert.equal(claudeTimers.size,0)
    claudePostFailure=claudeProfileFailure=holdToken=holdProfile=false
  }
  context.HttpServer=nativeServer
  // Aggregate windows only: utilization percent, valid reset ISO, absent/unknown don't become zero.
  let claudeMapped=claudeAPI.mapClaudeUsage(claudeUsage);assert.equal(claudeMapped.fiveHour.remainingPercent,62.5);assert.equal(claudeMapped.sevenDay.remainingPercent,19);assert.equal(claudeMapped.resetCredits,null)
  claudeMapped=claudeAPI.mapClaudeUsage({seven_day_sonnet:{utilization:4},five_hour:{utilization:NaN,resets_at:'invalid'}})
  assert.equal(claudeMapped.sevenDay.remainingPercent,null);assert.equal(claudeMapped.fiveHour.usedPercent,null);assert.equal(claudeMapped.fiveHour.resetsAt,null)
  assert.equal(claudeAPI.mapClaudeUsage({five_hour:{utilization:0},seven_day:{utilization:100}}).fiveHour.remainingPercent,100)
  // Refresh rotates only Claude key, retains email and omitted refresh token; one retry on 401.
  const codexSnapshot=kc.get('ai_usage_official_oauth_v1')
  const expireClaude=()=>{const rows=JSON.parse(kc.get('ai_usage_claude_oauth_v1'));rows.forEach(a=>a.expiresAt=now);kc.set('ai_usage_claude_oauth_v1',JSON.stringify(rows))}
  expireClaude();refreshCount=0;let clAccounts=await claudeAPI.loadClaudeAccounts();assert.equal(refreshCount,2);assert.equal(clAccounts[0].name,'claude-a@example.test');assert.equal(kc.get('ai_usage_official_oauth_v1'),codexSnapshot)
  const refreshBefore=JSON.parse(kc.get('ai_usage_claude_oauth_v1')).map(a=>a.refresh);omitRefresh=true;expireClaude();await claudeAPI.loadClaudeAccounts();assert.deepEqual(JSON.parse(kc.get('ai_usage_claude_oauth_v1')).map(a=>a.refresh),refreshBefore);omitRefresh=false
  usage401=true;refreshCount=0;await claudeAPI.loadClaudeAccounts();assert.equal(refreshCount,1)
  expireClaude();claudeRefreshFailure=true;await assert.rejects(()=>claudeAPI.loadClaudeAccounts(),e=>e.message.includes('Claude续期失败')&&!e.message.includes('sensitive-refresh'));claudeRefreshFailure=false
  expireClaude();refreshCount=0;await Promise.all([claudeAPI.loadClaudeAccounts(),claudeAPI.loadClaudeAccounts()]);assert.equal(refreshCount,2) // once per account, not per caller
  // Mixed official snapshot + unchanged Parrot aggregate/headers/cache/selection and widget aliases.
  api.saveConfig('mock-base','mock-management');api.saveSource('official');statsFailure=false;quotaFailure=false
  handler=(u,o)=>u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)
  api.saveAccountOrder([claudeB,'combined-official-1',claudeA],'official');before=calls.length
  combined=await api.loadUsage();batch=calls.slice(before)
  assert.equal(combined.stale,false);assert.equal(combined.data.today.requests,23);assert.equal(combined.data.accounts.length,5)
  assert.equal(combined.data.accounts[0].id,claudeB);assert.equal(combined.data.accounts[0].provider,'claude')
  assert.equal(batch.filter(c=>c.url.includes('/stats/summary')).length,2);assert.equal(batch.filter(c=>c.url==='https://api.anthropic.com/api/oauth/usage').length,2)
  assert.equal(storage.get('ai_usage_official_cache_v1').today,null);assert.ok(!JSON.stringify(storage.get('ai_usage_official_cache_v1')).includes('mock-claude-access'))
  for(const family of ['systemSmall','systemMedium','systemLarge']){
    scripting.Widget.family=family;scripting.Widget.parameter='1,2';const tree=expand(Root({data:combined.data,stale:false,error:null}))
    assert.ok(tree.includes('自定义Claude'));assert.ok(tree.includes('Claude'));assert.ok(!tree.includes('only-parrot'))
    const resets=tree.filter(x=>x.type==='Text'&&String(x.props.children).startsWith('RE:'));assert.equal(resets.length,1) // only Codex, never Claude
  }
  states.length=0;authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  assert.ok(render().some(x=>typeof x==='string'&&x.includes('Claude claude-b@example.test：')))
  claudeUsageFailure=true;combined=await api.loadUsage();assert.equal(combined.stale,true);assert.equal(combined.data.accounts.length,5);assert.equal(combined.data.statistics.stale,false);claudeUsageFailure=false
  // Local provider-scoped exits preserve Codex, other Claude accounts, Parrot cache and unrelated aliases.
  const parrotCacheSnapshot=JSON.stringify(storage.get('ai_usage_cache_v1')),codexBeforeLogout=kc.get('ai_usage_official_oauth_v1')
  api.logoutOfficial(claudeB);assert.equal(api.getWidgetName(claudeB,'official'),'');assert.equal(kc.get('ai_usage_official_oauth_v1'),codexBeforeLogout);assert.equal(claudeAPI.claudeAccounts().length,1)
  assert.ok(!api.officialCached().accounts.some(a=>a.id===claudeB));assert.equal(JSON.stringify(storage.get('ai_usage_cache_v1')),parrotCacheSnapshot)
  const clBeforeCodexLogout=kc.get('ai_usage_claude_oauth_v1');api.logoutOfficial('combined-official-1');assert.equal(kc.get('ai_usage_claude_oauth_v1'),clBeforeCodexLogout)
  // In-flight refresh cannot restore a locally logged-out Claude or its old cached row.
  expireClaude();holdToken=true;releaseClaudeRequest=null;const lateLoad=api.loadUsage()
  for(let i=0;i<12&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest)
  api.logoutOfficial(claudeA);releaseClaudeRequest();holdToken=false;combined=await lateLoad
  assert.equal(claudeAPI.claudeAccounts().length,0);assert.ok(!combined.data?.accounts.some(a=>a.id===claudeA))
  // UI owns the actual callback lifecycle: async code arrival completes while temporary modal is open.
  claudeAccount='ui-claude-auto';claudeEmail='ui-auto@example.test';handler=(u,o)=>u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)
  loadBrowser=async()=>true;let closeClaudeModal;presentBrowser=()=>new Promise(resolve=>closeClaudeModal=resolve)
  const uiAttempt=()=>states.find(x=>x&&typeof x.url==='string'&&x.url.startsWith('https://claude.com/'))
  const startClaudeUI=async()=>{
    states.length=0;api.saveSource('official');let tree=render()
    tree.find(x=>x.type==='Picker'&&x.props.title==='登录服务').props.onChanged('claude')
    tree=render();await tree.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action();return render()
  }
  authUI=await startClaudeUI();assert.ok(authUI.some(x=>x.type==='Button'&&x.props.title==='打开Claude授权页'))
  let uiD=uiAttempt(),uiServer=claudeServers.at(-1)
  const autoBrowser=authUI.find(x=>x.type==='Button'&&x.props.title==='打开Claude授权页').props.action()
  assert.equal(instances.at(-1).options.ephemeral,true);assert.equal(instances.at(-1).urls[0],uiD.url)
  uiServer.handlers['/callback'](callback(uiD.state));await autoBrowser
  for(let i=0;i<50&&!render().some(x=>x.type==='Text'&&x.props.children==='Claude ui-auto@example.test');i++)await Promise.resolve()
  assert.ok(render().some(x=>x.type==='Text'&&x.props.children==='Claude ui-auto@example.test'))
  for(let i=0;i<50&&!api.officialCached()?.accounts.some(a=>a.id==='claude:ui-claude-auto:org-a');i++)await Promise.resolve()
  assert.ok(api.officialCached().accounts.some(a=>a.id==='claude:ui-claude-auto:org-a'));assert.equal(instances.at(-1).disposed,1);assert.equal(uiServer.stops,1)
  assert.ok(!render().some(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码'));assert.equal(claudeTimers.size,0)
  closeClaudeModal() // native dismissal settlement may occur later; already disposed/completed
  // Switching explicitly to manual cancels the old callback and generates a fresh state/redirect.
  claudeAccount='ui-claude-manual';claudeEmail='ui-manual@example.test';authUI=await startClaudeUI()
  const autoState=uiAttempt().state,oldUiServer=claudeServers.at(-1)
  authUI.find(x=>x.type==='Button'&&x.props.title==='改用手动授权码').props.action()
  authUI=render();uiD=uiAttempt();assert.equal(uiD.manual,true);assert.notEqual(uiD.state,autoState);assert.equal(oldUiServer.stops,1)
  context.Safari.present=async url=>{assert.equal(url,uiD.url)}
  await authUI.find(x=>x.type==='Button'&&x.props.title==='Safari备用Claude授权页').props.action()
  assert.equal(uiD.consumed,false);authUI=render()
  authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged('mock-ui-code#'+uiD.state)
  authUI=render();await authUI.find(x=>x.type==='Button'&&x.props.title==='完成Claude授权').props.action()
  assert.ok(render().some(x=>x.type==='Text'&&x.props.children==='Claude ui-manual@example.test'));assert.equal(claudeTimers.size,0)
  assert.ok(!JSON.stringify(Array.from(storage.entries())).includes('mock-ui-code'))
  // UI cancel/source/settings dismissal during exchange: late response cannot persist account/code.
  for(const mode of ['cancel','source','dismiss','provider']){
    claudeAccount='ui-abandoned-'+mode;claudeEmail=mode+'@example.test';authUI=await startClaudeUI()
    authUI.find(x=>x.type==='Button'&&x.props.title==='改用手动授权码').props.action();authUI=render();uiD=uiAttempt()
    authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged('mock-ui-late#'+uiD.state)
    authUI=render();holdToken=true;releaseClaudeRequest=null
    const credentialSnapshot=kc.get('ai_usage_claude_oauth_v1'),pending=authUI.find(x=>x.type==='Button'&&x.props.title==='完成Claude授权').props.action()
    for(let i=0;i<12&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest)
    if(mode==='cancel')authUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
    else if(mode==='source')await authUI.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('parrot')
    else if(mode==='provider')authUI.find(x=>x.type==='Picker'&&x.props.title==='登录服务').props.onChanged('codex')
    else authUI.find(x=>x.type==='Form').props.toolbar.cancellationAction.props.action()
    releaseClaudeRequest();holdToken=false;await pending
    assert.equal(kc.get('ai_usage_claude_oauth_v1'),credentialSnapshot);assert.equal(claudeTimers.size,0)
    assert.ok(!render().some(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码'))
  }
  authUI=await startClaudeUI();uiD=uiAttempt();claudeTimers.get(uiD.timer).fn()
  assert.ok(render().includes('Claude授权已过期，请重新开始'));assert.equal(claudeTimers.size,0);assert.equal(claudeServers.at(-1).stops,1)
  const savedCrypto=context.Crypto;delete context.Crypto;authUI=await startClaudeUI()
  assert.ok(authUI.some(x=>x.type==='Text'&&x.props.foregroundStyle==='systemRed'&&x.props.children==='当前Scripting不支持Claude PKCE加密，请更新Scripting'))
  context.Crypto=savedCrypto
  console.log('PASS: Claude UI automatic loopback callback while ephemeral modal open; manual fresh state/paste flow; unsupported crypto inline; cancel/source/dismiss late exchange and expiry release all resources; no stored authorization code')
  console.log('PASS: Claude PKCE actual SHA256/global APIs/loopback and manual contracts; state/expiry/cancel/code reuse; token/profile failures; refresh rotation/dedup/401; aggregate windows; mixed official+Parrot stats; local provider exits and late logout isolation')
  // Official rows: provider/email plain Text -> Spacer -> independent borderless exit button.
  states.length=0;api.saveSource('official');handler=(u,o)=>u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)
  const legacyCodex=JSON.parse(kc.get('ai_usage_official_oauth_v1'))[0]
  assert.equal(legacyCodex.provider,undefined);assert.equal(api.officialAccounts().find(a=>a.id===legacyCodex.id).provider,'codex')
  const listRecords=api.officialAccounts();assert.ok(listRecords.some(a=>a.provider==='claude'))
  const exitRow=(tree,id)=>tree.find(x=>x.type==='HStack'&&x.key===id)
  let exitUI=render()
  for(const a of listRecords){
    const row=exitRow(exitUI,a.id);assert.ok(row)
    const children=Array.from(row.props.children)
    assert.deepEqual(children.map(x=>x.type),['Text','Spacer','Button'])
    assert.equal(children[0].props.children,(a.provider==='claude'?'Claude':'Codex')+' '+(a.provider==='claude'?(a.email||'邮箱未提供'):a.name))
    assert.equal(children[0].props.action,undefined);assert.equal(children[0].props.onTapGesture,undefined);assert.equal(row.props.action,undefined)
    assert.equal(children[0].props.lineLimit,undefined);assert.equal(children[0].props.fixedSize.horizontal,false);assert.equal(children[0].props.fixedSize.vertical,true)
    assert.equal(children[2].props.title,'点击退出');assert.equal(children[2].props.buttonStyle,'borderless');assert.equal(children[2].props.fixedSize.horizontal,true)
    assert.equal(children[2].props.disabled,false)
  }
  assert.ok(!exitUI.some(x=>x.type==='Button'&&x.props.title?.startsWith('退出 ')))
  // Long complete email stays in the label; wrapping is allowed and never squeezes away button text.
  const longEmail='very-long-account-'.repeat(12)+'@example.test',longRows=JSON.parse(kc.get('ai_usage_official_oauth_v1'))
  longRows[0].email=longEmail;kc.set('ai_usage_official_oauth_v1',JSON.stringify(longRows));states.length=0
  exitUI=render();assert.equal(exitRow(exitUI,legacyCodex.id).props.children[0].props.children,'Codex '+longEmail)
  // Identical disabling rules during either login flow, plus a held busy refresh.
  handler=async(u,o)=>u.endsWith('/usercode')?resp(200,{device_auth_id:'row-disable-device',usercode:'MOCK-ROW',interval:'5'}):u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)
  await exitUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action();exitUI=render()
  assert.ok(exitUI.filter(x=>x.type==='Button'&&x.props.title==='点击退出').every(x=>x.props.disabled))
  exitUI.find(x=>x.type==='Button'&&x.props.title==='取消登录').props.action()
  exitUI=render();exitUI.find(x=>x.type==='Picker'&&x.props.title==='登录服务').props.onChanged('claude')
  exitUI=render();await exitUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action();exitUI=render()
  assert.ok(exitUI.filter(x=>x.type==='Button'&&x.props.title==='点击退出').every(x=>x.props.disabled))
  exitUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action();exitUI=render()
  let releaseBusyRefresh;let heldBusy=false
  handler=async(u,o)=>{if(u.endsWith('/usage')&&!heldBusy){heldBusy=true;await new Promise(resolve=>releaseBusyRefresh=resolve)}return u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)}
  const busyRefresh=exitUI.find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.action()
  assert.ok(render().filter(x=>x.type==='Button'&&x.props.title==='点击退出').every(x=>x.props.disabled))
  for(let i=0;i<12&&!releaseBusyRefresh;i++)await Promise.resolve();assert.ok(releaseBusyRefresh);releaseBusyRefresh();await busyRefresh
  handler=(u,o)=>u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)
  // Click each provider's exact row button, preserve other IDs/keys, prune only target cache/order/alias.
  for(const provider of ['claude','codex']){
    const target=api.officialAccounts().find(a=>a.provider===provider),beforeRecords=api.officialAccounts(),otherKey=provider==='claude'?'ai_usage_official_oauth_v1':'ai_usage_claude_oauth_v1'
    const untouchedKey=kc.get(otherKey),parrotUntouched=JSON.stringify(storage.get('ai_usage_cache_v1'))
    api.saveWidgetName(target.id,'target-alias','official');api.saveAccountOrder(beforeRecords.map(a=>a.id),'official')
    states.length=0;exitUI=render()
    await exitRow(exitUI,target.id).props.children[2].props.action()
    assert.ok(!api.officialAccounts().some(a=>a.id===target.id))
    assert.deepEqual(api.officialAccounts().map(a=>a.id),beforeRecords.filter(a=>a.id!==target.id).map(a=>a.id))
    assert.equal(kc.get(otherKey),untouchedKey);assert.equal(api.getWidgetName(target.id,'official'),'')
    assert.ok(!api.officialCached().accounts.some(a=>a.id===target.id));assert.ok(!storage.get('ai_usage_official_order_v1').includes(target.id))
    assert.equal(JSON.stringify(storage.get('ai_usage_cache_v1')),parrotUntouched)
    assert.ok(!exitRow(render(),target.id))
  }
  console.log('PASS: Codex/Claude provider from separate real record collections (legacy Codex supported); plain complete-email label/Spacer/right independent borderless 点击退出; long-email wrapping; busy/device/Claude disables; each exact-ID button preserves other providers/cache/credentials')
  // Diagnostics expose only a fixed stage, never a native exception/URL/code/state.
  for(const stage of ['构造','地址配置','地址读回','注册handler','启动','端口','缺API']){
    diagnosticStage=stage;const savedServer=context.HttpServer
    if(stage==='缺API')delete context.HttpServer
    const beforeServers=claudeServers.length,attempt=api.beginClaudeLogin()
    const expectedStage=stage==='地址读回'?'地址配置':stage==='启动'?'启动；返回错误/未知':stage
    assert.equal(attempt.manual,true);assert.equal(attempt.fallback.replace(/；诊断：.*(?=），使用Claude官方手动授权码页)/g,''),`本机回调不可用（阶段：${expectedStage}），使用Claude官方手动授权码页`)
    assert.ok(!attempt.fallback.includes('SECRET'));assert.ok(!attempt.fallback.includes(attempt.state));assert.ok(!attempt.fallback.includes(attempt.verifier))
    if(claudeServers.length>beforeServers)assert.equal(claudeServers.at(-1).stops,1)
    api.cancelClaudeLogin(attempt);assert.equal(claudeTimers.size,0)
    authUI=await startClaudeUI()
    assert.ok(authUI.some(x=>typeof x==='string'&&x.replace(/；诊断：.*(?=），使用Claude官方手动授权码页)/g,'')===`本机回调不可用（阶段：${expectedStage}），使用Claude官方手动授权码页`))
    authUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
    context.HttpServer=savedServer;assert.equal(claudeTimers.size,0)
  }
  diagnosticStage=null
  // Exact manual validation branch is visible and input is retained without a token exchange.
  authUI=await startClaudeUI();authUI.find(x=>x.type==='Button'&&x.props.title==='改用手动授权码').props.action()
  authUI=render();const diagnosticAttempt=uiAttempt(),diagnosticState=diagnosticAttempt.state
  assert.ok(authUI.some(x=>x.type==='LabeledContent'&&x.props.title==='当前脚本版本'&&x.props.value==='1.9.1'))
  const validationCases=[['','Claude授权码输入为空'],['   ','Claude授权码输入为空'],['secret-without-hash','Claude授权码缺少#分隔符'],['secret#','Claude授权码格式错误'],['#state','Claude授权码格式错误'],['secret#state#extra','Claude授权码格式错误'],['secret#different-state','Claude授权码state不匹配']]
  for(const [input,expected] of validationCases){
    authUI=render();authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged(input)
    authUI=render();const button=authUI.find(x=>x.type==='Button'&&x.props.title==='完成Claude授权')
    assert.equal(button.props.disabled,!input.trim());before=calls.length
    // Explicitly call disabled action to test API defense too; native UI prevents the empty tap.
    await button.props.action();authUI=render()
    assert.equal(calls.length,before);assert.equal(authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.value,input)
    const err=authUI.find(x=>x.type==='Text'&&x.props.foregroundStyle==='systemRed');assert.ok(err.props.children.startsWith(expected))
    assert.ok(!err.props.children.includes('secret'));assert.ok(!err.props.children.includes('different-state'))
    assert.equal(uiAttempt().state,diagnosticState);assert.equal(diagnosticAttempt.consumed,false);assert.equal(diagnosticAttempt.cancelled,false)
  }
  // Corrected input can succeed in the SAME flow; fatal exchange failures clear/removes input instead.
  claudeAccount='diagnostic-success';claudeEmail='diagnostic@example.test'
  authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged('mock-corrected#'+diagnosticState)
  await render().find(x=>x.type==='Button'&&x.props.title==='完成Claude授权').props.action()
  assert.ok(api.officialAccounts().some(a=>a.name==='diagnostic@example.test'));assert.ok(!render().some(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码'))
  authUI=await startClaudeUI();authUI.find(x=>x.type==='Button'&&x.props.title==='改用手动授权码').props.action();authUI=render()
  authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged('mock-fatal#'+uiAttempt().state)
  claudePostFailure=true;await render().find(x=>x.type==='Button'&&x.props.title==='完成Claude授权').props.action();claudePostFailure=false
  assert.ok(!render().some(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码'));assert.equal(claudeTimers.size,0)
  console.log('PASS: callback fixed safe stage labels (construct/address/readback/register/start/port/missing API) with cleanup; distinct empty/hash/format/state manual errors; retained secure input/no exchange/no state regeneration; empty disabled; same-flow correction; fatal clears; visible runtime version')
  // Scope collection exactly matches official base subscription set, not optional or org scopes.
  const fullClaudeScope='user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
  const storedBeforeScopeChange=kc.get('ai_usage_claude_oauth_v1')
  for(const manual of [true,false]){
    const scopeFlow=api.beginClaudeLogin(()=>{},()=>{},manual)
    assert.equal(new URL(scopeFlow.url).searchParams.get('scope'),fullClaudeScope)
    assert.equal(kc.get('ai_usage_claude_oauth_v1'),storedBeforeScopeChange)
    api.cancelClaudeLogin(scopeFlow)
  }
  assert.equal(claudeTimers.size,0)
  handler=claudeHandler
  // Newly authorized record stores the server grant (not merely our requested scope).
  grantedClaudeScope=fullClaudeScope;claudeAccount='scope-new';claudeEmail='scope-new@example.test'
  cl=api.beginClaudeLogin(()=>{},()=>{},true);const newScopeID=await api.finishClaudeLogin(cl,'mock-scope#'+cl.state)
  const scopeRows=JSON.parse(kc.get('ai_usage_claude_oauth_v1'));assert.equal(scopeRows.find(a=>a.id===newScopeID).scope,fullClaudeScope)
  const oldScopeID=scopeRows.find(a=>a.id!==newScopeID).id
  assert.equal(scopeRows.find(a=>a.id===oldScopeID).scope,'user:profile user:inference')
  // Isolate each refresh target while retaining all credentials; missing response scope keeps its prior grant.
  grantedClaudeScope=undefined
  for(const [id,expectedScope] of [[oldScopeID,'user:profile user:inference'],[newScopeID,fullClaudeScope]]){
    const rows=JSON.parse(kc.get('ai_usage_claude_oauth_v1'));rows.forEach(a=>a.expiresAt=a.id===id?now:now+3600000)
    kc.set('ai_usage_claude_oauth_v1',JSON.stringify(rows));lastRefreshBody=null
    await claudeAPI.loadClaudeAccounts()
    assert.equal(lastRefreshBody.grant_type,'refresh_token');assert.equal(lastRefreshBody.scope,expectedScope)
    assert.equal(JSON.parse(kc.get('ai_usage_claude_oauth_v1')).find(a=>a.id===id).scope,expectedScope)
  }
  // Server may return a narrower actual grant even for a full-scope request.
  grantedClaudeScope='user:profile user:inference';claudeAccount='scope-narrow';claudeEmail='scope-narrow@example.test'
  cl=api.beginClaudeLogin(()=>{},()=>{},true);const narrowID=await api.finishClaudeLogin(cl,'mock-narrow#'+cl.state)
  assert.equal(JSON.parse(kc.get('ai_usage_claude_oauth_v1')).find(a=>a.id===narrowID).scope,grantedClaudeScope)
  console.log('PASS: exact official five subscription scopes in auto/manual URLs; no org/plugins/projects; old grants untouched; server full/narrow grant stored; refresh_token submits original grant and missing response scope preserves it; cancellation cleanup')
  // Nonzero documented start contract and sanitized return/throw classifications, no blind bind retries.
  for(const [error,category] of [['EADDRINUSE','端口占用'],['Permission denied','权限'],['port 0 is not supported','不支持参数'],['SECRET-https://example.test/code?token=mock','未知']]){
    for(const throwing of [false,true]){
      startNativeError=throwing?new Error(error):error;startThrows=throwing
      before=calls.length;const startsBefore=startCalls,attempt=api.beginClaudeLogin()
      const expected=`本机回调不可用（阶段：启动；${throwing?'抛异常':'返回错误'}/${category}），使用Claude官方手动授权码页`
      assert.equal(attempt.fallback.replace(/；诊断：.*(?=），使用Claude官方手动授权码页)/g,''),expected);assert.equal(startCalls,startsBefore+1);assert.equal(calls.length,before)
      assert.equal(claudeServers.at(-1).stops,1);assert.ok(!attempt.fallback.includes('SECRET'));assert.ok(!attempt.fallback.includes('example.test'))
      api.cancelClaudeLogin(attempt);assert.equal(claudeTimers.size,0)
      authUI=await startClaudeUI();assert.ok(authUI.some(x=>typeof x==='string'&&x.replace(/；诊断：.*(?=），使用Claude官方手动授权码页)/g,'')===expected));authUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
    }
  }
  startNativeError=null;startThrows=false
  handler=claudeHandler;claudeAccount='nonzero-auto';claudeEmail='nonzero-auto@example.test'
  authUI=await startClaudeUI();let nonzeroAttempt=uiAttempt(),nonzeroServer=claudeServers.at(-1)
  assert.equal(nonzeroAttempt.manual,false);assert.equal(nonzeroServer.port,8080);assert.equal(nonzeroServer.listenAddressIPv4,'127.0.0.1')
  assert.equal(new URL(nonzeroAttempt.url).searchParams.get('redirect_uri'),nonzeroAttempt.redirect)
  const beforeNonzeroCalls=calls.length
  // A callback from an external email/browser context uses exactly the same GET request contract.
  // This models request delivery, not iOS background survival or Cookie/session bridging.
  nonzeroServer.handlers['/callback'](callback(nonzeroAttempt.state,'mock-external-email-code'))
  nonzeroServer.handlers['/callback'](callback(nonzeroAttempt.state,'mock-external-email-code'))
  for(let i=0;i<70&&!api.officialAccounts().some(a=>a.email==='nonzero-auto@example.test');i++)await Promise.resolve()
  assert.ok(api.officialAccounts().some(a=>a.email==='nonzero-auto@example.test'))
  assert.equal(lastExchange.redirect_uri,'http://localhost:8080/callback')
  assert.equal(calls.slice(beforeNonzeroCalls).filter(x=>x.url==='https://platform.claude.com/v1/oauth/token').length,1)
  assert.equal(nonzeroServer.stops,1);assert.equal(claudeTimers.size,0)
  // Settle the previous UI's post-login quota refresh before mounting another UI instance.
  for(let i=0;i<100;i++)await Promise.resolve()
  // 429 remains a token-exchange failure, never a callback startup failure or automatic retry.
  const token429Handler=handler
  handler=(u,o)=>u==='https://platform.claude.com/v1/oauth/token'?resp(429,{error:'SECRET-rate-limit'}):token429Handler(u,o)
  authUI=await startClaudeUI();const rateAttempt=uiAttempt(),rateServer=claudeServers.at(-1),rateCallsBefore=calls.length
  rateServer.handlers['/callback'](callback(rateAttempt.state,'mock-429-code'))
  for(let i=0;i<70&&!render().some(x=>x.type==='Text'&&String(x.props.children).includes('HTTP 429'));i++)await Promise.resolve()
  assert.ok(render().some(x=>x.type==='Text'&&String(x.props.children).includes('Claude授权交换失败（HTTP 429')))
  assert.equal(calls.slice(rateCallsBefore).filter(x=>x.url==='https://platform.claude.com/v1/oauth/token').length,1)
  assert.equal(rateServer.stops,1);assert.equal(rateAttempt.cancelled,true);assert.equal(rateAttempt.consumed,true);assert.equal(claudeTimers.size,0)
  handler=token429Handler
  console.log('PASS: documented nonzero8080 loopback start, port0-rejecting native model; safe startup return/throw categories; one start/no LAN fallback; auto external-context GET delivery/email save/redirect match/exactly one exchange/listener cleanup (NOT iOS proof)')
  // Snapshot is taken AFTER start but BEFORE stop: truthy results remain failures even if running.
  const snapshots=[
    [true,'running',8080,true,'type=boolean;null=false;bool=true',true],
    [{code:'SECRET-code',message:'SECRET-url-token'},'running',8080,true,'type=object;null=false;code字符串=true;message字符串=true',true],
    [{},'stopped',null,false,'type=object;null=false;code字符串=false;message字符串=false',true],
    ['SECRET-native-return','stopped',null,false,'type=string;null=false',true],
    [null,'stopped',null,false,'type=object;null=true',true],
    [undefined,'stopped',null,false,'type=undefined;null=false',true],
    [false,'stopped',null,false,'type=boolean;null=false;bool=false',true],
    [undefined,'running',8080,true,'type=undefined;null=false',false],
    [false,'running',8080,true,'type=boolean;null=false;bool=false',false],
    [null,'running',8080,true,'type=object;null=true',false],
    [true,'SECRET-state','SECRET-port','SECRET-IPv4','type=boolean;null=false;bool=true',true],
  ]
  for(const [result,state,port,ipv4,typeExpected,failed] of snapshots){
    startScenario={result,state,port,ipv4};before=calls.length
    const snapshotFlow=api.beginClaudeLogin(),snapshotServer=claudeServers.at(-1)
    assert.equal(snapshotFlow.manual,failed);assert.equal(calls.length,before)
    if(failed){
      assert.ok(snapshotFlow.fallback.includes(typeExpected))
      assert.ok(snapshotFlow.fallback.includes('state='+(state==='SECRET-state'?'未知':state)))
      assert.ok(snapshotFlow.fallback.includes('port有效='+String(Number.isInteger(port)&&port>0&&port<=65535)))
      assert.ok(snapshotFlow.fallback.includes('IPv4='+(typeof ipv4==='boolean'?String(ipv4):'未知')))
      assert.ok(!snapshotFlow.fallback.includes('SECRET'));assert.ok(!snapshotFlow.fallback.includes(snapshotFlow.verifier));assert.ok(!snapshotFlow.fallback.includes(snapshotFlow.state))
      assert.equal(snapshotServer.state,'stopped');assert.equal(snapshotServer.port,null);assert.equal(snapshotServer.stops,1)
      // The actual authorization section displays the safe snapshot without needing browser/token activity.
      authUI=await startClaudeUI();assert.ok(authUI.some(x=>typeof x==='string'&&x.includes(typeExpected)))
      assert.equal(calls.length,before);authUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
    }else{assert.equal(snapshotFlow.fallback,null);assert.equal(snapshotServer.stops,0);assert.equal(snapshotFlow.redirect,'http://localhost:8080/callback')}
    api.cancelClaudeLogin(snapshotFlow);assert.equal(claudeTimers.size,0)
  }
  startScenario=null
  console.log('PASS: safe startup type/null/bool/object field flags and official state/port/IPv4 snapshot before stop; running truthy still rejected; undefined/false/null unchanged; no raw native secrets; add-only diagnosis/no account requests; original cleanup')
  // Only local start RETURN strings may have a description; thrown errors/network bodies never do.
  const descriptionCases=[
    ['Argument mismatch: start expected port number','Argument mismatch: start expected port number'],
    ['listen failed: EADDRINUSE (errno 48)','listen failed: EADDRINUSE (errno 48)'],
    ['setsockopt: Invalid argument (errno 22)','setsockopt: Invalid argument (errno 22)'],
    ['  bind\u0000 failed:   EADDRNOTAVAIL\u202e  ','bind failed: EADDRNOTAVAIL'],
    ['x'.repeat(300),'x'.repeat(239)+'…'],
    ['https://example.test/callback?code=private','已隐藏（含敏感模式）'],
    ['failed ?state=private','已隐藏（含敏感模式）'],
    ['access_token=private','已隐藏（含敏感模式）'],
    ['refresh-token: private','已隐藏（含敏感模式）'],
    ['code: private','已隐藏（含敏感模式）'],
    ['state=private','已隐藏（含敏感模式）'],
    ['code_verifier=private','已隐藏（含敏感模式）'],
    ['verifier private','已隐藏（含敏感模式）'],
    ['Bearer private','已隐藏（含敏感模式）'],
    ['to\u0000ken=private','已隐藏（含敏感模式）'],
    ['x'.repeat(300)+' token=private','已隐藏（含敏感模式）'],
  ]
  for(const [error,expected] of descriptionCases){
    before=calls.length;const keysBefore=JSON.stringify([...kc]),storageBefore=JSON.stringify([...storage])
    startNativeError=error;startThrows=false
    const descriptionFlow=api.beginClaudeLogin(),descriptionServer=claudeServers.at(-1)
    assert.ok(descriptionFlow.fallback.includes('；启动描述：'+expected))
    if(expected.startsWith('已隐藏'))assert.ok(!descriptionFlow.fallback.includes('private'))
    assert.equal(descriptionServer.stops,1);assert.equal(descriptionServer.state,'stopped')
    api.cancelClaudeLogin(descriptionFlow);assert.equal(claudeTimers.size,0)
    authUI=await startClaudeUI();assert.ok(authUI.some(x=>typeof x==='string'&&x.includes('；启动描述：'+expected)))
    authUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
    assert.equal(calls.length,before);assert.equal(JSON.stringify([...kc]),keysBefore);assert.equal(JSON.stringify([...storage]),storageBefore)
  }
  startNativeError=new Error('Argument mismatch: do not echo thrown text');startThrows=true
  const thrownDescriptionFlow=api.beginClaudeLogin();assert.ok(!thrownDescriptionFlow.fallback.includes('启动描述'));assert.ok(!thrownDescriptionFlow.fallback.includes('Argument mismatch'))
  api.cancelClaudeLogin(thrownDescriptionFlow);startNativeError=null;startThrows=false
  console.log('PASS: actual local start return argument/listen error text visible; controls removed/240-char cap; full-input secret/URL filtering before truncation; thrown/native objects not echoed; add-only UI/no account requests/no persistent error records; cleanup')
  // Synchronous callback response MUST exist even while token/profile promises are unresolved.
  handler=claudeHandler;claudeAccount='stage-auto';claudeEmail='stage-auto@example.test'
  authUI=await startClaudeUI();let stageAttempt=uiAttempt(),stageServer=claudeServers.at(-1)
  assert.ok(authUI.includes('等待Claude回调（尚未收到）'))
  const delayedBrowser=authUI.find(x=>x.type==='Button'&&x.props.title==='打开Claude授权页').props.action()
  const invalidReply=stageServer.handlers['/callback'](callback('mock-wrong-current-state'))
  assert.equal(invalidReply.statusCode,200);assert.equal(typeof invalidReply.then,'undefined')
  assert.ok(render().includes('收到Claude回调，但未通过本次校验'))
  holdToken=true;holdProfile=true;releaseClaudeRequest=null;before=calls.length
  const actualCallback={path:'/callback',target:'/callback?code=mock-stage-code&state='+stageAttempt.state,method:'GET',address:'127.0.0.1',headers:{},queryParams:[{key:'code',value:'mock-stage-code'},{key:'state',value:stageAttempt.state}]}
  const immediateReply=stageServer.handlers['/callback'](actualCallback)
  assert.equal(immediateReply.statusCode,200);assert.equal(typeof immediateReply.then,'undefined')
  assert.equal(calls.length,before);assert.ok(render().includes('收到Claude回调，已通过本次校验'))
  assert.ok(!immediateReply.body.includes(stageAttempt.state));assert.ok(!immediateReply.body.includes('mock-stage-code'))
  for(let i=0;i<20&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest)
  assert.ok(render().includes('正在交换Claude令牌（不重复提交）'));assert.equal(stageAttempt.consumed,true)
  stageServer.handlers['/callback'](actualCallback) // duplicate must not regress progress or exchange twice
  closeClaudeModal();await delayedBrowser
  assert.ok(render().includes('正在交换Claude令牌（不重复提交）'))
  assert.ok(render().find(x=>x.type==='Button'&&x.props.title==='刷新官方额度').props.disabled)
  assert.ok(!api.officialAccounts().some(a=>a.email==='stage-auto@example.test'));assert.equal(stageServer.stops,0)
  const releaseTokenStage=releaseClaudeRequest;releaseClaudeRequest=null;holdToken=false;releaseTokenStage()
  for(let i=0;i<30&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest)
  assert.ok(render().includes('正在读取Claude账号资料'));assert.equal(stageServer.stops,0)
  const releaseProfileStage=releaseClaudeRequest;releaseClaudeRequest=null;holdProfile=false;releaseProfileStage()
  for(let i=0;i<100;i++)await Promise.resolve()
  assert.ok(render().includes('Claude stage-auto@example.test'));assert.ok(api.officialAccounts().some(a=>a.email==='stage-auto@example.test'))
  assert.equal(stageServer.stops,1);assert.equal(claudeTimers.size,0)
  assert.equal(calls.slice(before).filter(x=>x.url==='https://platform.claude.com/v1/oauth/token').length,1)
  assert.equal(lastExchange.redirect_uri,stageAttempt.redirect)
  // Saving stage is emitted by the real API just before Keychain persist; all signals are fixed labels.
  const orderedStages=[];claudeAccount='stage-order';claudeEmail='stage-order@example.test'
  let signalFlow
  signalFlow=api.beginClaudeLogin(()=>void api.finishClaudeLogin(signalFlow),()=>{},false,s=>orderedStages.push(s))
  const signalServer=claudeServers.at(-1);signalServer.handlers['/callback'](callback(signalFlow.state))
  for(let i=0;i<100;i++)await Promise.resolve()
  assert.deepEqual(orderedStages,['收到Claude回调，已通过本次校验','正在交换Claude令牌（不重复提交）','正在读取Claude账号资料','正在保存Claude账号到本机','Claude stage-order@example.test'])
  // Browser close WITHOUT callback keeps waiting; cancellation suppresses late signals and late token saves.
  authUI=await startClaudeUI();const emptyBrowser=authUI.find(x=>x.type==='Button'&&x.props.title==='打开Claude授权页').props.action()
  closeClaudeModal();await emptyBrowser;assert.ok(render().includes('等待Claude回调（尚未收到）'))
  render().find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
  for(const stop of ['cancel','source']){
    authUI=await startClaudeUI();stageAttempt=uiAttempt();stageServer=claudeServers.at(-1);holdToken=true;releaseClaudeRequest=null
    const credentialsBefore=kc.get('ai_usage_claude_oauth_v1')
    stageServer.handlers['/callback'](callback(stageAttempt.state))
    for(let i=0;i<20&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest)
    authUI=render()
    if(stop==='cancel')authUI.find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action()
    else authUI.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('parrot')
    assert.ok(!render().includes('正在交换Claude令牌（不重复提交）'))
    stageServer.handlers['/callback'](actualCallback)
    releaseClaudeRequest();holdToken=false;releaseClaudeRequest=null
    for(let i=0;i<100;i++)await Promise.resolve()
    assert.equal(kc.get('ai_usage_claude_oauth_v1'),credentialsBefore);assert.equal(stageServer.stops,1)
    assert.ok(!render().includes('Claude账号已保存'));assert.equal(claudeTimers.size,0)
  }
  console.log('PASS: document-shaped synchronous HttpResponse returned before unresolved token/profile; callback received/verified/exchange/profile/save ordered signals; modal-close keeps in-flight busy; close without callback remains waiting; no duplicate exchange; cancel/source suppress late progress/save; dynamic redirect matches')
  for(const [utc,beijing] of [['2026-10-09T06:39:41.420Z','2026-10-09 14:39:41'],['2026-10-09T16:00:00Z','2026-10-10 00:00:00'],['2026-12-31T23:59:59Z','2027-01-01 07:59:59']]){
    assert.equal(api.formatBeijingDeadline(Date.parse(utc)),beijing)
    assert.ok(!/[TZ+]|UTC/.test(api.formatBeijingDeadline(Date.parse(utc))))
  }
  const cooldownKey='ai_usage_claude_login_cooldown_v1',baseRateNow=now
  const rateCases=[
    ['120','application/json',{error:{type:'rate_limit_error',message:'SECRET-token-body'}},120000,'JSON','rate_limit'],
    [new Date(now+90000).toUTCString(),'application/json',{error:'too_many_requests'},90000,'JSON','rate_limit'],
    ['invalid-secret','text/html','SECRET-html-url',0,'HTML','未分类'],
    ['-10','application/json',{error:{type:'SECRET-arbitrary',message:'SECRET-body'}},0,'JSON','未分类'],
    ['1.5','application/problem+json',{error:'temporarily_unavailable'},0,'JSON','temporarily_unavailable'],
    [new Date(now-1000).toUTCString(),'text/plain','SECRET-body',0,'other','未分类'],
    ['','application/json',{error:'invalid_grant'},0,'JSON','invalid_grant'],
    ['0','application/json',{error:'rate_limited'},0,'JSON','rate_limit'],
    ['9999999999999999999999999','application/json',{error:'rate_limit_error'},0,'JSON','rate_limit'],
  ]
  for(const [retry,mime,body,wait,format,category] of rateCases){
    storage.delete(cooldownKey);now=baseRateNow
    const rateFlow=api.beginClaudeLogin(()=>{},()=>{},true),savedRateState=rateFlow.state,credentialsBefore=kc.get('ai_usage_claude_oauth_v1')
    let bodyReads=0
    handler=async(u,o)=>{
      assert.equal(u,'https://platform.claude.com/v1/oauth/token');assert.equal(JSON.parse(o.body).grant_type,'authorization_code')
      return {status:429,headers:{get:n=>n.toLowerCase()==='retry-after'?retry:n.toLowerCase()==='content-type'?mime:null},json:async()=>{bodyReads++;return body}}
    }
    before=calls.length;let rateError
    try{await api.finishClaudeLogin(rateFlow,'mock-rate#'+savedRateState)}catch(e){rateError=e.message}
    assert.ok(rateError.includes(`格式：${format}；类别：${category}`));assert.ok(!rateError.includes('SECRET'));assert.ok(!rateError.includes('invalid-secret'));assert.ok(!rateError.includes(savedRateState))
    assert.equal(bodyReads,format==='JSON'?1:0);assert.equal(calls.length,before+1)
    assert.equal(rateFlow.cancelled,true);assert.equal(rateFlow.consumed,true);assert.equal(kc.get('ai_usage_claude_oauth_v1'),credentialsBefore)
    assert.equal(api.claudeCooldownUntil(),wait?now+wait:0)
    if(wait){
      assert.ok(rateError.includes('冷却中'));assert.ok(!rateError.includes('请重新开始'));assert.equal(storage.get(cooldownKey),now+wait)
      assert.ok(rateError.includes('可重新授权时间：'+api.formatBeijingDeadline(now+wait)));assert.ok(!rateError.includes('Z'));assert.ok(!rateError.includes('UTC+8'))
      const serversBefore=claudeServers.length;assert.throws(()=>api.beginClaudeLogin(),/冷却中/);assert.throws(()=>api.beginClaudeLogin(()=>{},()=>{},true),/冷却中/)
      assert.equal(claudeServers.length,serversBefore)
      authUI=await startClaudeUI();assert.ok(authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.disabled)
      assert.ok(authUI.some(x=>typeof x==='string'&&x.includes('冷却中')));assert.equal(calls.length,before+1)
      states.length=0;api.saveSource('official');authUI=render();authUI.find(x=>x.type==='Picker'&&x.props.title==='登录服务').props.onChanged('claude')
      assert.ok(render().find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.disabled)
      now+=1000;assert.ok(render().some(x=>typeof x==='string'&&x.includes('剩余'+Math.ceil((wait-1000)/1000)+'秒')))
      // Codex device flow is independent of Claude cooldown, and no existing credentials are removed.
      render().find(x=>x.type==='Picker'&&x.props.title==='登录服务').props.onChanged('codex')
      assert.equal(render().find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.disabled,false)
      handler=async(u,o)=>u.endsWith('/usercode')?resp(200,{device_auth_id:'rate-codex',usercode:'MOCK-COOLDOWN',interval:'5'}):combinedHandler(u,o)
      await render().find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.action()
      assert.ok(render().some(x=>x.type==='Button'&&x.props.title==='取消登录'));render().find(x=>x.type==='Button'&&x.props.title==='取消登录').props.action()
      assert.equal(storage.get(cooldownKey),baseRateNow+wait)
      now=baseRateNow+wait;assert.equal(api.claudeCooldownUntil(),0);const fresh=api.beginClaudeLogin();api.cancelClaudeLogin(fresh)
    }else{assert.ok(rateError.includes('服务未提供有效等待时间'));assert.ok(!rateError.includes('剩余'));assert.equal(storage.has(cooldownKey),false)}
    assert.equal(claudeTimers.size,0)
  }
  storage.delete(cooldownKey);now=baseRateNow
  // A cancelled late 429 cannot save/login/update UI, but the server-provided deadline remains a local protection.
  authUI=await startClaudeUI();let lateRateAttempt=uiAttempt(),lateRateServer=claudeServers.at(-1),releaseRate429
  const lateRateCredentials=kc.get('ai_usage_claude_oauth_v1')
  handler=async()=>{await new Promise(resolve=>releaseRate429=resolve);return {status:429,headers:{get:n=>n==='Retry-After'?'30':n==='Content-Type'?'application/json':null},json:async()=>({error:{type:'rate_limit_error',message:'SECRET'}})}}
  before=calls.length;lateRateServer.handlers['/callback'](callback(lateRateAttempt.state))
  for(let i=0;i<20&&!releaseRate429;i++)await Promise.resolve();assert.ok(releaseRate429)
  render().find(x=>x.type==='Button'&&x.props.title==='取消Claude登录').props.action();releaseRate429()
  for(let i=0;i<100;i++)await Promise.resolve()
  assert.equal(calls.length,before+1);assert.equal(kc.get('ai_usage_claude_oauth_v1'),lateRateCredentials);assert.equal(lateRateServer.stops,1)
  assert.equal(api.claudeCooldownUntil(),now+30000);assert.ok(!render().includes('Claude账号已保存'))
  storage.delete(cooldownKey);handler=claudeHandler
  console.log('PASS: Retry-After seconds/date/invalid/past/zero; JSON/HTML/other safe whitelist/no body secrets; persisted deadline disables fresh Claude attempts/re-render and expires; Codex device unaffected; one exchange/flow cleanup; cancelled late429 only records nonsecret cooldown')
  // Exercise the actual countdown effect (normally effects are suppressed by the UI harness).
  storage.set(cooldownKey,now+3000);const effectBefore=scripting.useEffect,rateEffects=[]
  scripting.useEffect=(fn,deps)=>rateEffects.push({fn,deps})
  states.length=0;api.saveSource('official');authUI=render();authUI.find(x=>x.type==='Picker'&&x.props.title==='登录服务').props.onChanged('claude')
  rateEffects.length=0;authUI=render();const countdownCleanup=rateEffects[0].fn()
  const rateTick=[...claudeTimers].find(([id,t])=>t.ms===1000);assert.ok(rateTick)
  now+=1000;rateTick[1].fn();assert.ok(render().some(x=>typeof x==='string'&&x.includes('剩余2秒')))
  countdownCleanup();assert.ok(!claudeTimers.has(rateTick[0]))
  now+=2000;rateEffects.length=0;authUI=render();assert.equal(rateEffects[0].fn(),undefined)
  assert.equal(authUI.find(x=>x.type==='Button'&&x.props.title==='添加官方账号').props.disabled,false)
  assert.ok(!authUI.some(x=>typeof x==='string'&&x.includes('冷却中')))
  scripting.useEffect=effectBefore;storage.delete(cooldownKey);now=baseRateNow
  console.log('PASS: real countdown effect updates remaining seconds, cleans its timer, re-enables Claude at deadline; no token polling')
  // Controller/browser/listener lifetime is independent of native global fetch; no early release during exchange.
  storage.delete(cooldownKey);handler=claudeHandler;claudeAccount='headers-auto';claudeEmail='headers-auto@example.test'
  authUI=await startClaudeUI();const headerAttempt=uiAttempt(),headerServer=claudeServers.at(-1)
  const headerBrowserAction=authUI.find(x=>x.type==='Button'&&x.props.title==='打开Claude授权页').props.action(),headerBrowser=instances.at(-1)
  holdToken=true;releaseClaudeRequest=null;before=calls.length
  headerServer.handlers['/callback'](callback(headerAttempt.state,'mock-headers-code'))
  for(let i=0;i<20&&!releaseClaudeRequest;i++)await Promise.resolve();assert.ok(releaseClaudeRequest)
  const headerPost=calls.slice(before).find(x=>x.url==='https://platform.claude.com/v1/oauth/token')
  assert.ok(headerPost);assert.equal(new Headers(headerPost.options.headers).get('user-agent'),'ai-usage/1.9.1')
  assert.equal(new Headers(headerPost.options.headers).get('accept'),'application/json')
  assert.equal(headerBrowser.disposed,0);assert.equal(headerServer.stops,0)
  headerServer.handlers['/callback'](callback(headerAttempt.state,'mock-headers-code'))
  assert.equal(calls.slice(before).filter(x=>x.url==='https://platform.claude.com/v1/oauth/token').length,1)
  releaseClaudeRequest();holdToken=false;await headerBrowserAction
  for(let i=0;i<100;i++)await Promise.resolve()
  assert.equal(headerBrowser.disposed,1);assert.equal(headerServer.stops,1)
  assert.ok(api.officialAccounts().some(a=>a.email==='headers-auto@example.test'))
  assert.equal(calls.slice(before).filter(x=>x.url==='https://platform.claude.com/v1/oauth/token').length,1)
  console.log('PASS: actual global fetch POST with record HeadersInit interpreted case-insensitively via WHATWG Headers; honest ai-usage/1.9.1 UA+JSON Accept on initial exchange only; six JSON body fields unchanged; refresh headers unchanged; no Cookie/spoof/auth extras; browser/listener retained until exchange completes; one POST')
  // Success is ONLY the unified provider/email account row: no duplicate progress text or new exit logic.
  handler=(u,o)=>u.startsWith('https://api.anthropic.com/')||u.startsWith('https://platform.claude.com/')?claudeHandler(u,o):combinedHandler(u,o)
  storage.delete(cooldownKey)
  for(const mode of ['auto','manual']){
    // Reauthorize an older existing ID, leaving a different account at the end of the collection.
    claudeAccount=mode==='auto'?'stage-order':'scope-new';claudeEmail='complete-'+mode+'-full@example.test'
    const targetID='claude:'+claudeAccount+':org-a',beforeCompletion=api.officialAccounts(),lastCompletion=beforeCompletion.at(-1)
    assert.notEqual(lastCompletion.id,targetID)
    const otherCredKey=kc.get('ai_usage_official_oauth_v1')
    authUI=await startClaudeUI()
    if(mode==='manual'){
      authUI.find(x=>x.type==='Button'&&x.props.title==='改用手动授权码').props.action();authUI=render()
      authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged('mock-complete#'+uiAttempt().state)
      await render().find(x=>x.type==='Button'&&x.props.title==='完成Claude授权').props.action()
    }else{
      const completionAttempt=uiAttempt(),completionServer=claudeServers.at(-1)
      const completingBrowser=authUI.find(x=>x.type==='Button'&&x.props.title==='打开Claude授权页').props.action()
      completionServer.handlers['/callback'](callback(completionAttempt.state))
      await completingBrowser
    }
    for(let i=0;i<100;i++)await Promise.resolve()
    authUI=render();const expectedLabel='Claude '+claudeEmail
    assert.equal(authUI.filter(x=>x.type==='Text'&&x.props.children===expectedLabel).length,1)
    assert.equal(authUI.filter(x=>x.type==='HStack'&&x.key===targetID).length,1)
    assert.ok(!authUI.some(x=>x.type==='Text'&&typeof x.props.children==='string'&&x.props.children.includes('已保存')))
    const completedRow=authUI.find(x=>x.type==='HStack'&&x.key===targetID),rowChildren=completedRow.props.children
    assert.deepEqual(Array.from(rowChildren).map(x=>x.type),['Text','Spacer','Button'])
    assert.equal(rowChildren[0].props.children,expectedLabel);assert.equal(rowChildren[2].props.title,'点击退出');assert.equal(rowChildren[2].props.disabled,false)
    assert.equal(api.officialAccounts().at(-1).id,lastCompletion.id);assert.equal(kc.get('ai_usage_official_oauth_v1'),otherCredKey)
    const remainingIDs=api.officialAccounts().filter(a=>a.id!==targetID).map(a=>a.id)
    await rowChildren[2].props.action()
    assert.deepEqual(api.officialAccounts().map(a=>a.id),remainingIDs);assert.ok(!render().some(x=>x.type==='HStack'&&x.key===targetID))
    assert.equal(kc.get('ai_usage_official_oauth_v1'),otherCredKey)
  }
  for(const mode of ['auto','manual']){
    claudeAccount='missing-email-'+mode;claudeEmail='';const targetID='claude:'+claudeAccount+':org-a'
    authUI=await startClaudeUI()
    if(mode==='manual'){
      authUI.find(x=>x.type==='Button'&&x.props.title==='改用手动授权码').props.action();authUI=render()
      authUI.find(x=>x.type==='SecureField'&&x.props.title==='本次完整授权码').props.onChanged('mock-missing#'+uiAttempt().state)
      await render().find(x=>x.type==='Button'&&x.props.title==='完成Claude授权').props.action()
    }else claudeServers.at(-1).handlers['/callback'](callback(uiAttempt().state))
    for(let i=0;i<100;i++)await Promise.resolve()
    authUI=render();const missingRow=authUI.find(x=>x.type==='HStack'&&x.key===targetID)
    assert.ok(missingRow);assert.equal(missingRow.props.children[0].props.children,'Claude 邮箱未提供')
    assert.equal(authUI.filter(x=>x.type==='Text'&&x.props.children==='Claude 邮箱未提供').length,1)
    assert.equal(api.officialAccounts().find(a=>a.id===targetID).email,'')
    await missingRow.props.children[2].props.action();assert.ok(!api.officialAccounts().some(a=>a.id===targetID))
  }
  console.log('PASS: auto/manual success uses one unified Claude full-email/Spacer/点击退出 row only; older reauthorized ID not last-account inference; exact target exit preserves other Claude/Codex IDs; no 已保存/generic duplicate success text; missing-email explicit fallback in both modes')
  // Fixtures mirror official 2.1.295 Bn/Xn schema (not captured user account responses).
  const resetGrant=(id,left)=>({id,label:'Plan reset',resets_total:5,resets_left:left,starts_at:null,ends_at:null,clears:['five_hour','seven_day'],paused:false,usable_now:false,use_requires_limit:true,percent_used:{},blocking:[]})
  const resetFixture=(grants)=>({cedar_ember:{eligible:true,at_limit:false,exhausted:[],grants,next_grant_id:null,weekly_resets_at:null,cooldown_until:null,event_props:null}})
  for(const [body,count] of [[{},null],[{cedar_ember:null},null],[{cedar_ember:{eligible:true}},null],[resetFixture([]),0],[resetFixture([resetGrant('grant-a',0)]),0],[resetFixture([resetGrant('grant-a',2),resetGrant('grant-b',3)]),5]]){
    const mapped=api.mapClaudeUsage({...claudeUsage,...body});assert.equal(mapped.resetCredits,count);assert.equal(mapped.fiveHour.remainingPercent,62.5);assert.equal(mapped.sevenDay.remainingPercent,19)
  }
  for(const value of [-1,NaN,Infinity,'2',1.5,Number.MAX_SAFE_INTEGER+1,undefined])assert.equal(api.mapClaudeUsage(resetFixture([resetGrant('grant-a',value)])).resetCredits,null)
  assert.equal(api.mapClaudeUsage(resetFixture([resetGrant('same',2),resetGrant('same',2)])).resetCredits,null)
  assert.equal(api.mapClaudeUsage(resetFixture([resetGrant('a',Number.MAX_SAFE_INTEGER),resetGrant('b',1)])).resetCredits,null)
  assert.equal(api.mapClaudeUsage({...claudeUsage,extra_usage:{used_credits:99}}).resetCredits,null)
  const cardsURL='https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1'
  const queryCredentials=kc.get('ai_usage_claude_oauth_v1'),queryCodex=kc.get('ai_usage_official_oauth_v1')
  const resetCredentialRows=JSON.parse(queryCredentials);assert.ok(resetCredentialRows.length>0)
  resetCredentialRows.forEach(a=>a.expiresAt=now+3600000);kc.set('ai_usage_claude_oauth_v1',JSON.stringify(resetCredentialRows))
  for(const scenario of ['inline','positive','zero','missing','http','network','malformed']){
    handler=async(u,o)=>{
      assert.ok(!o.method||o.method==='GET');assert.ok(!u.includes('reset_rate_limits'));assert.ok(o.headers.Authorization.startsWith('Bearer mock-claude-'))
      assert.equal(o.headers['anthropic-beta'],'oauth-2025-04-20');assert.equal(o.headers['Content-Type'],'application/json')
      if(u==='https://api.anthropic.com/api/oauth/usage')return resp(200,{...claudeUsage,...(scenario==='inline'?resetFixture([resetGrant('inline',4)]):{})})
      assert.equal(u,cardsURL)
      if(scenario==='network')throw Error('SECRET-query-network')
      if(scenario==='http')return resp(503,{error:'SECRET-query-response'})
      if(scenario==='malformed')return {status:200,json:async()=>{throw Error('SECRET-json')}}
      return resp(200,scenario==='positive'?resetFixture([resetGrant('a',2),resetGrant('b',3)]):scenario==='zero'?resetFixture([resetGrant('a',0)]):{})
    }
    storage.delete('ai_usage_claude_reset_cards_v1');storage.delete('ai_usage_claude_usage_cooldown_v1')
    before=calls.length;const readRows=await api.loadClaudeAccounts()
    assert.equal(readRows.length,resetCredentialRows.length)
    const expected=scenario==='inline'?4:scenario==='positive'?5:scenario==='zero'?0:null
    for(const a of readRows){assert.equal(a.resetCredits,expected);assert.equal(a.fiveHour.remainingPercent,62.5);assert.equal(a.sevenDay.remainingPercent,19)}
    assert.equal(calls.slice(before).filter(x=>x.url===cardsURL).length,scenario==='inline'?0:resetCredentialRows.length)
    assert.ok(calls.slice(before).every(x=>!x.options.method||x.options.method==='GET'))
    assert.equal(kc.get('ai_usage_official_oauth_v1'),queryCodex)
    // Existing RE rules and all widget layouts remain untouched: positive displayed, zero/unknown hidden.
    for(const family of ['systemSmall','systemMedium','systemLarge']){
      scripting.Widget.family=family;scripting.Widget.parameter='1'
      const resetTree=expand(Root({data:{...result.data,accounts:[readRows[0]]},stale:false,error:null}))
      const resetTexts=resetTree.filter(x=>x.type==='Text').map(x=>[].concat(x.props.children).join(''));assert.equal(resetTexts.includes('RE:'+expected),expected!=null&&expected>0,JSON.stringify({family,scenario,expected,resetTexts}))
      assert.ok(!resetTree.includes('RE:0'));assert.ok(!resetTree.includes('RE:null'))
    }
  }
  // Logout during a delayed optional card query must not resurrect the account.
  const targetResetID=resetCredentialRows[0].id;let releaseReset
  handler=async(u,o)=>u===cardsURL?await new Promise(resolve=>{releaseReset=()=>resolve(resp(200,resetFixture([resetGrant('a',2)]))) }):resp(200,claudeUsage)
  // Keep one credential for the delayed-query assertion, restore untouched rows afterwards.
  kc.set('ai_usage_claude_oauth_v1',JSON.stringify([resetCredentialRows[0]]));const lateReset=api.loadClaudeAccounts()
  for(let i=0;i<20&&!releaseReset;i++)await Promise.resolve();assert.ok(releaseReset)
  api.logoutOfficial(targetResetID);releaseReset();await assert.rejects(()=>lateReset,/已退出/)
  kc.set('ai_usage_claude_oauth_v1',queryCredentials);handler=claudeHandler
  console.log('PASS: official cedar_ember schema/grants resets_left sum (missing unknown/explicit zero/positive/invalid/overflow); inline or one optional GET only; HTTP/network/JSON failures do not block quota; no reset/claim POST; logout late-query guard; RE>0 existing layout rules preserved')
  // New updater must install the mandatory AppIntent file before its dependent widget.
  const savedFileManager=context.FileManager,savedScript=scripting.Script,updateWrites=[],updateReads=[]
  scripting.Script={directory:'/mock-script'};context.FileManager={writeAsString:async(p,b)=>updateWrites.push({p,b})}
  handler=async(u,o)=>{
    assert.ok(u.startsWith('https://raw.githubusercontent.com/Wangsc1/ai-usage/'));assert.equal(o.timeout,20)
    const name=u.slice(u.lastIndexOf('/')+1).split('?')[0];updateReads.push(name)
    return name==='script.json'?resp(200,{version:'1.9.1'}):{status:200,text:async()=>fs.readFileSync(path.join(root,name),'utf8')}
  }
  await load('index.tsx').updateFromGitHub(true)
  assert.deepEqual(updateReads,['script.json','api.ts','app_intents.tsx','widget.tsx','index.tsx'])
  assert.deepEqual(updateWrites.map(x=>x.p),['/mock-script/api.ts','/mock-script/app_intents.tsx','/mock-script/widget.tsx','/mock-script/index.tsx'])
  assert.equal(updateWrites[1].b,fs.readFileSync(path.join(root,'app_intents.tsx'),'utf8'))
  updateWrites.length=0
  handler=async(u)=>u.includes('script.json')?resp(200,{version:'1.9.1'}):u.includes('app_intents.tsx')?resp(404):{status:200,text:async()=>'mock-source'}
  await assert.rejects(()=>load('index.tsx').updateFromGitHub(true),/app_intents.tsx/);assert.equal(updateWrites.length,0)
  scripting.Script=savedScript;context.FileManager=savedFileManager
  console.log('PASS: updater downloads all four sources then installs intents before widget; failed intent download writes no partial files; metadata never overwritten')
  // 1.8.14 request budget: one plain usage per refresh, hourly card selector, 429 cooldown per account, in-flight sharing.
  storage.delete('ai_usage_claude_reset_cards_v1');storage.delete('ai_usage_claude_usage_cooldown_v1')
  const usageURL='https://api.anthropic.com/api/oauth/usage',budgetRows=JSON.parse(kc.get('ai_usage_claude_oauth_v1'))
  budgetRows.forEach(a=>a.expiresAt=now+7200000);kc.set('ai_usage_claude_oauth_v1',JSON.stringify(budgetRows))
  const nAcc=budgetRows.length;assert.ok(nAcc>0)
  let usageMode='ok',cardMode='positive',retryAfter=null,holdUsage=false,releaseUsage=[]
  quotaFailure=false;statsFailure=false
  handler=async(u,o)=>{
    if(!u.startsWith('https://api.anthropic.com/'))return combinedHandler(u,o)
    assert.ok(!o.method||o.method==='GET')
    if(u===usageURL){
      if(holdUsage)await new Promise(r=>releaseUsage.push(r))
      if(usageMode==='429')return {status:429,headers:{get:n=>n==='Retry-After'?retryAfter:null},json:async()=>({error:{type:'rate_limit_error'}})}
      return resp(200,claudeUsage)
    }
    assert.equal(u,cardsURL)
    if(cardMode==='429')return {status:429,headers:{get:()=>null},json:async()=>({})}
    return resp(200,resetFixture([resetGrant('a',2)]))
  }
  const countCalls=from=>({usage:calls.slice(from).filter(x=>x.url===usageURL).length,cards:calls.slice(from).filter(x=>x.url===cardsURL).length})
  // First refresh: one usage + one card selector per account; second within the hour: usage only, card count from cache.
  before=calls.length;let rows=await api.loadClaudeAccounts();assert.deepEqual(countCalls(before),{usage:nAcc,cards:nAcc});assert.ok(rows.every(a=>a.resetCredits===2))
  now+=60000;before=calls.length;rows=await api.loadClaudeAccounts();assert.deepEqual(countCalls(before),{usage:nAcc,cards:0});assert.ok(rows.every(a=>a.resetCredits===2))
  now+=3600000;budgetRows.forEach(a=>a.expiresAt=now+7200000);kc.set('ai_usage_claude_oauth_v1',JSON.stringify(budgetRows))
  before=calls.length;await api.loadClaudeAccounts();assert.deepEqual(countCalls(before),{usage:nAcc,cards:nAcc})
  // Concurrent App/Widget/AppIntent loads share one in-flight request per account.
  holdUsage=true;releaseUsage=[];before=calls.length
  const concurrent=[api.loadClaudeAccounts(),api.loadClaudeAccounts(),api.loadClaudeAccounts()]
  for(let i=0;i<30&&releaseUsage.length<nAcc;i++)await Promise.resolve()
  assert.equal(releaseUsage.length,nAcc);holdUsage=false;releaseUsage.forEach(r=>r())
  const shared=await Promise.all(concurrent);assert.equal(countCalls(before).usage,nAcc);assert.equal(shared[0][0],shared[1][0])
  // Card selector 429 never becomes a quota failure; it is remembered and not retried.
  now+=3600001;budgetRows.forEach(a=>a.expiresAt=now+7200000);kc.set('ai_usage_claude_oauth_v1',JSON.stringify(budgetRows))
  cardMode='429';before=calls.length;rows=await api.loadClaudeAccounts()
  assert.deepEqual(countCalls(before),{usage:nAcc,cards:nAcc});assert.ok(rows.every(a=>a.fiveHour.remainingPercent===62.5))
  before=calls.length;await api.loadClaudeAccounts();assert.deepEqual(countCalls(before),{usage:nAcc,cards:0});cardMode='positive'
  // Plain usage 429: exact path + Retry-After, cache preserved, no retry, later refreshes send nothing until deadline.
  const isolatedCodex=kc.get('ai_usage_official_oauth_v1');kc.delete('ai_usage_official_oauth_v1')
  const officialBefore=await api.loadOfficialUsage();assert.equal(officialBefore.stale,false,String(officialBefore.error))
  for(const [ra,ms] of [['120',120000],[null,300000],['99999',3600000],['DATE+600',600000],['past-date',300000]]){
    storage.delete('ai_usage_claude_usage_cooldown_v1');usageMode='429';now+=1000
    retryAfter=ra==='DATE+600'?new Date(now+600000).toUTCString():ra==='past-date'?new Date(now-60000).toUTCString():ra
    const cachedAt=api.officialCached().fetchedAt
    before=calls.length;const limited=await api.loadOfficialUsage()
    assert.equal(countCalls(before).usage,nAcc===1?1:countCalls(before).usage);assert.ok(countCalls(before).usage<=nAcc)
    assert.equal(limited.stale,true);assert.equal(api.officialCached().fetchedAt,cachedAt)
    assert.ok(limited.error.includes('HTTP 429，GET /api/oauth/usage'));assert.ok(limited.error.includes('不自动重试'))
    assert.ok([Math.round(ms/1000),Math.round(ms/1000)-1].some(n=>limited.error.includes('剩余'+n+'秒')),limited.error);assert.ok(!limited.error.includes('cedar_ember'))
    const stored=storage.get('ai_usage_claude_usage_cooldown_v1');assert.ok(Object.values(stored).some(v=>Math.abs(v-(now+ms))<1000))
    assert.ok(Object.values(stored).some(v=>limited.error.includes('冷却至'+api.formatBeijingDeadline(v))));assert.ok(!limited.error.includes('Z'));assert.ok(!limited.error.includes('UTC+8'))
    usageMode='ok';before=calls.length;const cooling=await api.loadOfficialUsage()
    assert.equal(countCalls(before).usage,0);assert.equal(cooling.stale,true);assert.ok(cooling.error.includes('本次未发送请求'))
    // Widget interval is a timeline request; it never overrides Claude's independent request cooldown.
    const oldInterval=api.getRefreshMinutes();api.saveRefreshMinutes(5)
    before=calls.length;await load('widget.tsx').runWidget();assert.equal(countCalls(before).usage,0)
    assert.equal(presented.options.reloadPolicy.date.getTime(),now+5*60000);assert.equal(api.officialCached().fetchedAt,cachedAt)
    assert.ok(Object.values(stored).some(v=>presented.tree.props.error.includes(api.formatBeijingDeadline(v))))
    api.saveRefreshMinutes(oldInterval)

    // AppIntent button during cooldown performs a local cache result + reload, zero Claude requests.
    let intentReloads=0;const savedReload=scripting.Widget.reloadAll;scripting.Widget.reloadAll=async()=>{intentReloads++}
    before=calls.length;await registeredIntents.get('RefreshUsageIntent').perform(undefined)
    assert.equal(countCalls(before).usage,0);assert.equal(intentReloads,1);scripting.Widget.reloadAll=savedReload
    now+=ms+1000;before=calls.length;const resumed=await api.loadOfficialUsage()
    assert.equal(countCalls(before).usage,nAcc);assert.equal(resumed.stale,false)
  }
  if(isolatedCodex!=null)kc.set('ai_usage_official_oauth_v1',isolatedCodex)
  // Logout clears that account's cooldown/card records only.
  storage.set('ai_usage_claude_usage_cooldown_v1',{[budgetRows[0].id]:now+60000,other:now+60000});storage.set('ai_usage_claude_reset_cards_v1',{[budgetRows[0].id]:{count:1,at:now},other:{count:1,at:now}})
  const savedCreds=kc.get('ai_usage_claude_oauth_v1');api.logoutOfficial(budgetRows[0].id)
  assert.deepEqual(Object.keys(storage.get('ai_usage_claude_usage_cooldown_v1')),['other']);assert.deepEqual(Object.keys(storage.get('ai_usage_claude_reset_cards_v1')),['other'])
  kc.set('ai_usage_claude_oauth_v1',savedCreds);storage.delete('ai_usage_claude_usage_cooldown_v1');storage.delete('ai_usage_claude_reset_cards_v1');handler=claudeHandler
  console.log('PASS: Claude refresh = one GET /api/oauth/usage per account; card selector at most hourly with cached count; concurrent App/widget/intent share in-flight; card 429 never a quota failure; usage 429 shows exact path + Retry-After/5min/1h cap, keeps cache, no retry, sends nothing (incl. button) until deadline; logout clears only that account')
  // Lock-screen accessory families: exactly one account (first after parameter/sort), no grid/dividers/stats/footer.
  {
    const preAccessory=process.env.PRE_ACCESSORY_WIDGET_PATH
    const accData={...singleData,accounts:singleData.accounts.map((a,i)=>({...a,name:'acc'+i+'@example.test',resetCredits:i===0?3:null}))}
    assert.ok(accData.accounts.length>=3)
    const sortedAll=api.widgetAccounts(accData.accounts,'')
    const titlesOf=tree=>tree.filter(x=>x.type==='HStack'&&x.props.children?.[0]?.type?.name==='ProviderIcon')
    for(const family of ['accessoryRectangular','accessoryCircular','accessoryInline']){
      for(const parameter of ['','3,1','2']){
        scripting.Widget.family=family;scripting.Widget.parameter=parameter;scripting.Widget.displaySize={width:160,height:72}
        const expected=api.widgetAccounts(accData.accounts,parameter)[0]
        const tree=expand(Root({data:accData,stale:true,error:null}))
        // No home background/padding, statistics, dividers, multi-account grid or refresh footer.
        assert.ok(!tree.some(x=>x.type==='Rectangle'));assert.ok(!tree.some(x=>x.props?.widgetBackground))
        assert.ok(!tree.some(x=>x.type==='Button'));assert.ok(!tree.some(x=>x.type==='GeometryReader'))
        const strings=tree.filter(x=>typeof x==='string').concat(tree.filter(x=>x.type==='Text').map(x=>[].concat(x.props.children).join('')))
        assert.ok(!strings.some(x=>x==='今日'||x==='本月'||x.includes('统计')))
        for(const other of accData.accounts.filter(a=>a.id!==expected.id))assert.ok(!strings.some(x=>x===(api.getWidgetName(other.id)||other.name.replace(/@.*$/,''))))
        if(family==='accessoryRectangular'){
          const titles=titlesOf(tree);assert.equal(titles.length,1)
          assert.equal(titles[0].props.children[0].props.provider,expected.provider)
          const shown=api.getWidgetName(expected.id)||expected.name.replace(/@.*$/,'');assert.ok(strings.includes(shown),shown+' '+JSON.stringify(strings))
          assert.equal(tree.filter(x=>x.type==='SVG'&&x.props.frame?.height===10).length,2) // 5 h + 每周 LCDs
          assert.ok(strings.includes('5 h'));assert.ok(strings.includes('每周'))
          // Title name/provider text never forced to a narrow fixed width (the old "C..." cause was grid cell width).
          assert.ok(tree.filter(x=>x.type==='Text').every(x=>x.props.frame?.width==null||x.props.frame.width<=8*2.1+1e-9))
        }else if(family==='accessoryCircular'){
          const gauge=tree.find(x=>x.type==='Gauge');assert.ok(gauge);assert.equal(tree.filter(x=>x.type==='Gauge').length,1)
          assert.equal(gauge.props.gaugeStyle,'accessoryCircularCapacity')
          const v=expected.fiveHour.remainingPercent;assert.equal(gauge.props.value,v==null?0:Math.max(0,Math.min(100,v))/100)
          assert.equal(gauge.props.currentValueLabel.props.children,api.fmtPct(v));assert.equal(gauge.props.label.props.children,'5 h')
        }else{
          const texts=tree.filter(x=>x.type==='Text');assert.equal(texts.length,1);assert.equal(texts[0].props.lineLimit,1)
          assert.equal(texts[0].props.children,(expected.provider==='claude'?'Claude':expected.provider==='openai'?'Codex':expected.provider)+' 5h '+api.fmtPct(expected.fiveHour.remainingPercent)+' · 周 '+api.fmtPct(expected.sevenDay.remainingPercent))
        }
      }
      // No data / no accounts / bad parameter: compact text, no exception, no grid.
      scripting.Widget.family=family;scripting.Widget.parameter='99'
      let t=expand(Root({data:accData,stale:false,error:null}));assert.ok(t.some(x=>x==='请检查小组件参数'))
      scripting.Widget.parameter=''
      t=expand(Root({data:null,stale:false,error:'未配置'}));assert.ok(t.includes('未配置'))
      t=expand(Root({data:{...accData,accounts:[]},stale:false,error:null}));assert.ok(t.includes('没有订阅账号'))
    }
    assert.equal(sortedAll[0].id,api.widgetAccounts(accData.accounts,'')[0].id)
    // Home-screen families are byte-identical to the pre-change widget for every selection.
    if(preAccessory){
      const prior=load('pre-accessory-widget.tsx').Root
      for(const [family,size] of [['systemSmall',{width:170,height:170}],['systemMedium',{width:358,height:170}],['systemLarge',{width:358,height:376}],['systemExtraLarge',{width:715,height:376}]])
        for(const parameter of ['','1','1,2','3,1,4','4,2,3,1'])for(const stale of [false,true]){
          scripting.Widget.family=family;scripting.Widget.parameter=parameter;scripting.Widget.displaySize=size
          // Only the requested refresh icon/font/hit frame may differ from the baseline.
          const normalize=t=>JSON.stringify(t,(k,v)=>{
            if(v?.type==='Image'&&v.props?.systemName==='arrow.triangle.2.circlepath')return {...v,props:{...v.props,font:9}}
            if(v?.type==='Button'&&v.props?.intent?.name==='RefreshUsageIntent'){const p={...v.props};delete p.frame;return {...v,props:p}}
            return v
          })
          assert.equal(normalize(expand(Root({data:accData,stale,error:null}))),normalize(expand(prior({data:accData,stale,error:null}))),family+' '+parameter)
        }
    }else console.log('NOTE: PRE_ACCESSORY_WIDGET_PATH unset; home-screen identity comparison skipped')
    scripting.Widget.family='systemLarge';scripting.Widget.parameter='';scripting.Widget.displaySize={width:358,height:376}
  }
  console.log('PASS: accessoryRectangular/Circular/Inline render exactly the first account after parameter/sort (one title, 5 h/每周 rows; one gauge; one inline line); no grid/divider/stats/background/footer button; empty/no-data/bad-parameter compact; systemSmall/Medium/Large/ExtraLarge trees identical except requested refresh icon/font/hit frame to baseline for all selections')
  // Sub2API admin contracts: all-site stats, calendar dates, pagination, GET-only + x-api-key, no user-key/JWT.
  {
    const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/sub2api-admin.json'),'utf8'))
    assert.equal(api.getStatisticsSource(),'parrot') // legacy default without changing either config
    const savedSource=api.getSource(),savedClaude=kc.get('ai_usage_claude_oauth_v1'),savedCodex=kc.get('ai_usage_official_oauth_v1')
    kc.delete('ai_usage_claude_oauth_v1');kc.set('ai_usage_official_oauth_v1',JSON.stringify(quotaItems.map(a=>({...a,expiresAt:now+86400000}))))
    api.saveConfig('mock-base','mock-management');api.saveSub2APIConfig('https://sub.example.test/','mock-admin','Asia/Shanghai')
    let failStats=false,failList=false,failClaude=false,failCards=false,omitCounts=false,holdStats=false,releaseStats=[]
    const ok=data=>resp(200,{code:0,message:'success',data})
    const route=async(u,o)=>{
      if(!u.startsWith('https://sub.example.test/'))return combinedHandler(u,o)
      assert.ok(!o.method||o.method==='GET');assert.equal(o.headers['x-api-key'],'mock-admin')
      assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers['ChatGPT-Account-ID'],undefined)
      const url=new URL(u),p=url.pathname
      if(p==='/api/v1/admin/usage/stats'){
        assert.equal(url.searchParams.get('timezone'),'Asia/Shanghai');assert.equal(url.searchParams.has('period'),false)
        assert.ok(![...url.searchParams.keys()].some(k=>['account_id','user_id','api_key_id','group_id','model'].includes(k)))
        if(holdStats)await new Promise(r=>releaseStats.push(r))
        if(failStats)return resp(503,{message:'SECRET-admin-body'})
        return ok({...fixture.stats,total_requests:url.searchParams.get('start_date').endsWith('-01')?120:12})
      }
      if(p==='/api/v1/admin/accounts'){
        if(failList)return resp(502)
        assert.equal(url.searchParams.get('lite'),'true');assert.equal(url.searchParams.get('page_size'),'100')
        const page=Number(url.searchParams.get('page'));assert.ok(page===1||page===2)
        return ok({items:page===1?fixture.accounts.slice(0,2):fixture.accounts.slice(2),total:5,page,page_size:100,pages:2})
      }
      if(p==='/api/v1/admin/accounts/11/usage'){if(failClaude)return resp(429);return ok(fixture.claudeUsage)}
      if(p==='/api/v1/admin/accounts/55/usage')return ok({five_hour:null,seven_day:null})
      if(p==='/api/v1/admin/accounts/11/claude/reset-credits'){if(failCards)return resp(503);return ok(omitCounts?{}:fixture.claudeCredits)}
      if(p==='/api/v1/admin/openai/accounts/22/quota')return ok({...fixture.codexQuota,rate_limit_reset_credits:omitCounts?{}:fixture.codexQuota.rate_limit_reset_credits})
      throw Error('unexpected Sub2API GET '+p)
    }
    handler=route;statsFailure=false;quotaFailure=false;missingOverall=false
    // Auth/source/cache/RE isolation for all 3 quota x 2 stats combinations.
    for(const source of ['parrot','official','sub2api'])for(const stats of ['parrot','sub2api']){
      api.saveSource(source);api.saveStatisticsSource(stats);before=calls.length
      const r=await api.loadUsage();assert.ok(r.data);assert.equal(r.stale,false,r.error);assert.equal(r.data.statistics.error,null)
      assert.equal(r.data.today.requests,stats==='sub2api'?12:23)
      assert.equal(r.data.today.costUsd,stats==='sub2api'?4.5:7.8) // actual_cost, NOT standard or upstream account cost
      if(stats==='sub2api'){assert.equal(r.data.today.totalTokens,640);assert.equal(r.data.today.cacheReadTokens,300);assert.equal(r.data.today.cacheCreationTokens,40)}
      if(source==='parrot'){assert.deepEqual(Array.from(r.data.accounts,a=>a.id),['combined-parrot']);assert.equal(r.data.accounts[0].resetCredits,0)}
      if(source==='official'){assert.ok(r.data.accounts.every(a=>a.id.startsWith('combined-official-')));assert.ok(r.data.accounts.every(a=>a.resetCredits===1))}
      if(source==='sub2api'){
        assert.deepEqual(Array.from(r.data.accounts,a=>a.id),['sub2api:11','sub2api:22','sub2api:55'])
        assert.equal(r.data.accounts[0].resetCredits,7);assert.equal(r.data.accounts[1].resetCredits,4);assert.equal(r.data.accounts[2].resetCredits,null)
        assert.equal(r.data.accounts[0].fiveHour.remainingPercent,75);assert.equal(r.data.accounts[0].sevenDay.remainingPercent,40)
        assert.equal(r.data.accounts[1].fiveHour.remainingPercent,85);assert.equal(r.data.accounts[1].sevenDay.remainingPercent,20)
        assert.equal(r.data.accounts[2].enabled,false);assert.equal(r.data.accounts[2].fiveHour.remainingPercent,null)
      }
      const b=calls.slice(before);assert.equal(b.filter(c=>c.url.includes('/admin/usage/stats')).length,stats==='sub2api'?2:0)
      assert.equal(b.filter(c=>c.url.includes('/stats/summary')).length,stats==='parrot'?2:0)
      assert.ok(b.filter(c=>c.url.startsWith('https://sub.example.test')).every(c=>!c.options.method||c.options.method==='GET'))
      // Statistics paths cannot fetch account/reset-card data unless quota source is Sub2API.
      if(source!=='sub2api')assert.ok(!b.some(c=>c.url.includes('/admin/accounts')||c.url.includes('/admin/openai')))
      for(const family of ['systemSmall','systemMedium','systemLarge','systemExtraLarge','accessoryRectangular','accessoryCircular','accessoryInline']){
        scripting.Widget.family=family;scripting.Widget.parameter=source==='sub2api'?'2,1':'1'
        const tree=expand(Root({data:r.data,stale:r.stale,error:r.error}));assert.ok(tree.length>0)
        if(family.startsWith('accessory'))assert.ok(!tree.some(x=>x.type==='Button'))
      }
    }
    // Schema gaps unknown (not zero), standard cost and wallet balance never substituted.
    const broken={...fixture.stats};delete broken.total_cache_read_tokens
    assert.throws(()=>api.parseSub2APIStats(broken,fixture.stats),/字段缺失/)
    const badCost={...fixture.stats,total_actual_cost:NaN};assert.throws(()=>api.parseSub2APIStats(badCost,fixture.stats),/字段缺失/)
    const unknown=api.mapSub2APIAccount(fixture.accounts[1],{credits:{balance:'999'},rate_limit:{primary_window:{used_percent:4,limit_window_seconds:3600}}},{available_count:99})
    assert.equal(unknown.fiveHour.remainingPercent,null);assert.equal(unknown.sevenDay.remainingPercent,null);assert.equal(unknown.resetCredits,null)
    assert.equal(api.mapSub2APIAccount(fixture.accounts[0],fixture.claudeUsage,{}).resetCredits,null)
    assert.equal(api.mapSub2APIAccount(fixture.accounts[0],fixture.claudeUsage,{available_count:0}).resetCredits,0)
    // calendar dates use explicit selected timezone; January month start, never rolling month.
    api.saveSource('sub2api');api.saveStatisticsSource('sub2api');before=calls.length;await api.loadUsage()
    const dates=calls.slice(before).filter(c=>c.url.includes('/admin/usage/stats')).map(c=>new URL(c.url).searchParams)
    assert.ok(dates.some(d=>d.get('start_date')===d.get('end_date')));assert.ok(dates.some(d=>d.get('start_date')===d.get('end_date').slice(0,8)+'01'))
    const keepNow=now;now=Date.parse('2027-01-31T16:30:00Z') // February 1 in Asia/Shanghai
    before=calls.length;await api.loadUsage();const firstDay=calls.slice(before).filter(c=>c.url.includes('/admin/usage/stats'))
    assert.equal(firstDay.length,1);const firstDate=new URL(firstDay[0].url).searchParams
    assert.equal(firstDate.get('start_date'),'2027-02-01');assert.equal(firstDate.get('end_date'),'2027-02-01');now=keepNow
    const allZero=Object.fromEntries(Object.keys(fixture.stats).map(k=>[k,0]));assert.equal(api.parseSub2APIStats(allZero,allZero).today.totalTokens,0)
    // Same-process App/widget/intent dedup: two stats GETs and one two-page account list shared.
    holdStats=true;releaseStats=[];before=calls.length
    const flights=[api.loadUsage(),api.loadUsage(),api.loadUsage()]
    for(let i=0;i<40&&releaseStats.length<2;i++)await Promise.resolve()
    assert.equal(releaseStats.length,2);holdStats=false;releaseStats.forEach(r=>r());const shared=await Promise.all(flights)
    assert.equal(shared[0],shared[1]);assert.equal(calls.slice(before).filter(c=>c.url.includes('/admin/usage/stats')).length,2)
    assert.equal(calls.slice(before).filter(c=>new URL(c.url).pathname==='/api/v1/admin/accounts').length,2)
    // Independent stats failure retains same-provider stats timestamp, does not block quota.
    const statsAt=storage.get('ai_usage_sub2api_stats_v1').fetchedAt;now+=1000;failStats=true
    let r=await api.loadUsage();assert.equal(r.stale,false);assert.equal(r.data.statistics.stale,true);assert.equal(r.data.statistics.fetchedAt,statsAt)
    assert.ok(r.data.statistics.error.includes('HTTP 503'));assert.ok(!r.data.statistics.error.includes('SECRET'))
    failStats=false
    // Partial per-account quota failure keeps every account and old quota, reports exact failing path; no cross-source replacement.
    const priorSubAt=storage.get('ai_usage_sub2api_quota_v1').fetchedAt;now+=1000;failClaude=true;r=await api.loadUsage()
    assert.equal(r.stale,true);assert.equal(r.data.accounts.length,3);assert.equal(r.data.accounts.find(a=>a.id==='sub2api:11').fiveHour.remainingPercent,75)
    assert.equal(r.data.fetchedAt,priorSubAt);assert.ok(r.error.includes('sub2api:11'));assert.ok(r.error.includes('GET /api/v1/admin/accounts/11/usage'));failClaude=false
    failList=true;r=await api.loadUsage();assert.equal(r.stale,true);assert.equal(r.data.accounts.length,3);assert.equal(r.data.statistics.error,null);failList=false
    // Source-specific aliases/order survive switching; no order/RE from stats provider.
    api.saveWidgetName('sub2api:22','S alias','sub2api');api.saveAccountOrder(['sub2api:22','sub2api:11','sub2api:55'],'sub2api')
    api.saveSource('official');assert.equal(api.getWidgetName('sub2api:22'),'');api.saveSource('sub2api');assert.equal(api.getWidgetName('sub2api:22'),'S alias')
    assert.equal(api.cachedAccounts()[0].id,'sub2api:22');assert.equal(api.widgetAccounts(r.data.accounts,'1')[0].id,'sub2api:22')
    // Card failure is quota-local: unknown without its own cache; never use Parrot/official counts.
    storage.delete('ai_usage_sub2api_cards_v1');failCards=true;omitCounts=true;api.saveStatisticsSource('parrot');r=await api.loadUsage()
    assert.equal(r.data.accounts.find(a=>a.id==='sub2api:11').resetCredits,null);assert.equal(r.data.accounts.find(a=>a.id==='sub2api:22').resetCredits,null)
    assert.ok(r.error.includes('重置卡'));assert.equal(r.data.statistics.error,null)
    before=calls.length;r=await api.loadUsage();assert.ok(r.error.includes('重置卡'));assert.ok(!calls.slice(before).some(c=>c.url.includes('/claude/reset-credits')))
    failCards=false;omitCounts=false
    // Widget run + registered RefreshUsageIntent call the same selected-provider loader.
    api.saveStatisticsSource('sub2api');let reloaded=0,presented=null;const reload=scripting.Widget.reloadAll,present=scripting.Widget.present
    scripting.Widget.reloadAll=async()=>{reloaded++};scripting.Widget.present=(node,opts)=>{presented={node,opts}}
    before=calls.length;await registeredIntents.get('RefreshUsageIntent').perform(undefined);assert.equal(reloaded,1);assert.equal(calls.slice(before).filter(c=>c.url.includes('/admin/usage/stats')).length,2)
    before=calls.length;await load('widget.tsx').runWidget();assert.ok(presented);assert.equal(calls.slice(before).filter(c=>c.url.includes('/admin/usage/stats')).length,2)
    scripting.Widget.reloadAll=reload;scripting.Widget.present=present
    // App exposes independent selectors, saved-key redaction, Sub2API save/reload, and does not modify quota when choosing stats.
    states.length=0;let ui=render();const selectors=ui.filter(x=>x.type==='Picker');assert.ok(selectors.some(x=>x.props.title==='统计来源'))
    const quotaSelector=selectors.find(x=>x.props.title==='来源');assert.ok(expand(quotaSelector).some(x=>x==='Sub2API'))
    assert.ok(ui.some(x=>x.type==='SecureField'&&x.props.title==='Sub2API管理员密钥'&&x.props.value===''))
    assert.ok(!ui.some(x=>typeof x==='string'&&x.includes('mock-admin')))
    ui.find(x=>x.type==='TextField'&&x.props.title==='Sub2API地址').props.onChanged('https://sub.example.test/')
    ui.find(x=>x.type==='SecureField'&&x.props.title==='Sub2API管理员密钥').props.onChanged('mock-admin')
    ui=render();await ui.find(x=>x.type==='Button'&&x.props.title==='保存Sub2API并测试').props.action()
    assert.equal(api.getSub2APIConfig().baseUrl,'https://sub.example.test');assert.equal(api.getSub2APIConfig().adminKey,'mock-admin')
    assert.ok(render().some(x=>x.type==='SecureField'&&x.props.title==='Sub2API管理员密钥'&&x.props.value===''))
    await selectors.find(x=>x.props.title==='统计来源').props.onChanged('parrot');assert.equal(api.getSource(),'sub2api');assert.equal(api.getStatisticsSource(),'parrot')
    ui=render();assert.ok(ui.some(x=>x.type==='TextField'&&x.props.title==='地址')) // Parrot config visible for selected stats
    await ui.find(x=>x.type==='Picker'&&x.props.title==='来源').props.onChanged('official');assert.equal(api.getStatisticsSource(),'parrot');assert.equal(api.getSub2APIConfig().adminKey,'mock-admin')
    // Config changes erase only Sub2API caches, and pending old reads cannot repopulate them.
    api.saveSource('sub2api');api.saveStatisticsSource('sub2api');holdStats=true;releaseStats=[];const oldFlight=api.loadUsage()
    for(let i=0;i<40&&releaseStats.length<2;i++)await Promise.resolve();assert.equal(releaseStats.length,2)
    const parrotStatsCache=JSON.stringify(storage.get('ai_usage_parrot_stats_v1')),officialCache=JSON.stringify(api.officialCached())
    api.saveSub2APIConfig('https://changed.example.test','other-admin','UTC')
    assert.equal(storage.get('ai_usage_sub2api_stats_v1'),undefined);assert.equal(storage.get('ai_usage_sub2api_quota_v1'),undefined)
    holdStats=false;releaseStats.forEach(r=>r());await oldFlight
    assert.equal(storage.get('ai_usage_sub2api_stats_v1'),undefined);assert.equal(storage.get('ai_usage_sub2api_quota_v1'),undefined)
    assert.equal(JSON.stringify(storage.get('ai_usage_parrot_stats_v1')),parrotStatsCache);assert.equal(JSON.stringify(api.officialCached()),officialCache)
    assert.throws(()=>api.saveSub2APIConfig('https://user:pass@example.test','x','UTC'),/地址/);assert.throws(()=>api.saveSub2APIConfig('https://example.test','x','not-a-tz'),/时区/)
    api.clearSub2APIConfig();assert.equal(api.getSub2APIConfig().adminKey,null);assert.equal(api.getConfig().managementKey,'mock-management')
    assert.ok(!JSON.stringify([...storage.values()]).includes('mock-admin'));assert.ok(!JSON.stringify([...storage.values()]).includes('other-admin'))
    if(savedClaude!=null)kc.set('ai_usage_claude_oauth_v1',savedClaude);if(savedCodex!=null)kc.set('ai_usage_official_oauth_v1',savedCodex)
    api.saveSource(savedSource);api.saveStatisticsSource('parrot');handler=claudeHandler;states.length=0
    scripting.Widget.family='systemLarge';scripting.Widget.parameter='';scripting.Widget.displaySize={width:358,height:376}
  }
  console.log('PASS: Sub2API upstream admin schema/x-api-key GET-only; unfiltered full-site actual_cost/calendar day+month/timezone; complete pagination/only real Claude+Codex windows; 3 quota x 2 stats/RE no cross-source; partial-account/cache/list/stats failures; aliases/order; defaults; App+widget+intent real selected-source entry; dedup; config changes/redaction/late-read guards; all family layouts unchanged')
  console.log('PASS: module explicitly has no WebViewController; legacy import fails/global succeeds; absent global accurate inline UI; code-only long-press copy with cancel/source/dismiss/expiry/success stale guards')
  console.log('PASS: deferred load cannot block presentation; timeout visible in UI/unlocks Safari; close-before-load late rejection handled; timers cleared and dispose once')
  console.log('PASS: new ephemeral WebView per attempt; finally dispose normal/load/present failure; default close auto-refresh; cancel/source/dismiss guards; retryable embedded failure; explicit Safari fallback preserved')
  console.log('PASS: Safari dismissal pending/success/one interval wait/cancel/source/dismiss; UI auto cache+list+reload; claims names/fallback/duplicate IDs/alias preservation/local migration')
  console.log('PASS: aliases stable-ID persistence/source isolation/trim+Emoji+long names/prototype IDs/fallback/6 widget cases per source/refresh+order stability/zero accounts/editor save/reset/official logout+Parrot clear isolation; remote records unchanged')
  console.log('PASS: device pending/throttle/expired/cancel/in-flight cancel/success/dedup; refresh/401/rotation; duration mapping/reset cards; source isolation/logout; 3 widget trees; syntax/version/old updater; stable-ID sorting/default first accounts including disabled/parameters/pruning; obsolete selections ignored and never written; no UI Toggles; large label gap/six stat columns; Parrot grant/total; read-only Form list + NavigationLink to ScrollView/LazyVGrid ReorderableForEach (dragPreview rounded, active highlight) down/up/multi/end/no-op/invalid/cross-source/persistence; old onDrag/EditButton removed; one-decimal rounding; fixedSize intrinsic 6-column HStack/one column owns both periods/leading/no edge Spacer/uniform font factor and width budget; dual-arrow refresh icon in 3 families; Small one-account 4 stats/uncompressed shared columns/equal internal Spacers/summary scope; Small two-account no stats; official missing; Codex/Claude disabled gray title+SVG fill in 3 widget families, App foreground always normal, enabled 0%/unavailable/stale unchanged, no disabled words; quota colors unchanged')
}
main().catch(e=>{console.error(e);process.exitCode=1})
