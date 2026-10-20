// Production SettingsView + shared browser lifecycle, offline. No protocol/network changes mocked here.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const ts=require(process.env.TYPESCRIPT_PATH||'typescript'),root=path.resolve(__dirname,'..')
let states=[],hook=0,effects=[],source='official',flows=[],accounts=[],instances=[],timers=new Map(),seq=0,mode='pending',rejectLoad,resolveLoad,finishExchange,holdExchange=false,loginError=false,refreshes=0,holdPreparation=false,finishPreparation
const api=new Proxy({
 getSource:()=>source,saveSource:s=>{source=s},officialAccounts:()=>accounts,managementAccounts:()=>accounts,cachedAccounts:()=>[],getConfig:()=>({}),getSub2APIConfig:()=>({}),getStatisticsSource:()=> 'parrot',getRefreshMinutes:()=>30,accountScope:()=>0,hiddenAccountIds:()=>[],claudeCooldownUntil:()=>0,REFRESH_OPTIONS:[],loadUsage:async()=>{refreshes++;return {data:null}},sortAccounts:a=>a,
},{get:(o,k)=>k in o?o[k]: /^begin.*Login$/.test(k)?(...args)=>{const flow={url:'https://fixture.invalid/'+k,consumed:false,cancelled:false,progress:'',callback:args[0]};flows.push(flow);return k==='beginWorkBuddyLogin'?(holdPreparation?new Promise(r=>finishPreparation=()=>r(flow)):Promise.resolve(flow)):flow}: /^cancel.*Login$/.test(k)?d=>{d.cancelled=true}: /^finish.*Login$/.test(k)?async(d,...args)=>{d.consumed=true;if(loginError)throw Error("fixture login network error");const valid=args.at(-1);if(holdExchange)await new Promise(r=>finishExchange=r);if(!d.cancelled&&valid())accounts.push({id:'fixture',provider:'fixture'});}:()=>undefined})
const scripting=new Proxy({Navigation:{useDismiss:()=>()=>{},present:()=>{throw Error('independent presentation forbidden')}},Widget:{reloadAll:async()=>{}},useState:v=>{const i=hook++;if(!(i in states))states[i]=v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect:f=>effects.push(f)},{get:(o,k)=>k in o?o[k]:k})
const context=vm.createContext({console,Map,Set,Promise,Math,Number,Date,
 setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
 WebViewController:class{constructor(options){assert.equal(options.ephemeral,true);this.disposed=0;this.loads=[];instances.push(this)}loadURL(url){this.loads.push(url);if(mode==='false')return Promise.resolve(false);if(mode==='throw')return Promise.reject(Error('fixture load failure'));if(mode==='loaded')return Promise.resolve(true);return new Promise((r,j)=>{resolveLoad=r;rejectLoad=j})}present(){throw Error('modal forbidden')}dismiss(){throw Error('modal forbidden')}dispose(){this.disposed++}},
})
const code=fs.readFileSync(path.join(root,'index.tsx'),'utf8').replace(/\nrun\(\)\s*$/,'\nexport {SettingsView,presentIsolatedAuthorization}')
const out=ts.transpileModule(code,{fileName:'index.tsx',compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'scripting'},reportDiagnostics:true});assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)
const m={exports:{}};vm.runInContext(`(function(require,module,exports){${out.outputText}\n})`,context)(n=>n==='scripting'?scripting:n==='scripting/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'}:api,m,m.exports)
function walk(v,out=[]){if(v==null||v===false)return out;if(Array.isArray(v)){v.forEach(x=>walk(x,out));return out}if(typeof v!=='object'){out.push(v);return out}if(typeof v.type==='function')return walk(v.type(v.props),out);out.push(v);walk(v.props?.children,out);return out}
function render(){hook=0;return walk(m.exports.SettingsView())}
const refreshButton=()=>render().find(n=>n?.type==='Form').props.toolbar.primaryAction
const button=title=>{const b=render().find(n=>n?.type==='Button'&&n.props.title===title);assert.ok(b,title);return b},dest=()=>render().find(n=>n?.type==='Form').props.navigationDestination,flush=async(n=40)=>{while(n--)await Promise.resolve()}
function reset(){states=[];effects=[];source='official';flows=[];accounts=[];instances=[];timers.clear();mode='pending';holdExchange=false;finishExchange=null;loginError=false;rejectLoad=null;resolveLoad=null;refreshes=0;holdPreparation=false;finishPreparation=null}
async function prepare(provider){reset();render().find(n=>n?.type==='Picker'&&n.props.title==='').props.onChanged(provider);await button('添加账号').props.action();if(provider==='workbuddy')assert.ok(!render().some(n=>typeof n==='string'&&n.includes('国内个人账号 · 客户端私有协议')));return flows.at(-1)}
async function main(){
 for(const provider of ['codex','claude','antigravity','workbuddy'])for(const action of ['back','success','false','throw','timeout','loaded','cancel','source','unmount','late-exchange','back-exchange']){
  const flow=await prepare(provider);mode=action==='false'?'false':action==='throw'?'throw':'pending';holdExchange=['late-exchange','back-exchange'].includes(action)||(provider==='workbuddy'&&action!=='success');
  const task=button('点击登录').props.action();await flush();const view=instances.at(-1);assert.ok(view);const binding=dest();if(!['false','throw','success'].includes(action)){assert.equal(binding.isPresented,true);assert.equal(binding.content.type,'WebView');assert.equal(binding.content.props.controller,view);assert.equal(binding.content.props.navigationTitle,'官方授权（临时会话）');assert.equal(binding.content.props.toolbar,undefined);assert.equal(binding.content.props.navigationBarBackButtonHidden,undefined);}assert.equal(view.loads.length,1)
  if(['false','throw'].includes(action)){await task;assert.equal(dest().isPresented,false);assert.ok(render().some(n=>typeof n==='string'&&/失败|重试|fixture load failure/.test(n)))}
  else if(action==='timeout'){assert.equal([...timers.values()][0].ms,20000);[...timers.values()][0].fn();await task;assert.ok(render().some(n=>typeof n==='string'&&n.includes('加载超时')))}
  else if(action==='loaded'){resolveLoad(true);await flush();assert.equal(dest().isPresented,true,'load completion is not authorization');assert.equal(timers.size,0);binding.onChanged(false);await task}
  else if(action==='success'){if(provider!=='workbuddy')flow.callback();await flush();await task;assert.equal(accounts.length,1);assert.equal(dest().isPresented,false,'save automatically pops')}
  else if(action==='back-exchange'){if(provider!=='workbuddy')flow.callback();await flush();assert.ok(finishExchange);binding.onChanged(false);await flush();if(provider!=='workbuddy'){assert.equal(refreshButton().props.disabled,true);const before=refreshes;await refreshButton().props.action();assert.equal(refreshes,before,'exchange blocks actual homepage action')}if(['codex','claude','antigravity'].includes(provider))assert.equal(button('点击登录').props.disabled,true,'back must not unlock an exchange in progress');finishExchange();await task;await flush();assert.equal(accounts.length,['codex','claude','antigravity'].includes(provider)?1:0)}
  else if(action==='late-exchange'){if(provider!=='workbuddy')flow.callback();await flush();assert.ok(finishExchange);button('取消登录').props.action();finishExchange();await task;await flush();assert.equal(accounts.length,0)}
  else {if(action==='back')binding.onChanged(false);if(action==='cancel')button('取消登录').props.action();if(action==='source')await render().find(n=>n?.type==='Picker'&&n.props.title==='账号来源').props.onChanged('sub2api');if(action==='unmount')effects.map(f=>f()).filter(f=>typeof f==='function').forEach(f=>f());if(provider==='workbuddy'){await flush();finishExchange?.()}await task;const count=accounts.length;if(provider!=='workbuddy')flow.callback();await flush();assert.equal(accounts.length,count,'cancelled callback cannot revive authorization');if(action==='back') { assert.equal(render().find(n=>n?.type==='Form').props.toolbar.primaryAction.props.disabled,false,'homepage refresh unlocked after '+provider+' back'); assert.equal(button('添加账号').props.disabled,false) }}
  if(provider==='workbuddy'&&['back','cancel','loaded','back-exchange','late-exchange'].includes(action)){
    assert.equal(flow.cancelled,true,'normal cancellation still terminates poll flow '+action);assert.equal(accounts.length,0)
    assert.ok(!render().some(n=>typeof n==='string'&&n.includes('WorkBuddy登录已取消，请重新登录')))
    assert.ok(!render().some(n=>n?.type==='Text'&&n.props.foregroundStyle==='systemRed'),'normal cancellation has no error row')
    assert.equal(button('添加账号').props.disabled,false,'busy unlocked')
    finishExchange?.();await flush();assert.equal(accounts.length,0,'late poll cannot save after return')
  }
  if(!['source','unmount'].includes(action)){
    assert.equal(refreshButton().props.disabled,false,provider+' '+action+' homepage refresh enabled')
    const before=refreshes;await refreshButton().props.action();assert.equal(refreshes,before+1,provider+' '+action+' actual refresh action runs')
    assert.equal(button('添加账号').props.disabled,false)
    await button('添加账号').props.action();assert.notEqual(flows.at(-1),flow,'a fresh attempt is possible');button('取消登录').props.action();assert.equal(refreshButton().props.disabled,false)
  }
  assert.equal(view.disposed,1,provider+' '+action);assert.equal(timers.size,0);binding.onChanged(false);assert.equal(view.disposed,1,'back notification after release is idempotent');if(rejectLoad)rejectLoad(Error('late load rejection'));await flush()
 }
 // Cancel at prepared screen, without opening WebView, releases every blocking flow ref.
 for(const provider of ['codex','claude','antigravity','workbuddy']){
  const flow=await prepare(provider);assert.equal(refreshButton().props.disabled,true)
  button('取消登录').props.action();assert.equal(flow.cancelled,true);assert.equal(refreshButton().props.disabled,false)
  const count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count+1)
  if(provider!=='workbuddy')flow.callback();await flush();assert.equal(accounts.length,0)
  await button('添加账号').props.action();assert.notEqual(flows.at(-1),flow);button('取消登录').props.action()
 }
 // WorkBuddy preparation is async: cancel/source/unmount before its response cannot revive it.
 for(const action of ['cancel','source','unmount']){
  reset();render().find(n=>n?.type==='Picker'&&n.props.title==='').props.onChanged('workbuddy');holdPreparation=true
  const first=button('添加账号').props.action();await flush();assert.equal(refreshButton().props.disabled,true)
  if(action==='cancel')button('取消登录').props.action()
  if(action==='source')await render().find(n=>n?.type==='Picker'&&n.props.title==='账号来源').props.onChanged('sub2api')
  if(action==='unmount')effects.map(f=>f()).filter(f=>typeof f==='function').forEach(f=>f())
  finishPreparation();await first;assert.equal(flows[0].cancelled,true);assert.equal(accounts.length,0)
  if(action!=='unmount'){assert.equal(refreshButton().props.disabled,false);const count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count+1)}
 }
 // Old completion/browser finally must not unlock or clear a subsequent attempt's exchange/release.
 for(const provider of ['codex','claude','antigravity','workbuddy']){
  const oldFlow=await prepare(provider);holdExchange=true;const oldTask=button('点击登录').props.action();await flush();if(provider!=='workbuddy')oldFlow.callback();await flush();const finishOld=finishExchange
  button('取消登录').props.action();await button('添加账号').props.action();const nextFlow=flows.at(-1);const nextTask=button('点击登录').props.action();await flush();if(provider!=='workbuddy')nextFlow.callback();await flush();const finishNew=finishExchange
  finishOld();await oldTask;await flush();assert.equal(refreshButton().props.disabled,true,provider+' old finally does not clear new busy');const count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count)
  finishNew();await nextTask;await flush();assert.equal(accounts.length,1);assert.equal(nextFlow.cancelled,false);assert.equal(refreshButton().props.disabled,false);assert.ok(instances.every(b=>b.disposed===1))
 }
 // Token-exchange failure retains the page until native back, then permits refresh/new authorization.
 for(const provider of ['codex','claude','antigravity']){
  const flow=await prepare(provider);loginError=true;const task=button('点击登录').props.action();flow.callback();await flush();assert.equal(dest().isPresented,true);dest().onChanged(false);await task
  assert.equal(dest().isPresented,false);assert.equal(instances[0].disposed,1);assert.equal(refreshButton().props.disabled,false);assert.ok(render().includes('fixture login network error'))
  const count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count+1);loginError=false;await button('添加账号').props.action();button('取消登录').props.action()
 }
 // Claude manual fallback has no callback listener: browser return keeps code/state for paste,
 // but no I/O is running. Refresh/new attempt are allowed; consuming that code locks again.
 {
  const flow=await prepare('claude');flow.manual=true;const task=button('点击登录').props.action();dest().onChanged(false);await task
  assert.equal(flow.cancelled,false);assert.equal(refreshButton().props.disabled,false);let count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count+1)
  render().find(n=>n?.type==='SecureField'&&n.props.title==='本次完整授权码').props.onChanged('fixture#state');holdExchange=true
  const exchange=button('完成Claude授权').props.action();await flush();assert.equal(refreshButton().props.disabled,true);count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count)
  finishExchange();await exchange;assert.equal(accounts.length,1);assert.equal(refreshButton().props.disabled,false)
 }
 {
  const flow=await prepare('claude');flow.manual=true;const task=button('点击登录').props.action();dest().onChanged(false);await task
  await button('添加账号').props.action();assert.equal(flow.cancelled,true);assert.notEqual(flows.at(-1),flow);button('取消登录').props.action();assert.equal(refreshButton().props.disabled,false)
 }
 for(const provider of ['codex','claude','antigravity','workbuddy'])for(const change of ['source','unmount']){
  const flow=await prepare(provider);holdExchange=true;const task=button('点击登录').props.action();await flush();if(provider!=='workbuddy')flow.callback();await flush();const finish=finishExchange
  if(change==='source')await render().find(n=>n?.type==='Picker'&&n.props.title==='账号来源').props.onChanged('sub2api')
  else effects.map(f=>f()).filter(f=>typeof f==='function').forEach(f=>f())
  finish();await task;await flush();assert.equal(accounts.length,0);assert.ok(instances.every(b=>b.disposed===1));if(change==='source'){assert.equal(refreshButton().props.disabled,false);const count=refreshes;await refreshButton().props.action();assert.equal(refreshes,count+1)}
 }
 // Real login/poll errors, unlike the internal cancellation sentinel, remain visible.
 await prepare('workbuddy');loginError=true;const failed=button('点击登录').props.action();await failed;assert.ok(render().includes('fixture login network error'));assert.equal(flows[0].cancelled,true);assert.equal(instances[0].disposed,1);assert.equal(button('添加账号').props.disabled,false)
 // A synchronous native push failure still cleans up the isolated controller.
 reset();await assert.rejects(()=>m.exports.presentIsolatedAuthorization(undefined,'https://fixture.invalid/',()=>{throw Error('push failed')}),/push failed/);assert.equal(instances[0].disposed,1);assert.equal(timers.size,0)
 // A late cleanup from the previous destination must not pop a subsequent attempt.
 await prepare('codex');let first=button('点击登录').props.action();const old=dest();old.onChanged(false);await first;await button('添加账号').props.action();const second=button('点击登录').props.action();old.onChanged(false);assert.equal(dest().isPresented,true);dest().onChanged(false);await second;assert.notEqual(instances[0],instances[1]);assert.ok(instances.every(b=>b.disposed===1))
 console.log('PASS homepage actual refresh/new-login after four-provider native back/cancel/failure/preparation cancel; manual fallback paste retained without IO lock; consumed exchange blocks refresh; old finally/source/unmount/late callback cannot override new busy or save')
 console.log('PASS WorkBuddy normal return/cancel silent, old explanatory Text removed, poll cancellation/late-save protection retained, genuine loading/timeout/login errors visible')
 console.log('PASS four provider production TSX native navigationDestination/WebView push, no modal/custom back; immediate display with pending load, success pop, native back unlock, failure/timeout, isolated sessions, exactly-once dispose, source/unmount/cancel/late exchange and callbacks, stale destination isolation')
}
main().catch(e=>{console.error(e);process.exitCode=1})
