import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOperations, captureOperation, applyOperation, operationMatches, topologySignature} from '../dist/operations.js';

function project() {
  return {title:'固定管線圖', nodes:[
    {id:'tank',type:'tank',name:'油槽',x:10,y:20,enabled:false,fuel:'diesel',capacity:50000},
    {id:'v1',type:'valve',code:'V-01',name:'第一閥',x:100,y:20,rotation:23,open:false},
    {id:'v2',type:'valve',code:'V-02',name:'第二閥',x:200,y:20,open:true},
    {id:'end',type:'outlet',name:'用油端',x:300,y:20}
  ], edges:[
    {id:'e1',from:{node:'tank',port:'out'},to:{node:'v1',port:'in'},kind:'bridge',routing:'free',waypoints:[{x:50,y:80}]},
    {id:'e2',from:{node:'v1',port:'out'},to:{node:'v2',port:'in'},kind:'underground'},
    {id:'e3',from:{node:'v2',port:'out'},to:{node:'end',port:'in'}}
  ], reference:{dataUrl:'a-reference-image',opacity:.22}, operations:[]};
}
const clone = value => structuredClone(value);
const operation = value => captureOperation(value, {id:'op1',name:'正常輸送',createdAt:100});

test('capture saves valve states, not tank settings or layout, without mutating the diagram', () => {
  const original = project(), before = clone(original);
  const captured = operation(original);
  assert.deepEqual(captured.valves,[{id:'v1',open:false},{id:'v2',open:true}]);
  assert.equal(captured.createdAt,100);
  assert.ok(captured.updatedAt >= captured.createdAt);
  assert.equal('nodes' in captured,false);
  assert.equal('edges' in captured,false);
  assert.equal('fuel' in captured,false);
  assert.deepEqual(original,before);
});

test('applying restores every valve but preserves geometry, sources, reference and other presets', () => {
  const target = project(), captured = operation(target);
  target.nodes[1].open = true; target.nodes[2].open = false;
  target.nodes[0].enabled = true; target.nodes[0].fuel = 'fuel';
  target.nodes[1].x = 555; target.edges[0].waypoints = [{x:99,y:123}];
  target.operations = [captured];
  const before = clone(target), expected = clone(target);
  expected.nodes[1].open = false; expected.nodes[2].open = true;
  const result = applyOperation(target,captured);
  assert.deepEqual(result,expected);
  assert.deepEqual(target,before);
  assert.notEqual(result,target);
  assert.notEqual(result.nodes[0],target.nodes[0]);
  assert.equal(operationMatches(result,captured),true);
  assert.equal(operationMatches(target,captured),false);
});

test('named operations remain independent and do not bleed valve state into one another', () => {
  const diagram = project(), normal = operation(diagram);
  diagram.nodes[1].open = true; diagram.nodes[2].open = false;
  const reverse = captureOperation(diagram,{id:'op2',name:'回流'});
  diagram.operations = [normal,reverse];
  const first = applyOperation(diagram,normal), second = applyOperation(first,reverse);
  assert.deepEqual(normal.valves,[{id:'v1',open:false},{id:'v2',open:true}]);
  assert.equal(first.nodes[1].open,false); assert.equal(second.nodes[1].open,true);
  assert.equal(first.nodes[2].open,true); assert.equal(second.nodes[2].open,false);
  assert.deepEqual(second.operations,[normal,reverse]);
});

test('topology is order-stable and permits presentation changes, while valve codes and links invalidate a preset', () => {
  const original = project(), captured = operation(original), changed = clone(original);
  changed.nodes.reverse(); changed.edges.reverse();
  changed.nodes.forEach(node => {node.x += 100;node.y += 50;node.rotation = 91;node.name += ' 新名稱';});
  changed.edges.forEach(edge => {edge.kind='normal';edge.routing='orthogonal';edge.waypoints=[];});
  assert.equal(topologySignature(original),topologySignature(changed));
  assert.equal(operationMatches(changed,captured),true);
  const recoded = clone(original); recoded.nodes[1].code='V-99';
  assert.throws(()=>applyOperation(recoded,captured),{code:'incompatible'});
  const rewired = clone(original); rewired.edges[1].to={node:'end',port:'in'};
  assert.throws(()=>applyOperation(rewired,captured),{code:'incompatible'});
  const replaced = clone(original); replaced.nodes[3].type='filter';
  assert.throws(()=>applyOperation(replaced,captured),{code:'incompatible'});
});

test('incomplete, extra, new or missing valves reject before applying any states', () => {
  const diagram = project(), captured = operation(diagram), before = clone(diagram);
  const missing = clone(captured); missing.valves.pop();
  assert.throws(()=>applyOperation(diagram,missing),{code:'incompatible'});
  const extra = clone(captured); extra.valves.push({id:'other',open:true});
  assert.throws(()=>applyOperation(diagram,extra),{code:'incompatible'});
  const newValve = clone(diagram); newValve.nodes.push({id:'v3',type:'valve',code:'V-03',open:true});
  assert.throws(()=>applyOperation(newValve,captured),{code:'incompatible'});
  assert.deepEqual(diagram,before);
});

test('normalization rejects malformed JSON states, identifiers, duplicate names, and unsafe coercion', () => {
  const captured = operation(project());
  assert.deepEqual(normalizeOperations(undefined),[]);
  assert.throws(()=>normalizeOperations(null),{code:'invalid-operation'});
  for (const bad of [null,{}, {...captured,id:123}, {...captured,id:'bad/id'}, {...captured,name:' '}, {...captured,name:'圖'.repeat(81)}, {...captured,signature:'garbage'}, {...captured,signature:'topology-v1:bad'}]) {
    assert.throws(()=>normalizeOperations([bad]),{code:'invalid-operation'});
  }
  const stringState = clone(captured); stringState.valves[0].open='false';
  assert.throws(()=>applyOperation(project(),stringState),{code:'invalid-operation'});
  const duplicateValve = clone(captured); duplicateValve.valves.push(duplicateValve.valves[0]);
  assert.throws(()=>normalizeOperations([duplicateValve]),{code:'invalid-operation'});
  assert.throws(()=>normalizeOperations([captured,captured]),{code:'invalid-operation'});
  assert.throws(()=>normalizeOperations([{...captured,name:' Ａ   B '},{...captured,id:'op2',name:'a b'}]),{code:'name-exists'});
  const invalidProject = project(); invalidProject.nodes[1].open='false';
  assert.throws(()=>captureOperation(invalidProject,{name:'測試'}),{code:'invalid-project'});
  assert.equal(operationMatches(project(),stringState),false);
});

test('normalization returns detached safe records and map keys cannot pollute prototypes', () => {
  const diagram = project(); diagram.nodes[1].id='__proto__'; diagram.edges[0].to.node='__proto__'; diagram.edges[1].from.node='__proto__';
  const captured = operation(diagram), normalized = normalizeOperations([captured]);
  normalized[0].valves[0].open=true;
  assert.equal(captured.valves[0].open,false);
  const next = applyOperation(diagram,captured);
  assert.equal(next.nodes[1].open,false);
  assert.equal(Object.prototype.open,undefined);
  assert.equal(Object.getPrototypeOf(next),Object.prototype);
});

test('legacy missing open flags use the same open-by-default behavior as the flow engine', () => {
  const diagram=project(); delete diagram.nodes[1].open;
  const captured=operation(diagram);
  assert.equal(captured.valves.find(valve=>valve.id==='v1').open,true);
  assert.equal(operationMatches(diagram,captured),true);
});
