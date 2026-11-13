// Documented host test adapter only: Observable notifications + post-render effects + modern ForEach validation.
const assert = require('node:assert/strict')
let pending = [], cleanups = [], rendering = false, notifications = 0
function observable(initial) {
  const listeners = new Set()
  return {value: typeof initial === 'function' ? initial() : initial,
    setValue(next) { assert.equal(rendering, false, 'setValue must not run during render'); const old=this.value;this.value=next;notifications++;for(const fn of [...listeners])fn(next,old) },
    subscribe(fn){listeners.add(fn)},unsubscribe(fn){listeners.delete(fn)},listenerCount(){return listeners.size},
  }
}
function effect(fn) {if(fn.name!=='syncAccountRows')return false;pending.push(fn);return true}
function render(fn) {rendering=true;let value;try{value=fn()}finally{rendering=false}flush();return value}
function flush(){if(!pending.length)return;for(const fn of cleanups)fn();cleanups=[];const jobs=pending;pending=[];for(const fn of jobs){const clean=fn();if(typeof clean==='function')cleanups.push(clean)}}
function rows(props) {
  for(const key of ['count','itemBuilder','onMove','onDelete'])assert.equal(key in props,false,'ForEach.'+key+' is deprecated/not part of modern API')
  assert.ok(props.data && Array.isArray(props.data.value),'ForEach.data must be Observable<T[]>')
  assert.equal(typeof props.data.setValue,'function');assert.equal(typeof props.builder,'function');assert.equal(props.editActions,'move')
  const data=props.data.value;assert.equal(new Set(data.map(x=>x.id)).size,data.length)
  return data.map((item,index)=>{assert.equal(typeof item.id,'string');return props.builder(item,index)})
}
// Test a system move by updating data, never by inventing an onMove callback in the modern schema.
function move(props,indices,offset){rows(props);const old=props.data.value
  if(!indices.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=old.length)||!Number.isInteger(offset))return
  const next=old.filter((_,i)=>!indices.includes(i)),moving=indices.map(i=>old[i]);next.splice(Math.max(0,Math.min(offset-indices.filter(i=>i<offset).length,next.length)),0,...moving);props.data.setValue(next)
}
function unmount(){for(const clean of cleanups)clean();cleanups=[];pending=[]}
module.exports={observable,effect,render,flush,rows,move,unmount,notifications:()=>notifications}
