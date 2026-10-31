import test from 'node:test';
import assert from 'node:assert/strict';
import {copyComponent,pasteComponent,copyPipeSegment,pastePipeSegment} from '../dist/component-clipboard.js';
import {computeFlow} from '../dist/flow.js';

const ids = () => {let count=0;return prefix=>prefix+'copy'+(++count);};
const source={id:'tank',type:'tank',x:100,y:200,name:'供油槽',code:'TC-08',note:'依圖核對',review:true,
  rotation:37,scale:1.75,inAngle:95,outAngle:280,enabled:false,fuel:'gasoline',capacity:25000};
const main=()=>({title:'庫區圖',nodes:[{...source},{id:'v',type:'valve',x:400,y:200,code:'V-01',open:false}],
  edges:[{id:'line',from:{node:'tank',port:'out'},to:{node:'v',port:'in'},routing:'free',kind:'bridge',waypoints:[{x:200,y:300}]}],
  reference:{metadata:{keep:true}},operations:[{id:'operation',valves:[{id:'v',open:false}]}]});
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('clipboard snapshot is detached and preserves fuel, blank labels, geometry and review settings',()=>{
 const node={...source},clipboard=copyComponent(node);assert.deepEqual(clipboard,node);assert.notEqual(clipboard,node);
 node.name='改名';node.enabled=true;assert.equal(clipboard.name,'供油槽');assert.equal(clipboard.enabled,false);
 assert.equal(copyComponent({...source,code:''}).code,'');
 assert.equal(copyComponent({...source,code:'  '}).code,'  ');
});

test('single-component paste keeps graph, presets and source settings while assigning a fresh identity',()=>{
 const project=freeze(main()),clipboard=freeze(copyComponent(source));
 const result=pasteComponent(project,clipboard,{position:{x:600,y:700},offset:{x:20,y:-10},idFactory:ids()});
 assert.equal(result.nodeId,'ncopy1');assert.equal(result.project.nodes.length,3);assert.equal(project.nodes.length,2);
 assert.deepEqual(result.project.edges,project.edges);assert.deepEqual(result.project.operations,project.operations);
 assert.deepEqual(result.project.reference,project.reference);assert.notEqual(result.project.reference,project.reference);
 assert.deepEqual(result.project.nodes.at(-1),{...source,id:'ncopy1',code:'TC-09',x:620,y:690});
 assert.equal(result.project.edges.some(edge=>edge.from.node==='ncopy1'||edge.to.node==='ncopy1'),false);
});

test('every equipment type, standalone pipe and text can paste without losing its applicable metadata',()=>{
 const examples=[
  {type:'valve',variant:'riser',open:false,rotation:90,scale:.5},
  {type:'ground',variant:'sink',enabled:false,fuel:'diesel',station:'通霄',rotation:15},
  {type:'pipe',length:380,kind:'underground',layer:7,rotation:35,scale:2},
  {type:'text',text:'日南\n接收油品',fontSize:31,textColor:'#aabbcc',textAlign:'middle',bold:true,scale:1.5},
  ...['point','cap','flowmeter','elbow','filter','junction','cross','outlet'].map(type=>({type}))
 ];
 for(const value of examples){
  const node={id:'original',x:5,y:10,name:'',code:'',...value};
  const {project}=pasteComponent({nodes:[node],edges:[]},copyComponent(node),{offset:{x:20,y:20},idFactory:ids()});
  assert.deepEqual(project.nodes[1],{...node,id:'ncopy1',x:25,y:30},value.type);
 }
});

test('display codes increment with padding and avoid normalized collisions; arbitrary and long codes remain bounded',()=>{
 const run=(code,existing)=>pasteComponent({nodes:existing.map((code,index)=>({id:'node'+index,type:'valve',x:0,y:0,code})),edges:[]},
  {id:'original',type:'valve',x:0,y:0,code},{idFactory:ids()}).project.nodes.at(-1).code;
 assert.equal(run('V-01',['V-01','v-02','Ｖ-03']),'V-04');
 assert.equal(run('TC-08',['TC-08','TC-09']),'TC-10');
 assert.equal(run('備用',['備用','備用-2']),'備用-3');
 const long='元'.repeat(24),longCopy=run(long,[long]);assert.ok(longCopy.length<=24);assert.ok(longCopy.endsWith('-2'));
 const huge=run('9'.repeat(24),['9'.repeat(24)]);assert.ok(huge.length<=24);assert.ok(huge.endsWith('-2'));
 assert.equal(run('',[]),'');
});

test('repeated paste from an unchanged snapshot generates different IDs and available codes',()=>{
 const idFactory=ids(),snapshot=copyComponent(source),first=pasteComponent(main(),snapshot,{idFactory});
 const second=pasteComponent(first.project,snapshot,{idFactory,offset:{x:40,y:40}});
 assert.equal(first.nodeId,'ncopy1');assert.equal(second.nodeId,'ncopy2');
 assert.equal(first.project.nodes.at(-1).code,'TC-09');assert.equal(second.project.nodes.at(-1).code,'TC-10');
 assert.equal(second.project.nodes.at(-1).x,140);assert.equal(snapshot.x,100);assert.equal(snapshot.code,'TC-08');
});

test('coordinate and capacity limits reject atomically and fresh IDs never reuse equipment or pipe IDs',()=>{
 const project=freeze(main()),before=structuredClone(project),clipboard=freeze(copyComponent(source));
 for(const options of [{position:{x:40001,y:0}},{position:{x:40000,y:0},offset:{x:1,y:0}},
  {position:{x:NaN,y:0}},{offset:{x:Infinity,y:0}},{idFactory:()=>source.id},{idFactory:()=>'line'},
  {idFactory:()=>'<script>'},{idFactory:4}])assert.throws(()=>pasteComponent(project,clipboard,options));
 assert.deepEqual(project,before);
 const full={nodes:Array.from({length:400},(_,i)=>({id:'n'+i,type:'point',x:0,y:0})),edges:[]};
 assert.throws(()=>pasteComponent(full,clipboard),/400/);assert.equal(full.nodes.length,400);
 const boundary=pasteComponent(project,clipboard,{position:{x:-40000,y:40000},idFactory:ids()});
 assert.equal(boundary.project.nodes.at(-1).x,-40000);assert.equal(boundary.project.nodes.at(-1).y,40000);
 for(const invalid of [null,{...source,type:'unknown'},{...source,x:40001},{...source,enabled:'true'},{...source,scale:Infinity}])assert.throws(()=>copyComponent(invalid));
});

test('large tank copies retain independent source roles with detached nested settings',()=>{
 const node={...source,scale:30,enabled:true,portModes:{in:'outlet',out:'outlet'}};
 const clipboard=copyComponent(node);
 assert.deepEqual(clipboard.portModes,node.portModes);assert.notEqual(clipboard.portModes,node.portModes);
 const copied=pasteComponent({nodes:[node],edges:[]},clipboard,{position:{x:2000,y:3000},idFactory:ids()});
 const tank=copied.project.nodes.find(n=>n.id===copied.nodeId);
 assert.equal(tank.scale,30);assert.equal(tank.enabled,true);assert.equal(tank.fuel,'gasoline');
 assert.deepEqual(tank.portModes,{in:'outlet',out:'outlet'});assert.notEqual(tank.portModes,clipboard.portModes);
 clipboard.portModes.in='closed';node.portModes.out='closed';
 assert.deepEqual(tank.portModes,{in:'outlet',out:'outlet'});
 const receivers=[{id:'a',type:'outlet',x:0,y:0},{id:'b',type:'outlet',x:0,y:0}];
 const edges=[{id:'first',from:{node:tank.id,port:'in'},to:{node:'a',port:'in'}},
  {id:'second',from:{node:tank.id,port:'out'},to:{node:'b',port:'in'}}];
 const flow=computeFlow([tank,...receivers],edges);
 assert.deepEqual([...flow.activeEdges].sort(),['first','second']);
 assert.deepEqual([...flow.activeEdgeFuels.get('first')],['gasoline']);
 const inletCopy=pasteComponent({nodes:[],edges:[]},copyComponent({...tank,portModes:{in:'inlet',out:'inlet'}}),{idFactory:ids()}).project.nodes[0];
 assert.deepEqual(inletCopy.portModes,{in:'inlet',out:'inlet'});
 const receivingFlow=computeFlow([inletCopy,...receivers],edges.map(edge=>({...edge,from:{...edge.from,node:inletCopy.id}})));
 assert.equal(receivingFlow.activeEdges.size,0);
});

test('idle ground copies remain idle when connected to an external live source',()=>{
 const ground={id:'idle',type:'ground',variant:'sink',x:0,y:0,code:'UG-01',flowMode:'idle',enabled:false,fuel:'diesel',station:'倒打端'};
 const result=pasteComponent({nodes:[ground],edges:[]},copyComponent(ground),{position:{x:100,y:100},idFactory:ids()});
 const pasted=result.project.nodes.at(-1);
 assert.equal(pasted.flowMode,'idle');assert.equal(pasted.enabled,false);assert.equal(pasted.station,'倒打端');
 const tank={id:'source',type:'tank',x:0,y:0,enabled:true},joint={id:'joint',type:'point',x:0,y:0};
 const edges=[{id:'original-idle',from:{node:'source',port:'out'},to:{node:ground.id,port:'port'}},
  {id:'copied-idle',from:{node:'source',port:'out'},to:{node:pasted.id,port:'port'}},
  {id:'live-branch',from:{node:'source',port:'out'},to:{node:'joint',port:'joint'}}];
 const flow=computeFlow([...result.project.nodes,tank,joint],edges);
 assert.deepEqual([...flow.activeEdges],['live-branch']);
 assert.equal(flow.activeNodes.has(pasted.id),false);
 assert.equal(Object.hasOwn(copyComponent({...source}),'portModes'),false);
 assert.equal(Object.hasOwn(copyComponent({...ground,flowMode:undefined}),'flowMode'),false);
});

test('explicit tank port settings normalize into a fresh object and reject invalid containers',()=>{
 assert.deepEqual(copyComponent({...source,portModes:{in:'closed'}}).portModes,{in:'closed',out:'outlet'});
 for(const portModes of [null,[],true,'outlet'])assert.throws(()=>copyComponent({...source,portModes}),/接管口用途/);
 assert.throws(()=>copyComponent({...source,flowMode:1}),/文字資料/);
});

test('pipe copy carries complete route and display settings without equipment endpoints',()=>{
 const edge=main().edges[0],route=[{x:0,y:0},{x:80,y:0},{x:80,y:40},{x:100,y:40}];
 const snapshot=copyPipeSegment({...edge,layer:9},route);
 assert.deepEqual(snapshot,{clipboardType:'pipe-segment',kind:'bridge',layer:9,points:route});
 assert.notEqual(snapshot.points,route);assert.notEqual(snapshot.points[0],route[0]);
 route[0].x=99;assert.equal(snapshot.points[0].x,0);
 assert.equal(snapshot.from,undefined);assert.equal(snapshot.to,undefined);assert.equal(snapshot.id,undefined);
});

test('pasted pipe keeps bends and kind/layer, centers as requested and never duplicates equipment or connections',()=>{
 const project=freeze(main()),before=structuredClone(project);
 const snapshot=freeze(copyPipeSegment({kind:'underground',layer:-4},
  [{x:0,y:0},{x:80,y:0},{x:80,y:40},{x:100,y:40}]));
 const result=pastePipeSegment(project,snapshot,{position:{x:500,y:500},offset:{x:20,y:-10},idFactory:ids()});
 assert.equal(result.edgeId,'pcopy3');assert.equal(result.project.nodes.length,4);assert.equal(result.project.edges.length,2);
 assert.deepEqual(result.project.nodes.slice(-2),[
  {id:'ncopy1',type:'point',x:470,y:470,name:'',code:'',rotation:0},
  {id:'ncopy2',type:'point',x:570,y:510,name:'',code:'',rotation:0}
 ]);
 assert.deepEqual(result.project.edges.at(-1),{id:'pcopy3',kind:'underground',layer:-4,
  from:{node:'ncopy1',port:'joint'},to:{node:'ncopy2',port:'joint'},routing:'free',waypoints:[{x:550,y:470},{x:550,y:510}]});
 assert.deepEqual(result.project.operations,project.operations);assert.deepEqual(result.project.reference,project.reference);
 assert.deepEqual(project,before);
 assert.equal(result.project.nodes.filter(node=>node.type==='tank').length,1);
 assert.equal(result.project.nodes.filter(node=>node.type==='valve').length,1);
});

test('coincident pasted pipe stays hydraulically separate from original live component ports',()=>{
 const project={nodes:[{id:'t',type:'tank',x:0,y:0,enabled:true},{id:'o',type:'outlet',x:100,y:0}],
  edges:[{id:'supply',from:{node:'t',port:'out'},to:{node:'o',port:'in'}}]};
 const clip=copyPipeSegment(project.edges[0],[{x:50,y:0},{x:67,y:0}]);
 const result=pastePipeSegment(project,clip,{idFactory:ids()});
 assert.deepEqual(result.project.nodes.slice(-2).map(({x,y})=>({x,y})),clip.points);
 const flow=computeFlow(result.project.nodes,result.project.edges);
 assert.equal(flow.activeEdges.has('supply'),true);assert.equal(flow.activeEdges.has(result.edgeId),false);
 assert.equal(flow.activeNodes.has('ncopy1'),false);assert.equal(flow.activeNodes.has('ncopy2'),false);
});

test('pipe paste rejects shape, identity, bounds and graph limits atomically',()=>{
 const project=freeze(main()),before=structuredClone(project);
 const clip=freeze(copyPipeSegment({kind:'normal'},[{x:-20,y:0},{x:20,y:0}]));
 for(const options of [{position:{x:40000,y:0}},{position:{x:-40000,y:0}},
  {position:{x:0,y:0},offset:{x:NaN,y:0}},{idFactory:()=>'line'},{idFactory:()=>'repeated'},
  {idFactory:()=>'<bad>'},{idFactory:'invalid'}])assert.throws(()=>pastePipeSegment(project,clip,options));
 assert.deepEqual(project,before);
 const crowded={nodes:Array.from({length:399},(_,i)=>({id:'n'+i,type:'point',x:0,y:0})),edges:[]};
 assert.throws(()=>pastePipeSegment(crowded,clip),/兩個空白接點/);assert.equal(crowded.nodes.length,399);
 const fullEdges={nodes:[],edges:Array.from({length:1600},(_,i)=>({id:'p'+i}))};
 assert.throws(()=>pastePipeSegment(fullEdges,clip),/1600/);assert.equal(fullEdges.edges.length,1600);
 for(const points of [[],[{x:0,y:0}],[{x:0,y:0},{x:0,y:0}],[{x:0,y:0},{x:40001,y:0}]]) {
  assert.throws(()=>copyPipeSegment({kind:'normal'},points));
 }
 assert.throws(()=>copyPipeSegment({kind:'unknown'},clip.points));
 assert.throws(()=>copyPipeSegment({layer:10001},clip.points));
 assert.throws(()=>pastePipeSegment(project,copyComponent(source)));
});
