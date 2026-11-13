// Production widget run + real composed API, virtual time/in-memory storage, intercepted synthetic HTTP only.
// These are JS scheduling/cache assertions, NOT an iOS deadline, native render, or post-present lifetime claim.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript'), root = path.resolve(__dirname, '..')
const flush = async () => { for (let i=0;i<160;i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
const ok = data => ({status:200,json:async()=>data})
const quota = () => ok({rate_limit:{primary_window:{limit_window_seconds:18000,used_percent:20}},rate_limit_reset_credits:{available_count:2}})
const keys={official:'ai_usage_official_cache_v1',parrot:'ai_usage_cache_v1',sub2api:'ai_usage_sub2api_quota_v1'}
function runtime(source='official', family='systemSmall') {
  let now=1800000000000, seq=0, clears=0, brokenStorage=false
  const store=new Map(),kc=new Map(),timers=new Map(),modules={},calls=[],presented=[]
  let handler=()=>new Promise(()=>{})
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]))} static now(){return now} }
  const scripting=new Proxy({Widget:{family,parameter:'',displaySize:{width:360,height:380},present:(tree,options)=>presented.push({tree,options,at:now})},
    AppIntentManager:{register:()=>()=>({})},AppIntentProtocol:{AppIntent:0},
    modifiers:()=>{const m=new Proxy({}, {get:()=>()=>m});return m},
  },{get:(o,k)=>k in o?o[k]:k})
  const ctx=vm.createContext({console,Date:Clock,Map,Set,Math,Promise,
    setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:now+ms,ms});return id},clearTimeout:id=>{clears++;timers.delete(id)},
    Storage:{get:k=>{if(brokenStorage)throw Error('synthetic local storage error');return store.get(k)??null},set:(k,v)=>store.set(k,v),remove:k=>store.delete(k)},
    Keychain:{get:k=>kc.get(k)??null,set:(k,v)=>{kc.set(k,v);return true},remove:k=>kc.delete(k)},
    Data:{fromBase64String:s=>({toRawString:()=>Buffer.from(s,'base64').toString()})},UIImage:{fromBase64String:s=>({base64:s})},
    fetch:(url,options)=>{calls.push({url,options});return handler(url,options)},
  })
  function load(name){
    if(modules[name])return modules[name].exports
    let source=fs.readFileSync(path.join(root,name),'utf8')
    if(name==='widget.tsx')source=source.replace(/\nrun\(\)\s*$/,'\nexport { run }')
    // Expose an existing credential-save branch to simulate re-login, not a protocol substitute.
    if(name==='api.ts')source+='\nexport { saveOfficialCredential }'
    const out=ts.transpileModule(source,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'},reportDiagnostics:true})
    assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,name)
    const m=modules[name]={exports:{}},jsx=(type,props)=>({type,props})
    const req=n=>n==='scripting'?scripting:n==='scripting/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:load(n.slice(2)+(n==='./app_intents'?'.tsx':'.ts'))
    vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`,ctx)(req,m,m.exports)
    return m.exports
  }
  const api=load('api.ts'),widget=load('widget.tsx')
  const token=()=> 'fixture.'+Buffer.from(JSON.stringify({sub:'user',email:'fixture@example.test',exp:(now+7200000)/1000,'https://api.openai.com/auth':{chatgpt_account_id:'account',chatgpt_user_id:'user'}})).toString('base64url')+'.fixture'
  function configure(s){
    if(s==='official')kc.set('ai_usage_official_oauth_v1',JSON.stringify([{id:'account:user',accountId:'account',subject:'user',email:'fixture@example.test',access:token(),refresh:'FIXTURE-OLD',expiresAt:now+7200000}]))
    if(s==='parrot'){api.saveConfig('https://parrot.example','FIXTURE-KEY');kc.set('parrot_session_credential','FIXTURE-SESSION')}
    if(s==='sub2api')api.saveSub2APIConfig('https://sub.example','FIXTURE-KEY','Asia/Shanghai')
  }
  api.saveSource(source);configure(source)
  const account=(s,id=s==='official'?'account:user':s+'-account')=>({id,name:s+' fixture',provider:'openai',enabled:true,available:true,resetCredits:2,fiveHour:{usedPercent:30,remainingPercent:70,resetsAt:null},sevenDay:{usedPercent:40,remainingPercent:60,resetsAt:null}})
  const cache=(s=api.getSource(),at=now-3600000)=>{const data={accounts:[account(s)],today:null,month:null,todayByFamily:{},monthByFamily:{},fetchedAt:at};store.set(keys[s],data);return data}
  const expand=n=>{
    if(n==null||typeof n!=='object')return n
    if(Array.isArray(n))return n.map(expand)
    if(Object.hasOwn(n,'type')&&typeof n.type==='function')return expand(n.type(n.props))
    if(n.type==='GeometryReader')return expand(n.props.children({size:{width:330,height:134}}))
    return Object.fromEntries(Object.entries(n).map(([k,v])=>[k,typeof v==='function'?'[callback]':expand(v)]))
  }
  const tick=async ms=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await flush()}
  return {api,widget,store,kc,calls,presented,timers,cache,configure,token,expand,tick,now:()=>now,clears:()=>clears,handler:v=>handler=v,breakStorage:()=>{brokenStorage=true}}
}
async function main(){
  for(const source of ['official','parrot','sub2api']){
    const r=runtime(source),old=r.cache(),start=r.now(),pending=deferred()
    const metric={requests:9,totalTokens:90,inputTokens:60,outputTokens:30,cacheReadTokens:0,cacheCreationTokens:0,costUsd:1}
    const stats={today:metric,month:metric,todayByFamily:{},monthByFamily:{},fetchedAt:start-7200000}
    r.api.saveStatisticsSource('sub2api');r.store.set('ai_usage_sub2api_stats_v1',stats)
    r.handler(()=>pending.promise)
    const job=r.widget.run();await flush()
    assert.equal(r.presented.length,0);assert.equal(r.timers.size,1);assert.equal([...r.timers.values()][0].ms,8000)
    await r.tick(7999);assert.equal(r.presented.length,0)
    await r.tick(1);await job
    assert.equal(r.presented.length,1);const p=r.presented[0]
    assert.equal(p.at,start+8000);assert.equal(p.tree.props.data.fetchedAt,old.fetchedAt)
    assert.equal(p.tree.props.data.accounts[0].id,old.accounts[0].id)
    assert.equal(p.tree.props.data.statistics.fetchedAt,stats.fetchedAt,'independent statistics keep their old time too')
    assert.equal(p.tree.props.data.today.requests,9)
    assert.equal(p.tree.props.data.statistics.stale,true)
    assert.equal(p.options.reloadPolicy.date.getTime(),r.now()+15*60000)
    assert.ok(JSON.stringify(r.expand(p.tree)).includes(r.api.fmtTime(old.fetchedAt)))
    assert.equal(r.timers.size,0);assert.equal(r.clears(),1)
    pending.reject(Error('late synthetic failure'));await flush();await r.tick(30000)
    assert.equal(r.presented.length,1,'losing request cannot present again')
  }
  for(const family of ['systemSmall','systemMedium','systemLarge','systemExtraLarge','accessoryCircular','accessoryRectangular','accessoryInline']){
    const r=runtime('official',family)
    const job=r.widget.run();await flush();await r.tick(8000);await job
    assert.equal(r.presented[0].tree.type,'Text','no-cache fallback is plain text in every family')
    assert.equal(r.presented[0].tree.props.children,'暂时无法读取用量，请打开脚本刷新')
    assert.equal(r.presented.length,1);assert.equal(r.timers.size,0)
    // Normal quick load still uses the unchanged family-specific Root tree, not a fallback.
    const fast=runtime('official',family);fast.handler(()=>quota());const start=fast.now()
    await fast.widget.run()
    assert.equal(fast.presented.length,1);assert.equal(fast.presented[0].at,start)
    assert.equal(typeof fast.presented[0].tree.type,'function');assert.equal(fast.presented[0].tree.props.data.fetchedAt,start)
    assert.ok(fast.expand(fast.presented[0].tree));assert.equal(fast.timers.size,0);assert.equal(fast.clears(),1)
    await fast.tick(9000);assert.equal(fast.presented.length,1)
  }
  // The ONE total budget includes independently selected statistics, not just the quota request.
  {const r=runtime(),old=r.cache();r.api.saveConfig('https://parrot.example','FIXTURE-STATS');r.kc.set('parrot_session_credential','FIXTURE-SESSION')
    r.handler(url=>url.includes('/stats/summary')?new Promise(()=>{}):Promise.resolve(quota()))
    const job=r.widget.run();await flush()
    assert.equal(r.presented.length,0);assert.equal(r.calls.filter(c=>c.url.includes('/stats/summary')).length,2)
    const count=r.calls.length;await r.tick(8000);await job
    assert.equal(r.presented.length,1);assert.equal(r.presented[0].tree.props.data.fetchedAt,old.fetchedAt+3600000,'fallback picks quota already completed during stalled stats')
    assert.equal(r.calls.length,count,'fallback does not request again');assert.equal(r.timers.size,0)
  }
  // Local projection is immediate and must not start a network loader.
  {const r=runtime(),old=r.cache();r.api.requestLocalWidgetProjection();await r.widget.run();assert.equal(r.calls.length,0);assert.equal(r.presented[0].tree.props.data.fetchedAt,old.fetchedAt);assert.equal(r.timers.size,0)}
  // Both synchronous initialization errors and rejected loaders take a usable cache fallback.
  for(const asynchronous of [false,true]){
    const r=runtime(),old=r.cache()
    r.api.loadUsage=()=>{if(asynchronous)return Promise.reject(Error('synthetic reject'));throw Error('synthetic sync failure')}
    await r.widget.run();assert.equal(r.presented[0].tree.props.data.fetchedAt,old.fetchedAt);assert.equal(r.presented.length,1);assert.equal(r.timers.size,0)
  }
  {const r=runtime();r.breakStorage();await r.widget.run();assert.equal(r.presented[0].tree.type,'Text');assert.equal(r.presented.length,1);assert.equal(r.timers.size,0)}
  // Deadline reads CURRENT source, never the cached object from a losing official read.
  {const r=runtime(),pending=deferred();r.cache();r.handler(()=>pending.promise);const job=r.widget.run();await flush()
    r.api.saveSource('parrot');r.configure('parrot');const current=r.cache('parrot');const officialMarker=r.cache('official',123)
    await r.tick(8000);await job;assert.equal(r.presented[0].tree.props.data.accounts[0].id,'parrot-account')
    pending.resolve(quota());await flush()
    assert.equal(r.store.get(keys.official),officialMarker,'old source generation cannot overwrite official cache')
    assert.equal(r.store.get(keys.parrot),current);assert.equal(r.presented.length,1)
  }
  // Existing remote configuration scope guards protect quota/statistics/session writes after a deadline.
  for(const source of ['parrot','sub2api']){
    const r=runtime(source),pending=deferred();r.cache();r.handler(url=>pending.promise.then(()=>source==='parrot'?ok({items:[]}):ok({code:0,data:{items:[],pages:1}})))
    const job=r.widget.run();await flush();await r.tick(8000);await job
    if(source==='parrot')r.api.saveConfig('https://new-parrot.example','FIXTURE-NEW')
    else r.api.saveSub2APIConfig('https://new-sub.example','FIXTURE-NEW','Asia/Shanghai')
    const marker=r.cache(source,456);pending.resolve();await flush()
    assert.equal(r.store.get(keys[source]),marker,'old configuration must not overwrite new cache');assert.equal(r.presented.length,1)
  }
  // A configuration removed during a hang cannot resurrect the old fallback object.
  {const r=runtime('sub2api'),pending=deferred();r.cache();r.handler(()=>pending.promise);const job=r.widget.run();await flush()
    r.api.clearSub2APIConfig();await r.tick(8000);await job
    assert.equal(r.presented[0].tree.type,'Text');assert.equal(r.store.has(keys.sub2api),false)
    pending.resolve(ok({code:0,data:{items:[],pages:1}}));await flush()
    assert.equal(r.store.has(keys.sub2api),false);assert.equal(r.presented.length,1)
  }
  // A new login with the same ID wins over an old in-flight full snapshot.
  {const r=runtime(),pending=deferred();r.cache();r.handler(()=>pending.promise);const job=r.widget.run();await flush();await r.tick(8000);await job
    r.api.logoutOfficial('account:user');r.api.saveOfficialCredential({access_token:r.token(),refresh_token:'FIXTURE-RELOGIN'})
    const marker=r.cache('official',789);pending.resolve(quota());await flush()
    assert.equal(r.store.get(keys.official),marker);assert.equal(JSON.parse(r.kc.get('ai_usage_official_oauth_v1'))[0].refresh,'FIXTURE-RELOGIN');assert.equal(r.presented.length,1)
  }
  // Time budget is NOT a cancellation of valid token rotation. Save a late, correctly rotated refresh token.
  {const r=runtime(),pending=deferred();r.cache();const key='ai_usage_official_oauth_v1',old=JSON.parse(r.kc.get(key))[0];old.expiresAt=r.now()-1;r.kc.set(key,JSON.stringify([old]))
    r.handler(url=>url.endsWith('/oauth/token')?pending.promise:quota());const job=r.widget.run();await flush();assert.equal(r.calls.length,1)
    await r.tick(8000);await job
    pending.resolve(ok({access_token:r.token(),refresh_token:'FIXTURE-ROTATED',expires_in:7200}));await flush()
    assert.equal(JSON.parse(r.kc.get(key))[0].refresh,'FIXTURE-ROTATED');assert.equal(r.presented.length,1);assert.equal(r.timers.size,0)
    assert.equal(r.calls.filter(c=>c.url.endsWith('/oauth/token')).length,1)
  }
  console.log('PASS production widget run: 8s total async deadline, current-source timestamp-preserving cache or plain text, sync/rejected reads, immediate success/projection, all 7 families, one present/timer cleanup, source/config/re-login late cache guards, late valid credential rotation retained; offline virtual host only')
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
