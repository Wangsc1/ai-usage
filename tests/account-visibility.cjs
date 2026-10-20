// Source-local visibility/list regression. Executes production TS/TSX; synthetic data only.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const ts=require(process.env.TYPESCRIPT_PATH||'/tmp/chk/node_modules/typescript'),root=path.resolve(__dirname,'..')
let now=1800000000000,handler,calls=[],states=[],hook=0,effects=[],timers=new Map(),seq=1,servers=[],failSave=false,closeBrowser,disposed=0
const kc=new Map(),store=new Map(),modules={};let native=true
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
const data=b=>({bytes:Buffer.from(b),toBase64String:()=>Buffer.from(b).toString('base64'),toRawString:()=>Buffer.from(b).toString()})
const scripting=new Proxy({Widget:{family:'systemLarge',parameter:'',displaySize:{width:360,height:380},reloadAll:async()=>{}},Navigation:{useDismiss:()=>()=>{}},useState:initial=>{const i=hook++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect:fn=>effects.push(fn),useObservable:initial=>({value:typeof initial==='function'?initial():initial,setValue(v){this.value=v}}),modifiers:()=>{const m=new Proxy({},{get:()=>()=>m});return m},AppIntentProtocol:{AppIntent:0},AppIntentManager:{register:()=>()=>({})}},{get:(o,k)=>!native&&(k==="EditButton"||k==="ForEach")?undefined:k in o?o[k]:k})
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
function load(name){if(modules[name])return modules[name].exports;let s=fs.readFileSync(path.join(root,name),'utf8');if(name==='index.tsx')s=s.replace(/\nrun\(\)\s*$/,'\nexport { SettingsView, AccountLine, AccountCacheSections, WidgetNamePage, AccountOrderPage, run as runApp }');if(name==='widget.tsx')s=s.replace(/\nrun\(\)\s*$/,'\nexport { Root, ProviderIcon, run as runWidget }');const out=ts.transpileModule(s,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'},reportDiagnostics:true});assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,name);const m=modules[name]={exports:{}};const jsx=(type,props)=>({type,props});const req=n=>n==='scripting'?scripting:n==='scripting/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:load(n.slice(2)+(fs.existsSync(path.join(root,n.slice(2)+'.tsx'))?'.tsx':'.ts'));vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`,context)(req,m,m.exports);return m.exports}
const api=load('api.ts'),initialApp=load('index.tsx'),widget=load('widget.tsx'),KEY='ai_usage_antigravity_oauth_v1'
const resp=(status,b={})=>({status,json:async()=>b}),ok=b=>resp(200,b),flush=async(n=40)=>{while(n--)await Promise.resolve()}
const creds=()=>JSON.parse(kc.get(KEY)||'[]'),credential=()=>creds()[0]
function reset(){kc.clear();store.clear();calls=[];states=[];effects=[];timers.clear();servers=[];failSave=false;api.saveSource('official')}

let app=initialApp
const families=['systemSmall','systemMedium','systemLarge','systemExtraLarge','accessoryRectangular','accessoryCircular','accessoryInline']
const cacheKey=s=>s==='parrot'?'ai_usage_cache_v1':s==='sub2api'?'ai_usage_sub2api_quota_v1':'ai_usage_official_cache_v1'
const win={usedPercent:25,remainingPercent:75,resetsAt:'2030-01-02T00:00:00Z'}
const account=(id,i)=>({id,name:'Account '+i,provider:'openai',enabled:true,available:true,fiveHour:{...win,usedPercent:i,remainingPercent:100-i},sevenDay:win,resetCredits:i})
const ids=xs=>Array.from(xs,a=>a.id)
const usage=accounts=>({accounts,today:null,month:null,todayByFamily:{},monthByFamily:{},fetchedAt:now-1000})
const remoteIds=s=>s==='sub2api'?['sub2api:1','sub2api:2','sub2api:3','sub2api:4']:['p1','p2','p3','p4']
function seed(s,n=4){reset();native=true;delete modules['index.tsx'];app=load('index.tsx');api.saveSource(s);if(s==='parrot'){api.saveConfig('https://parrot.example','FIXTURE-KEY');kc.set('parrot_session_credential','FIXTURE-SESSION')}if(s==='sub2api')api.saveSub2APIConfig('https://sub.example','FIXTURE-KEY','Asia/Shanghai');const accounts=(s==='official'?['antigravity:1','antigravity:2','antigravity:3','antigravity:4']:remoteIds(s)).slice(0,n).map(account);if(s==='official'){for(const a of accounts)a.provider='antigravity';kc.set(KEY,JSON.stringify(accounts.map(a=>({id:a.id,email:a.name,access:'FIXTURE',refresh:'FIXTURE',expiresAt:now+3600000}))))}store.set(cacheKey(s),usage(accounts));return accounts}
function walk(v,out=[]){if(v==null||v===false)return out;if(Array.isArray(v)){v.forEach(x=>walk(x,out));return out}if(typeof v!=='object'){out.push(v);return out}if(Object.hasOwn(v,'type')&&typeof v.type==='function')return walk(v.type(v.props),out);out.push(v);if(v.type==='GeometryReader'&&typeof v.props.children==='function')walk(v.props.children({size:scripting.Widget.displaySize}),out);else walk(v.props?.children,out);if(v.type==='ForEach'&&v.props.itemBuilder)for(let i=0;i<v.props.count;i++)walk(v.props.itemBuilder(i),out);if(v.type==='ReorderableForEach'&&v.props.builder)for(let i=0;i<v.props.data.length;i++)walk(v.props.builder(v.props.data[i],i),out);if(v.props?.header)walk(v.props.header,out);if(v.props?.toolbar?.primaryAction)walk(v.props.toolbar.primaryAction,out);return out}
function render(){hook=0;return walk(app.SettingsView())}
const find=(tree,type)=>tree.find(n=>n?.type===type)
const button=(tree,title)=>{const n=tree.find(n=>n?.type==='Button'&&n.props.title===title);assert.ok(n,title);return n}
const swipes=tree=>tree.filter(n=>n?.props?.trailingSwipeActions)
function expand(n){if(n==null||typeof n!=='object')return n;if(Array.isArray(n))return n.map(expand);if(Object.hasOwn(n,'type')&&typeof n.type==='function')return expand(n.type(n.props));if(n.type==='GeometryReader')return expand(n.props.children({size:scripting.Widget.displaySize}));return Object.fromEntries(Object.entries(n).map(([k,v])=>[k,typeof v==='function'?'[callback]':expand(v)]))}
const hash=n=>crypto.createHash('sha256').update(JSON.stringify(expand(n))).digest('hex')
function widgets(raw){const visible=api.cachedAccounts();for(const family of families){scripting.Widget.family=family;for(const parameter of ['', '1','2,1']){scripting.Widget.parameter=parameter;assert.equal(hash(widget.Root({data:usage(raw),error:null})),hash(widget.Root({data:usage(visible),error:null})),family+'/'+parameter)}}scripting.Widget.parameter=''}
let reloads=0,presentations=[]
function localReloads(){reloads=0;presentations=[];scripting.Widget.present=(node,options)=>presentations.push({tree:expand(node),options});scripting.Widget.reloadAll=async()=>{reloads++;for(const f of families){scripting.Widget.family=f;await widget.runWidget()}};handler=()=>{throw Error('local action must not fetch')}}
function network(s){return async(u,o={})=>{
 const method=o.method||'GET';assert.ok(method==='GET'||s==='parrot'&&method==='POST'&&u.endsWith('/auth/sessions'),'no management mutation: '+method+' '+u)
 if(u.endsWith('/auth/sessions'))return resp(201,{data:{credential:'FIXTURE-SESSION'}})
 if(s==='parrot'){
  if(u.includes('/stats/summary'))return ok({data:{overall:{total:1,costTicks:0}}})
  if(u.includes('/channels?'))return ok({data:[],meta:{page:1,hasNext:false}})
  if(u.includes('/oauth/accounts?'))return ok({data:{items:remoteIds(s).map((id,i)=>({accountId:id,displayName:'Account '+i,provider:'openai',enabled:true,available:true}))}})
  if(u.includes('/oauth/accounts/'))return ok({data:{usageWindows:[{name:'fiveHour',...win},{name:'sevenDay',...win}]}})
 }else{
  if(u.includes('/usage/stats?'))return ok({code:0,data:{total_requests:1,total_input_tokens:0,total_output_tokens:0,total_cache_read_tokens:0,total_cache_creation_tokens:0,total_tokens:0,total_actual_cost:0}})
  if(u.includes('/accounts?lite'))return ok({code:0,data:{items:[1,2,3,4].map(id=>({id,name:'Account '+(id-1),platform:'openai',type:'oauth',status:'active'})),pages:1}})
  if(u.includes('/quota'))return ok({code:0,data:{rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000}}}})
 }
 throw Error('unexpected fixture URL '+u)
}}
async function main(){
 for(const s of ['official','parrot','sub2api']){
  const accounts=seed(s);localReloads();if(s==='official')api.requestLocalWidgetProjection(s);let tree=render(),rows=swipes(tree);assert.equal(rows.length,4);assert.ok(find(tree,'EditButton'));const each=find(tree,'ForEach');assert.equal(each.props.count,4);assert.equal(typeof each.props.onMove,'function');assert.equal(rows[0].props.trailingSwipeActions.actions[0].props.title,s==='official'?'删除':'隐藏');assert.equal(rows[0].props.trailingSwipeActions.allowsFullSwipe,false);assert.equal(rows[0].props.children[0].type,'NavigationLink');assert.equal(rows[0].props.children[0].props.destination.type,app.WidgetNamePage)
  each.props.onMove([0],4);assert.deepEqual(ids(api.managementAccounts()),[accounts[1].id,accounts[2].id,accounts[3].id,accounts[0].id]);each.props.onMove([0],4);await flush() // stale remote snapshot rejected
  if(s!=='official'){assert.equal(reloads,1);assert.equal(calls.length,0);assert.equal(presentations.length,7)}
  // Reset order and verify multi-index ORIGINAL destination semantics; edit metadata survives render.
  api.saveAccountOrder(ids(accounts),s);tree=render();find(tree,'ForEach').props.onMove([0,2],4);await flush();assert.deepEqual(ids(api.managementAccounts()),[accounts[1].id,accounts[3].id,accounts[0].id,accounts[2].id]);assert.ok(find(render(),'EditButton'))
  const before=ids(api.managementAccounts());for(const args of [[[0,0],2],[[-1],2],[[.5],2],[[99],0],[[0],1.5],[[],2]])find(render(),'ForEach').props.onMove(...args);assert.deepEqual(ids(api.managementAccounts()),before)
  if(s==='official'){
   assert.equal(api.hideAccount(accounts[0].id,s),false);assert.deepEqual(Array.from(api.hiddenAccountIds(s)),[])
  }else{
   api.saveAccountOrder(ids(accounts),s);tree=render();const oldDetail=swipes(tree)[1].props.children[0].props.destination;const full=JSON.stringify(store.get(cacheKey(s)));await swipes(tree)[1].props.trailingSwipeActions.actions[0].props.action();assert.equal(JSON.stringify(store.get(cacheKey(s))),full);assert.deepEqual(ids(api.cachedAccounts()),[accounts[0].id,accounts[2].id,accounts[3].id]);assert.equal(api.widgetAccounts(accounts,'2')[0].id,accounts[2].id);widgets(accounts);assert.equal(calls.length,0)
   const current=render();find(current,'ForEach').props.onMove([0],3);await flush();assert.deepEqual(store.get('ai_usage_'+s+'_order_v1'),[accounts[2].id,accounts[1].id,accounts[3].id,accounts[0].id],'hidden slot retained in canonical order')
   // Old hidden detail cannot save a new alias or run any network request.
   const savedStates=states;states=[];hook=0;await button(walk(oldDetail),'保存').props.action();states=savedStates;assert.equal(api.getWidgetName(accounts[1].id,s),'');assert.equal(calls.length,0)
   for(const row of swipes(render()))await row.props.trailingSwipeActions.actions[0].props.action();assert.equal(api.cachedAccounts().length,0);tree=render();assert.equal(swipes(tree).length,0);assert.ok(tree.includes('账号已全部在本机隐藏，可恢复；服务器账号未删除。'));assert.equal(find(tree,'EditButton'),undefined);assert.ok(button(tree,'恢复全部隐藏账号（4）'));widgets(accounts);assert.equal(calls.length,0)
   const action=button(tree,'恢复全部隐藏账号（4）').props.action;await action();assert.deepEqual(ids(api.cachedAccounts()),[accounts[2].id,accounts[1].id,accounts[3].id,accounts[0].id]);assert.equal(api.hiddenAccountIds(s).length,0);assert.ok(!render().some(n=>n?.props?.title?.startsWith('恢复全部')));assert.equal(calls.length,0)
   assert.ok(kc.get(s==='parrot'?'parrot_management_key':'ai_usage_sub2api_admin_key_v1'),'management config retained')
  }
 }
 console.log('PASS 3-source native EditButton/ForEach+swipe+detail rows; original-offset and multi-index moves/invalid-index guards; remote local-only hide/restore-all, multiple/all-hidden empty state, canonical cache/order/config retained; App and 7 widget families x numeric parameters agree, no network')
 // Fallback long-press callbacks use post-removal destination offsets, not SwiftUI offsets.
 for(const s of ['official','parrot','sub2api']){
  const accounts=seed(s);native=false;delete modules['index.tsx'];app=load('index.tsx');localReloads();if(s==='official')api.requestLocalWidgetProjection(s);const tree=render();assert.equal(find(tree,'EditButton'),undefined);assert.equal(find(tree,'ForEach'),undefined);const link=tree.find(n=>n?.type==='NavigationLink'&&n.props.destination?.type===app.AccountOrderPage);assert.ok(link);const ordered=walk(link.props.destination),reorder=find(ordered,'ReorderableForEach');assert.ok(reorder);reorder.props.onMove([0],2);await flush();assert.deepEqual(ids(api.managementAccounts()),[accounts[1].id,accounts[2].id,accounts[0].id,accounts[3].id]);if(s!=='official')assert.equal(calls.length,0);api.saveSource(s==='parrot'?'sub2api':'parrot');const snapshot=JSON.stringify(store.get('ai_usage_'+s+'_order_v1'));reorder.props.onMove([0],1);assert.equal(JSON.stringify(store.get('ai_usage_'+s+'_order_v1')),snapshot)
 }
 console.log('PASS 3-source capability fallback keeps swipe/detail and long-press ordering; post-removal offsets and late-source guard')
 for(const s of ['parrot','sub2api']){
  const accounts=seed(s);localReloads();api.hideAccount(accounts[3].id,s);let release;const base=network(s);handler=async(u,o)=>{const result=await base(u,o);if((u.includes('/accounts?lite')||u.includes('/oauth/accounts?'))&&!release)await new Promise(resolve=>release=resolve);return result}
  const started=button(render(),'刷新').props.action();await flush();assert.ok(release);const busyTree=render(),before=JSON.stringify([...store]);find(busyTree,'ForEach').props.onMove([0],3);const hide=swipes(busyTree)[0].props.trailingSwipeActions.actions[0],restore=button(busyTree,'恢复全部隐藏账号（1）');assert.equal(hide.props.disabled,true);assert.equal(restore.props.disabled,true);await hide.props.action();await restore.props.action();assert.equal(JSON.stringify([...store]),before);release();await started
  const staleTree=render(),staleRow=swipes(staleTree)[0],staleRestore=button(staleTree,'恢复全部隐藏账号（1）'),staleMove=find(staleTree,'ForEach');api.saveSource(s==='parrot'?'sub2api':'parrot');const snap=JSON.stringify([...store]);await staleRow.props.trailingSwipeActions.actions[0].props.action();await staleRestore.props.action();staleMove.props.onMove([0],3);assert.equal(JSON.stringify([...store]),snap)
 }
 console.log('PASS native editing metadata retained; active refresh disables local swipe/restore/move; old source callbacks cannot mutate either source')
 for(const s of ['parrot','sub2api']){
  const accounts=seed(s);localReloads();api.saveStatisticsSource(s);api.hideAccount(accounts[1].id,s);api.hideAccount(accounts[3].id,s);api.saveVisibleAccountOrder([accounts[2].id,accounts[0].id],s);const other=s==='parrot'?'sub2api':'parrot';api.saveSource(other);store.set(cacheKey(other),usage(accounts));assert.deepEqual(ids(api.cachedAccounts()),ids(accounts),'same stable IDs isolated by source');assert.equal(api.cachedLocalWidgetProjection(),null,'local reload marker must not cross sources');api.saveSource(s)
  handler=network(s);const r=await api.loadUsage();assert.deepEqual(ids(r.data.accounts),[accounts[2].id,accounts[0].id]);assert.equal(store.get(cacheKey(s)).accounts.length,4);assert.equal(store.get('ai_usage_'+s+'_order_v1').length,4);assert.equal(api.hiddenAccountIds(s).length,2)
  const reads=calls.length;now+=api.getRefreshMinutes()*60000;assert.equal(api.cachedLocalWidgetProjection(),null);await widget.runWidget();assert.ok(calls.length>reads,'planned widget refresh resumes network after local window')
  const snapshot=JSON.stringify(store.get(cacheKey(s)));handler=()=>{throw Error('offline')};const failed=await api.loadUsage();assert.deepEqual(ids(failed.data.accounts),[accounts[2].id,accounts[0].id]);assert.equal(JSON.stringify(store.get(cacheKey(s))),snapshot)
  // Delay the list response, hide while fetching, then release. Late results project latest preferences.
  let release;const base=network(s);handler=async(u,o)=>{const result=await base(u,o);if((u.includes('/accounts?lite')||u.includes('/oauth/accounts?'))&&!release)await new Promise(resolve=>release=resolve);return result};const pending=api.loadUsage();await flush();assert.ok(release);api.hideAccount(accounts[0].id,s);release();const late=await pending;assert.deepEqual(ids(late.data.accounts),[accounts[2].id]);assert.equal(store.get(cacheKey(s)).accounts.length,4)
  // Current source and configuration changes invalidate previously rendered row/detail/order callbacks.
  states=[];let tree=render();const staleRow=swipes(tree)[0],staleRestore=button(tree,'恢复全部隐藏账号（3）'),staleMove=find(tree,'ForEach');const oldDetail=staleRow.props.children[0].props.destination,oldScope=api.accountScope(s)
  if(s==='parrot')api.saveConfig('https://new-parrot.example','FIXTURE-KEY');else api.saveSub2APIConfig('https://new-sub.example','FIXTURE-KEY','Asia/Shanghai');assert.equal(api.hiddenAccountIds(s).length,0);assert.equal(api.cachedLocalWidgetProjection(),null);assert.notEqual(api.accountScope(s),oldScope);store.set(cacheKey(s),usage(accounts));api.hideAccount(accounts[0].id,s);const before=JSON.stringify([...store]);await staleRow.props.trailingSwipeActions.actions[0].props.action();await staleRestore.props.action();staleMove.props.onMove([0],1);assert.deepEqual(Array.from(api.hiddenAccountIds(s)),[accounts[0].id]);assert.equal(api.hideAccount(accounts[2].id,s,oldScope),false);assert.equal(api.restoreHiddenAccounts(s,oldScope),false)
  assert.equal(before,JSON.stringify([...store]));
  // A stale NavigationLink opened only after config changed also carries its old scope.
  { const savedStates=states;states=[];hook=0;const stalePage=walk(oldDetail);find(stalePage,'TextField').props.onChanged('Must not cross deployment');hook=0;await button(walk(oldDetail),'保存').props.action();states=savedStates;assert.equal(api.getWidgetName(accounts[2].id,s),'') }

  // Open detail BEFORE another config change, then invoke save from that old tree.
  states=[];hook=0;const detail=app.WidgetNamePage({account:accounts[2],source:s,onSaved:()=>{throw Error('stale detail saved')}}),detailTree=walk(detail);find(detailTree,'TextField').props.onChanged('Must not save');hook=0;const rerendered=walk(app.WidgetNamePage({account:accounts[2],source:s,onSaved:()=>{throw Error('stale detail saved')}}));if(s==='parrot')api.saveConfig('https://third.example','FIXTURE-KEY');else api.saveSub2APIConfig('https://third.example','FIXTURE-KEY','Asia/Shanghai');store.set(cacheKey(s),usage(accounts));await button(rerendered,'保存').props.action();assert.equal(api.getWidgetName(accounts[2].id,s),'')
  // ABA config race: even returning to the original URL/key cannot resurrect old full cache.
  states=[];handler=async(u,o)=>{const result=await base(u,o);if((u.includes('/accounts?lite')||u.includes('/oauth/accounts?')))await new Promise(resolve=>release=resolve);return result};release=null;const old=api.loadUsage();await flush();assert.ok(release);if(s==='parrot'){api.saveConfig('https://temporary.example','FIXTURE-KEY');api.saveConfig('https://third.example','FIXTURE-KEY')}else{api.saveSub2APIConfig('https://temporary.example','FIXTURE-KEY','Asia/Shanghai');api.saveSub2APIConfig('https://third.example','FIXTURE-KEY','Asia/Shanghai')}release();assert.equal((await old).data,null);assert.equal(store.has(cacheKey(s)),false)
  // Clear config cleans hiding; identical config save is stable and does not lose preferences.
  store.set(cacheKey(s),usage(accounts));api.hideAccount(accounts[0].id,s);if(s==='parrot')api.saveConfig('https://third.example','FIXTURE-KEY');else api.saveSub2APIConfig('https://third.example','FIXTURE-KEY','Asia/Shanghai');assert.deepEqual(Array.from(api.hiddenAccountIds(s)),[accounts[0].id]);if(s==='parrot')api.clearConfig();else api.clearSub2APIConfig();assert.equal(api.hiddenAccountIds(s).length,0);assert.equal(api.cachedLocalWidgetProjection(),null)
 }
 console.log('PASS source+deployment isolation, unchanged config retention/changed config cleanup, GET-only refresh and stale fallback retain hiding/full cache; late list response cannot revive hidden rows; old rows/restore/move/details and ABA configuration responses rejected')
 // Official left-swipe still logs out only that local account; not a hidden record.
 const accounts=seed('official',2);localReloads();handler=async(u,o)=>u.endsWith(':loadCodeAssist')?ok({cloudaicompanionProject:'fixture'}):u.endsWith(':retrieveUserQuotaSummary')?ok({groups:[]}):(()=>{throw Error('offline stats')})();const tree=render();await swipes(tree)[0].props.trailingSwipeActions.actions[0].props.action();assert.deepEqual(ids(api.officialAccounts()),[accounts[1].id]);assert.deepEqual(Array.from(api.hiddenAccountIds('official')),[]);assert.deepEqual(ids(api.cachedAccounts()),[accounts[1].id]);console.log('PASS actual official destructive swipe retains local logout, other credentials/cache survive; never converts official removal to hiding')
 // All child entries must stay on the root native stack, never present another modal.
 const shown=[];let exited=0
 scripting.Navigation.present=async options=>{shown.push(options)}
 scripting.Script={exit:()=>{exited++}}
 for(const source of ['official','parrot','sub2api']){
  seed(source,2);native=false;delete modules['index.tsx'];app=load('index.tsx');localReloads()
  const tree=render(),links=tree.filter(n=>n?.type==='NavigationLink')
  assert.equal(links.length,3,'two account details plus fallback sort')
  assert.equal(links.filter(n=>n.props.destination.type===app.WidgetNamePage).length,2)
  assert.equal(links.filter(n=>n.props.destination.type===app.AccountOrderPage).length,1)
  assert.equal(tree.filter(n=>n?.type==='NavigationStack').length,1,'children inherit the root stack')
  assert.equal(shown.length,0,'opening native destinations does not present independent modals')
 }
 await app.runApp();assert.equal(shown.length,1);assert.equal(shown[0].modalPresentationStyle,'fullScreen');assert.equal(exited,1)
 const sourceText=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
 assert.ok(!sourceText.includes('DragGesture')&&!sourceText.includes('FullScreenLink'),'no custom swipe-dismiss recognizer')
 console.log('PASS native NavigationLink children on one root stack across all sources; full-screen root retained; no custom swipe dismissal; device must verify interactive animation')
 console.log('PASS account visibility suite complete; production TS/TSX, no real network/credentials; not native gesture/pixel proof')
}
main().catch(e=>{console.error(e);process.exitCode=1})
