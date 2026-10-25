// Production widget/api/intent modules, synthetic host only. No business requests or real credentials.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const ts=require(process.env.TYPESCRIPT_PATH||'typescript'),root=path.resolve(__dirname,'..'),DIAG='ai_usage_widget_diagnostic_v1'
const clone=x=>JSON.parse(JSON.stringify(x)),flush=async(n=160)=>{while(n--)await Promise.resolve()}
const win={usedPercent:25,remainingPercent:75,resetsAt:null}
const account=(id='sub2api:1',provider='openai')=>({id,name:'Fixture '+id,provider,enabled:true,available:true,fiveHour:win,sevenDay:win,resetCredits:2})
const data=(accounts=[account()])=>({accounts,today:null,month:null,todayByFamily:{},monthByFamily:{},fetchedAt:1800000000000-5000})
const cacheKey=s=>s==='official'?'ai_usage_official_cache_v1':s==='sub2api'?'ai_usage_sub2api_quota_v1':'ai_usage_cache_v1'
const localKey=s=>s==='official'?'ai_usage_antigravity_local_widget_until_v1':`ai_usage_local_widget_until_${s}_v1`
function host({source='sub2api',cached,local=false,registerFail=false}={}){
 let now=1800000000000,next=1,throwGet='',throwKey='',writeFailure=false,presentFailure=false,decodeFailure=false,handler,renderInside=true
 const store=new Map([['ai_usage_source_v1',source]]),kc=new Map(),modules={},timers=new Map(),calls=[],presents=[],writes=[],keyReads=[],storeReads=[]
 if(cached!==undefined)store.set(cacheKey(source),clone(cached))
 if(local)store.set(localKey(source),now+60000)
 const response=(status,b={})=>({status,headers:{get:()=>null},json:async()=>b})
 if(source==='sub2api'){kc.set('ai_usage_sub2api_url_v1','https://sub.fixture.invalid');kc.set('ai_usage_sub2api_admin_key_v1','SECRET-KEY-fixture')}
 if(source==='parrot'){kc.set('parrot_base_url','https://parrot.fixture.invalid');kc.set('parrot_management_key','SECRET-MGMT-fixture');kc.set('parrot_session_credential','SECRET-SESSION-fixture')}
 function seedOfficial(provider='openai',expired=false){
  store.set('ai_usage_source_v1','official')
  const key=provider==='openai'?'ai_usage_official_oauth_v1':provider==='claude'?'ai_usage_claude_oauth_v1':provider==='antigravity'?'ai_usage_antigravity_oauth_v1':'ai_usage_workbuddy_cn_cli_v1'
  const id=provider==='openai'?'official-fixture':provider==='workbuddy'?'workbuddy:cn:cli:fixture':provider+':fixture'
  const c={id,accountId:'fixture',subject:'fixture',organizationId:'org',name:'Fixture',email:'fixture@example.test',access:'SECRET-ACCESS-fixture',refresh:'SECRET-REFRESH-fixture',expiresAt:expired?1:now+3600000,scope:'user:profile',uid:'fixture',domain:'www.codebuddy.cn'}
  kc.set(key,JSON.stringify([c]));return {key,id,c}
 }
 handler=async(u,o)=>{
  if(u.includes('/api/v1/admin/accounts?'))return response(200,{code:0,data:{pages:1,items:[{id:1,name:'Fixture sub2api:1',platform:'openai',type:'oauth',status:'active'}]}})
  if(u.endsWith('/quota'))return response(200,{code:0,data:{rate_limit:{primary_window:{used_percent:60,limit_window_seconds:18000}}}})
  if(u.includes('/usage/stats?'))return response(200,{code:0,data:{total_requests:3,total_input_tokens:2,total_output_tokens:1,total_cache_read_tokens:0,total_cache_creation_tokens:0,total_tokens:3,total_actual_cost:1}})
  if(u.includes('/wham/usage'))return response(200,{rate_limit:{primary_window:{used_percent:60,limit_window_seconds:18000}},rate_limit_reset_credits:{available_count:3}})
  if(u.endsWith('/api/oauth/usage'))return response(200,{five_hour:{utilization:60},cedar_ember:{eligible:true,grants:[{id:'fixture',resets_left:3}]}})
  if(u.endsWith(':loadCodeAssist'))return response(200,{cloudaicompanionProject:'fixture-project'})
  if(u.endsWith(':retrieveUserQuotaSummary'))return response(200,{groups:[{displayName:'Gemini Models',buckets:[{displayName:'Gemini',window:'5h',remainingFraction:0.4}]}]})
  if(u.endsWith('/get-user-resource'))return response(200,{code:0,data:{Response:{Data:{TotalCount:1,Accounts:[{AccountId:'fixture',PackageName:'Fixture',CapacitySizePrecise:'10',CapacityRemainPrecise:'4',CapacityUsedPrecise:'6'}]}}}})
  if(u.endsWith('/checkin-activity-status'))return response(200,{code:0,data:{active:true,todayCheckedIn:true}})
  if(u.includes('/oauth/accounts?'))return response(200,{data:{items:[{accountId:'p1',displayName:'Fixture p1',provider:'openai',enabled:true,available:true}]}})
  if(u.endsWith('/oauth/accounts/p1'))return response(200,{data:{usageWindows:[{name:'fiveHour',usedPercent:60,remainingPercent:40}]}})
  if(u.includes('/channels?'))return response(200,{data:[],meta:{page:1,hasNext:false}})
  if(u.includes('/stats/summary?'))return response(200,{data:{overall:{total:3,costTicks:0}}})
  throw Error('synthetic-unexpected-request SECRET-KEY https://secret.invalid/?token=SECRET')
 }
 const scripting=new Proxy({Widget:{family:'systemSmall',parameter:'',displaySize:{width:160,height:160},present:(node,options)=>{presents.push({node,options});if(presentFailure)throw Error('SECRET-native-present');if(renderInside)presents.at(-1).tree=expand(node)},reloadAll:()=>{}},AppIntentProtocol:{AppIntent:0},AppIntentManager:{register:()=>{if(registerFail)throw Error('SECRET-register');return()=>({intent:'fixture'})}},modifiers:()=>{const p=new Proxy({},{get:()=>()=>p});return p}},{get:(o,k)=>k in o?o[k]:k})
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const context=vm.createContext({console,Date:Clock,Map,Set,WeakMap,Math,Promise,Intl,
  setTimeout:(fn,ms)=>{const id=next++;timers.set(id,{fn,at:now+ms,ms});return id},clearTimeout:id=>timers.delete(id),
  Storage:{get:k=>{storeReads.push(k);if(throwGet==='*'||throwGet===k)throw Error('SECRET-Storage /?key=SECRET');return store.has(k)?clone(store.get(k)):null},set:(k,v)=>{if(writeFailure&&(k===DIAG||k==='ai_usage_widget_diagnostic_history_v1'))throw Error('SECRET-diagnostic-write');store.set(k,clone(v));writes.push({kind:'store',key:k});return true},remove:k=>{store.delete(k);writes.push({kind:'remove',key:k})}},
  Keychain:{get:k=>{keyReads.push(k);if(throwKey==='*'||throwKey===k)throw Error('SECRET-Keychain /?token=SECRET');return kc.get(k)||null},set:(k,v)=>{kc.set(k,v);writes.push({kind:'keychain',key:k});return true},remove:k=>{kc.delete(k);writes.push({kind:'keychain-remove',key:k})}},
  Data:{fromBase64String:s=>({toRawString:()=>Buffer.from(s,'base64').toString()})},UIImage:{fromBase64String:()=>decodeFailure?null:{image:'fixture'}},
  fetch:async(u,o={})=>{calls.push({u,o});return handler(u,o)}
 })
 function load(file){if(modules[file])return modules[file].exports;let s=fs.readFileSync(path.join(root,file),'utf8');if(file==='widget.tsx')s=s.replace(/\nrun\(\)\s*$/,'\nexport {run}');const output=ts.transpileModule(s,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'},reportDiagnostics:true});assert.equal(output.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);const m=modules[file]={exports:{}},jsx=(type,props)=>({type,props});vm.runInContext(`(function(require,module,exports){${output.outputText}\n})`,context)(n=>n==='scripting'?scripting:n==='scripting/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:load(n.slice(2)+(fs.existsSync(path.join(root,n.slice(2)+'.tsx'))?'.tsx':'.ts')),m,m.exports);return m.exports}
 function expand(node){if(node==null||typeof node!=='object')return node;if(Array.isArray(node))return node.map(expand);if(typeof node.type==='function')return expand(node.type(node.props));if(node.type==='GeometryReader'&&typeof node.props.children==='function')return expand(node.props.children({size:scripting.Widget.displaySize}));return {type:node.type,props:Object.fromEntries(Object.entries(node.props||{}).map(([k,v])=>[k,typeof v==='function'?'[function]':expand(v)]))}}
 const api=load('api.ts'),widget=load('widget.tsx')
 async function tick(ms=widget.WIDGET_LOAD_BUDGET_MS){now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await flush()}
 return {load,api,widget,store,kc,timers,calls,presents,writes,keyReads,storeReads,response,seedOfficial,tick,run:()=>widget.run(),expand,scripting,handler:()=>handler,setHandler:f=>handler=f,
  fault:(kind,key)=>{if(kind==='store')throwGet=key;if(kind==='key')throwKey=key;if(kind==='diagnostic')writeFailure=key;if(kind==='present')presentFailure=key;if(kind==='decode')decodeFailure=key;if(kind==='deferred')renderInside=!key},
  text:()=>JSON.stringify(presents.at(-1)?.tree),diagnostic:()=>store.get(DIAG)}
}
async function done(h,task=h.run()){
 await task;assert.equal(h.presents.length,1,'exactly one present attempt');assert.equal(h.timers.size,0,'budget timer cleaned')
 const d=h.diagnostic();if(d){assert.deepEqual(Object.keys(d).sort(),['elapsedMs','errorType','outcome','phase','version']);assert.ok(!/SECRET|https|token|query|fixture@example/i.test(JSON.stringify(d)));assert.ok(d.elapsedMs>=0&&d.elapsedMs<=86400000)}
}
async function timeout(h){const task=h.run();await flush();assert.equal(h.presents.length,0);await h.tick();await done(h,task);assert.equal(h.diagnostic().errorType,'timeout');return task}
async function main(){
 const unhandled=[];const onRejection=e=>unhandled.push(e);process.on('unhandledRejection',onRejection)
 for(const source of ['sub2api','parrot','official'])for(const warm of [false,true]){
  const h=host({source,cached:warm?data([account(source==='parrot'?'p1':source==='official'?'official-fixture':'sub2api:1')]):undefined});if(source==='official')h.seedOfficial()
  await done(h);assert.equal(h.presents[0].node.props.data.accounts.length,1);assert.equal(h.presents[0].node.props.data.accounts[0].fiveHour.remainingPercent,40);assert.equal(h.diagnostic().errorType,'none');assert.equal(h.diagnostic().outcome,'fresh')
 }
 {
  const h=host({source:'official'});await done(h);assert.equal(h.presents[0].node.type,'Text');assert.ok(h.text().includes('账号未配置'))
 }
 for(const fail of ['reject','http-timeout','never'])for(const warm of [false,true]){
  const h=host({cached:warm?data():undefined});h.setHandler(()=>fail==='never'?new Promise(()=>{}):Promise.reject(Object.assign(Error('SECRET-transport https://secret/?token=SECRET'),{name:fail==='http-timeout'?'AbortError':'Error'})))
  if(fail==='never')await timeout(h);else await done(h)
  if(warm)assert.equal(h.presents[0].node.props.data.accounts[0].id,'sub2api:1');else assert.equal(h.presents[0].node.type,'Text')
 }
 {
  const h=host({cached:data()});h.store.set('ai_usage_statistics_source_v1','sub2api');const base=h.handler();let release=[]
  h.setHandler((u,o)=>u.includes('/usage/stats?')?new Promise(r=>release.push(()=>r(h.response(200,{code:0,data:{}})))):base(u,o))
  await timeout(h);assert.equal(h.presents[0].node.props.data.accounts[0].fiveHour.remainingPercent,40,'quota completed and committed before statistics hung; fallback reads latest cache')
  const snapshot=clone([...h.store]),writeCount=h.writes.length;release.forEach(f=>f());await flush();assert.deepEqual([...h.store],snapshot);assert.equal(h.writes.length,writeCount,'late statistics cannot write')
 }
 for(const key of ['ai_usage_source_v1','ai_usage_refresh_minutes_v1','ai_usage_sub2api_quota_v1','ai_usage_sub2api_order_v1','ai_usage_hidden_sub2api_v1']){
  const h=host({cached:data()});h.fault('store',key);await done(h);assert.equal(h.diagnostic().errorType,'runtime');if(key==='ai_usage_refresh_minutes_v1')assert.equal(h.presents[0].node.props.data.accounts.length,1);else assert.equal(h.presents[0].node.type,'Text')
 }
 for(const key of ['parrot_base_url','ai_usage_sub2api_admin_key_v1','*']){
  const h=host({cached:data()});h.fault('key',key);await done(h);assert.equal(h.diagnostic().outcome,'cache');assert.equal(h.presents[0].node.props.data.accounts[0].id,'sub2api:1')
 }
 for(const broken of [{},data([null]),{...data(),accounts:{}},data([{...account(),name:null}]),data([{...account(),balance:{money:{}}}]),data([{...account(),antigravity:{groups:[{name:'x',buckets:{}}]}}]),data([{...account(),credits:{packages:[null]}}])]){
  const h=host({cached:broken});await done(h);assert.equal(h.presents[0].node.type,'Text');assert.equal(h.calls.length,0);assert.equal(h.diagnostic().errorType,'cache_invalid')
 }
 {
  const h=host({source:'official',cached:data([account('official-fixture')])});h.kc.set('ai_usage_official_oauth_v1','NOT JSON SECRET');await done(h);assert.equal(h.diagnostic().outcome,'cache');assert.equal(h.presents[0].node.props.data.accounts[0].id,'official-fixture')
  h.fault('key','*');assert.equal(h.api.widgetCacheSnapshot().data.accounts.length,1,'cache access never needs credentials')
 }
 {
  const h=host({cached:data(),registerFail:true});await done(h);assert.equal(h.presents[0].node.type,'Text');assert.equal(h.diagnostic().errorType,'intent_init');assert.equal(h.calls.length,0)
 }
 {
  const a=[account('sub2api:1'),account('sub2api:2'),account('sub2api:3')],h=host({cached:data(a),local:true});h.store.set('ai_usage_sub2api_order_v1',['sub2api:3','sub2api:2','sub2api:1']);h.store.set('ai_usage_hidden_sub2api_v1',['sub2api:2']);h.api.saveWidgetName('sub2api:3','Local alias','sub2api');h.scripting.Widget.parameter='1'
  h.fault('key','*');await done(h);assert.equal(h.calls.length,0);assert.ok(h.text().includes('Local alias'));assert.deepEqual(Array.from(h.presents[0].node.props.data.accounts,a=>a.id),['sub2api:3','sub2api:1']);assert.equal(h.store.get(cacheKey('sub2api')).accounts.length,3)
 }
 {
  const a=account('antigravity:fixture','antigravity');a.antigravity={tier:'Fixture',creditAmount:2,minimumCreditAmount:0,groups:[{name:'Gemini Models',buckets:[{name:'G',window:'5h',remainingPercent:12.123456,resetsAt:null}]},{name:'Gemini 4 Argon',buckets:[{name:'A',window:'5h',remainingPercent:88.76151,resetsAt:null}]}]}
  const h=host({source:'official',cached:data([a]),local:true});h.api.saveAntigravityMode(a.id,'argon','official');h.fault('key','*');await done(h);assert.equal(h.presents[0].node.props.data.accounts[0].fiveHour.remainingPercent,88.76151);const projected=h.presents[0].node.props.data.accounts[0].fiveHour.remainingPercent;assert.equal(projected,88.76151,'Argon preference projects original precision into windows');assert.equal(JSON.stringify(h.presents[0].node).includes('"88.76151"'),false,'rendered LCD/bar use display rounding, raw group precision preserved in cache');assert.equal(h.store.get(cacheKey('official')).accounts[0].antigravity.groups[1].buckets[0].remainingPercent,88.76151)
 }
 // Delayed request or body after timeout cannot write quota/cards/session/tokens, nor block next app refresh.
 for(const bodyDelay of [false,true]){
  const h=host({cached:data()});let release;const base=h.handler();h.setHandler((u,o)=>{if(u.includes('/accounts?')){if(bodyDelay)return {status:200,json:()=>new Promise(r=>release=()=>r({code:0,data:{pages:1,items:[]}}))};return new Promise(r=>release=()=>r(h.response(200,{code:0,data:{pages:1,items:[]}})))}return base(u,o)})
  await timeout(h);const writeCount=h.writes.length;h.store.set(cacheKey('sub2api'),data([account('sub2api:99')]));release();await flush();assert.equal(h.writes.length,writeCount);assert.equal(h.store.get(cacheKey('sub2api')).accounts[0].id,'sub2api:99')
  h.setHandler(base);const next=await h.api.loadUsage();assert.equal(next.data.accounts[0].id,'sub2api:1');assert.equal(next.stale,false,'next explicit app load is not joined to stopped widget flight')
 }
 for(const change of ['source','deployment-aba']){
  const h=host({cached:data()});let release;h.setHandler(()=>new Promise(r=>release=()=>r(h.response(200,{code:0,data:{pages:1,items:[]}}))))
  const task=h.run();await flush();if(change==='source'){h.api.saveSource('parrot');h.store.set(cacheKey('parrot'),data([account('new-parrot')]))}else{h.api.saveSub2APIConfig('https://new.fixture.invalid','NEW','Asia/Shanghai');h.api.saveSub2APIConfig('https://sub.fixture.invalid','SECRET-KEY-fixture','Asia/Shanghai');h.store.set(cacheKey('sub2api'),data([account('sub2api:99')]))}
  await h.tick();await done(h,task);const expected=change==='source'?'new-parrot':'sub2api:99';assert.equal(h.presents[0].node.props.data.accounts[0].id,expected);const writes=h.writes.length;release();await flush();assert.equal(h.writes.length,writes)
 }
 for(const provider of ['openai','claude','antigravity','workbuddy']){
  const h=host({source:'official'}),{key,id}=h.seedOfficial(provider,true);h.store.set(cacheKey('official'),data([account(id,provider)]));let release
  h.setHandler(()=>new Promise(r=>release=()=>r(h.response(200,provider==='workbuddy'?{code:0,data:{accessToken:'SECRET-NEXT',refreshToken:'SECRET-NEXT-R',expiresIn:3600}}:{access_token:'SECRET-NEXT',refresh_token:'SECRET-NEXT-R',expires_in:3600}))))
  await timeout(h);const before=h.kc.get(key),writes=h.writes.length;release();await flush();assert.equal(h.kc.get(key),before,provider+' no late renewal save');assert.equal(h.writes.length,writes)
 }
 {
  const h=host({cached:data(),local:true});h.fault('diagnostic',true);await done(h);assert.equal(h.presents.length,1);assert.equal(h.diagnostic(),undefined)
 }
 {
  const h=host({cached:data(),local:true});h.fault('present',true);await done(h);assert.equal(h.diagnostic().errorType,'present_error');assert.equal(h.presents.length,1,'no speculative second present')
 }
 // Deferred native/child rendering is outside the synchronous run catch: document, do not fake a guarantee.
 {
  const a=account('antigravity:fixture','antigravity'),h=host({source:'official',cached:data([a]),local:true});h.fault('deferred',true);await done(h);h.fault('decode',true);assert.throws(()=>h.expand(h.presents[0].node),/图标解码失败/);assert.equal(h.diagnostic().errorType,'none')
 }
 await new Promise(r=>setImmediate(r));process.removeListener('unhandledRejection',onRejection);assert.deepEqual(unhandled,[])
 console.log('PASS production widget cold/warm normal; rejection/request-timeout/never-resolve/stuck statistics; safe credential-free cache, malformed data, Storage/Keychain/settings failures, intent-init failure; local selection/order/hidden/aliases/Antigravity original precision; bounded redacted diagnostics and failed writes')
 console.log('PASS 15s widget-only deadline, request/body/renewal late writes blocked for four OAuth providers; source/deployment ABA/current-cache fallback; next manual load succeeds; one present, timer cleanup, zero unhandled rejection; deferred native-render failure explicitly outside guarantee')
}
module.exports={host,data,flush}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
