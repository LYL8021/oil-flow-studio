import test from 'node:test';
import assert from 'node:assert/strict';
import {componentPort} from '../dist/component-geometry.js';
import {computeFlow} from '../dist/flow.js';
import {commitPipeRun} from '../dist/pipe-runs.js';
import {findMagneticPort,reconnectPipeEndpoint} from '../dist/pipe-magnets.js';

const ep=(node,port)=>({node,port});
const tank={id:'tank',type:'tank',x:0,y:0,portCount:3,enabled:true,fuel:'fuel',portModes:{in:'inlet',out:'outlet',out2:'outlet'}};
const valve={id:'valve',type:'valve',x:200,y:150,open:true};
const ends=[{id:'b',type:'outlet',x:350,y:0},{id:'c',type:'outlet',x:400,y:150}];
const branchEdges=[{id:'branch-b',from:ep('tank','out'),to:ep('b','in')},{id:'after-c-valve',from:ep('valve','out'),to:ep('c','in')}];

test('continuous drawing connects C without disturbing B, and C branch valve isolation survives the graph commit',()=>{
  const original={nodes:[structuredClone(tank),structuredClone(valve),...structuredClone(ends)],edges:structuredClone(branchEdges)};
  const start=componentPort(tank,'out2'),end=componentPort(valve,'in');
  const {project}=commitPipeRun(original,{start:ep('tank','out2'),end:ep('valve','in'),points:[start,{x:start.x,y:end.y},end],idFactory:()=> 'new-c-link'});
  assert.equal(original.edges.length,2);
  assert.deepEqual(project.edges.find(e=>e.id==='new-c-link').from,ep('tank','out2'));
  assert.equal(computeFlow(project.nodes,project.edges).activeEdges.size,3);
  project.nodes.find(n=>n.id==='valve').open=false;
  const closed=computeFlow(project.nodes,project.edges);
  assert.ok(closed.activeEdges.has('branch-b'));
  assert.ok(closed.activeEdges.has('new-c-link'));
  assert.ok(!closed.activeEdges.has('after-c-valve'));
  project.nodes.find(n=>n.id==='tank').portModes.out2='closed';
  assert.deepEqual([...computeFlow(project.nodes,project.edges).activeEdges],['branch-b']);
});

test('magnetic free-end reconnection targets C only when enabled, removes its orphan point, and leaves legacy two-port drawings untouched',()=>{
  const loose={id:'loose',type:'point',x:0,y:47};
  const project={nodes:[structuredClone(tank),structuredClone(valve),...structuredClone(ends),loose],edges:[...structuredClone(branchEdges),{id:'free',from:ep('loose','joint'),to:ep('valve','in')}]};
  const options={position:componentPort(tank,'out2'),sourceNodeId:'loose',otherNodeId:'valve',ignoreEdgeId:'free'};
  assert.equal(findMagneticPort(project,options)?.port,'out2');
  const next=reconnectPipeEndpoint(project,{edgeId:'free',end:'from',target:ep('tank','out2')}).project;
  assert.deepEqual(next.edges.find(e=>e.id==='free').from,ep('tank','out2'));
  assert.ok(!next.nodes.some(n=>n.id==='loose'));
  assert.ok(computeFlow(next.nodes,next.edges).activeEdges.has('after-c-valve'));
  const legacy=structuredClone(project);delete legacy.nodes[0].portCount;
  const before=structuredClone(legacy);
  assert.notEqual(findMagneticPort(legacy,options)?.port,'out2');
  assert.throws(()=>reconnectPipeEndpoint(legacy,{edgeId:'free',end:'from',target:ep('tank','out2')}),/接管/);
  assert.deepEqual(legacy,before);
});
