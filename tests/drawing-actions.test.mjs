import test from 'node:test';
import assert from 'node:assert/strict';
import {applyReference, createBlankDrawing} from '../dist/drawing-actions.js';

const reference = {dataUrl:'data:image/png;base64,AAAA', width:30000, height:15000,
  baseWidth:3000, baseHeight:1500, x:-12000, y:4000, opacity:.25, visible:true};
const project = {
 title:'輸王田', nodes:[{id:'t',type:'tank',x:20000,y:3000,scale:1.5,rotation:25,
  inAngle:130,outAngle:30,enabled:true,fuel:'diesel'}],
 edges:[{id:'p',from:{node:'t',port:'out'},to:{node:'v',port:'in'},routing:'free',waypoints:[{x:21000,y:4000}]}],
 operations:[{id:'operation',name:'日常作業',valves:[{id:'v',open:true}]}],
 draftInfo:{title:'原圖核對事項',reviewNotes:['已確認']},
 reference:{...reference,width:3000,height:1500},
 _savedDrawing:{id:'private-library-record',revision:3}
};

test('fresh drawing has no previous background, operations, name or saved-record identity',()=>{
 const first=createBlankDrawing(),second=createBlankDrawing();
 assert.deepEqual(first,{nodes:[],edges:[]});assert.notEqual(first.nodes,second.nodes);
 first.nodes.push({id:'x'});assert.equal(second.nodes.length,0);
});

test('keeping components preserves source settings, geometry, operations and title in a detached result',()=>{
 const before=structuredClone(project);
 const next=applyReference(project,reference,{keepComponents:true,title:'上傳PDF',draftInfo:{title:'新底圖'}});
 assert.deepEqual(project,before);
 assert.deepEqual(next.nodes,project.nodes);assert.deepEqual(next.edges,project.edges);
 assert.deepEqual(next.operations,project.operations);assert.equal(next.title,'輸王田');
 assert.deepEqual(next.draftInfo,project.draftInfo);assert.equal(next.reference.width,30000);
 assert.notEqual(next.nodes,project.nodes);assert.notEqual(next.nodes[0],project.nodes[0]);
 next.nodes[0].enabled=false;next.edges[0].waypoints[0].x=0;
 assert.equal(project.nodes[0].enabled,true);assert.equal(project.edges[0].waypoints[0].x,21000);
});

test('discarding components removes old presets and identity while applying only the selected new background',()=>{
 const before=structuredClone(project),draftInfo={title:'新PDF底圖',reviewNotes:['底圖不參與通油']};
 const next=applyReference(project,reference,{keepComponents:false,title:'日南',draftInfo});
 assert.deepEqual(project,before);assert.deepEqual(next.nodes,[]);assert.deepEqual(next.edges,[]);
 assert.equal(next.title,'日南');assert.equal(next.reference.width,30000);
 assert.deepEqual(next.draftInfo,draftInfo);assert.notEqual(next.draftInfo,draftInfo);
 assert.equal(Object.hasOwn(next,'operations'),false);assert.equal(Object.hasOwn(next,'_savedDrawing'),false);
 const noMetadata=applyReference(project,reference,{keepComponents:false});
 assert.deepEqual(Object.keys(noMetadata).sort(),['edges','nodes','reference']);
});

test('invalid choices and backgrounds fail without clearing or modifying the working drawing',()=>{
 const before=structuredClone(project);
 for(const options of [{keepComponents:'false'},{keepComponents:0},{title:7},{draftInfo:[]}]){
  assert.throws(()=>applyReference(project,reference,options));assert.deepEqual(project,before);
 }
 assert.throws(()=>applyReference(project,{...reference,width:30001},{keepComponents:false}));
 assert.throws(()=>applyReference(project,{...reference,dataUrl:'javascript:alert(1)'},{keepComponents:false}));
 assert.deepEqual(project,before);
});
