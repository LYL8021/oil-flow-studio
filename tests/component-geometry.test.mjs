import test from 'node:test';
import assert from 'node:assert/strict';
import {componentPort,nodeScale,maxNodeScale,normalizeAngle,normalizeTankPorts} from '../dist/component-geometry.js';
import {copyComponent,pasteComponent} from '../dist/component-clipboard.js';

test('legacy tank outlet retains its position while a separate inlet becomes available',()=>{
 const tank={type:'tank',x:100,y:200};
 assert.deepEqual(componentPort(tank,'out'),{x:150,y:200,dx:1,dy:0});
 assert.deepEqual(componentPort(tank,'in'),{x:50,y:200,dx:-1,dy:0});
 assert.deepEqual(normalizeTankPorts(tank),{inAngle:180,outAngle:0});
});

test('tank nozzle angles remain independent and compose with symbol scale and rotation',()=>{
 const tank={type:'tank',x:100,y:200,inAngle:90,outAngle:300,scale:2,rotation:90};
 const inlet=componentPort(tank,'in'),outlet=componentPort(tank,'out');
 assert.deepEqual(inlet,{x:0,y:200,dx:-1,dy:0});
 assert.ok(Math.abs(outlet.x-186.6)<.001);assert.ok(Math.abs(outlet.y-250)<.001);
 assert.ok(Math.abs(Math.hypot(outlet.dx,outlet.dy)-1)<1e-12);
 assert.deepEqual(componentPort({...tank,inAngle:270},'out'),outlet);
 assert.deepEqual(normalizeTankPorts({inAngle:-90,outAngle:720}),{inAngle:270,outAngle:0});
});

test('every component connection scales and rotates with its symbol; direction stays a unit vector',()=>{
 const cases=[['valve','in',-29,0],['filter','out',36,0],['flowmeter','in',-36,0],
  ['pipe','out',80,0],['cap','in',-28,0],['outlet','in',-33,0],
  ['elbow','in',0,-32],['junction','branch',0,26],['cross','top',0,-26]];
 for(const [type,port,x,y] of cases){
  const base={type,x:10,y:20},legacy=componentPort(base,port),changed=componentPort({...base,scale:2,rotation:90},port);
  assert.equal(legacy.x,10+x,type);assert.equal(legacy.y,20+y,type);
  assert.equal(changed.x,10-y*2,type);assert.equal(changed.y,20+x*2,type);
  assert.ok(Math.abs(Math.hypot(changed.dx,changed.dy)-1)<1e-12,type);
 }
 assert.deepEqual(componentPort({type:'ground',variant:'sink',x:10,y:20,scale:.5,rotation:90},'port'),{x:10,y:12,dx:0,dy:-1});
 assert.deepEqual(componentPort({type:'valve',variant:'riser',x:10,y:20,scale:4,rotation:90},'in'),{x:10,y:20,dx:0,dy:-1});
 assert.deepEqual(componentPort({type:'point',x:10,y:20,scale:4},'joint'),{x:10,y:20,dx:0,dy:0});
});

test('normalization keeps finite safe geometry and annotations cannot acquire pipe ports',()=>{
 assert.equal(nodeScale({scale:0}),.25);assert.equal(nodeScale({scale:50}),4);
 assert.equal(nodeScale({scale:Infinity}),1);assert.equal(nodeScale({type:'point',scale:3}),1);
 assert.equal(normalizeAngle(NaN,180),180);assert.equal(normalizeAngle(-450),270);
 assert.equal(componentPort({type:'text',x:0,y:0},'in'),null);
 assert.equal(componentPort({type:'tank',x:0,y:0},'wrong'),null);
 assert.equal(componentPort({type:'tank',x:Infinity,y:0},'out'),null);
});

test('tanks retain up to 3000% scale and both nozzles follow the large rotated body',()=>{
 assert.equal(maxNodeScale({type:'tank'}),30);
 assert.equal(nodeScale({type:'tank',scale:12}),12);
 assert.equal(nodeScale({type:'tank',scale:30}),30);
 assert.equal(nodeScale({type:'tank',scale:30.01}),30);
 assert.equal(nodeScale({type:'tank',scale:.1}),.25);
 assert.equal(nodeScale({type:'tank',scale:NaN}),1);
 assert.equal(maxNodeScale({type:'filter'}),4);
 assert.equal(nodeScale({type:'filter',scale:30}),4);
 assert.equal(maxNodeScale({type:'point'}),1);
 assert.equal(nodeScale({type:'point',scale:30}),1);
 const tank={type:'tank',x:2000,y:3000,scale:30,rotation:90,inAngle:90,outAngle:0};
 assert.deepEqual(componentPort(tank,'in'),{x:500,y:3000,dx:-1,dy:0});
 assert.deepEqual(componentPort(tank,'out'),{x:2000,y:4500,dx:0,dy:1});
});

test('ordinary valve connections land on flange faces while other equipment retains its ports',()=>{
 for(const variant of [undefined,'flanged','motor','round']){
  const node={type:'valve',variant,x:100,y:200};
  assert.deepEqual(componentPort(node,'in'),{x:71,y:200,dx:-1,dy:0});
  assert.deepEqual(componentPort(node,'out'),{x:129,y:200,dx:1,dy:0});
  assert.deepEqual(componentPort({...node,scale:2,rotation:90},'in'),{x:100,y:142,dx:0,dy:-1});
  assert.deepEqual(componentPort({...node,scale:2,rotation:90},'out'),{x:100,y:258,dx:0,dy:1});
 }
 assert.deepEqual(componentPort({type:'valve',variant:'riser',x:100,y:200},'center'),{x:100,y:200,dx:0,dy:0});
 for(const type of ['filter','flowmeter']){
  assert.equal(componentPort({type,x:0,y:0},'in').x,-36);
  assert.equal(componentPort({type,x:0,y:0},'out').x,36);
 }
});

test('copying a 3000% tank preserves scale and nozzle geometry without creating pipe connections',()=>{
 const tank={id:'tank',type:'tank',x:100,y:200,scale:30,rotation:90,inAngle:0,outAngle:180,code:'TC-01'};
 const project={nodes:[tank],edges:[]};
 const result=pasteComponent(project,copyComponent(tank),{position:{x:2000,y:3000},idFactory:()=> 'copy'});
 const copy=result.project.nodes.find(n=>n.id==='copy');
 assert.equal(copy.scale,30);
 assert.deepEqual(componentPort(copy,'in'),{x:2000,y:4500,dx:0,dy:1});
 assert.deepEqual(componentPort(copy,'out'),{x:2000,y:1500,dx:0,dy:-1});
 assert.deepEqual(result.project.edges,[]);
 assert.equal(project.nodes.length,1);
});

test('fractional standalone pipe lengths retain exact fitted endpoints after scale and rotation',()=>{
 const pipe={type:'pipe',x:10,y:20,length:123.5};
 assert.deepEqual(componentPort(pipe,'in'),{x:-51.75,y:20,dx:-1,dy:0});
 assert.deepEqual(componentPort(pipe,'out'),{x:71.75,y:20,dx:1,dy:0});
 assert.deepEqual(componentPort({...pipe,scale:2,rotation:90},'out'),{x:10,y:143.5,dx:0,dy:1});
 assert.equal(componentPort({...pipe,length:59.5},'out').x,40);
 assert.equal(componentPort({...pipe,length:1600.5},'out').x,810);
});
