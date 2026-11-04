import test from 'node:test';
import assert from 'node:assert/strict';
import {commitPipeRun} from '../dist/pipe-runs.js';
import {computeFlow} from '../dist/flow.js';

const end = (node, port = 'joint') => ({node, port});
const xy = value => ({x:value.x,y:value.y});
const ids = () => {let sequence=0;return prefix=>`${prefix}bend${++sequence}`;};
const commit = (project, start, finish, points) => commitPipeRun(project,
  {start,end:finish,points,idFactory:ids()});
const attached = (id, point, path) => ({edge:id,point,path});
const pathOf = (project, edge) => [
  xy(project.nodes.find(node=>node.id===edge.from.node)),
  ...edge.waypoints,
  xy(project.nodes.find(node=>node.id===edge.to.node))
];

function fixture(routing = 'free') {
  return {
    title:'彎折接管',
    nodes:[{id:'a',type:'point',x:0,y:0},{id:'b',type:'point',x:300,y:200},
      {id:'v',type:'valve',x:400,y:0,open:true}],
    edges:[{id:'main',from:end('a'),to:end('b'),routing,kind:'underground',layer:7,
      waypoints:routing==='free'?[{x:150,y:0},{x:150,y:200}]:[]}],
    reference:{preserve:'原底圖'},operations:[{preserve:'原閥位作業'}]
  };
}

test('branching exactly at either explicit corner retains both original pipe legs and metadata',()=>{
  const path=[{x:0,y:0},{x:150,y:0},{x:150,y:200},{x:300,y:200}];
  for (const cornerIndex of [1,2]) {
    const original=fixture(),before=structuredClone(original),corner=path[cornerIndex];
    const {project,edgeId}=commit(original,attached('main',corner,path),end('v','in'),[corner,{x:371,y:0}]);
    assert.deepEqual(original,before);
    const joint=project.nodes.find(node=>!original.nodes.some(previous=>previous.id===node.id));
    assert.deepEqual(xy(joint),corner);
    assert.equal(joint.type,'point');
    assert.equal(joint.name,'');assert.equal(joint.code,'');
    const halves=project.edges.filter(edge=>edge.id!==edgeId);
    assert.equal(halves.length,2);
    for (const edge of halves) {
      assert.equal(edge.kind,'underground');assert.equal(edge.layer,7);
      assert.equal(edge.routing,'free');
    }
    const left=halves.find(edge=>edge.id==='main'),right=halves.find(edge=>edge.id!=='main');
    assert.deepEqual(pathOf(project,left),path.slice(0,cornerIndex+1));
    assert.deepEqual(pathOf(project,right),path.slice(cornerIndex));
    assert.equal(project.edges.filter(edge=>edge.from.node===joint.id||edge.to.node===joint.id).length,3);
    assert.deepEqual(project.operations,before.operations);assert.deepEqual(project.reference,before.reference);
    assert.deepEqual(project.nodes.filter(node=>node.id!==joint.id),before.nodes);
  }
});

test('an implicit orthogonal corner becomes a connected point without losing its generated lead-ins',()=>{
  const original=fixture('orthogonal'),before=structuredClone(original);
  const path=[{x:0,y:0},{x:34,y:0},{x:34,y:200},{x:266,y:200},{x:300,y:200}];
  const corner=path[2];
  const {project,edgeId}=commit(original,end('v','in'),attached('main',corner,path),[{x:371,y:0},corner]);
  assert.deepEqual(original,before);
  const joint=project.nodes.find(node=>!original.nodes.some(previous=>previous.id===node.id));
  const first=project.edges.find(edge=>edge.id==='main');
  const second=project.edges.find(edge=>edge.id!==edgeId&&edge.id!=='main');
  assert.deepEqual(pathOf(project,first),path.slice(0,3));
  assert.deepEqual(pathOf(project,second),path.slice(2));
  assert.deepEqual(project.edges.find(edge=>edge.id===edgeId).to,end(joint.id));
  assert.equal(project.edges.filter(edge=>edge.from.node===joint.id||edge.to.node===joint.id).length,3);
});

test('duplicate adjacent path coordinates at a bend produce no zero-length split or extra junction',()=>{
  const original=fixture(),corner={x:150,y:0};
  const path=[{x:0,y:0},corner,corner,{x:150,y:200},{x:300,y:200}];
  const {project,edgeId}=commit(original,attached('main',corner,path),end('v','in'),[corner,{x:371,y:0}]);
  assert.equal(project.nodes.length,original.nodes.length+1);
  assert.equal(project.edges.length,3);
  const halves=project.edges.filter(edge=>edge.id!==edgeId);
  assert.deepEqual(pathOf(project,halves.find(edge=>edge.id==='main')),[path[0],corner]);
  assert.deepEqual(pathOf(project,halves.find(edge=>edge.id!=='main')),[corner,path[3],path[4]]);
  for (const edge of project.edges) {
    assert.notEqual(edge.from.node,edge.to.node);
    assert.ok(edge.waypoints.every((point,index)=>!index||point.x!==edge.waypoints[index-1].x||point.y!==edge.waypoints[index-1].y));
  }
});

test('a bend tee receives C-port fuel, isolates only the closed branch, and never joins a crossing pipe',()=>{
  const original={nodes:[
    {id:'tank',type:'tank',x:0,y:0,enabled:true,fuel:'diesel',portCount:3,
      portModes:{in:'inlet',out:'closed',out2:'outlet'}},
    {id:'mainEnd',type:'point',x:300,y:200},
    {id:'valve',type:'valve',x:150,y:-150,open:true},
    {id:'branchEnd',type:'point',x:350,y:-150},
    {id:'crossA',type:'point',x:0,y:-150},{id:'crossB',type:'point',x:300,y:150}
  ],edges:[
    {id:'main',from:end('tank','out2'),to:end('mainEnd'),kind:'bridge',layer:3,
      routing:'free',waypoints:[{x:150,y:47.33},{x:150,y:200}]},
    {id:'afterValve',from:end('valve','out'),to:end('branchEnd'),routing:'free',waypoints:[]},
    {id:'crossing',from:end('crossA'),to:end('crossB'),routing:'free',waypoints:[],kind:'normal'}
  ]};
  const corner={x:150,y:47.33},path=[{x:0,y:47.33},corner,{x:150,y:200},{x:300,y:200}];
  const {project,edgeId}=commit(original,attached('main',corner,path),end('valve','in'),[corner,{x:121,y:47.33},{x:121,y:-150}]);
  assert.deepEqual(project.edges.find(edge=>edge.id==='crossing'),original.edges.find(edge=>edge.id==='crossing'));
  const open=computeFlow(project.nodes,project.edges);
  assert.equal(open.activeEdges.size,4);
  assert.deepEqual([...open.activeEdgeFuels.get(edgeId)],['diesel']);
  assert.equal(open.activeEdges.has('crossing'),false);
  project.nodes.find(node=>node.id==='valve').open=false;
  const closed=computeFlow(project.nodes,project.edges);
  assert.equal(closed.activeEdges.size,3);
  assert.equal(closed.activeEdges.has(edgeId),true);
  assert.equal(closed.activeEdges.has('main'),true);
  assert.equal(closed.activeEdges.has('afterValve'),false);
  assert.equal(closed.activeEdges.has('crossing'),false);
  project.nodes.find(node=>node.id==='tank').portModes.out2='closed';
  assert.equal(computeFlow(project.nodes,project.edges).activeEdges.size,0);
});

test('rejected bend attachment leaves the unsplit original graph intact',()=>{
  const path=[{x:0,y:0},{x:150,y:0},{x:150,y:200},{x:300,y:200}],corner=path[1];
  const cap={id:'cap',type:'cap',x:400,y:200};
  const occupied=fixture();occupied.nodes.push(cap);
  occupied.edges.push({id:'sealed',from:end('b'),to:end('cap','in')});
  const before=structuredClone(occupied);
  assert.throws(()=>commit(occupied,attached('main',corner,path),end('cap','in'),[corner,{x:372,y:200}]),/盲封只能/);
  assert.deepEqual(occupied,before);
  const crowded=fixture();
  while(crowded.nodes.length<400)crowded.nodes.push({id:`spare${crowded.nodes.length}`,type:'point',x:-100,y:-100});
  const crowdedBefore=structuredClone(crowded);
  assert.throws(()=>commit(crowded,attached('main',corner,path),end('v','in'),[corner,{x:371,y:0}]),/最多支援/);
  assert.deepEqual(crowded,crowdedBefore);
});
