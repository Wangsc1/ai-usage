// Independent real production API/widget/diagnostic-page execution, entirely synthetic host.
const assert=require('node:assert/strict')
const {host,data,flush}=require('./widget-stability.cjs')
const HISTORY='ai_usage_widget_diagnostic_history_v1'
const rows=h=>h.api.readWidgetDiagnostics()
const flat=n=>n==null?[]:Array.isArray(n)?n.flatMap(flat):typeof n!=='object'?[n]:[n,...flat(n.props?.children)]
const text=n=>JSON.stringify(n)
async function main(){
 const unhandled=[],onReject=e=>unhandled.push(e);process.on('unhandledRejection',onReject)
 {
  const h=host({cached:data()});h.setHandler(()=>new Promise(()=>{}));const task=h.run()
  // Startup evidence exists synchronously, even before asynchronous load begins.
  assert.equal(rows(h).length,1);assert.equal(rows(h)[0].phase,'load');assert.equal(rows(h)[0].outcome,'pending');assert.equal(rows(h)[0].beforePresent,false)
  const id=rows(h)[0].id;await flush();assert.equal(rows(h)[0].id,id)
  let before;const original=h.scripting.Widget.present;h.scripting.Widget.present=(...args)=>{before=rows(h)[0];return original(...args)}
  await h.tick();await task
  const entry=rows(h)[0];assert.equal(rows(h).length,1,'all stages update one invocation');assert.equal(entry.id,id);assert.equal(entry.errorType,'timeout');assert.equal(entry.elapsedMs,15000)
  assert.equal(before.beforePresent,true);assert.equal(before.returned,false,'pre-present evidence persisted before native call');assert.equal(entry.returned,true,'only records synchronous native return, not rendering success');assert.equal(entry.scriptVersion,'1.54');assert.equal(entry.family,'systemSmall')
 }
 {
  const h=host({cached:data(),local:true});const snapshots=[];const start=h.api.beginWidgetDiagnostic('systemMedium',Date.now());snapshots.push(rows(h)[0]);start.stage('cache');snapshots.push(rows(h)[0]);start.stage('prepare');snapshots.push(rows(h)[0])
  assert.deepEqual(snapshots.map(x=>x.phase),['init','cache','prepare']);assert.equal(new Set(snapshots.map(x=>x.id)).size,1)
 }
 {
  const h=host({cached:data(),local:true});h.fault('deferred',true);for(let i=0;i<13;i++){h.scripting.Widget.family=['systemSmall','systemMedium','systemLarge','accessoryCircular'][i%4];await h.run()}
  assert.equal(rows(h).length,10);assert.ok(new Set(rows(h).map(x=>x.family)).size>1);assert.equal(new Set(rows(h).map(x=>x.id)).size,10);assert.ok(rows(h).every(x=>x.beforePresent&&x.returned),JSON.stringify(rows(h)));assert.equal(h.presents.length,13)
 }
 for(const fault of ['store','key','present']){
  const h=host({cached:data()});if(fault==='store')h.fault('store','ai_usage_refresh_minutes_v1');if(fault==='key')h.fault('key','*');if(fault==='present')h.fault('present',true)
  await h.run();assert.equal(h.presents.length,1);assert.equal(rows(h).length,1);assert.equal(rows(h)[0].errorType,fault==='present'?'present_error':'runtime');assert.equal(rows(h)[0].returned,fault!=='present')
 }
 {
  const h=host({registerFail:true});await h.run();assert.equal(rows(h)[0].errorType,'intent_init');assert.equal(rows(h)[0].beforePresent,true)
 }
 {
  const h=host({cached:data(),local:true});h.fault('diagnostic',true);await h.run();assert.equal(h.presents.length,1);assert.deepEqual(Array.from(rows(h)),[],'failed diagnostic writes never block present')
 }
 {
  const h=host({cached:data(),local:true});h.fault('store',HISTORY);await h.run();assert.equal(h.presents.length,1,'history read failure does not block widget')
 }
 {
  const h=host();const secret='SECRET token https://example.invalid/?key=PRIVATE account-name'
  const d=h.api.beginWidgetDiagnostic(secret,1800000000000)
  d.stage(secret);d.result({phase:secret,outcome:secret,errorType:secret,elapsedMs:Infinity,token:secret});d.beforePresent();d.returned()
  assert.ok(!text(h.store.get(HISTORY)).includes('SECRET'));assert.ok(!text(h.store.get(HISTORY)).includes('PRIVATE'));assert.equal(rows(h)[0].family,'未知');assert.equal(rows(h)[0].phase,'init');assert.equal(rows(h)[0].errorType,'runtime')
  const allowed=['id','scriptVersion','startedAt','family','phase','outcome','errorType','elapsedMs','beforePresent','returned','legacy'].sort();assert.deepEqual(Object.keys(h.store.get(HISTORY)[0]).sort(),allowed)
  h.store.set(HISTORY,[{...rows(h)[0],id:'123',url:secret,phase:secret,family:secret,scriptVersion:secret}]);assert.ok(!text(rows(h)).includes('SECRET'),'reading existing entries strips unknown fields and invalid enums')
  h.api.recordWidgetDiagnostic({version:1,phase:secret,outcome:secret,errorType:secret,elapsedMs:NaN});assert.ok(!text(h.store.get('ai_usage_widget_diagnostic_v1')).includes('SECRET'))
 }
 {
  const h=host();h.store.set('ai_usage_widget_diagnostic_v1',{version:1,phase:'load',elapsedMs:15000,outcome:'cache',errorType:'timeout'})
  const old=rows(h)[0];assert.equal(old.legacy,true);assert.equal(old.scriptVersion,'1.52');assert.equal(old.startedAt,null);assert.equal(old.family,'未知');assert.equal(old.beforePresent,false)
  assert.equal(h.api.widgetDiagnosticTime(Date.UTC(2026,9,24,1,2,3)),'2026-10-24 09:02:03 北京时间');assert.match(h.api.widgetDiagnosticTime(null),/未记录/);assert.equal(h.api.widgetDiagnosticTime(NaN),'时间不可用')
 }
 // Render actual production TSX page + invoke its actual local refresh action. No app/root execution.
 {
  const h=host();let state=[],cursor=0,reads=0,reloads=0
  h.scripting.useState=initial=>{const slot=cursor++;if(!(slot in state))state[slot]=initial;return[state[slot],v=>state[slot]=v]}
  h.scripting.Widget.reloadAll=()=>{reloads++;throw Error('must not reload')}
  h.fault('key','*');h.setHandler(()=>{throw Error('must not fetch')})
  const page=h.load('widget_diagnostics.tsx').WidgetDiagnosticsPage
  const render=()=>{cursor=0;reads++;return h.expand({type:page,props:{}})}
  let tree=render();assert.equal(tree.type,'Form');assert.equal(tree.props.navigationTitle,'组件诊断');assert.ok(!flat(tree).some(x=>x?.type==='NavigationStack'||x?.type==='NavigationLink'),'page inherits root stack without modal or nested stack')
  assert.ok(text(tree).includes('暂无可读记录'));assert.ok(text(tree).includes('缺少返回不等于失败'));assert.ok(text(tree).includes('不能证明未启动'))
  h.api.beginWidgetDiagnostic('systemLarge',1800000000000).beforePresent()
  // h.expand hides callback functions; inspect real production page element to invoke actual action.
  cursor=0;let raw=page();const button=flat(raw).find(x=>x?.type==='Button'&&x.props.title==='刷新本地记录');assert.equal(typeof button.props.action,'function');button.props.action();tree=render();assert.ok(text(tree).includes('systemLarge'));assert.ok(text(tree).includes('到达present前：是'));assert.ok(text(tree).includes('不等于失败'))
  assert.equal(h.calls.length,0);assert.equal(h.keyReads.length,0);assert.equal(reloads,0);assert.equal(h.presents.length,0);assert.equal(reads,2)
  h.store.delete(HISTORY);h.store.set('ai_usage_widget_diagnostic_v1',{version:1,phase:'load',elapsedMs:500,outcome:'cache',errorType:'none'});cursor=0;raw=page();flat(raw).find(x=>x?.type==='Button').props.action();tree=render();assert.ok(text(tree).includes('旧记录'));assert.ok(text(tree).includes('时间未记录'))
 }
 await new Promise(r=>setImmediate(r));process.removeListener('unhandledRejection',onReject);assert.deepEqual(unhandled,[])
 console.log('PASS production widget diagnostics: correlated early/stage/result/pre-present/return evidence, 10 executions/multiple families, exceptions, redacted fixed fields, failed Storage writes/reads, 1.52 legacy, Beijing time; actual TSX local refresh is read-only with zero network/Keychain/reloads and native inherited navigation; no rendering-success claim')
}
main().catch(e=>{console.error(e);process.exitCode=1})
