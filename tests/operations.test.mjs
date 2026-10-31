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

test('capture saves valve and operational source states without fuel or layout changes', () => {
  const original = project(), before = clone(original);
  const captured = operation(original);
  assert.deepEqual(captured.valves,[{id:'v1',open:false},{id:'v2',open:true}]);
  assert.deepEqual(captured.sources,[{id:'tank',type:'tank',enabled:false,portModes:{in:'inlet',out:'outlet'}}]);
  assert.equal(captured.createdAt,100);
  assert.ok(captured.updatedAt >= captured.createdAt);
  assert.equal('nodes' in captured,false);
  assert.equal('edges' in captured,false);
  assert.equal('fuel' in captured,false);
  assert.deepEqual(original,before);
});

test('legacy valve-only operation restores valves but preserves current source states and layout', () => {
  const target = project(), captured = operation(target);
  delete captured.sources;
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


test('text annotations do not invalidate valve presets when added, edited, moved or removed', () => {
  const original=project(), captured=operation(original), signature=topologySignature(original);
  const annotated=clone(original);
  annotated.nodes.push({id:'label1',type:'text',text:'往通霄\n12 吋管線',x:400,y:150,fontSize:24,textColor:'#ff8800',textAlign:'middle',bold:true,rotation:45});
  assert.equal(topologySignature(annotated),signature);
  assert.equal(operationMatches(annotated,captured),true);
  const label=annotated.nodes.at(-1);
  label.text='往台中油庫';label.x=-50;label.y=300;label.fontSize=36;label.rotation=180;label.code='註記';
  assert.equal(topologySignature(annotated),signature);
  annotated.nodes[1].open=true;annotated.nodes[2].open=false;
  const before=clone(annotated), applied=applyOperation(annotated,captured);
  assert.deepEqual(applied.nodes.at(-1),label);
  assert.notEqual(applied.nodes.at(-1),label);
  assert.equal(applied.nodes[1].open,false);assert.equal(applied.nodes[2].open,true);
  assert.deepEqual(annotated,before);
  annotated.nodes.pop();
  assert.equal(topologySignature(annotated),signature);
  assert.equal(operationMatches(applyOperation(annotated,captured),captured),true);
  annotated.edges[0].to={node:'v2',port:'in'};
  assert.throws(()=>applyOperation(annotated,captured),{code:'incompatible'});
});

test('annotation-only diagrams have no valve topology and can preserve empty valve operations', () => {
  const empty={nodes:[],edges:[]}, captured=captureOperation(empty,{id:'empty',name:'空圖'});
  const annotated={nodes:[{id:'label',type:'text',text:'站名',x:0,y:0}],edges:[]};
  assert.equal(topologySignature(annotated),topologySignature(empty));
  assert.deepEqual(captured.valves,[]);
  assert.equal(operationMatches(annotated,captured),true);
  assert.deepEqual(applyOperation(annotated,captured),annotated);
});

test('annotations retain identifier validation and cannot become hydraulic endpoints', () => {
  const source=project(), captured=operation(source);
  for(const labels of [
    [{id:'v1',type:'text',text:'重複元件編號'}],
    [{id:'label',type:'text'},{id:'label',type:'text'}],
    [{id:'bad/id',type:'text'}]
  ]){
    const invalid=clone(source);invalid.nodes.push(...labels);
    assert.throws(()=>topologySignature(invalid),{code:'invalid-project'});
  }
  for(const side of ['from','to']){
    const invalid=clone(source);invalid.nodes.push({id:'label',type:'text',text:'不是接點'});
    invalid.edges[0][side]={node:'label',port:'joint'};
    const before=clone(invalid);
    assert.throws(()=>applyOperation(invalid,captured),{code:'invalid-project'});
    assert.deepEqual(invalid,before);
  }
});

test('pre-annotation diagrams retain their exact topology-v1 canonical representation', () => {
  assert.equal(topologySignature(project()),'topology-v1:'+JSON.stringify({
    nodes:[['end','outlet',''],['tank','tank',''],['v1','valve','V-01'],['v2','valve','V-02']],
    edges:[['e1','tank','out','v1','in'],['e2','v1','out','v2','in'],['e3','v2','out','end','in']]
  }));
});

test('source presets restore independent tank roles and reversible station modes without changing products or geometry',()=>{
 const diagram=project();
 diagram.nodes.push({id:'station',type:'ground',variant:'sink',enabled:true,flowMode:'source',fuel:'gasoline',x:550,y:50});
 diagram.nodes[0].enabled=true;diagram.nodes[0].portModes={in:'outlet',out:'outlet'};
 const signature=topologySignature(diagram),normal=operation(diagram);
 diagram.nodes[0].portModes={in:'inlet',out:'inlet'};diagram.nodes[0].enabled=false;
 diagram.nodes.at(-1).enabled=false;diagram.nodes.at(-1).flowMode='idle';
 diagram.nodes[1].open=true;
 const idle=captureOperation(diagram,{id:'idle',name:'靜置'});
 assert.equal(topologySignature(diagram),signature);
 assert.equal(operationMatches(diagram,normal),false);
 assert.equal(operationMatches(diagram,idle),true);
 diagram.nodes[0].fuel='fuel';diagram.nodes.at(-1).fuel='diesel';
 diagram.nodes[0].x=750;diagram.nodes[0].scale=30;diagram.nodes[0].outAngle=245;
 const before=clone(diagram),restored=applyOperation(diagram,normal);
 assert.deepEqual(restored.nodes[0].portModes,{in:'outlet',out:'outlet'});
 assert.equal(restored.nodes[0].enabled,true);
 assert.equal(restored.nodes.at(-1).flowMode,'source');assert.equal(restored.nodes.at(-1).enabled,true);
 assert.equal(restored.nodes[0].fuel,'fuel');assert.equal(restored.nodes.at(-1).fuel,'diesel');
 assert.equal(restored.nodes[0].x,750);assert.equal(restored.nodes[0].scale,30);assert.equal(restored.nodes[0].outAngle,245);
 assert.equal(restored.nodes.at(-1).variant,'sink');
 assert.equal(operationMatches(restored,normal),true);
 assert.equal(operationMatches(applyOperation(restored,idle),idle),true);
 assert.deepEqual(diagram,before);
});

test('source matching notices mode and supply changes while tolerating normalized legacy defaults',()=>{
 const diagram=project(),captured=operation(diagram);
 assert.equal(operationMatches(diagram,captured),true);
 diagram.nodes[0].portModes={in:'inlet',out:'outlet'};
 assert.equal(operationMatches(diagram,captured),true);
 diagram.nodes[0].portModes.in='outlet';assert.equal(operationMatches(diagram,captured),false);
 diagram.nodes[0].portModes.in='inlet';diagram.nodes[0].enabled=true;
 assert.equal(operationMatches(diagram,captured),false);
});

test('source presets validate modes and identities atomically and normalize to detached safe values',()=>{
 const diagram=project(),captured=operation(diagram),before=clone(diagram);
 const source=captured.sources[0];
 for(const sources of [null,[{...source,enabled:'false'}],[source,source],
  [{...source,portModes:{in:'source',out:'outlet'}}],
  [{...source,type:'valve'}],
  [{id:'station',type:'ground',enabled:true,flowMode:'idle'}],
  [{id:'station',type:'ground',enabled:false,flowMode:'unknown'}]]){
  assert.throws(()=>applyOperation(diagram,{...captured,sources}),{code:'invalid-operation'});
  assert.deepEqual(diagram,before);
 }
 for(const setting of [{...source,id:'missing'},{id:'v1',type:'ground',enabled:false,flowMode:'idle'}]){
  assert.throws(()=>applyOperation(diagram,{...captured,sources:[setting]}),{code:'incompatible'});
  assert.deepEqual(diagram,before);
 }
 const normalized=normalizeOperations([captured]);normalized[0].sources[0].portModes.in='closed';
 assert.equal(captured.sources[0].portModes.in,'inlet');
 const partial=clone(captured);partial.sources=[];
 diagram.nodes[0].enabled=true;diagram.nodes[0].portModes={in:'closed',out:'closed'};
 const restored=applyOperation(diagram,partial);
 assert.equal(restored.nodes[0].enabled,true);assert.deepEqual(restored.nodes[0].portModes,{in:'closed',out:'closed'});
});

test('legacy presets with no source field leave explicit new ground and tank settings untouched',()=>{
 const diagram=project(),legacy=operation(diagram);delete legacy.sources;
 diagram.nodes[0].enabled=true;diagram.nodes[0].portModes={in:'outlet',out:'closed'};
 diagram.nodes.push({id:'station',type:'ground',enabled:false,flowMode:'idle'});
 // Existing older presets are still subject to topology compatibility.
 legacy.signature=topologySignature(diagram);
 const next=applyOperation(diagram,legacy);
 assert.deepEqual(next.nodes[0],diagram.nodes[0]);assert.deepEqual(next.nodes.at(-1),diagram.nodes.at(-1));
 assert.equal(operationMatches(diagram,legacy),true);
 assert.equal('sources' in normalizeOperations([legacy])[0],false);
});
