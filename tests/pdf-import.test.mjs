import test from 'node:test';
import assert from 'node:assert/strict';
import {isPdfFile,normalizePdfOptions,readPdf} from '../dist/pdf-import.js';
import {readImage,draftFromOcr,analyzePreparedImage} from '../dist/image-draft.js';

test('PDF picker accepts MIME and uppercase file extension while rejecting unrelated files', () => {
  assert.equal(isPdfFile({type:'application/pdf',name:'drawing'}),true);
  assert.equal(isPdfFile({type:'application/octet-stream',name:'DRAWING.PDF'}),true);
  for(const value of [null,{}, {type:'image/png',name:'drawing.png'}, {name:'drawing.pdf.exe'}])assert.equal(isPdfFile(value),false);
});

test('PDF pages and quarter-turn rotation are validated without changing requested page', () => {
  assert.deepEqual(normalizePdfOptions(),{page:1,rotation:0});
  assert.deepEqual(normalizePdfOptions({page:12,rotation:-90}),{page:12,rotation:270});
  assert.deepEqual(normalizePdfOptions({page:2,rotation:450}),{page:2,rotation:90});
  for(const page of [0,-1,1.5,Infinity,NaN,'2'])assert.throws(()=>normalizePdfOptions({page}),/頁碼/);
  for(const rotation of [45,1.5,Infinity,NaN,'90'])assert.throws(()=>normalizePdfOptions({rotation}),/90°/);
});

test('PDF validation rejects empty/oversize files and cancellation before loading renderer', async () => {
  const pdf={type:'application/pdf',name:'drawing.pdf',size:50,arrayBuffer:async()=>new ArrayBuffer(50)};
  await assert.rejects(readPdf({...pdf,size:0}),/空的/);
  await assert.rejects(readPdf({...pdf,size:15*1024*1024+1}),/15 MB/);
  await assert.rejects(readPdf({...pdf,type:'image/png',name:'image.png'}),/選擇 PDF/);
  await assert.rejects(readPdf(pdf,{page:0}),/頁碼/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readPdf(pdf,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(readImage(pdf,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(analyzePreparedImage(null),/先載入/);
});

test('TC tank numbers from depot drawings become inactive review candidates without pipes', () => {
  const draft=draftFromOcr({words:[
    {text:'TC-12',confidence:95,bbox:{x0:100,y0:120,x1:180,y1:140}},
    {text:'TK-03',confidence:95,bbox:{x0:300,y0:120,x1:380,y1:140}}
  ]},1000,700);
  assert.deepEqual(draft.nodes.map(n=>[n.code,n.type,n.enabled,n.review]),[
    ['TC-12','tank',false,true],['TK-03','tank',false,true]
  ]);
  assert.deepEqual(draft.edges,[]);
});
