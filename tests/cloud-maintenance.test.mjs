import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/feedback-worker.js';

test('migration freeze blocks shared writes while preserving reads, CORS and preflight', async () => {
  let prepared=0;
  const DB={prepare(){prepared++;return {bind(){return this;},async all(){return {results:[]};},async first(){return {total:0};}};}};
  const env={SHARED_READ_ONLY:'1',DB};
  const request=(path,method='GET',origin='https://oil-flow-studio.vercel.app')=>new Request('https://service.example'+path,{method,headers:{Origin:origin}});
  for(const path of ['/api/feedback','/api/drawings','/api/drawings/11111111-1111-4111-8111-111111111111']) {
    for(const method of ['POST','DELETE']) {
      const response=await worker.fetch(request(path,method),env);
      assert.equal(response.status,503);assert.equal((await response.json()).code,'maintenance');
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://oil-flow-studio.vercel.app');
    }
  }
  assert.equal(prepared,0,'freeze must reject before a storage mutation or lookup');
  const read=await worker.fetch(request('/api/feedback'),env);
  assert.equal(read.status,200);assert.deepEqual((await read.json()).items,[]);
  assert.equal((await worker.fetch(request('/api/feedback','OPTIONS'),env)).status,204);
  assert.equal((await worker.fetch(request('/api/feedback','POST','https://unrelated.example'),env)).status,403);
  const unfrozen=await worker.fetch(request('/api/feedback','POST'),{...env,SHARED_READ_ONLY:'0'});
  assert.equal(unfrozen.status,415,'ordinary validation resumes when migration freeze is off');
});
