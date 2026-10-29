import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePipeLayer, pipeDrawOrder, reorderPipes} from '../dist/pipe-order.js';
import {computeFlow} from '../dist/flow.js';
import {captureOperation, operationMatches, topologySignature} from '../dist/operations.js';

const entries = project => [
  ...project.nodes.filter(node => node.type === 'pipe').map(node => ({...node,group:'node'})),
  ...project.edges.map(edge => ({...edge,group:'edge'}))
];
const order = project => pipeDrawOrder(entries(project)).map(item => `${item.group}:${item.id}`);
const flowSnapshot = project => {
  const flow = computeFlow(project.nodes, project.edges);
  return {edges:[...flow.activeEdges], ports:[...flow.activePorts],
    fuels:[...flow.activeEdgeFuels].map(([id,fuels])=>[id,[...fuels]])};
};
function diagram() {
  const project={title:'管段交叉測試', nodes:[
    {id:'tank',type:'tank',x:100,y:100,name:'油源',fuel:'diesel',enabled:true},
    {id:'valve',type:'valve',x:300,y:100,code:'V-01',open:false,variant:'riser'},
    {id:'straight',type:'pipe',x:500,y:100,length:240,rotation:90,kind:'underground'},
    {id:'bridge',type:'pipe',x:350,y:250,length:320,rotation:0,kind:'bridge'},
    {id:'outlet',type:'outlet',x:700,y:100}
  ], edges:[
    {id:'up',from:{node:'tank',port:'out'},to:{node:'valve',port:'in'},kind:'normal',routing:'free',waypoints:[{x:200,y:150}]},
    {id:'down',from:{node:'valve',port:'out'},to:{node:'straight',port:'in'},kind:'bridge',routing:'orthogonal',waypoints:[]},
    {id:'end',from:{node:'straight',port:'out'},to:{node:'outlet',port:'in'},kind:'underground',routing:'free',waypoints:[{x:600,y:50}]}
  ], metadata:{keep:'保留所有資料'}};
  project.operations=[captureOperation(project,{id:'op',name:'停止輸油',createdAt:100})];
  return project;
}

test('legacy pipes use their existing normal/bridge order with stable ties', () => {
  const list=[
    {group:'node',id:'bridge',kind:'bridge'},
    {group:'edge',id:'regular2'},
    {group:'edge',id:'jump',kind:'bridge'},
    {group:'node',id:'regular'},
    {group:'edge',id:'regular1',kind:'normal'}
  ];
  const before=structuredClone(list), result=pipeDrawOrder(list);
  assert.deepEqual(result.map(item=>item.id),['regular','regular2','regular1','jump','bridge']);
  assert.deepEqual(list,before);
  assert.notEqual(result,list);
  assert.equal(result[0],list[3]);
});

test('explicit layers override bridge priority and malformed values safely use the default', () => {
  for(const invalid of [undefined,null,'3',1.5,NaN,Infinity,10001,-10001,Number.MAX_SAFE_INTEGER])assert.equal(normalizePipeLayer(invalid),0);
  for(const value of [-10000,-1,0,5,10000])assert.equal(normalizePipeLayer(value),value);
  const result=pipeDrawOrder([
    {group:'node',id:'jump',kind:'bridge',layer:-1},
    {group:'edge',id:'top',kind:'normal',layer:1},
    {group:'node',id:'regular',layer:'99'}
  ]);
  assert.deepEqual(result.map(item=>item.id),['jump','regular','top']);
});

test('edge and legacy standalone pipes can each be moved repeatedly above or below every pipe', () => {
  const source=diagram();
  assert.deepEqual(order(source),['node:straight','edge:up','edge:end','edge:down','node:bridge']);
  const top=reorderPipes(source,{kind:'edge',id:'up'},'top');
  assert.equal(order(top).at(-1),'edge:up');
  const otherTop=reorderPipes(top,{kind:'node',id:'straight'},'top');
  assert.equal(order(otherTop).at(-1),'node:straight');
  const bottom=reorderPipes(otherTop,{kind:'node',id:'bridge'},'bottom');
  assert.equal(order(bottom)[0],'node:bridge');
  assert.deepEqual(reorderPipes(bottom,{kind:'node',id:'bridge'},'bottom'),bottom);
  assert.deepEqual(pipeDrawOrder(entries(bottom)).map(item=>item.layer),[0,1,2,3,4]);
});

test('layer changes preserve all graph, fluid, geometry and operation data and do not mutate the source', () => {
  const source=diagram(), before=structuredClone(source);
  const result=reorderPipes(source,{kind:'edge',id:'up'},'top');
  assert.deepEqual(source,before);
  assert.equal(topologySignature(result),topologySignature(source));
  assert.equal(operationMatches(result,source.operations[0]),true);
  assert.deepEqual(flowSnapshot(result),flowSnapshot(source));
  assert.deepEqual(result.operations,source.operations);
  assert.deepEqual(result.metadata,source.metadata);
  assert.notEqual(result.nodes[0],source.nodes[0]);
  for(const node of result.nodes)if(node.type==='pipe')delete node.layer;
  for(const edge of result.edges)delete edge.layer;
  assert.deepEqual(result,source);
});

test('wrong targets and invalid requests reject atomically', () => {
  const source=diagram(), before=structuredClone(source);
  for(const target of [null,{kind:'edge',id:''},{kind:'wrong',id:'up'},{kind:'edge',id:'gone'},{kind:'node',id:'valve'}])assert.throws(()=>reorderPipes(source,target,'top'),/管段/);
  assert.throws(()=>reorderPipes(source,{kind:'edge',id:'up'},'front'),/上層或下層/);
  assert.throws(()=>reorderPipes({nodes:[]},{kind:'edge',id:'up'},'top'),/圖面資料/);
  assert.deepEqual(source,before);
  assert.throws(()=>pipeDrawOrder(null),/顯示資料/);
  assert.throws(()=>pipeDrawOrder([{group:'invalid'}]),/顯示資料/);
});
