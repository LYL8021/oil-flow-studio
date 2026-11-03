import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudProjectStore} from '../dist/cloud-project-store.js';

const uuid='19706c9d-e2b3-4b93-9abc-182dd9f9e635',other='450be847-a82f-4511-a725-a385effb5e50';
const project={nodes:[{id:'tank',type:'tank',scale:30,portModes:{in:'outlet',out:'outlet'}}],edges:[],
  reference:{url:'data:image/png;base64,iVBORw0KGgo=',scale:10},operations:[{name:'雙出口'}]};
const item={id:uuid,name:'輸王田',revision:1,createdAt:1760000000000,updatedAt:1760000000000,
  nodeCount:1,edgeCount:0,operationCount:1};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const record=(changes={})=>({...item,project,...changes});

test('cloud client maps IDs, reads complete projects, and sends no cookies or local substitutes',async()=>{
  const calls=[],store=createCloudProjectStore({fetch:async(url,options)=>{calls.push({url,options});return response({item:record()});}});
  const saved=await store.get('cloud:'+uuid.toUpperCase());
  assert.equal(saved.id,'cloud:'+uuid);assert.equal(saved.scope,'cloud');assert.deepEqual(saved.project,project);
  assert.notEqual(saved.project,project);saved.project.nodes[0].scale=1;assert.equal(project.nodes[0].scale,30);
  assert.equal(calls[0].url,'https://oil-flow-studio.lililinomj330223.workers.dev/api/drawings/'+uuid);
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.mode,'cors');
});

test('cloud list and history read all bounded pages and preserve revision metadata',async()=>{
  const urls=[];const store=createCloudProjectStore({fetch:async(url)=>{
    urls.push(url);
    if(url.includes('/revisions'))return response({items:[item,{...item,revision:2,updatedAt:item.updatedAt+1}],total:2,nextCursor:null});
    return response(url.includes('cursor=')?{items:[{...item,id:other,name:'日南'}],total:2,nextCursor:null}:
      {items:[item],total:2,nextCursor:'next+cursor'});
  }});
  const list=await store.list();assert.deepEqual(list.map(x=>x.name),['輸王田','日南']);assert.match(urls[1],/cursor=next%2Bcursor/);
  const history=await store.revisions('cloud:'+uuid);assert.deepEqual(history.map(x=>x.revision),[1,2]);
  assert.match(urls[2],new RegExp('/'+uuid+'/revisions\\?limit=100$'));
});

test('cloud pagination rejects repeated cursors and duplicate rows rather than looping or hiding changes',async()=>{
  const store=createCloudProjectStore({fetch:async()=>response({items:[item],total:2,nextCursor:'again'})});
  await assert.rejects(store.list(),{code:'invalid-data'});
  const invalid=createCloudProjectStore({fetch:async()=>response({items:[{...item,revision:0}],total:1})});
  await assert.rejects(invalid.list(),{code:'invalid-data'});
});

test('retry after committed response loss reuses request ID, keeps full source/reference data, then clears it',async()=>{
  const requests=[];let attempt=0;
  const store=createCloudProjectStore({fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));if(attempt++===0)throw new TypeError('lost response');
    return response({item:record(),duplicate:attempt===2});
  }});
  const input={name:'輸王田',project};
  await assert.rejects(store.save(input),{code:'network'});
  const result=await store.save(input);assert.equal(result.id,'cloud:'+uuid);
  assert.equal(requests[0].requestId,requests[1].requestId);assert.deepEqual(requests[1].project,project);
  assert.equal(input.id,undefined);assert.equal(project.nodes[0].scale,30);
  await store.save(input);assert.notEqual(requests[2].requestId,requests[1].requestId);
});

test('ambiguous server failure preserves idempotency key while edited snapshot gets a new one',async()=>{
  const requests=[];const store=createCloudProjectStore({fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));return response({error:'暫時無法使用'},503);
  }});
  await assert.rejects(store.save({name:'輸王田',project}),{status:503});
  await assert.rejects(store.save({name:'輸王田',project}),{status:503});
  assert.equal(requests[0].requestId,requests[1].requestId);
  await assert.rejects(store.save({name:'另一張',project}),{status:503});
  assert.notEqual(requests[2].requestId,requests[1].requestId);
});

test('stale revisions surface conflict and cannot be retried as an unconditional update',async()=>{
  const requests=[];const store=createCloudProjectStore({fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));return response({error:'已有新版，請保留目前畫布後重新載入。',code:'conflict'},409);
  }});
  await assert.rejects(store.save({id:'cloud:'+uuid,expectedRevision:3,name:'輸王田',project}),{code:'conflict',status:409});
  assert.equal(requests[0].expectedRevision,3);assert.equal(requests[0].id,uuid);
  await assert.rejects(store.save({id:'cloud:'+uuid,name:'輸王田',project}),{code:'invalid-revision'});
  assert.equal(requests.length,1);
});

test('malformed success response retains retry ID because the server may already have saved',async()=>{
  const requests=[];const store=createCloudProjectStore({fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));return requests.length===1?new Response('not json',{status:200}):response({item:record()});
  }});
  await assert.rejects(store.save({name:'輸王田',project}),{code:'invalid-data'});
  await store.save({name:'輸王田',project});assert.equal(requests[0].requestId,requests[1].requestId);
});

test('invalid identifiers, versions and oversized UTF-8 payloads never issue a request',async()=>{
  let calls=0;const store=createCloudProjectStore({fetch:async()=>{calls++;return response(record());}});
  for(const id of ['../other','cloud:'+uuid+'/revisions','https://example.com',null]){
    await assert.rejects(store.get(id),{code:'not-found'});
  }
  await assert.rejects(store.getRevision(uuid,0),{code:'invalid-revision'});
  await assert.rejects(store.getRevision(uuid,1.5),{code:'invalid-revision'});
  await assert.rejects(store.save({name:'大圖',project:{nodes:[],edges:[],note:'油'.repeat(9*1024*1024)}}),{code:'too-large'});
  assert.equal(calls,0);
});

test('request timeout is reported honestly and can be retried with the same payload',async()=>{
  const ids=[];let calls=0;const store=createCloudProjectStore({timeoutMs:8,fetch:async(url,options)=>{
    ids.push(JSON.parse(options.body).requestId);
    if(calls++===0)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
    return response({item:record()});
  }});
  await assert.rejects(store.save({name:'輸王田',project}),{code:'timeout'});
  await store.save({name:'輸王田',project});assert.equal(ids[0],ids[1]);
});
