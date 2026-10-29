import test from 'node:test';
import assert from 'node:assert/strict';
import {commitPipeRun} from '../dist/pipe-runs.js';
import {computeFlow} from '../dist/flow.js';

const canvas = (x,y) => ({point:{x,y}});
const port = (node,side) => ({node,port:side});
const ids = () => {let value=0;return prefix=>prefix+'new'+(++value);};
const run = (project,start,end,points,options={}) => commitPipeRun(project,{start,end,points,idFactory:ids(),...options});
const tank = {id:'tank',type:'tank',x:0,y:0,enabled:true,fuel:'diesel'};
const outlet = {id:'out',type:'outlet',x:500,y:0};
const main = () => ({title:'連續畫管',nodes:[{...tank},{...outlet}],edges:[{id:'main',from:port('tank','out'),to:port('out','in'),kind:'underground',routing:'free',waypoints:[{x:200,y:0},{x:200,y:200},{x:500,y:200}]}],operations:[{preserve:'原作業'}],reference:{preserve:'原底圖'}});
const mainPath = [{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:500,y:200},{x:500,y:0}];

function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const part of Object.values(value))freeze(part);}return value;}

test('bare continuous route creates only two blank endpoints and one polyline, immutably',()=>{
 const source=freeze({title:'空白管線',nodes:[],edges:[],metadata:{preserve:true}});
 const {project,edgeId}=run(source,canvas(100,100),canvas(400,300),[{x:100,y:100},{x:400,y:100},{x:400,y:300}],{kind:'bridge'});
 assert.equal(source.nodes.length,0);assert.equal(project.nodes.length,2);assert.equal(project.edges.length,1);
 assert.equal(project.nodes.every(node=>node.type==='point'&&node.name===''&&node.code===''),true);
 assert.equal(project.edges[0].id,edgeId);assert.equal(project.edges[0].kind,'bridge');assert.equal(project.edges[0].routing,'free');
 assert.deepEqual(project.edges[0].waypoints,[{x:400,y:100}]);assert.equal(project.edges[0].from.port,'joint');
 assert.deepEqual(project.metadata,{preserve:true});
});

test('source to existing component uses no unnecessary endpoint nodes and preserves route',()=>{
 const source={nodes:[{...tank},{...outlet}],edges:[]};
 const {project}=run(source,port('tank','out'),port('out','in'),[{x:50,y:0},{x:300,y:0},{x:467,y:0}]);
 assert.equal(project.nodes.length,2);assert.deepEqual(project.edges[0].from,port('tank','out'));
 assert.deepEqual(project.edges[0].to,port('out','in'));assert.deepEqual(project.edges[0].waypoints,[{x:300,y:0}]);
 assert.deepEqual([...computeFlow(project.nodes,project.edges).activeEdges],[project.edges[0].id]);
});

test('explicit branch splits selected pipe at projected point, preserving kind, geometry and project data',()=>{
 const source=main(), before=structuredClone(source);
 const {project,edgeId}=run(source,{edge:'main',point:{x:250,y:203},path:mainPath},canvas(250,400),[{x:250,y:203},{x:250,y:400}]);
 assert.deepEqual(source,before);assert.equal(project.edges.length,3);assert.equal(project.nodes.length,4);
 const junction=project.nodes.find(node=>node.type==='point'&&node.x===250&&node.y===200);
 assert.ok(junction);assert.deepEqual(project.edges.find(edge=>edge.id==='main').waypoints,[{x:200,y:0},{x:200,y:200}]);
 const second=project.edges.find(edge=>edge.id!==edgeId&&edge.id!=='main');
 assert.deepEqual(second.from,port(junction.id,'joint'));assert.deepEqual(second.waypoints,[{x:500,y:200}]);
 assert.equal(second.kind,'underground');assert.equal(second.routing,'free');
 assert.deepEqual(project.operations,source.operations);assert.deepEqual(project.reference,source.reference);
 const flow=computeFlow(project.nodes,project.edges);assert.equal(flow.activeEdges.size,3);
 assert.deepEqual([...flow.activeEdgeFuels.get(edgeId)],['diesel']);
});

test('same junction endpoint can become four-way without a cross component; incidental crossing stays isolated',()=>{
 const first=run({nodes:[{...tank}],edges:[]},port('tank','out'),canvas(200,0),[{x:50,y:0},{x:200,y:0}]).project;
 const joint=first.nodes.find(node=>node.type==='point');
 let id=0;const idFactory=prefix=>prefix+'branch'+(++id);
 let project=first;
 for(const [x,y] of [[400,0],[200,200],[200,-200]])project=run(project,port(joint.id,'joint'),canvas(x,y),[{x:200,y:0},{x,y}],{idFactory}).project;
 assert.equal(project.nodes.some(node=>node.type==='junction'||node.type==='cross'),false);
 assert.equal(project.edges.filter(edge=>edge.from.node===joint.id||edge.to.node===joint.id).length,4);
 assert.equal(computeFlow(project.nodes,project.edges).activeEdges.size,4);
 const crossing=run(project,canvas(100,-100),canvas(100,100),[{x:100,y:-100},{x:100,y:100}],{idFactory});
 const flow=computeFlow(crossing.project.nodes,crossing.project.edges);
 assert.equal(flow.activeEdges.has(crossing.edgeId),false);assert.equal(flow.activeEdges.size,4);
});

test('one visible riser can still isolate its two logical sides and reject same-side bypasses',()=>{
 const valve={id:'v',type:'valve',variant:'riser',x:200,y:0,open:false};
 let sequence=0;const idFactory=prefix=>prefix+'route'+(++sequence);
 let project={nodes:[{...tank},valve],edges:[]};
 const upstream=run(project,port('tank','out'),port('v','in'),[{x:50,y:0},{x:200,y:0}],{idFactory});project=upstream.project;
 const downstream=run(project,port('v','out'),canvas(400,0),[{x:200,y:0},{x:400,y:0}],{idFactory});project=downstream.project;
 const closed=computeFlow(project.nodes,project.edges);assert.equal(closed.activeEdges.has(upstream.edgeId),true);assert.equal(closed.activeEdges.has(downstream.edgeId),false);
 project.nodes.find(node=>node.id==='v').open=true;assert.equal(computeFlow(project.nodes,project.edges).activeEdges.size,2);
 const before=structuredClone(project);
 assert.throws(()=>run(project,port('v','in'),canvas(200,200),[{x:200,y:0},{x:200,y:200}],{idFactory}),/這一側已接管/);
 assert.deepEqual(project,before);
});

test('near endpoint attaches to original port without creating a tiny split segment',()=>{
 const source={nodes:[{...tank},{...outlet}],edges:[{id:'main',from:port('tank','out'),to:port('out','in'),kind:'normal'}]};
 const {project}=run(source,{edge:'main',point:{x:.3,y:0},path:[{x:0,y:0},{x:500,y:0}]},canvas(100,100),[{x:.3,y:0},{x:100,y:100}]);
 assert.equal(project.edges.length,2);assert.equal(project.nodes.length,3);assert.deepEqual(project.edges[1].from,port('tank','out'));
});

test('occupied blind flange, invalid ports, zero-length, same-node and same-edge runs reject atomically',()=>{
 const source={nodes:[{...tank},{id:'cap',type:'cap',x:200,y:0}],edges:[{id:'sealed',from:port('tank','out'),to:port('cap','in')}]};
 const before=structuredClone(source);
 const attempts=[
  ()=>run(source,port('cap','in'),canvas(300,0),[{x:200,y:0},{x:300,y:0}]),
  ()=>run(source,port('tank','missing'),canvas(300,0),[{x:0,y:0},{x:300,y:0}]),
  ()=>run(source,canvas(100,100),canvas(100,100),[{x:100,y:100},{x:100,y:100}]),
  ()=>run(source,port('tank','out'),port('tank','out'),[{x:0,y:0},{x:100,y:100},{x:0,y:0}]),
  ()=>run(source,{edge:'sealed',point:{x:50,y:0},path:[{x:0,y:0},{x:200,y:0}]},{edge:'sealed',point:{x:100,y:0},path:[{x:0,y:0},{x:200,y:0}]},[{x:50,y:0},{x:100,y:0}])
 ];
 for(const attempt of attempts){assert.throws(attempt);assert.deepEqual(source,before);}
});

test('failed split, malformed coordinates and quantity limits leave no orphan nodes or partial pipes',()=>{
 const source=main(),before=structuredClone(source);
 assert.throws(()=>run(source,{edge:'main',point:{x:250,y:200},path:mainPath},port('missing','in'),[{x:250,y:200},{x:400,y:400}]),/接點無效/);
 assert.deepEqual(source,before);
 for(const bad of [NaN,Infinity,10001,'200'])assert.throws(()=>run(source,canvas(0,0),canvas(bad,100),[{x:0,y:0},{x:bad,y:100}]),/座標無效/);
 assert.throws(()=>run(source,canvas(0,0),canvas(1,1),[{x:0,y:0},{x:1,y:1}],{idFactory:()=> 'main'}),/編號重複/);
 const crowded={nodes:Array.from({length:400},(_,i)=>({id:'point'+i,type:'point',x:i,y:0,name:'',code:''})),edges:[]};
 const crowdedBefore=structuredClone(crowded);
 assert.throws(()=>run(crowded,canvas(0,100),canvas(100,100),[{x:0,y:100},{x:100,y:100}]),/最多支援/);
 assert.deepEqual(crowded,crowdedBefore);
});
