import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReference, transformReference} from '../dist/reference-layout.js';
import {captureOperation, operationMatches, topologySignature} from '../dist/operations.js';

const image = 'data:image/png;base64,AAAA';
function diagram() {
  const project = {title:'底圖對照', reference:{dataUrl:image,width:2000,height:1000,x:100,y:50,opacity:.3},
    nodes:[
      {id:'tank',type:'tank',x:200,y:150,enabled:true,fuel:'diesel',capacity:50000},
      {id:'v1',type:'valve',code:'RN-G2',x:500,y:300,open:false,rotation:37,variant:'riser'},
      {id:'pipe',type:'pipe',x:700,y:400,length:160,rotation:90,kind:'underground'}
    ], edges:[
      {id:'p1',from:{node:'tank',port:'out'},to:{node:'v1',port:'in'},routing:'free',kind:'bridge',waypoints:[{x:300,y:200}]},
      {id:'p2',from:{node:'v1',port:'out'},to:{node:'pipe',port:'in'},routing:'orthogonal',waypoints:[{x:600,y:350}]}
    ], metadata:{keep:'原始註記'}};
  project.operations=[captureOperation(project,{id:'op1',name:'停止供油',createdAt:100})];
  return project;
}

test('legacy references receive stable original dimensions and compatible defaults', () => {
  const reference={dataUrl:image,width:1721,height:914};
  const normalized=normalizeReference(reference);
  assert.deepEqual(normalized,{...reference,baseWidth:1721,baseHeight:914,x:0,y:0,visible:true,opacity:.22});
  assert.deepEqual(normalizeReference(normalized),normalized);
  assert.equal('baseWidth' in reference,false);
  const limited=normalizeReference({...reference,x:-20000,y:20000,opacity:2,visible:false});
  assert.deepEqual([limited.x,limited.y,limited.opacity,limited.visible],[-10000,10000,.6,false]);
  const large=normalizeReference({...reference,width:6000,height:3000});
  assert.deepEqual([large.baseWidth,large.baseHeight],[3000,1500]);
});

test('scaling spreads nodes and free bends while preserving component sizes, connectivity and operations', () => {
  const source=diagram(), before=structuredClone(source);
  const changed=transformReference(source,{scale:200,x:300,y:100,moveLayout:true});
  assert.deepEqual([changed.reference.width,changed.reference.height,changed.reference.x,changed.reference.y],[4000,2000,300,100]);
  assert.deepEqual(changed.nodes.map(({x,y})=>[x,y]),[[500,300],[1100,600],[1500,800]]);
  assert.deepEqual(changed.edges[0].waypoints,[{x:700,y:400}]);
  assert.deepEqual(changed.edges[1].waypoints,source.edges[1].waypoints);
  assert.equal(changed.nodes[2].length,160);
  assert.equal(changed.nodes[1].rotation,37);
  assert.equal(changed.nodes[1].open,false);
  assert.equal(changed.nodes[1].variant,'riser');
  assert.deepEqual(changed.operations,source.operations);
  assert.deepEqual(changed.metadata,source.metadata);
  assert.equal(topologySignature(changed),topologySignature(source));
  assert.equal(operationMatches(changed,source.operations[0]),true);
  assert.deepEqual(source,before);
  assert.notEqual(changed.nodes[0],source.nodes[0]);
});

test('repeated scale values use the original dimensions rather than compound the enlargement', () => {
  const original=diagram();
  const enlarged=transformReference(original,{scale:300,moveLayout:true});
  const again=transformReference(enlarged,{scale:300,moveLayout:true});
  assert.deepEqual(again,enlarged);
  const restored=transformReference(enlarged,{scale:100,moveLayout:true});
  assert.deepEqual(restored.nodes,original.nodes);
  assert.deepEqual(restored.edges,original.edges);
  assert.deepEqual([restored.reference.width,restored.reference.height],[2000,1000]);
});

test('position-only adjustment translates the full layout without changing the oil state', () => {
  const source=diagram();
  const moved=transformReference(source,{scale:100,x:-50,y:200,moveLayout:true});
  assert.deepEqual(moved.nodes.map(({x,y})=>[x,y]),[[50,300],[350,450],[550,550]]);
  assert.deepEqual(moved.edges[0].waypoints,[{x:150,y:350}]);
  assert.deepEqual(moved.operations,source.operations);
  assert.equal(moved.nodes[0].fuel,'diesel');
  assert.equal(moved.nodes[0].enabled,true);
});

test('independent reference changes leave every node and bend in place', () => {
  const source=diagram();
  const moved=transformReference(source,{scale:250,x:1000,y:-300,moveLayout:false});
  assert.deepEqual(moved.nodes,source.nodes);
  assert.deepEqual(moved.edges,source.edges);
  assert.deepEqual([moved.reference.width,moved.reference.height,moved.reference.x,moved.reference.y],[5000,2500,1000,-300]);
  const minimal=transformReference(source,{scale:25});
  assert.deepEqual([minimal.reference.width,minimal.reference.height],[500,250]);
});

test('out-of-range synchronized coordinates reject atomically without touching the source', () => {
  const source=diagram();source.nodes[2].x=9000;
  const before=structuredClone(source);
  assert.throws(()=>transformReference(source,{scale:500,moveLayout:true}),/超出位置範圍/);
  assert.deepEqual(source,before);
  source.nodes[2].x=700;source.edges[0].waypoints[0].y=-9000;
  const routeBefore=structuredClone(source);
  assert.throws(()=>transformReference(source,{scale:200,moveLayout:true}),/超出位置範圍/);
  assert.deepEqual(source,routeBefore);
});

test('malformed references and transform options reject unsafe coercion and invalid dimensions', () => {
  const source=diagram();
  for(const scale of [NaN,Infinity,'200',24,501])assert.throws(()=>transformReference(source,{scale}),/縮放比例/);
  for(const position of [NaN,Infinity,'200',10001,-10001])assert.throws(()=>transformReference(source,{scale:100,x:position}),/底圖位置/);
  assert.throws(()=>transformReference(source,{scale:100,moveLayout:'false'}),/同步調整/);
  assert.throws(()=>transformReference({nodes:[],edges:[]},{scale:100}),/先載入/);
  for(const reference of [null,{...source.reference,dataUrl:'https://example.com/image.png'},
    {...source.reference,width:Infinity},{...source.reference,height:16001},
    {...source.reference,baseWidth:1000,baseHeight:1000},
    {...source.reference,baseWidth:'2000',baseHeight:1000}])assert.throws(()=>normalizeReference(reference),/底圖/);
  assert.throws(()=>transformReference({...source,reference:{dataUrl:image,width:1,height:1}},{scale:25}),/尺寸超過範圍/);
});
