// Offline Antigravity display-mode regression. Production TS/TSX, synthetic credentials only.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const ts=require(process.env.TYPESCRIPT_PATH||'/tmp/chk/node_modules/typescript'),root=path.resolve(__dirname,'..')
let now=1800000000000,handler,calls=[],states=[],hook=0,effects=[],timers=new Map(),seq=1,servers=[],failSave=false,closeBrowser,disposed=0
const kc=new Map(),store=new Map(),modules={}
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
const data=b=>({bytes:Buffer.from(b),toBase64String:()=>Buffer.from(b).toString('base64'),toRawString:()=>Buffer.from(b).toString()})
const scripting=new Proxy({Widget:{family:'systemLarge',parameter:'',displaySize:{width:360,height:380},reloadAll:async()=>{}},Navigation:{useDismiss:()=>()=>{}},useState:initial=>{const i=hook++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect:fn=>effects.push(fn),useObservable:initial=>({value:typeof initial==='function'?initial():initial,setValue(v){this.value=v}}),modifiers:()=>{const m=new Proxy({},{get:()=>()=>m});return m},AppIntentProtocol:{AppIntent:0},AppIntentManager:{register:()=>()=>({})}},{get:(o,k)=>k in o?o[k]:k})
const context=vm.createContext({console,Date:Clock,Map,Set,Math,Promise,
 setTimeout:(fn,ms)=>{const id=seq++;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
 Keychain:{get:k=>kc.get(k)||null,set:(k,v)=>{if(failSave&&k==='ai_usage_antigravity_oauth_v1')return false;kc.set(k,v);return true},remove:k=>kc.delete(k)},
 Storage:{get:k=>store.has(k)?JSON.parse(JSON.stringify(store.get(k))):null,set:(k,v)=>store.set(k,JSON.parse(JSON.stringify(v))),remove:k=>store.delete(k)},
 Data:{fromRawString:s=>data(s),fromBase64String:s=>data(Buffer.from(s,'base64'))},Crypto:{generateSymmetricKey:bits=>data(crypto.randomBytes(bits/8)),sha256:d=>data(crypto.createHash('sha256').update(d.bytes).digest())},
 HttpServer:class{constructor(){this.handlers={};servers.push(this)}registerHandler(p,h){this.handlers[p]=h}start(o){assert.equal(this.listenAddressIPv4,'127.0.0.1');assert.equal(o.forceIPv4,true);this.port=o.port;return null}stop(){this.port=null}},HttpResponse:{ok:b=>b},HttpResponseBody:{html:s=>s},
 UIImage:{fromBase64String:s=>({base64:s})},
 WebViewController:class{constructor(o){assert.equal(o.ephemeral,true)}loadURL(){return Promise.resolve(true)}present(){return new Promise(r=>closeBrowser=r)}dismiss(){closeBrowser?.()}dispose(){disposed++}},
 fetch:async(u,o)=>{calls.push({u,o});if(!handler)throw Error('unmocked request');return handler(u,o)}
})
function load(name){if(modules[name])return modules[name].exports;let s=fs.readFileSync(path.join(root,name),'utf8');if(name==='index.tsx')s=s.replace(/\nrun\(\)\s*$/,'\nexport { SettingsView, AccountLine, AccountCacheSections, WidgetNamePage }');if(name==='widget.tsx')s=s.replace(/\nrun\(\)\s*$/,'\nexport { Root, ProviderIcon, run as runWidget }');const out=ts.transpileModule(s,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'},reportDiagnostics:true});assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,name);const m=modules[name]={exports:{}};const jsx=(type,props)=>({type,props});const req=n=>n==='scripting'?scripting:n==='scripting/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:load(n.slice(2)+(fs.existsSync(path.join(root,n.slice(2)+'.tsx'))?'.tsx':'.ts'));vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`,context)(req,m,m.exports);return m.exports}
const api=load('api.ts'),app=load('index.tsx'),widget=load('widget.tsx'),KEY='ai_usage_antigravity_oauth_v1'
const resp=(status,b={})=>({status,json:async()=>b}),ok=b=>resp(200,b),flush=async(n=40)=>{while(n--)await Promise.resolve()}
const creds=()=>JSON.parse(kc.get(KEY)||'[]'),credential=()=>creds()[0]
function reset(){kc.clear();store.clear();calls=[];states=[];effects=[];timers.clear();servers=[];failSave=false;api.saveSource('official')}
// Profile-sensitive behavior reproduced on the official read-only endpoints: a generic UA
// gets HTTP 200 without project/tier on loadCodeAssist, then HTTP 403 on quota summary.
// These are synthetic structural fixtures, not captured real account responses.
const quotaUserAgent='antigravity/hub/2.22.0 (aidev_client; os_type=linux; arch=amd64; cl=995734886)'
const loadBody={cloudaicompanionProject:{id:'fixture-project'},paidTier:{name:'Fixture Pro',availableCredits:[{creditType:'GOOGLE_ONE_AI',creditAmount:'123.5',minimumCreditAmountForUsage:'0.1'}]}}
const summary={groups:[{displayName:'Models A',buckets:[{bucketId:'a',window:'5h',remainingFraction:0.75,resetTime:'2030-01-01T00:00:00Z'},{window:'weekly',remainingFraction:0.9}]},{displayName:'Models B',buckets:[{window:'5h',remainingFraction:0.4,resetTime:'2030-01-02T00:00:00Z'}]}]}
function network({expires=3600,id='fixture-google-user'}={}){return async(u,o)=>{if(u==='https://oauth2.googleapis.com/token'){const b=new URLSearchParams(o.body);assert.equal(b.get('client_id'),'1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com');assert.equal(b.get('client_secret'),'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');assert.equal(o.headers['Content-Type'],'application/x-www-form-urlencoded');if(b.get('grant_type')==='authorization_code'){assert.equal(b.get('redirect_uri'),'http://localhost:51121/oauth-callback');assert.ok(b.get('code_verifier'));return ok({access_token:'FIXTURE-ACCESS',refresh_token:'FIXTURE-REFRESH',expires_in:expires})}assert.equal(b.get('grant_type'),'refresh_token');return ok({access_token:'ROTATED',refresh_token:'ROTATED-REFRESH',expires_in:3600})}if(u.includes('/userinfo?'))return ok({id,email:'fixture@example.test'});assert.equal(new URL(u).hostname,u.endsWith(':retrieveUserQuotaSummary')?'daily-cloudcode-pa.googleapis.com':'cloudcode-pa.googleapis.com');assert.equal(o.method,'POST');if(o.headers['User-Agent']!==quotaUserAgent)return u.endsWith(':loadCodeAssist')?ok({allowedTiers:[{id:'free-tier'}],ineligibleTiers:[]}):resp(403,{error:{code:403,status:'PERMISSION_DENIED',message:'DO-NOT-LEAK'}});if(u.endsWith(':loadCodeAssist')){assert.deepEqual(JSON.parse(o.body),{metadata:{ideType:'ANTIGRAVITY'}});return ok(loadBody)}if(u.endsWith(':retrieveUserQuotaSummary')){assert.deepEqual(JSON.parse(o.body),{project:'fixture-project'});return ok(summary)}throw Error('unexpected mocked URL '+u)}}
function callback(d,extra=[]){return d.server.handlers['/oauth-callback']({method:'GET',queryParams:[{key:'state',value:d.state},{key:'code',value:'FIXTURE-CODE'},...extra]})}
async function login(options={}){handler=network(options);const d=api.beginAntigravityLogin(()=>{},()=>{});callback(d);await api.finishAntigravityLogin(d,()=>true);return d}
function walk(v,out=[]){if(v==null||v===false)return out;if(Array.isArray(v)){v.forEach(x=>walk(x,out));return out}if(typeof v!=='object'){out.push(v);return out}if(typeof v.type==='function')return walk(v.type(v.props),out);out.push(v);if(v.type==='GeometryReader'&&typeof v.props.children==='function')walk(v.props.children({size:scripting.Widget.displaySize}),out);else walk(v.props?.children,out);if(v.type==='ForEach'&&v.props.itemBuilder)for(let i=0;i<v.props.count;i++)walk(v.props.itemBuilder(i),out);for(const k of ['header','destination'])if(v.props?.[k])walk(v.props[k],out);return out}
function render(){hook=0;return walk(app.SettingsView())}
const button=(tree,title)=>{const n=tree.find(n=>n?.type==='Button'&&n.props.title===title);assert.ok(n,title);return n}
const CACHE='ai_usage_official_cache_v1',A='antigravity:group-A',B='antigravity:group-B'
const families=['systemSmall','systemMedium','systemLarge','systemExtraLarge','accessoryRectangular','accessoryCircular','accessoryInline']
const groups=[
 {displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',window:'5h',remainingFraction:.85,resetTime:'2030-01-01T01:00:00Z'},{bucketId:'gemini-weekly',window:'weekly',remainingFraction:.41,resetTime:'2030-01-04T01:00:00Z'}]},
 {displayName:'Claude and GPT models',buckets:[{bucketId:'claude-5h',window:'5h',remainingFraction:.32,resetTime:'2030-01-02T02:00:00Z'},{bucketId:'claude-weekly',window:'weekly',remainingFraction:.78,resetTime:'2030-01-06T02:00:00Z'}]},
]
const make=(id=A,raw=groups)=>({id,name:id.slice(12)+'@example.test',provider:'antigravity',enabled:true,available:true,resetCredits:null,...api.mapAntigravityQuota(loadBody,{groups:raw})})
const usage=accounts=>({accounts,today:null,month:null,todayByFamily:{},monthByFamily:{},fetchedAt:now-100000})
const metric={requests:1,inputTokens:1,outputTokens:2,cacheReadTokens:3,cacheCreationTokens:0,totalTokens:6,costUsd:1}
function seed(accounts=[make()],expired=false){kc.set(KEY,JSON.stringify(accounts.map(a=>({id:a.id,email:a.name,access:'FIXTURE-ACCESS',refresh:'FIXTURE-REFRESH',expiresAt:now+(expired?-1:3600000)}))));store.set(CACHE,usage(accounts));store.set('ai_usage_parrot_stats_v1',{today:metric,month:metric,todayByFamily:{},monthByFamily:{},fetchedAt:now-200000})}
const project=a=>api.projectAntigravityAccount(a,'official')
function windows(a,five,seven,r5,r7){assert.equal(a.fiveHour.remainingPercent,five);assert.equal(a.sevenDay.remainingPercent,seven);assert.equal(a.fiveHour.usedPercent,five==null?null:100-five);assert.equal(a.sevenDay.usedPercent,seven==null?null:100-seven);if(r5!==undefined)assert.equal(a.fiveHour.resetsAt,r5);if(r7!==undefined)assert.equal(a.sevenDay.resetsAt,r7)}
function quotaHandler(raw=groups){const base=network();return (u,o)=>{if(u.endsWith(':retrieveUserQuotaSummary')){assert.equal(new URL(u).hostname,'daily-cloudcode-pa.googleapis.com');assert.equal(o.headers['User-Agent'],quotaUserAgent);assert.deepEqual(JSON.parse(o.body),{project:'fixture-project'});return ok({groups:raw})}return base(u,o)}}
function details(a,source='official'){return walk(app.AccountCacheSections({account:a,source}))}
function assertDetails(a,five,seven){const nodes=details(a);for(const[label,v]of[['5 h',five],['7 d',seven]]){const section=nodes.find(n=>n?.type==='Section'&&n.props.header?.props.children===label);assert.ok(section,label);assert.ok(walk(section).includes('剩余额度 '+(v==null?'未提供':v+'%')))}}
function page(a,source='official',onSaved=()=>{}){hook=0;return walk(app.WidgetNamePage({account:a,source,onSaved}))}
const picker=nodes=>nodes.find(n=>n?.type==='Picker'&&n.props.title==='显示额度')
for(const source of ['official','parrot','sub2api'])for(const provider of ['antigravity','openai','claude','deepseek','workbuddy']){
 states=[];hook=0;const section=app.WidgetNamePage({account:{...make(),provider},source,onSaved:()=>{}}).props.children[0]
 assert.equal(section.props.header.props.children,'小组件用户名')
 assert.equal(Object.hasOwn(section.props,'footer'),false)
 assert.equal(section.props.children[0].props.title,'自定义小组件用户名')
 assert.equal(section.props.children[1].props.title,'保存')
}

function assertModeSection(account,source='official'){
 hook=0;const section=app.WidgetNamePage({account,source,onSaved:()=>{}}).props.children[1]
 assert.equal(section.props.header.props.children,'小组件额度显示')
 assert.equal(Object.hasOwn(section.props,'footer'),false,'no explanation footer for any source')
 const children=section.props.children.filter(Boolean)
 assert.equal(children.length,1,'exactly one content row, no empty section or second hint row')
 if(source==='official'){
  assert.equal(children[0].type,'Picker')
  assert.deepEqual(Array.from(children[0].props.children,n=>[n.props.tag,n.props.children]),[['summary','最低剩余额度汇总'],['gemini','Gemini Models'],['claude_gpt','Claude and GPT models'],['argon','Gemini 4 Argon']])
 }else{
  assert.equal(children[0].type,'Text')
  assert.equal(children[0].props.children,api.antigravityModeHint(account,source))
  assert.match(children[0].props.children,/不支持分组切换/)
 }
}
function expand(n){if(n==null||typeof n!=='object')return n;if(Array.isArray(n))return n.map(expand);if(Object.hasOwn(n,'type')&&typeof n.type==='function')return expand(n.type(n.props));if(n.type==='GeometryReader')return expand(n.props.children({size:scripting.Widget.displaySize}));return Object.fromEntries(Object.entries(n).map(([k,v])=>[k,typeof v==='function'?'[callback]':expand(v)]))}
const treeHash=n=>crypto.createHash('sha256').update(JSON.stringify(expand(n))).digest('hex')
function assertWidgetTrees(a){const p=project(a),expected={...p,id:'expected-summary',antigravity:{...p.antigravity,groups:[]}};for(const family of families){scripting.Widget.family=family;scripting.Widget.parameter='';assert.equal(treeHash(widget.Root({data:usage([a]),error:null})),treeHash(widget.Root({data:usage([expected]),error:null})),family)}}
// Observed 2026-10-20 in Parrot v0.34.14's stored Google quota snapshot, not screenshot guesses.
// Fixture restores Google's camelCase keys via the verified parse_quota_summary mapping
// in /app/src/oauth/antigravity.py:849; no identity, token or project fields are retained.
const argonSummary=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/antigravity-argon-summary.json'),'utf8'))
async function argonCases(){
 reset();const raw=argonSummary.groups,argon=raw[2],fraction=argon.buckets[0].remainingFraction,remaining=fraction*100,resetAt=argon.buckets[0].resetTime,a=make(A,raw),b=make(B,raw)
 assert.equal(argon.displayName,'Gemini 4 Argon');assert.equal(argon.buckets[0].bucketId,'gemini-argon-wtu-weekly');assert.equal(argon.buckets[0].window,'weekly');assert.equal(argon.buckets.length,1)
 seed([a,b],true);const original=JSON.stringify(store.get(CACHE)),beforeKC=kc.get(KEY)
 // Canonical summary includes Argon but its missing 5h must not erase the other groups' 5h.
 windows(a,100,remaining,raw[0].buckets[1].resetTime,resetAt)
 for(const order of [raw,[raw[2],raw[0],raw[1]],[raw[1],raw[2],raw[0]],raw.slice().reverse()]){
  const account=make(A,order)
  for(const [mode,five,seven]of [['summary',100,remaining],['gemini',100,100],['claude_gpt',100,100],['argon',null,remaining]]){
   api.saveAntigravityMode(A,mode);windows(project(account),five,seven);assertDetails(account,five,seven);assertWidgetTrees(account);assertModeSection(account)
  }
  assert.equal(project(account).sevenDay.resetsAt,resetAt)
 }
 // Stable weekly ties include Argon according to response order, not preferred group names.
 const tied=JSON.parse(JSON.stringify(raw));tied[0].buckets[0].remainingFraction=fraction
 api.saveAntigravityMode(A,'summary');assert.equal(project(make(A,tied)).sevenDay.resetsAt,tied[0].buckets[0].resetTime);assert.equal(project(make(A,[tied[2],tied[1],tied[0]])).sevenDay.resetsAt,resetAt)
 api.saveAntigravityMode(A,'argon');windows(project(make(A,raw.slice(0,2))),null,null);assert.equal(api.getAntigravityMode(A),'argon')
 windows(project(make(A,[...raw.slice(0,2),{...argon,buckets:[]}])) ,null,null)
 windows(project(make(A,[...raw.slice(0,2),{...argon,buckets:[{...argon.buckets[0],remainingFraction:null}]}])),null,null)
 for(const displayName of ['Gemini 4 Argon Plus','gemini-4-argon-medium','Gemini Models Argon'])windows(project(make(A,[...raw.slice(0,2),{...argon,displayName}])) ,null,null)
 windows(project(make(A,[...raw.slice(0,2),{...argon,displayName:' Gemini 4 Argon '}])),null,remaining,null,resetAt)
 const legacy={...a,antigravity:undefined};windows(project(legacy),null,null);api.saveAntigravityMode(A,'summary');assert.equal(project(legacy),legacy)
 assert.equal(JSON.stringify(store.get(CACHE)),original);assert.equal(calls.length,0)
 // Actual fourth Picker option invokes cached widget entry for all 7 sizes, even with expired tokens.
 let saved=0,reloads=0,presentations=0;scripting.Widget.present=()=>presentations++;scripting.Widget.reloadAll=async()=>{reloads++;for(const family of families){scripting.Widget.family=family;await widget.runWidget()}}
 handler=async()=>{throw Error('Argon selection must not network')};states=[];let tree=page(a,'official',()=>saved++);await picker(tree).props.onChanged('argon');tree=page(a,'official',()=>saved++);assert.equal(picker(tree).props.value,'argon');assert.equal(saved,1);assert.equal(reloads,1);assert.equal(presentations,7);assert.equal(calls.length,0);assert.equal(kc.get(KEY),beforeKC);assert.equal(JSON.stringify(store.get(CACHE)),original)
 assert.equal(api.getAntigravityMode(B),'summary');windows(api.officialCached().accounts[0],null,remaining,null,resetAt);windows(api.cachedAccounts()[0],null,remaining);windows(api.managementAccounts()[0],null,remaining);assertDetails(a,null,remaining);assertWidgetTrees(a)
 // Source-local preference never turns Parrot/Sub2API into fabricated group/window support.
 for(const source of ['parrot','sub2api']){
  api.saveSource(source);api.saveAntigravityMode(A,'argon',source);assert.equal(api.projectAntigravityAccount(a,source),a);states=[];assertModeSection(a,source);assert.equal(picker(page(a,source)),undefined);assert.equal(api.getAntigravityMode(A,'official'),'argon')
 }
 api.saveSource('official');const base=network();const routeStart=calls.length
 // Reproduce the live same-token/project/UA difference: production gives two groups,
 // daily gives all three. Calling the old host must fail this end-to-end read assertion.
 handler=(u,o)=>u.endsWith(':retrieveUserQuotaSummary')?ok({groups:new URL(u).hostname==='daily-cloudcode-pa.googleapis.com'?raw.slice().reverse():raw.slice(0,2)}):base(u,o)
 const refreshed=await api.loadOfficialUsage();assert.equal(refreshed.data.accounts[0].antigravity.groups.length,3);assert.ok(calls.slice(routeStart).filter(c=>c.u.endsWith(':retrieveUserQuotaSummary')).every(c=>new URL(c.u).hostname==='daily-cloudcode-pa.googleapis.com'));windows(refreshed.data.accounts[0],null,remaining,null,resetAt);assert.equal(api.getAntigravityMode(A),'argon');windows(store.get(CACHE).accounts[0],100,remaining);assert.equal(store.get(CACHE).accounts[0].antigravity.groups.length,3)
 handler=quotaHandler(raw.slice(0,2));await api.loadOfficialUsage();windows(api.officialCached().accounts[0],null,null);assert.equal(api.getAntigravityMode(A),'argon');handler=quotaHandler(raw);await api.loadOfficialUsage();windows(api.officialCached().accounts[0],null,remaining)
 api.saveWidgetName(A,'Argon weekly','official');api.saveAccountOrder([B,A],'official');assert.equal(api.getAntigravityMode(A),'argon');api.logoutOfficial(A);assert.equal(api.getAntigravityMode(A),'summary');assert.equal(api.getAntigravityMode(A,'parrot'),'argon');assert.equal(api.getAntigravityMode(B),'summary')
 console.log('PASS production-load/daily-summary real-profile regression and observed Google Argon weekly fixture: exact group/bucket/window/reset, all 4 modes across permutations, summary includes Argon/stable ties, missing/invalid/renamed groups remain unknown, old cache/3 preferences compatible; actual fourth Picker cache-only -> 7 widget entries, App/widget agreement, refresh persistence/missing group recovery, account/source isolation and deletion')
}
async function diagnosticCases(){
 reset();seed([make(A),make(B)]);api.saveAntigravityMode(A,'argon');api.requestAntigravityWidgetProjection();handler=quotaHandler(argonSummary.groups)
 states=[];let tree=page(make());assert.ok(tree.includes('当前页：本机缓存快照'));const collect=tree.find(n=>n?.type==='Button'&&n.props.title==='立即网络采集');assert.ok(collect)
 scripting.Widget.reloadAll=async()=>{};const n=calls.length;await collect.props.action();assert.equal(calls.length-n,2);tree=page(make());assert.ok(tree.includes('当前页：本次网络采集结果'))
 let a=api.officialCached().accounts.find(a=>a.id===A),d=a.antigravityRead;assert.equal(d.version,'1.37');assert.equal(d.summaryHTTP,200);assert.equal(d.loadHTTP,200);assert.equal(d.project,true);assert.equal(d.groupCount,3);assert.equal(d.host,'daily');assert.equal(d.outcome,'response');assert.ok(d.groupNames.includes('Gemini 4 Argon'));assert.equal(api.getAntigravityMode(A),'argon');assert.equal(api.officialCached().accounts.find(a=>a.id===B).antigravityRead,undefined)
 assert.ok(!JSON.stringify(d).includes('fixture-project'));assert.ok(!JSON.stringify(d).includes('ACCESS'));assert.ok(!JSON.stringify(d).includes('@'))
 now+=1000;handler=quotaHandler(groups);await api.refreshAntigravityAccount(A);d=api.officialCached().accounts[0].antigravityRead;assert.equal(d.groupCount,2);windows(api.officialCached().accounts[0],null,null);assert.equal(d.lastSuccessAt,now)
 now+=1000;handler=quotaHandler([{displayName:'SECRET-email-token',buckets:[]}]);await api.refreshAntigravityAccount(A);d=api.officialCached().accounts[0].antigravityRead;assert.deepEqual(Array.from(d.groupNames),['其他分组']);assert.ok(!JSON.stringify(d).includes('SECRET'))
 const base=quotaHandler();now+=1000;handler=(u,o)=>u.endsWith(':retrieveUserQuotaSummary')?resp(403,{error:{message:'SECRET',status:'PERMISSION_DENIED'}}):base(u,o);await api.refreshAntigravityAccount(A);d=api.officialCached().accounts[0].antigravityRead;assert.equal(d.summaryHTTP,403);assert.equal(d.outcome,'failed');assert.equal(d.groupCount,null);assert.ok(!JSON.stringify(d).includes('SECRET'))
 now+=1000;handler=()=>{throw Error('SECRET')};await api.refreshAntigravityAccount(A);d=api.officialCached().accounts[0].antigravityRead;assert.equal(d.retainedCache,true);assert.equal(d.loadHTTP,null);assert.equal(d.summaryHTTP,null)
 // In-flight aggregate does not block explicit collection or later overwrite newer metadata.
 reset();seed([make(A)]);let release;handler=async(u,o)=>{const result=quotaHandler(groups)(u,o);if(u.endsWith(':retrieveUserQuotaSummary'))await new Promise(r=>release=r);return result};const pending=api.loadUsage();await flush();assert.ok(release);now+=1000;handler=quotaHandler(argonSummary.groups);await api.refreshAntigravityAccount(A);const newest=api.officialCached().accounts[0].antigravityRead.startedAt;release();await pending;assert.equal(api.officialCached().accounts[0].antigravityRead.startedAt,newest);assert.equal(api.officialCached().accounts[0].antigravityRead.groupCount,3)
 // Late single-account results cannot commit after source change or logout.
 for(const action of ['source','logout']){reset();seed([make(A)]);release=null;handler=async(u,o)=>{const result=quotaHandler()(u,o);if(u.endsWith(':retrieveUserQuotaSummary'))await new Promise(r=>release=r);return result};const pending=api.refreshAntigravityAccount(A);await flush();assert.ok(release);if(action==='source')api.saveSource('parrot');else api.logoutOfficial(A);release();assert.equal(await pending,false);assert.equal(store.get(CACHE)?.accounts[0]?.antigravityRead,undefined)}
 console.log('PASS diagnostic UI explicit collection bypasses local cache and usageFlight; current-page update, safe account-local HTTP/project/groups/times, two/three groups and failures, concurrent full refresh cannot overwrite newer result, source/logout late responses discarded')
}
async function main(){
 await diagnosticCases()
 await argonCases()
 reset();seed();states=[];hook=0;const positioned=app.WidgetNamePage({account:make(),source:'official',onSaved:()=>{}}).props.children;assert.equal(positioned[0].props.children[0].props.title,'自定义小组件用户名');assert.equal(positioned[1].props.header.props.children,'小组件额度显示');assert.equal(positioned[2].type,app.AccountCacheSections);const a=make(),original=JSON.stringify(a),rawCache=JSON.stringify(store.get(CACHE));assert.equal(api.getAntigravityMode(A),'summary');windows(project(a),32,41,groups[1].buckets[0].resetTime,groups[0].buckets[1].resetTime)
 for(const raw of [groups,[...groups].reverse()])for(const [mode,five,seven,r5,r7]of [['summary',32,41,groups[1].buckets[0].resetTime,groups[0].buckets[1].resetTime],['gemini',85,41,groups[0].buckets[0].resetTime,groups[0].buckets[1].resetTime],['claude_gpt',32,78,groups[1].buckets[0].resetTime,groups[1].buckets[1].resetTime]]){api.saveAntigravityMode(A,mode);const account=make(A,raw),p=project(account);windows(p,five,seven,r5,r7);assert.equal(p.antigravity,account.antigravity,'raw groups must be retained by reference');assertDetails(account,five,seven);assertWidgetTrees(account);assertModeSection(account)}
 assert.equal(JSON.stringify(a),original);assert.equal(JSON.stringify(store.get(CACHE)),rawCache);assert.equal(calls.length,0)
 // Equal values keep the first matching bucket's reset from the existing response order.
 const ties=JSON.parse(JSON.stringify(groups));ties[0].buckets[0].remainingFraction=.5;ties[1].buckets[0].remainingFraction=.5;api.saveAntigravityMode(A,'summary');assert.equal(project(make(A,ties)).fiveHour.resetsAt,ties[0].buckets[0].resetTime);assert.equal(project(make(A,ties.reverse())).fiveHour.resetsAt,ties[0].buckets[0].resetTime)
 console.log('PASS three modes x both group orders, per-window minimum+matched reset and stable ties; App details and 7 widget trees; immutable raw groups/cache; zero network')
 api.saveAntigravityMode(A,'claude_gpt');const missingWindow=make(A,[groups[0],{...groups[1],buckets:[groups[1].buckets[1]]}]);windows(project(missingWindow),null,78);assertDetails(missingWindow,null,78);assertWidgetTrees(missingWindow)
 const missingGroup=make(A,[groups[0]]);windows(project(missingGroup),null,null);assert.match(api.antigravityModeHint(missingGroup),/所选 Claude and GPT models 分组未提供/);assert.equal(api.getAntigravityMode(A),'claude_gpt');assertWidgetTrees(missingGroup);assertModeSection(missingGroup)
 const unknownGroup=make(A,[{displayName:'Renamed group',buckets:groups[1].buckets},groups[0]]);windows(project(unknownGroup),null,null)
 api.saveAntigravityMode(A,'summary');const legacy={...a,antigravity:undefined,fiveHour:{remainingPercent:66,usedPercent:34,resetsAt:null}};assert.equal(project(legacy),legacy);api.saveAntigravityMode(A,'gemini');windows(project(legacy),null,null)
 seed([legacy]);const staleLegacy=api.managementAccounts()[0];windows(staleLegacy,null,null);api.saveAntigravityMode(A,'summary');states=[];const restoredPage=page(staleLegacy);assert.ok(restoredPage.includes('剩余额度 66%'),'legacy summary restored from canonical cache even if open-page props were selected');assert.equal(calls.length,0)
 console.log('PASS missing window/group/renamed group stay unknown without fallback; preference retained; default legacy standard windows retained and restored in open detail')
 reset();seed([make(A),make(B)]);api.saveAntigravityMode(A,'gemini','official');api.saveAntigravityMode(B,'claude_gpt','official');api.saveAntigravityMode(A,'claude_gpt','parrot');api.saveAntigravityMode(A,'gemini','sub2api');assert.equal(api.getAntigravityMode(A,'official'),'gemini');assert.equal(api.getAntigravityMode(A,'parrot'),'claude_gpt');assert.equal(api.getAntigravityMode(A,'sub2api'),'gemini');windows(project(make(A)),85,41);windows(project(make(B)),32,78)
 for(const source of ['parrot','sub2api']){api.saveSource(source);assert.equal(api.projectAntigravityAccount(a,source),a);states=[];assertModeSection(a,source);const tree=page(a,source);assert.equal(picker(tree),undefined);assert.ok(tree.some(n=>typeof n==='string'&&n.includes('不支持分组切换')));store.set(source==='parrot'?'ai_usage_cache_v1':'ai_usage_sub2api_quota_v1',usage([a]));assert.equal(api.cachedAccounts()[0].fiveHour.remainingPercent,a.fiveHour.remainingPercent);assert.equal(api.widgetAccounts([a])[0].fiveHour.remainingPercent,a.fiveHour.remainingPercent)}
 api.saveSource('official');assert.equal(api.getAntigravityMode(A),'gemini');api.saveAntigravityMode('__proto__','claude_gpt');assert.equal(api.getAntigravityMode('__proto__'),'claude_gpt');api.saveAntigravityMode('__proto__','summary');assert.equal(api.getAntigravityMode('__proto__'),'summary')
 console.log('PASS exact section tree: official only retains four-option Picker below custom name, no footer/second hint; Parrot/Sub2API retain one unsupported Text row, never empty; independent accounts/sources and standard windows unchanged')
 // A real picker change causes Widget.reloadAll, whose actual widget entry must use only cache.
 reset();seed([make(A),make(B)],true);const beforeKC=kc.get(KEY),beforeCache=JSON.stringify(store.get(CACHE));let saved=0,reloads=0,presentations=[];scripting.Widget.present=(node,options)=>presentations.push({tree:walk(node),options});scripting.Widget.reloadAll=async()=>{reloads++;for(const f of families){scripting.Widget.family=f;await widget.runWidget()}};handler=async()=>{throw Error('unexpected network during selection')};states=[];let tree=page(a,'official',()=>saved++);assert.deepEqual(Array.from(picker(tree).props.children,n=>n.props.children),['最低剩余额度汇总','Gemini Models','Claude and GPT models','Gemini 4 Argon']);await picker(tree).props.onChanged('gemini');tree=page(a,'official',()=>saved++);assert.equal(picker(tree).props.value,'gemini');assert.equal(saved,1);assert.equal(reloads,1);assert.equal(presentations.length,7);assert.equal(calls.length,0);assert.equal(kc.get(KEY),beforeKC,'even expired token must not renew');assert.equal(JSON.stringify(store.get(CACHE)),beforeCache);windows(api.officialCached().accounts[0],85,41);windows(api.cachedAccounts()[0],85,41);windows(api.managementAccounts()[0],85,41);assertDetails(a,85,41);assertWidgetTrees(a);assert.ok(api.cachedAntigravityWidgetProjection().data.statistics.fetchedAt<now)
 for(const p of presentations)assert.equal(p.options.reloadPolicy.date.getTime(),now+api.getRefreshMinutes()*60000)
 // Multiple widget instances do not consume a single-use flag; none may accidentally renew.
 for(let i=0;i<3;i++)await widget.runWidget();assert.equal(calls.length,0);api.saveSource('parrot');assert.equal(api.cachedAntigravityWidgetProjection(),null);api.saveSource('official')
 // A late page callback after source change must not write a new source's preferences.
 const stalePicker=picker(tree);api.saveSource('sub2api');await stalePicker.props.onChanged('claude_gpt');assert.equal(api.getAntigravityMode(A,'official'),'gemini');api.saveSource('official')
 console.log('PASS actual Picker -> cache-only Widget.reloadAll -> 7 widget entry executions plus repeated instances, no fetch/renewal with expired credentials; App/cache/component agreement and late-source guard')
 // Manual refresh is never blocked by local projection, and persists raw summary rather than selection.
 handler=quotaHandler([...groups].reverse());let r=await api.loadOfficialUsage();assert.ok(calls.some(c=>c.u.endsWith('/token')));windows(r.data.accounts[0],85,41);assert.equal(api.getAntigravityMode(A),'gemini');const stored=store.get(CACHE).accounts[0];windows(stored,32,41);assert.equal(stored.antigravity.groups.length,2);api.saveAntigravityMode(A,'claude_gpt');windows(api.officialCached().accounts[0],32,78)
 const beforeFailure=JSON.stringify(store.get(CACHE).accounts[0].antigravity);handler=async()=>{throw Error('fixture offline')};const failed=await api.loadOfficialUsage();windows(failed.data.accounts[0],32,78);assert.equal(JSON.stringify(store.get(CACHE).accounts[0].antigravity),beforeFailure);windows(store.get(CACHE).accounts[0],32,41)
 // Selection made while quota is in flight is applied on return, without changing raw stored data.
 let release;const base=quotaHandler();handler=async(u,o)=>{const result=await base(u,o);if(u.endsWith(':retrieveUserQuotaSummary')&&!release)await new Promise(resolve=>release=resolve);return result};const inFlight=api.loadOfficialUsage();await flush();assert.ok(release);api.saveAntigravityMode(A,'gemini');release();r=await inFlight;windows(r.data.accounts[0],85,41);windows(store.get(CACHE).accounts[0],32,41)
 now+=api.getRefreshMinutes()*60000;assert.equal(api.cachedAntigravityWidgetProjection(),null);const n=calls.length;handler=quotaHandler();await widget.runWidget();assert.ok(calls.length>n,'scheduled refresh resumes');assert.equal(api.getAntigravityMode(A),'gemini')
 api.saveAccountOrder([B,A],'official');api.saveWidgetName(A,'My Gemini','official');assert.equal(api.managementAccounts()[1].id,A);assert.equal(api.getAntigravityMode(A),'gemini');assert.equal(api.getWidgetName(A,'official'),'My Gemini')
 console.log('PASS manual and scheduled refresh/resume, in-flight selection, canonical stored windows/raw groups preserved; mode survives refresh/order/alias')
 api.saveAntigravityMode(B,'claude_gpt','official');api.saveAntigravityMode(A,'claude_gpt','parrot');api.logoutOfficial(A);assert.equal(api.getAntigravityMode(A,'official'),'summary');assert.equal(api.getAntigravityMode(B,'official'),'claude_gpt');assert.equal(api.getAntigravityMode(A,'parrot'),'claude_gpt');assert.equal(api.officialCached().accounts.length,1);assert.equal(api.getWidgetName(A,'official'),'');await stalePicker.props.onChanged('claude_gpt');assert.equal(api.getAntigravityMode(A,'official'),'summary','deleted account cannot recreate preference from stale page');api.logoutOfficial(B);assert.equal(api.cachedAntigravityWidgetProjection(),null)
 for(const provider of ['claude','openai','deepseek','workbuddy']){const other={...a,id:'other-'+provider,provider,antigravity:undefined};api.saveAntigravityMode(other.id,'gemini');assert.equal(api.projectAntigravityAccount(other,'official'),other)}
 console.log('PASS deletion removes only own source-local preference/alias/cache; other account/source untouched, stale detail guarded; other providers bypass projection')
 console.log('PASS Antigravity group selection suite complete; offline mocks only')
}
main().catch(e=>{console.error(e);process.exitCode=1})
