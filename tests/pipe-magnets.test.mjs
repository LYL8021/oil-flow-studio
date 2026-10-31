import test from 'node:test';
import assert from 'node:assert/strict';
import {componentPort} from '../dist/component-geometry.js';
import {computeFlow} from '../dist/flow.js';
import {reconnectPipeEndpoint,fitStandalonePipeEndpoint,findMagneticPort} from '../dist/pipe-magnets.js';

const ep=(node,port)=>({node,port});
const node=(id,type,x,y,extra={})=>({id,type,x,y,...extra});
const edge=(id,from,to,extra={})=>({id,from,to,...extra});
const near=(a,b,t=.011)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const base=()=>({title:'保留原圖',operations:[],nodes:[node('src','ground',0,100,{enabled:true,fuel:'diesel'}),node('loose','point',120,100),node('valve','valve',250,100,{open:false}),node('end','outlet',450,100)],edges:[edge('feed',ep('src','port'),ep('loose','joint'),{kind:'bridge',layer:9,routing:'free',waypoints:[{x:70,y:120}]}),edge('down',ep('valve','out'),ep('end','in'))]});

test('free end magnet rebinds the graph, removes only orphan point and respects closed valve',()=>{
 const project=base(),snapshot=structuredClone(project);
 const next=reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('valve','in')}).project;
 assert.deepEqual(project,snapshot);assert.equal(next.nodes.some(n=>n.id==='loose'),false);
 assert.deepEqual(next.edges.find(e=>e.id==='feed'),{...project.edges[0],to:ep('valve','in')});
 assert.deepEqual(next.operations,project.operations);assert.equal(next.title,project.title);
 let flow=computeFlow(next.nodes,next.edges);assert.ok(flow.activeEdges.has('feed'));assert.equal(flow.activeEdges.has('down'),false);
 next.nodes.find(n=>n.id==='valve').open=true;flow=computeFlow(next.nodes,next.edges);assert.ok(flow.activeEdges.has('down'));
});

test('magnet allows explicit join at another point without joining unrelated visual crossings',()=>{
 const project=base();project.nodes.push(node('joint','point',250,250));
 project.edges.push(edge('branch',ep('joint','joint'),ep('end','in')));
 const next=reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('joint','joint')}).project;
 assert.deepEqual(next.edges.find(e=>e.id==='feed').to,ep('joint','joint'));
 assert.equal(next.edges.find(e=>e.id==='branch').from.node,'joint');
 assert.equal(next.nodes.some(n=>n.id==='loose'),false);
});

test('occupied cap/tank and invalid self targets reject atomically; riser center takes remaining side',()=>{
 for(const type of ['tank','cap']){
  const project=base(),port=type==='tank'?'in':'in';project.nodes.push(node('full',type,220,220));project.edges.push(edge('existing',ep('full',port),ep('end','in')));
  const snapshot=structuredClone(project);assert.throws(()=>reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('full',port)}),/已接管/);assert.deepEqual(project,snapshot);
 }
 const project=base();assert.throws(()=>reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('src','port')}),/另一個/);
 project.nodes.push(node('riser','valve',300,300,{variant:'riser'}));project.edges.push(edge('riser-in',ep('riser','in'),ep('end','in')));
 const next=reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('riser','center')}).project;
 assert.deepEqual(next.edges.find(e=>e.id==='feed').to,ep('riser','out'));
 assert.throws(()=>reconnectPipeEndpoint({...next,nodes:[...next.nodes,node('loose2','point',100,300)],edges:[...next.edges,edge('free2',ep('loose2','joint'),ep('src','port'))]},{edgeId:'free2',end:'from',target:ep('riser','center')}),/無法連接/);
});

test('shared junction endpoints cannot be moved as if they were a free pipe end',()=>{
 const project=base();project.edges.push(edge('branch',ep('loose','joint'),ep('end','in')));
 assert.throws(()=>reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('valve','in')}),/自由端/);
});

test('operational idle/closed roles do not prevent a physical endpoint connection',()=>{
 const project=base();project.nodes.push(node('idle','ground',300,300,{enabled:false,flowMode:'idle'}));
 const next=reconnectPipeEndpoint(project,{edgeId:'feed',end:'to',target:ep('idle','port')}).project;
 assert.deepEqual(next.edges.find(e=>e.id==='feed').to,ep('idle','port'));
 assert.equal(computeFlow(next.nodes,next.edges).activeEdges.has('feed'),false);
 next.nodes.find(n=>n.id==='idle').flowMode='receive';
 assert.equal(computeFlow(next.nodes,next.edges).activeEdges.has('feed'),true);
});

test('standalone endpoint fit fixes the other port and creates coincident explicit graph link',()=>{
 const project={nodes:[node('source','tank',-100,0,{enabled:true,fuel:'gasoline'}),node('pipe','pipe',100,0,{length:160,scale:1.2,rotation:15,kind:'underground',layer:4}),node('v','valve',430,160,{open:true})],edges:[edge('supply',ep('source','out'),ep('pipe','in'))]};
 const before=structuredClone(project),fixed=componentPort(project.nodes[1],'in'),target=componentPort(project.nodes[2],'in');
 const result=fitStandalonePipeEndpoint(project,{nodeId:'pipe',port:'out',target:ep('v','in'),idFactory:()=> 'newlink'}),next=result.project,p=next.nodes.find(n=>n.id==='pipe');
 assert.deepEqual(project,before);near(componentPort(p,'in').x,fixed.x);near(componentPort(p,'in').y,fixed.y);near(componentPort(p,'out').x,target.x);near(componentPort(p,'out').y,target.y);
 assert.equal(p.kind,'underground');assert.equal(p.layer,4);assert.equal(p.scale,1.2);assert.equal(result.edgeId,'newlink');
 assert.deepEqual(next.edges.find(e=>e.id==='newlink'),{id:'newlink',from:ep('pipe','out'),to:ep('v','in'),routing:'free',waypoints:[],kind:'normal'});
 assert.ok(computeFlow(next.nodes,next.edges).activeNodes.has('v'));
});

test('standalone free dragging handles inlet orientation and rejects limits/collisions before mutation',()=>{
 const project={nodes:[node('pipe','pipe',100,100,{length:160,rotation:90}),node('v','valve',400,0)],edges:[]},before=structuredClone(project),fixed=componentPort(project.nodes[0],'out');
 const fitted=fitStandalonePipeEndpoint(project,{nodeId:'pipe',port:'in',targetPosition:{x:-40,y:100}}).project.nodes[0];
 near(componentPort(fitted,'out').x,fixed.x);near(componentPort(fitted,'out').y,fixed.y);near(componentPort(fitted,'in').x,-40);near(componentPort(fitted,'in').y,100);
 for(const p of [{x:fixed.x,y:fixed.y},{x:40001,y:0},{x:39000,y:0}])assert.throws(()=>fitStandalonePipeEndpoint(project,{nodeId:'pipe',port:'in',targetPosition:p}));
 assert.throws(()=>fitStandalonePipeEndpoint(project,{nodeId:'pipe',port:'in',target:ep('v','in'),idFactory:()=> 'pipe'}),/重複/);assert.deepEqual(project,before);
});

test('screen-space magnetic radius stays fixed under zoom and filters occupied/own ports',()=>{
 const project=base(),target=componentPort(project.nodes.find(n=>n.id==='valve'),'in');
 const options={sourceNodeId:'loose',otherNodeId:'src',ignoreEdgeId:'feed',position:{x:target.x-10,y:target.y}};
 assert.equal(findMagneticPort(project,{...options,screenScale:1})?.node,'valve');
 assert.equal(findMagneticPort(project,{...options,screenScale:2}),null);
 assert.equal(findMagneticPort(project,{...options,screenScale:.2})?.node,'valve');
 project.nodes.push(node('full','cap',target.x-12,target.y));project.edges.push(edge('full-edge',ep('full','in'),ep('end','in')));
 assert.equal(findMagneticPort(project,{...options,screenScale:1})?.node,'valve');
});
