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

test('large reference pages allow pipe endpoints and bends throughout the expanded coordinate bounds',()=>{
 const source=freeze({nodes:[],edges:[]});
 const {project}=run(source,canvas(-40000,-40000),canvas(40000,40000),
  [{x:-40000,y:-40000},{x:29000,y:30000},{x:40000,y:40000}]);
 assert.deepEqual(project.nodes.map(({x,y})=>({x,y})),[{x:-40000,y:-40000},{x:40000,y:40000}]);
 assert.deepEqual(project.edges[0].waypoints,[{x:29000,y:30000}]);
 assert.deepEqual(source,{nodes:[],edges:[]});
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
 const source={nodes:[{id:'joint',type:'point',x:0,y:0},{...outlet}],edges:[{id:'main',from:port('joint','joint'),to:port('out','in'),kind:'normal'}]};
 const {project}=run(source,{edge:'main',point:{x:.3,y:0},path:[{x:0,y:0},{x:500,y:0}]},canvas(100,100),[{x:.3,y:0},{x:100,y:100}]);
 assert.equal(project.edges.length,2);assert.equal(project.nodes.length,3);assert.deepEqual(project.edges[1].from,port('joint','joint'));
});

test('tank inlet and outlet each accept one connection without altering nozzle geometry or old edges',()=>{
 const storage={...tank,enabled:false,inAngle:120,outAngle:30,scale:1.5};
 let sequence=0;const idFactory=prefix=>prefix+'tank'+(++sequence);
 const received=run({nodes:[storage,{id:'feed',type:'ground',x:-200,y:0,enabled:true,fuel:'gasoline'}],edges:[]},
  port('feed','port'),port('tank','in'),[{x:-164,y:0},{x:-40,y:65}],{idFactory});
 const delivered=run(received.project,port('tank','out'),canvas(300,0),[{x:65,y:37},{x:300,y:0}],{idFactory});
 assert.deepEqual(delivered.project.nodes.find(n=>n.id==='tank'),storage);
 assert.deepEqual(delivered.project.edges[0].to,port('tank','in'));
 assert.deepEqual(delivered.project.edges[1].from,port('tank','out'));
 const flow=computeFlow(delivered.project.nodes,delivered.project.edges);
 assert.equal(flow.activeEdges.has(received.edgeId),true);
 assert.equal(flow.activeEdges.has(delivered.edgeId),false);
 for(const side of ['in','out']){
  const before=structuredClone(delivered.project);
  assert.throws(()=>run(delivered.project,port('tank',side),canvas(500,200),[{x:0,y:0},{x:500,y:200}],{idFactory}),/已接管/);
  assert.deepEqual(delivered.project,before);
 }
});

test('legacy multiple outlet pipes remain loadable during unrelated edits but cannot acquire another nozzle branch',()=>{
 const project={nodes:[{...tank},{id:'a',type:'point',x:200,y:0},{id:'b',type:'point',x:0,y:200}],
  edges:[{id:'old-a',from:port('tank','out'),to:port('a','joint')},{id:'old-b',from:port('tank','out'),to:port('b','joint')}]};
 const edited=run(project,canvas(400,400),canvas(600,400),[{x:400,y:400},{x:600,y:400}]);
 assert.deepEqual(edited.project.edges.slice(0,2),project.edges);
 assert.throws(()=>run(project,{edge:'old-a',point:{x:.3,y:0},path:[{x:0,y:0},{x:200,y:0}]},canvas(100,100),[{x:.3,y:0},{x:100,y:100}]),/已接管/);
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
 for(const bad of [NaN,Infinity,40001,-40001,'200'])assert.throws(()=>run(source,canvas(0,0),canvas(bad,100),[{x:0,y:0},{x:bad,y:100}]),/座標無效/);
 assert.throws(()=>run(source,canvas(0,0),canvas(1,1),[{x:0,y:0},{x:1,y:1}],{idFactory:()=> 'main'}),/編號重複/);
 const crowded={nodes:Array.from({length:400},(_,i)=>({id:'point'+i,type:'point',x:i,y:0,name:'',code:''})),edges:[]};
 const crowdedBefore=structuredClone(crowded);
 assert.throws(()=>run(crowded,canvas(0,100),canvas(100,100),[{x:0,y:100},{x:100,y:100}]),/最多支援/);
 assert.deepEqual(crowded,crowdedBefore);
});

test('ground endpoints connect through a valve without extra points or lost station metadata',()=>{
 const source={nodes:[
  {id:'rise',type:'ground',variant:'rise',x:0,y:0,name:'出土端',code:'G-1',station:'通霄中繼站',enabled:true,fuel:'diesel'},
  {id:'valve',type:'valve',x:200,y:0,open:false},
  {id:'sink',type:'ground',variant:'sink',x:400,y:0,name:'入土端',code:'G-2',station:'台中供油中心',enabled:false,fuel:'fuel'}
 ],edges:[],metadata:{preserve:'原註記'}};
 const before=structuredClone(source);let sequence=0;const idFactory=prefix=>prefix+'ground'+(++sequence);
 const upstream=run(source,port('rise','port'),port('valve','in'),[{x:36,y:0},{x:164,y:0}],{idFactory});
 const downstream=run(upstream.project,port('valve','out'),port('sink','port'),[{x:236,y:0},{x:364,y:0}],{kind:'underground',idFactory});
 assert.deepEqual(source,before);assert.deepEqual(downstream.project.nodes,source.nodes);
 assert.equal(downstream.project.edges.length,2);
 assert.deepEqual(downstream.project.edges.map(edge=>[edge.from,edge.to]),[
  [port('rise','port'),port('valve','in')],[port('valve','out'),port('sink','port')]
 ]);
 assert.equal(downstream.project.edges[1].kind,'underground');
 assert.deepEqual(downstream.project.metadata,source.metadata);
});

test('splitting a ground-fed pipe preserves station, source settings, and pipe metadata',()=>{
 const source={nodes:[
  {id:'rise',type:'ground',variant:'rise',x:0,y:0,station:'通霄中繼站',enabled:true,fuel:'diesel'},
  {id:'sink',type:'ground',variant:'sink',x:400,y:0,station:'油庫',enabled:false,fuel:'fuel'}
 ],edges:[{id:'groundMain',from:port('rise','port'),to:port('sink','port'),kind:'underground',routing:'free',waypoints:[],layer:3}],operations:[{preserve:'原作業'}]};
 const before=structuredClone(source);
 const {project,edgeId}=run(source,{edge:'groundMain',point:{x:200,y:0},path:[{x:36,y:0},{x:364,y:0}]},canvas(200,200),[{x:200,y:0},{x:200,y:200}]);
 assert.deepEqual(source,before);assert.equal(project.edges.length,3);
 for(const id of ['rise','sink'])assert.deepEqual(project.nodes.find(node=>node.id===id),source.nodes.find(node=>node.id===id));
 assert.deepEqual(project.operations,source.operations);
 for(const edge of project.edges.filter(edge=>edge.id!==edgeId)){
  assert.equal(edge.kind,'underground');assert.equal(edge.layer,3);
 }
});

test('invalid ground port rejects atomically, including when another pipe would have been split',()=>{
 const source={nodes:[
  {id:'rise',type:'ground',variant:'rise',x:0,y:0,station:'通霄中繼站',enabled:true,fuel:'diesel'},
  {id:'sink',type:'ground',variant:'sink',x:400,y:0,station:'油庫',enabled:false,fuel:'fuel'}
 ],edges:[{id:'groundMain',from:port('rise','port'),to:port('sink','port'),routing:'free',waypoints:[]}]};
 const before=structuredClone(source);
 for(const attempt of [
  ()=>run(source,port('rise','out'),canvas(200,200),[{x:36,y:0},{x:200,y:200}]),
  ()=>run(source,{edge:'groundMain',point:{x:200,y:0},path:[{x:36,y:0},{x:364,y:0}]},port('sink','in'),[{x:200,y:0},{x:364,y:0}])
 ]){assert.throws(attempt,/接點無效/);assert.deepEqual(source,before);}
});

test('text annotations remain unchanged during pipe drawing and branching',()=>{
 const annotation={id:'note',type:'text',x:120,y:80,name:'往台中供油',code:'',text:'柴油作業\n請確認閥位',fontSize:18,rotation:35,color:'#aabbcc'};
 const source={nodes:[{...tank},{...outlet},annotation],edges:[]};
 const before=structuredClone(source);let sequence=0;const idFactory=prefix=>prefix+'label'+(++sequence);
 const drawn=run(source,port('tank','out'),port('out','in'),[{x:50,y:0},{x:467,y:0}],{idFactory});
 assert.deepEqual(drawn.project.nodes.find(node=>node.id==='note'),annotation);
 const branched=run(drawn.project,{edge:drawn.edgeId,point:{x:200,y:0},path:[{x:50,y:0},{x:467,y:0}]},canvas(200,200),[{x:200,y:0},{x:200,y:200}],{idFactory});
 assert.deepEqual(branched.project.nodes.find(node=>node.id==='note'),annotation);
 assert.equal(branched.project.edges.length,3);assert.deepEqual(source,before);
});

test('text annotations cannot become pipe endpoints and rejection is atomic',()=>{
 const source={nodes:[{...tank},{id:'note',type:'text',x:200,y:100,text:'此處不接管',fontSize:16}],edges:[]};
 const before=structuredClone(source);
 for(const side of ['port','in','out','joint']){
  assert.throws(()=>run(source,port('tank','out'),port('note',side),[{x:50,y:0},{x:200,y:100}]),/接點無效/);
  assert.deepEqual(source,before);
 }
 const connected=run(source,port('tank','out'),canvas(400,0),[{x:50,y:0},{x:400,y:0}]).project;
 const connectedBefore=structuredClone(connected);
 let sequence=0;const idFactory=prefix=>prefix+'textreject'+(++sequence);
 assert.throws(()=>run(connected,{edge:connected.edges[0].id,point:{x:200,y:0},path:[{x:50,y:0},{x:400,y:0}]},port('note','port'),[{x:200,y:0},{x:200,y:100}],{idFactory}),/接點無效/);
 assert.deepEqual(connected,connectedBefore);
});
