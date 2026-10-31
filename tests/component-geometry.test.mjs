import test from 'node:test';
import assert from 'node:assert/strict';
import {componentPort,nodeScale,normalizeAngle,normalizeTankPorts} from '../dist/component-geometry.js';

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
 const cases=[['valve','in',-36,0],['filter','out',36,0],['flowmeter','in',-36,0],
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
