// Real production widget run; synthetic host only, no external request or credentials.
const assert=require('node:assert/strict')
const {host,data}=require('./widget-stability.cjs')
const DIAG='ai_usage_widget_diagnostic_v1',HISTORY='ai_usage_widget_diagnostic_history_v1'
const allowed=new Set([DIAG,HISTORY])
const families=['systemSmall','systemMedium','systemLarge','systemExtraLarge','accessoryInline','accessoryCircular','accessoryRectangular']
async function main(){
 const unhandled=[],onReject=e=>unhandled.push(e);process.on('unhandledRejection',onReject)
 for(const family of families)for(const failure of ['none','diagnostic-write','storage-read','intent-registration']){
  const h=host({cached:data(),registerFail:failure==='intent-registration'})
  const previous=JSON.stringify([...h.store].filter(([k])=>!allowed.has(k)))
  h.scripting.Widget.family=family;h.scripting.Widget.parameter='diag-text'
  h.fault('decode',true);h.fault('key','*')
  if(failure==='diagnostic-write')h.fault('diagnostic',true)
  if(failure==='storage-read')h.fault('store','*')
  h.setHandler(()=>{throw Error('text control must not start requests')})
  // Fail on attempted complex root children; Text alone is the entire presented tree.
  for(const name of ['Image','SVG','VStack','HStack','ZStack','GeometryReader','Gauge'])h.scripting[name]=()=>{throw Error('text control must not render complex child '+name)}
  await h.run()
  assert.equal(h.presents.length,1,family+' / '+failure+' exactly one present')
  const {node,tree,options}=h.presents[0]
  assert.equal(node.type,'Text');assert.deepEqual(Object.keys(node.props),['children'])
  assert.equal(node.props.children,'AI Usage 纯文字对照');assert.equal(tree.props.children,'AI Usage 纯文字对照')
  assert.equal(options.reloadPolicy.policy,'after');assert.equal(options.reloadPolicy.date.getTime(),1800000000000+15*60000)
  assert.equal(h.calls.length,0,'no fetch');assert.equal(h.keyReads.length,0,'no Keychain');assert.equal(h.timers.size,0,'no deadline/network/background task')
  assert.ok(h.storeReads.every(k=>allowed.has(k)),'only diagnostic Storage may be read: '+JSON.stringify(h.storeReads))
  assert.ok(h.writes.every(x=>allowed.has(x.key)),'only diagnostics may be written')
  assert.equal(JSON.stringify([...h.store].filter(([k])=>!allowed.has(k))),previous,'source, cache, preferences unchanged')
  if(failure==='none'||failure==='intent-registration'){
   const entry=h.api.readWidgetDiagnostics()[0];assert.equal(entry.phase,'text_control');assert.equal(entry.outcome,'text');assert.equal(entry.scriptVersion,'1.54');assert.equal(entry.family,family);assert.equal(entry.beforePresent,true);assert.equal(entry.returned,true);assert.equal(entry.errorType,'none')
  }
 }
 {
  const h=host();h.scripting.Widget.parameter='diag-text';h.fault('present',true);await h.run()
  assert.equal(h.presents.length,1,'native throw must not retry present');const entry=h.api.readWidgetDiagnostics()[0];assert.equal(entry.phase,'text_control');assert.equal(entry.errorType,'present_error');assert.equal(entry.returned,false)
 }
 // Restore this same instance's original numeric parameter; normal loader is reachable again.
 for(const parameter of ['', '1', '1 2', 'diag-text 1']){
  const h=host();h.scripting.Widget.parameter='diag-text';await h.run();assert.equal(h.calls.length,0)
  h.scripting.Widget.parameter=parameter;await h.run()
  assert.equal(h.presents.length,2);assert.ok(h.calls.length>0,'non-exact parameters use unchanged normal loader');assert.ok(h.keyReads.length>0)
  assert.notEqual(h.presents[1].node.type,'Text','normal data is sent to normal Root')
  assert.equal(h.presents[1].node.props.data.accounts[0].id,'sub2api:1');assert.notEqual(h.api.readWidgetDiagnostics()[0].phase,'text_control')
 }
 await new Promise(r=>setImmediate(r));process.removeListener('unhandledRejection',onReject);assert.deepEqual(unhandled,[])
 console.log('PASS exact diag-text production run across seven families: one fixed Text present, zero requests/Keychain/business Storage/Root images/timers; diagnostic write/read failure and caught intent registration failure do not block; native present exception is not retried; restoring parameter resumes normal loader, configurations unchanged')
}
main().catch(e=>{console.error(e);process.exitCode=1})
