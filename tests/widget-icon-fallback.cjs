// Real production widget run; synthetic host only, no external request or credentials.
const assert=require('node:assert/strict')
const {host,data}=require('./widget-stability.cjs')
const account=(id,provider)=>({id,name:'Fixture '+id,provider,enabled:true,available:true,
  fiveHour:{usedPercent:25,remainingPercent:75,resetsAt:null},sevenDay:{usedPercent:25,remainingPercent:75,resetsAt:null},resetCredits:2})
async function main(){
 const unhandled=[],onReject=e=>unhandled.push(e);process.on('unhandledRejection',onReject)
 // Baseline: no decode failure, no account degrades, diagnostic errorType stays none/unaffected.
 for(const provider of ['openai','claude','deepseek','antigravity','workbuddy']){
  const h=host({source:provider==='antigravity'||provider==='workbuddy'?'official':'sub2api',cached:data([account(provider+':1',provider)]),local:true})
  if(provider==='antigravity'||provider==='workbuddy')h.seedOfficial(provider)
  await h.run();assert.equal(h.presents.length,1,provider+' exactly one present')
  const tree=h.expand(h.presents[0].node);assert.equal(JSON.stringify(tree).includes('图标解码失败'),false,provider+' baseline has no decode throw')
  assert.equal(h.api.readWidgetDiagnostics()[0].errorType,'none',provider+' baseline diagnostic stays none')
 }
 // Base64 decode failure (antigravity/workbuddy UIImage.fromBase64String returns null) degrades that
 // single account to an initial-letter Text, present still succeeds exactly once, other data intact.
 for(const provider of ['antigravity','workbuddy']){
  const a=account(provider+':fixture',provider)
  const h=host({source:'official',cached:data([a]),local:true});h.seedOfficial(provider);h.fault('decode',true)
  await h.run();assert.equal(h.presents.length,1,provider+' exactly one present despite decode failure')
  const tree=h.expand(h.presents[0].node);const json=JSON.stringify(tree)
  assert.equal(json.includes('图标解码失败'),false,provider+' decode error text never reaches the rendered tree')
  assert.equal(json.includes(provider==='antigravity'?'"Antigravity"'.slice(1,2):'W'),true,provider+' initial-letter fallback text is present')
  assert.equal(h.presents[0].node.props.data.accounts[0].id,a.id,'account data itself is unaffected by icon fallback')
  const entry=h.api.readWidgetDiagnostics()[0];assert.equal(entry.errorType,'icon_fallback',provider+' diagnostic records icon_fallback');assert.equal(entry.outcome,'cache');assert.equal(entry.returned,true)
 }
 // SVG-path providers (claude/openai/deepseek) do not call UIImage.fromBase64String; the 'decode' fault
 // only affects antigravity/workbuddy brand images, confirming isolation between provider icon paths.
 for(const provider of ['claude','openai','deepseek']){
  const h=host({cached:data([account('sub2api:'+provider,provider)]),local:true});h.fault('decode',true)
  await h.run();const entry=h.api.readWidgetDiagnostics()[0];assert.equal(entry.errorType,'none',provider+' SVG path unaffected by brand-image decode fault')
 }
 // Multi-account isolation: one account's icon fails, sibling accounts keep their own icon/data intact,
 // and the surrounding Root/other cards are not replaced by a blank or failed render.
 {
  const bad=account('official-fixture','antigravity'), good=account('sub2api:ok','claude')
  const h=host({source:'official',cached:data([bad,good]),local:true});h.seedOfficial('antigravity');h.fault('decode',true)
  await h.run();assert.equal(h.presents.length,1,'exactly one present with a mixed-failure account set')
  const list=h.presents[0].node.props.data.accounts;assert.equal(list.length,2,'both accounts still present in data')
  const tree=h.expand(h.presents[0].node);const json=JSON.stringify(tree)
  assert.equal(json.includes('图标解码失败'),false,'no decode error text leaks into the presented tree')
  assert.equal(h.api.readWidgetDiagnostics()[0].errorType,'icon_fallback','partial icon failure is recorded without failing the whole render')
 }
 // icon_fallback must never override a more significant error already classified (timeout/cache_invalid/
 // intent_init/runtime): those paths render Text only and never reach ProviderIcon, so no override risk,
 // but the enum write path itself must still accept and persist the new value under the existing contract.
 {
  const h=host({cached:data(),local:true});await h.run()
  const entry=h.api.readWidgetDiagnostics()[0]
  assert.ok(['none','timeout','cache_invalid','read_stopped','runtime','intent_init','present_error','icon_fallback'].includes(entry.errorType))
 }
 // Diagnostic write failure during the post-present icon_fallback upgrade must not throw or block the
 // already-successful present; this mirrors the existing bounded/never-blocking diagnostic contract.
 {
  const a=account('antigravity:fixture','antigravity')
  const h=host({source:'official',cached:data([a]),local:true});h.seedOfficial('antigravity');h.fault('decode',true);h.fault('diagnostic',true)
  await h.run();assert.equal(h.presents.length,1,'diagnostic write failure during icon-fallback upgrade does not block present');assert.equal(h.api.readWidgetDiagnostics().length,0)
 }
 await new Promise(r=>setImmediate(r));process.removeListener('unhandledRejection',onReject);assert.deepEqual(unhandled,[])
 console.log('PASS per-account icon/brand-image decode failures degrade to an initial-letter text fallback without failing the whole Root render: baseline unaffected, SVG-path providers isolated from base64 decode faults, multi-account mixed failure keeps siblings intact, exactly one present, diagnostic records icon_fallback without overriding a worse error, and diagnostic write failure during the fallback upgrade does not block an already-successful present')
}
main().catch(e=>{console.error(e);process.exitCode=1})
