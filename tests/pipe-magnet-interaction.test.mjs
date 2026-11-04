import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPipeEndpointDrag} from '../dist/pipe-magnets.js';

// A small event surface keeps release-only pointer sequences reproducible without
// a browser generating additional pointermove events on the test's behalf.
class EventSurface {
  handlers = new Map();
  dataset = {};
  children = [];
  classList = {add(){},remove(){}};
  addEventListener(type, listener) {
    const listeners=this.handlers.get(type)||[];listeners.push(listener);this.handlers.set(type,listeners);
  }
  fire(type, values={}) {
    const event={button:0,pointerId:1,clientX:0,clientY:0,target:null,
      preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};
    for(const listener of this.handlers.get(type)||[])listener(event);
    return event;
  }
  append(value){this.children.push(value);}
  replaceChildren(){this.children=[];}
  setAttribute(){}
}
const matrix={a:1,b:0,c:0,d:1,e:0,f:0,inverse(){return this;}};
class PointerPosition {
  constructor(x,y){this.x=x;this.y=y;}
  matrixTransform(){return this;}
}
const port=(owner,side)=>({dataset:{owner,port:side},closest(selector){return selector==='[data-port]'?this:null;}});
const outer=owner=>({closest(selector){
  if(selector==='.joint-hit,.joint-dot')return this;
  if(selector==='[data-node]')return {dataset:{node:owner}};
  return null;
}});
const fixture=()=>({title:'管端互動回歸',nodes:[
  {id:'feed',type:'ground',x:0,y:100,enabled:true,fuel:'diesel'},
  {id:'loose',type:'point',x:120,y:100},
  {id:'valve',type:'valve',x:250,y:100,open:false},
  {id:'end',type:'outlet',x:450,y:100}
],edges:[
  {id:'supply',from:{node:'feed',port:'port'},to:{node:'loose',port:'joint'},routing:'free',waypoints:[],kind:'bridge',layer:7},
  {id:'tail',from:{node:'valve',port:'out'},to:{node:'end',port:'in'}}
]});

const environments=new WeakMap();
function harness(t, initial=fixture()) {
  let environment=environments.get(t);
  if(!environment){
    const saved=new Map(['document','window','DOMPoint'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
    const document=new EventSurface(),window=new EventSurface();
    document.createElementNS=()=>new EventSurface();
    environment={document,window};environments.set(t,environment);
    Object.assign(globalThis,{document,window,DOMPoint:PointerPosition});
    t.after(()=>{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  }
  const {document,window}=environment,svg=new EventSurface(),layer=new EventSurface(),capture=new Set();
  svg.querySelector=selector=>selector==='#pipeMagnetLayer'?layer:null;
  svg.querySelectorAll=()=>[];svg.getScreenCTM=()=>matrix;
  svg.setPointerCapture=id=>capture.add(id);svg.hasPointerCapture=id=>capture.has(id);svg.releasePointerCapture=id=>capture.delete(id);
  let state=structuredClone(initial),mode='edit',pending=null;
  const commits=[],cancels=[],clicks=[],selections=[],messages=[];
  const controller=setupPipeEndpointDrag({svg,getMode:()=>mode,getPending:()=>pending,getProject:()=>state,
    onPreview:next=>{state=next;},onCommit:(before,next,info)=>{commits.push({before,next,info});state=next;},
    onCancel:before=>{cancels.push(before);state=before;},onClick:(...args)=>clicks.push(args),
    onSelect:(...args)=>selections.push(args),notify:message=>messages.push(message)});
  const pointer=(type,target,x,y,extra={})=>svg.fire(type,{target,clientX:x,clientY:y,...extra});
  return {pointer,controller,commits,cancels,clicks,selections,messages,document,window,
    state:()=>state,setMode:value=>{mode=value;},setPending:value=>{pending=value;}};
}

test('outer free endpoint drag creates an actual valve connection; shared junction body is ignored',t=>{
  const h=harness(t),target=outer('loose');
  assert.equal(h.pointer('pointerdown',target,128,100).stopped,true);
  assert.equal(h.controller.active,true);
  h.pointer('pointerup',target,229,100);
  assert.equal(h.commits.length,1);assert.equal(h.commits[0].info.connected,true);
  assert.deepEqual(h.state().edges.find(e=>e.id==='supply').to,{node:'valve',port:'in'});
  assert.equal(h.state().nodes.some(n=>n.id==='loose'),false);
  assert.equal(h.state().edges.find(e=>e.id==='supply').layer,7);

  const shared=fixture();shared.edges.push({id:'branch',from:{node:'loose',port:'joint'},to:{node:'end',port:'in'}});
  const other=harness(t,shared);
  assert.equal(other.pointer('pointerdown',outer('loose'),128,100).stopped,undefined);
  assert.equal(other.controller.active,false);assert.deepEqual(other.state(),shared);
});

test('stationary center click draws while stationary outer press selects without graph edits',t=>{
  const h=harness(t),before=structuredClone(h.state());
  h.pointer('pointerdown',port('loose','joint'),120,100);
  h.pointer('pointerup',port('loose','joint'),122,100);
  assert.deepEqual(h.clicks,[['loose','joint']]);assert.deepEqual(h.selections,[]);
  h.pointer('pointerdown',outer('loose'),128,100);
  h.pointer('pointerup',outer('loose'),129,100);
  assert.deepEqual(h.selections,[['loose','joint']]);assert.equal(h.commits.length,0);
  assert.deepEqual(h.state(),before);
});

test('release recomputes magnetic target both when entering and leaving its radius',t=>{
  const entering=harness(t),target=port('loose','joint');
  entering.pointer('pointerdown',target,120,100);
  entering.pointer('pointermove',target,180,100);
  entering.pointer('pointerup',target,221,100);
  assert.deepEqual(entering.state().edges.find(e=>e.id==='supply').to,{node:'valve',port:'in'});
  assert.equal(entering.commits[0].info.connected,true);

  const leaving=harness(t);
  leaving.pointer('pointerdown',target,120,100);
  leaving.pointer('pointermove',target,221,100);
  leaving.pointer('pointerup',target,221,140);
  assert.equal(leaving.commits[0].info.connected,false);
  assert.deepEqual(leaving.state().edges.find(e=>e.id==='supply').to,{node:'loose',port:'joint'});
  assert.deepEqual(leaving.state().nodes.find(n=>n.id==='loose'),{id:'loose',type:'point',x:221,y:140});
});

test('outer grabbing preserves offset and a displaced release works without pointermove',t=>{
  const h=harness(t),target=outer('loose');
  h.pointer('pointerdown',target,128,106);
  h.pointer('pointerup',target,188,146);
  assert.equal(h.commits.length,1);assert.equal(h.commits[0].info.connected,false);
  assert.deepEqual(h.state().nodes.find(n=>n.id==='loose'),{id:'loose',type:'point',x:180,y:140});
  assert.equal(h.clicks.length,0);assert.equal(h.selections.length,0);
});

test('invalid final standalone fit cancels rather than committing a stale valid preview',t=>{
  const initial={nodes:[{id:'pipe',type:'pipe',x:100,y:100,length:160,rotation:0}],edges:[]};
  const h=harness(t,initial),target=port('pipe','out');
  h.pointer('pointerdown',target,180,100);
  h.pointer('pointermove',target,300,100);
  assert.notDeepEqual(h.state(),initial);
  h.pointer('pointerup',target,22,100);
  assert.equal(h.commits.length,0);assert.equal(h.cancels.length,1);
  assert.deepEqual(h.state(),initial);assert.match(h.messages[0],/端點位置無效/);
});

test('cancel and a locked or pending drawing cannot leave partial endpoint changes',t=>{
  const h=harness(t),before=structuredClone(h.state()),target=outer('loose');
  h.pointer('pointerdown',target,128,100);h.pointer('pointermove',target,188,140);
  h.document.fire('keydown',{key:'Escape'});
  assert.equal(h.controller.active,false);assert.equal(h.commits.length,0);assert.deepEqual(h.state(),before);
  h.setMode('sim');h.pointer('pointerdown',target,128,100);assert.equal(h.controller.active,false);
  h.setMode('edit');h.setPending({node:'feed',port:'port'});h.pointer('pointerdown',target,128,100);assert.equal(h.controller.active,false);
});
