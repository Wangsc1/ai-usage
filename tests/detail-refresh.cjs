// Real detail Button -> production per-account readers -> atomic cache merge -> all widget entries.
// All credentials/responses/host APIs are synthetic; no native sockets, credentials or external fetch.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const ts=require(process.env.TYPESCRIPT_PATH||'typescript'),root=path.resolve(__dirname,'..')
function runtime(source,provider,mode='oauth'){
 let now=1800000000000,states=[],hook=0,effects=[],handler,reloads=0,saved=0,dismissed=0,hold,release,fail=false,saveFailure=""
 const kc=new Map(),store=new Map(),modules={},calls=[],families=['systemSmall','systemMedium','systemLarge','systemExtraLarge','accessoryRectangular','accessoryCircular','accessoryInline']
 const cacheKey=source==='official'?'ai_usage_official_cache_v1':source==='parrot'?'ai_usage_cache_v1':'ai_usage_sub2api_quota_v1'
 const id=source==='official'?(provider==='openai'?'official-target':provider==='workbuddy'?'workbuddy:cn:cli:target':provider==='claude'?'claude:target:org':provider+':target'):source==='parrot'?(provider==='deepseek'?'parrot:deepseek:target':'target'):'sub2api:1'
 const win={usedPercent:25,remainingPercent:75,resetsAt:'2030-01-01T00:00:00Z'}
 const old={id,name:'target@example.test',provider,enabled:true,available:true,fiveHour:win,sevenDay:win,resetCredits:1}
 const other={...old,id:source==='sub2api'?'sub2api:2':'other',name:'other@example.test',resetCredits:3}
 const metric={requests:9,inputTokens:10,outputTokens:2,cacheReadTokens:1,cacheCreationTokens:0,totalTokens:13,costUsd:1}
 const snapshot={accounts:[other,old],today:metric,month:metric,todayByFamily:{fixture:metric},monthByFamily:{fixture:metric},fetchedAt:now-1000,statistics:{fetchedAt:now-2000,stale:true,error:'fixture-stat-error'},providerErrors:['other:fixture']}
 const scripting=new Proxy({Widget:{family:'systemSmall',parameter:'',displaySize:{width:360,height:380},present:()=>{},reloadAll:async()=>{reloads++;for(const f of families){scripting.Widget.family=f;await widget.runWidget()}}},Navigation:{useDismiss:()=>()=>{dismissed++}},
  useState:initial=>{const i=hook++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect:fn=>effects.push(fn),
  modifiers:()=>{const p=new Proxy({},{get:()=>()=>p});return p},AppIntentProtocol:{AppIntent:0},AppIntentManager:{register:()=>()=>({})}}, {get:(o,k)=>k in o?o[k]:k})
 const context=vm.createContext({console,Map,Set,Math,Promise,Date:class extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}},
  setTimeout:()=>1,clearTimeout:()=>{},UIImage:{fromBase64String:s=>({base64:s})},
  Data:{fromBase64String:s=>({toRawString:()=>Buffer.from(s,'base64').toString()})},
  Storage:{get:k=>store.has(k)?JSON.parse(JSON.stringify(store.get(k))):null,set:(k,v)=>store.set(k,JSON.parse(JSON.stringify(v))),remove:k=>store.delete(k)},
  Keychain:{get:k=>kc.get(k)||null,set:(k,v)=>{if(saveFailure&&k===key){if(saveFailure==='throw')throw Error('SECRET-keychain');return false}kc.set(k,v);return true},remove:k=>kc.delete(k)},
  fetch:async(u,o={})=>{calls.push({u,o});if(hold){const pending=hold;hold=null;await pending}if(fail)throw Error('SECRET-fixture-transport');return handler(u,o)}
 })
 function load(name){if(modules[name])return modules[name].exports;let source=fs.readFileSync(path.join(root,name),'utf8');if(name==='index.tsx')source=source.replace(/\nrun\(\)\s*$/,'\nexport { WidgetNamePage }');if(name==='widget.tsx')source=source.replace(/\nrun\(\)\s*$/,'\nexport { run as runWidget }');const out=ts.transpileModule(source,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'},reportDiagnostics:true});assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);const m=modules[name]={exports:{}},jsx=(type,props,key)=>({type,props,key});vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`,context)(n=>n==='scripting'?scripting:n==='scripting/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:load(n.slice(2)+(fs.existsSync(path.join(root,n.slice(2)+'.tsx'))?'.tsx':'.ts')),m,m.exports);return m.exports}
 const api=load('api.ts'),app=load('index.tsx'),widget=load('widget.tsx')
 api.saveConfig('https://parrot.fixture.invalid','FIXTURE-MGMT');kc.set('parrot_session_credential','FIXTURE-SESSION');api.saveSub2APIConfig('https://sub.fixture.invalid','FIXTURE-ADMIN','Asia/Shanghai');api.saveSource(source)
 const key=provider==='openai'?'ai_usage_official_oauth_v1':provider==='claude'?'ai_usage_claude_oauth_v1':provider==='deepseek'?'ai_usage_deepseek_credentials_v1':provider==='workbuddy'?'ai_usage_workbuddy_cn_cli_v1':'ai_usage_antigravity_oauth_v1'
 const token=()=> 'fixture.'+Buffer.from(JSON.stringify({sub:'target',exp:now/1000+3600,email:'target@example.test','https://api.openai.com/auth':{chatgpt_account_id:'target',chatgpt_user_id:'target'}})).toString('base64url')+'.fixture'
 const credential={id,name:old.name,email:old.name,accountId:'target',subject:'target',organizationId:'org',access:provider==='openai'?token():'FIXTURE-TARGET',refresh:'FIXTURE-REFRESH',expiresAt:now+3600000,scope:'user:profile',token:'FIXTURE-DS',mode:mode==='web'?'web':'api',uid:'target',domain:'www.codebuddy.cn'}
 if(source==='official')kc.set(key,JSON.stringify([credential,{...credential,id:other.id,accountId:'other',uid:'other',access:'FIXTURE-OTHER',refresh:'FIXTURE-OTHER-REFRESH',token:'FIXTURE-OTHER-DS',email:other.name,name:other.name}]))
 store.set(cacheKey,snapshot);api.saveAccountOrder([other.id,id],source);api.saveWidgetName(id,'alias',source)
 store.set('ai_usage_parrot_stats_v1',{...snapshot,accounts:undefined});store.set('ai_usage_sub2api_stats_v1',{...snapshot,accounts:undefined})
 if(source!=='official')store.set(`ai_usage_hidden_${source}_v1`,[other.id])
 const response=(status,b={})=>({status,json:async()=>b}),ok=b=>response(200,b)
 const groups=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/antigravity-argon-summary.json'),'utf8'))
 handler=async(u,o)=>{
  // A list, statistics query, another account's refresh token or other quota is never permitted.
  assert.ok(!/[?&](?:page|lite)=|\/stats|\/channels\?/.test(u),'not a list/statistics endpoint: '+u)
  assert.ok(!String(o.body).includes('FIXTURE-OTHER-REFRESH'));assert.ok(!String(o.headers?.Authorization).includes('FIXTURE-OTHER'))
  if(u.endsWith('/oauth/token')){
   const body=JSON.parse(o.body);assert.equal(body.refresh_token,'FIXTURE-REFRESH');assert.equal(body.grant_type,'refresh_token')
   if(provider==='claude'){assert.equal(o.headers.Accept,'application/json');assert.equal(o.headers['User-Agent'],`ai-usage/${api.VERSION}`);assert.equal(body.scope,'user:profile')}
   return ok({access_token:provider==='openai'?token():'FIXTURE-ROTATED',refresh_token:'FIXTURE-ROTATED-REFRESH',expires_in:3600})
  }
  if(u==='https://oauth2.googleapis.com/token'){assert.equal(new URLSearchParams(o.body).get('refresh_token'),'FIXTURE-REFRESH');return ok({access_token:'FIXTURE-ROTATED',refresh_token:'FIXTURE-ROTATED-REFRESH',expires_in:3600})}
  if(u.endsWith('/auth/token/refresh')){assert.equal(o.headers['X-Refresh-Token'],'FIXTURE-REFRESH');return ok({code:0,data:{accessToken:'FIXTURE-ROTATED',refreshToken:'FIXTURE-ROTATED-REFRESH',expiresIn:3600}})}
  if(source==='parrot'){
   assert.equal(u,'https://parrot.fixture.invalid/api/management/v1/oauth/accounts/target');assert.ok(!o.method||o.method==='GET')
   return ok({data:{usageWindows:[{name:'fiveHour',usedPercent:79,remainingPercent:21,resetsAt:null}],resetCreditCount:8,workbuddy:{scope:'personal',unit:'credits',complete:true,status:'known',fetchedAt:now,personalCredits:{remaining:412.5,capacity:500.75,used:88.25,reliable:true},checkin:{todayCheckedIn:true,observedAt:now}}}})
  }
  if(source==='sub2api'){
   assert.ok(!o.method||o.method==='GET');assert.equal(o.headers['x-api-key'],'FIXTURE-ADMIN')
   if(u.endsWith('/admin/accounts/1'))return ok({code:0,data:{id:1,name:old.name,platform:provider==='claude'?'anthropic':provider,type:mode,status:'active'}})
   if(u.endsWith('/cn-providers/accounts/1/balance'))return ok({code:0,data:{success:true,balances:[{currency:'CNY',balance:'7.88'}],fetched_at:now/1000,available:true}})
   if(u.endsWith('/accounts/1/claude/reset-credits'))return ok({code:0,data:{available_count:8}})
   assert.ok(u.endsWith('/openai/accounts/1/quota')||u.endsWith('/accounts/1/usage'))
   return ok({code:0,data:{five_hour:{utilization:79},rate_limit:{primary_window:{used_percent:79,limit_window_seconds:18000}},rate_limit_reset_credits:{available_count:8},antigravity_quota:{model:{utilization:11.23849}},antigravity_quota_details:{model:{display_name:'Fixture model'}}}})
  }
  if(provider==='openai'){assert.equal(o.headers['ChatGPT-Account-ID'],'target');assert.ok(u.endsWith('/wham/usage'));return ok({rate_limit:{primary_window:{used_percent:79,limit_window_seconds:18000}},rate_limit_reset_credits:{available_count:8}})}
  if(provider==='claude'){assert.equal(o.headers['anthropic-beta'],'oauth-2025-04-20');assert.ok(u.endsWith('/api/oauth/usage'));return ok({five_hour:{utilization:79},cedar_ember:{eligible:true,grants:[{id:'fixture',resets_left:8}]}})}
  if(provider==='antigravity'){
   assert.equal(o.method,'POST');if(u.endsWith(':loadCodeAssist'))return ok({cloudaicompanionProject:'fixture-project',paidTier:{name:'Fixture',availableCredits:[{creditType:'GOOGLE_ONE_AI',creditAmount:3}]}})
   assert.ok(u.startsWith('https://daily-cloudcode-pa.googleapis.com/')&&u.endsWith(':retrieveUserQuotaSummary'));return ok(groups)
  }
  if(provider==='deepseek'){
   assert.equal(o.headers.Authorization,'Bearer FIXTURE-DS')
   if(u.endsWith('/user/balance'))return ok({is_available:true,balance_infos:[{currency:'CNY',total_balance:'7.88',granted_balance:'0',topped_up_balance:'7.88'}]})
   if(u.endsWith('/get_user_summary'))return ok({code:0,data:{biz_data:{normal_wallets:[{currency:'CNY',balance:'7.88'}],bonus_wallets:[]}}})
   assert.ok(u.includes('/usage/by_api_key/cost?'));return ok({code:0,data:{biz_data:{data:[{currency:'CNY',series:[{buckets:[{cost:'0.1'},{cost:'0.2'}]}]}]}}})
  }
  if(provider==='workbuddy'){
   assert.equal(o.method,'POST');assert.equal(o.headers['X-User-Id'],'target')
   if(u.endsWith('/checkin-activity-status'))return ok({code:0,data:{active:true,todayCheckedIn:true}})
   assert.ok(u.endsWith('/get-user-resource'));return ok({code:0,data:{Response:{Data:{TotalCount:1,Accounts:[{AccountId:'target-resource',PackageName:'Fixture',CapacitySizePrecise:'500.75',CapacityRemainPrecise:'412.5',CapacityUsedPrecise:'88.25',PackageEndTime:'2028-01-01 12:00:00'}]}}}})
  }
  throw Error('unexpected fixture request: '+u)
 }
 function walk(n){if(n==null||n===false)return[];if(Array.isArray(n))return n.flatMap(walk);if(typeof n!=='object')return[n];if(typeof n.type==='function')return walk(n.type(n.props));return[n,...walk(n.props?.children),...walk(n.props?.header),...walk(n.props?.toolbar?.primaryAction)]}
 const props={account:old,source,expectedScope:api.accountScope(source),onSaved:()=>saved++}
 const render=()=>{hook=0;return walk(app.WidgetNamePage(props))}
 const button=()=>render().find(n=>n?.type==='Form').props.toolbar.primaryAction
 return {api,store,kc,key,cacheKey,id,old,other,snapshot,calls,credential,groups,render,button,props,context,response,handler:()=>handler,setHandler:f=>{handler=f},fail:v=>{fail=v},saveFailure:v=>{saveFailure=v},hold:()=>{hold=new Promise(r=>release=r);return()=>release()},counts:()=>({reloads,saved,dismissed}),flush:async()=>{for(let i=0;i<40;i++)await Promise.resolve()},advance:ms=>{now+=ms},unmount:()=>{effects.map(f=>f()).filter(f=>typeof f==='function').forEach(f=>f())},widget,families}
}
const clone=x=>JSON.parse(JSON.stringify(x)),text=r=>r.render().filter(n=>typeof n==='string').join(' ')
async function successful(r){
 const before=clone(r.store.get(r.cacheKey)),preferences=[...r.store].filter(([k])=>/names|order|hidden|stats_v1/.test(k));r.render()
 const b=r.button();assert.equal(b.props.systemImage,'arrow.clockwise');assert.equal(b.props.title,'刷新');assert.equal(b.props.disabled,false)
 await b.props.action()
 assert.equal(r.counts().reloads,1,text(r));assert.equal(r.counts().saved,1);assert.equal(r.counts().dismissed,0)
 const after=r.store.get(r.cacheKey);assert.deepEqual(after.accounts[0],before.accounts[0]);assert.deepEqual(after.accounts.map(a=>a.id),before.accounts.map(a=>a.id));for(const k of Object.keys(before).filter(k=>k!=='accounts'))assert.deepEqual(after[k],before[k],k)
 assert.deepEqual([...r.store].filter(([k])=>/names|order|hidden|stats_v1/.test(k)),preferences)
 const a=after.accounts.find(a=>a.id===r.id)
 if(a.provider==='deepseek'){assert.equal(a.balance.money[0].total,'7.88');assert.ok(text(r).includes('¥ 7.88'))}
 else if(a.provider==='workbuddy'){assert.equal(a.credits.remaining,412.5);assert.ok(text(r).includes('412.5'));assert.ok(text(r).includes('已签到'))}
 else if(a.provider==='antigravity'){assert.ok(a.antigravity?.groups.length||r.props.source==='parrot');if(r.props.source==='official')assert.equal(a.antigravity.groups[2].buckets[0].remainingPercent,88.76151)}
 else {assert.equal(a.fiveHour.remainingPercent,21);assert.ok(text(r).includes('剩余额度 21%'))}
 assert.equal(r.button().props.disabled,false)
 return a
}
async function main(){
 const matrix=[['official','openai'],['official','claude'],['official','antigravity'],['official','deepseek','api'],['official','deepseek','web'],['official','workbuddy'],['parrot','openai'],['parrot','claude'],['parrot','antigravity'],['parrot','workbuddy'],['sub2api','openai'],['sub2api','claude'],['sub2api','claude','setup-token'],['sub2api','deepseek'],['sub2api','antigravity']]
 for(const args of matrix){const r=runtime(...args);const cards=args[0]==='sub2api'?'ai_usage_sub2api_cards_v1':'ai_usage_claude_reset_cards_v1';r.store.set(cards,{[r.other.id]:{count:99,at:1800000000000}});await successful(r);assert.equal(r.store.get(cards)[r.other.id].count,99);const count=r.calls.length;assert.equal(count,args[0]==='sub2api'?(args[1]==='claude'&&args[2]!=='setup-token'?3:2):args[0]==='official'&&['antigravity','workbuddy'].includes(args[1])||args[2]==='web'?2:1);console.log('PASS detail Button '+args.join('/')+': '+count+' target-only requests, seven widget reload entries zero extra requests, immediate detail update and untouched other account/statistics/preferences')}
 {
  const r=runtime('parrot','deepseek'),before=clone(r.store.get(r.cacheKey));await r.button().props.action();assert.equal(r.calls.length,0);assert.deepEqual(r.store.get(r.cacheKey),before);assert.ok(text(r).includes('无法安全单账号刷新'));assert.equal(r.counts().reloads,0)
 }
 for(const args of matrix){const r=runtime(...args),before=clone(r.store.get(r.cacheKey));r.fail(true);await r.button().props.action();assert.deepEqual(r.store.get(r.cacheKey),before);assert.equal(r.counts().reloads,0);assert.ok(/失败|HTTP/.test(text(r)));assert.ok(!text(r).includes('SECRET'));assert.equal(r.button().props.disabled,false)}
 {
  const r=runtime('official','openai'),release=r.hold(),b=r.button(),pending=b.props.action();await r.flush();assert.equal(r.button().props.disabled,true);await b.props.action();assert.equal(r.calls.length,1)
  const current=r.store.get(r.cacheKey);current.accounts[0].resetCredits=99;current.today.requests=42;r.store.set(r.cacheKey,current)
  release();await pending;assert.equal(r.store.get(r.cacheKey).accounts[0].resetCredits,99);assert.equal(r.store.get(r.cacheKey).today.requests,42);assert.equal(r.calls.length,1)
 }
 for(const source of ['official','parrot','sub2api'])for(const change of ['source','deployment','credential','logout','unmount']){
  if(source!=='official'&&['credential','logout'].includes(change)||source==='official'&&change==='deployment')continue
  const r=runtime(source,'openai'),release=r.hold(),pending=r.button().props.action();await r.flush()
  if(change==='source'){r.api.saveSource(source==='official'?'parrot':'official');r.api.saveSource(source)}
  if(change==='deployment'){if(source==='parrot'){r.api.saveConfig('https://new.fixture.invalid','NEW');r.api.saveConfig('https://parrot.fixture.invalid','FIXTURE-MGMT')}else{r.api.saveSub2APIConfig('https://new.fixture.invalid','NEW','Asia/Shanghai');r.api.saveSub2APIConfig('https://sub.fixture.invalid','FIXTURE-ADMIN','Asia/Shanghai')}}
  if(change==='credential'){const rows=JSON.parse(r.kc.get(r.key));rows[0].access='NEW-FIXTURE';r.kc.set(r.key,JSON.stringify(rows))}
  if(change==='logout')r.api.logoutOfficial(r.id)
  if(change==='unmount')r.unmount()
  const expected=clone(r.store.get(r.cacheKey)??null);release();await pending;assert.deepEqual(r.store.get(r.cacheKey)??null,expected,source+'/'+change);assert.equal(r.counts().reloads,0)
 }
 {
  const r=runtime('official','antigravity'),release=r.hold(),pending=r.button().props.action();await r.flush()
  const picker=r.render().find(n=>n?.type==='Picker'&&n.props.title==='显示额度');await picker.props.onChanged('argon');assert.equal(r.calls.length,1,'mode change does not fetch');release();await pending
  assert.equal(r.api.getAntigravityMode(r.id,'official'),'argon');assert.ok(text(r).includes('剩余额度 89%'));assert.equal(r.store.get(r.cacheKey).accounts.find(a=>a.id===r.id).antigravity.groups[2].buckets[0].remainingPercent,88.76151)
 }
 {
  const r=runtime('parrot','openai'),release=r.hold(),pending=r.button().props.action();await r.flush();r.render().find(n=>n?.type==='TextField').props.onChanged(' New Alias ')
  await r.render().find(n=>n?.type==='Button'&&n.props.title==='保存').props.action();assert.equal(r.calls.length,1,'alias sync does not fetch');release();await pending;assert.equal(r.api.getWidgetName(r.id,'parrot'),'New Alias');assert.equal(r.counts().dismissed,1)
 }
 for(const provider of ['openai','claude','antigravity','workbuddy']){
  const r=runtime('official',provider),rows=JSON.parse(r.kc.get(r.key));rows[0].expiresAt=1;r.kc.set(r.key,JSON.stringify(rows));await successful(r);assert.equal(r.calls.filter(c=>c.u.endsWith('/oauth/token')||c.u==='https://oauth2.googleapis.com/token'||c.u.endsWith('/auth/token/refresh')).length,1);assert.equal(JSON.parse(r.kc.get(r.key))[1].refresh,'FIXTURE-OTHER-REFRESH')
 }
 for(const provider of ['openai','claude','antigravity','deepseek','workbuddy'])for(const change of ['credential','logout-aba']){
  const r=runtime('official',provider),release=r.hold(),pending=r.button().props.action();await r.flush()
  if(change==='credential'){const rows=JSON.parse(r.kc.get(r.key));rows[0][provider==='deepseek'?'token':'access']='CHANGED-FIXTURE';r.kc.set(r.key,JSON.stringify(rows))}
  else {const rows=r.kc.get(r.key);r.api.logoutOfficial(r.id);r.kc.set(r.key,rows)}
  const expected=clone(r.store.get(r.cacheKey));release();await pending;assert.deepEqual(r.store.get(r.cacheKey),expected,provider+'/'+change);assert.equal(r.counts().reloads,0)
 }
 for(const provider of ['openai','claude','antigravity','workbuddy']){
  const r=runtime('official',provider),base=r.handler();let denied=false
  r.setHandler((u,o)=>{const usage=provider==='openai'?u.endsWith('/wham/usage'):provider==='claude'?u.endsWith('/api/oauth/usage'):provider==='antigravity'?u.endsWith(':loadCodeAssist'):u.endsWith('/get-user-resource');if(usage&&!denied){denied=true;return r.response(401)}return base(u,o)})
  await successful(r);assert.equal(r.calls.filter(c=>c.u.endsWith('/oauth/token')||c.u==='https://oauth2.googleapis.com/token'||c.u.endsWith('/auth/token/refresh')).length,1)
 }
 {
  const r=runtime('parrot','openai'),base=r.handler();let denied=false
  r.setHandler((u,o)=>{if(u.endsWith('/auth/sessions')){assert.equal(JSON.parse(o.body).managementKey,'FIXTURE-MGMT');return r.response(201,{data:{credential:'FIXTURE-NEW-SESSION'}})}if(!denied){denied=true;return r.response(401)}return base(u,o)})
  await successful(r);assert.equal(r.calls.length,3)
 }
 for(const provider of ['openai','claude'])for(const fail of ['false','throw']){
  const r=runtime('official',provider),rows=JSON.parse(r.kc.get(r.key));rows[0].expiresAt=1;r.kc.set(r.key,JSON.stringify(rows));r.saveFailure(fail)
  const before=clone(r.store.get(r.cacheKey));for(let n=0;n<2;n++){await r.button().props.action();assert.ok(text(r).includes('保存失败'));assert.ok(!text(r).includes('SECRET'));assert.deepEqual(r.store.get(r.cacheKey),before)}
  assert.equal(r.calls.length,1,'retry saves candidate without replaying old refresh token');r.saveFailure('');await successful(r);assert.equal(r.calls.length,2,'save recovery followed by one target usage')
 }
 {
  const r=runtime('official','deepseek','web'),base=r.handler();await successful(r);const old=r.store.get(r.cacheKey).accounts.find(a=>a.id===r.id).balance.money[0].weekCost
  r.setHandler((u,o)=>u.includes('/usage/by_api_key/cost?')?r.response(503):base(u,o));await r.button().props.action();assert.equal(r.store.get(r.cacheKey).accounts.find(a=>a.id===r.id).balance.money[0].weekCost,old);assert.ok(text(r).includes('读取失败'))
 }
 {
  const r=runtime('official','claude'),base=r.handler();r.setHandler((u,o)=>u.endsWith('/api/oauth/usage')?{status:429,headers:{get:()=> '60'},json:async()=>({})}:base(u,o));await r.button().props.action();const count=r.calls.length;await r.button().props.action();assert.equal(r.calls.length,count);assert.ok(text(r).includes('冷却'));assert.equal(r.counts().reloads,0)
 }
 {
  const r=runtime('official','openai');await r.button().props.action();const count=r.calls.length;r.api.clearSub2APIConfig();r.api.clearConfig();r.setHandler(u=>{assert.ok(u.endsWith('/wham/usage'));return r.response(200,{rate_limit_reset_credits:{available_count:8}})});const full=await r.api.loadUsage();assert.ok(full.data&&!full.stale);assert.equal(r.calls.length,count+2,'explicit whole refresh reads both accounts despite local projection');r.advance(16*60000);await r.widget.runWidget();assert.equal(r.calls.length,count+4,'scheduled widget resumes both requests after local-only projection deadline')
 }
 console.log('PASS target failure preserves old cache; synchronous duplicate-click guard; source/deployment ABA, credentials/logout/unmount discard late writes; concurrent other-account/stat/alias/mode merge; provider renewal and Claude backoff; explicit/scheduled whole refresh not swallowed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
